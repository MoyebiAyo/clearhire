import { randomUUID } from "crypto";

import { ingestCv } from "@/lib/intake";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared Gmail inbox scanner (spec 2.1 email intake), used by BOTH:
 *  - the global poll (cron / Settings "Poll now") — routes each CV email to
 *    the best-matching OPEN job; unmatched CVs are preserved in the private
 *    bucket and flagged for manual assignment, never dropped;
 *  - the per-job pull (job page "Pull from Gmail") — ingests only emails
 *    whose subject matches THAT job; everything else is left untouched for
 *    the global poll (never marked processed).
 *
 * Idempotent per message via processed_emails in both modes.
 */

export interface MailboxSummary {
  connections: number;
  scanned: number;
  ingested: number;
  unmatched: number;
  skipped: number;
  /** Scoped mode only: emails seen but not about this job — left for the global poll. */
  other: number;
  errors: string[];
}

export interface ConnectionRow {
  recruiter_id: string;
  gmail_address: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function matchJob(
  subject: string,
  snippet: string,
  jobs: { id: string; title: string }[]
): { id: string; title: string } | null {
  const s = subject.toLowerCase();
  const ns = norm(subject);
  const words = norm(`${subject} ${snippet.slice(0, 400)}`).split(" ");
  for (const job of jobs) {
    if (s.includes(job.title.toLowerCase())) return job;
  }
  for (const job of jobs) {
    if (ns.includes(norm(job.title))) return job;
  }
  let best: { job: (typeof jobs)[number]; score: number } | null = null;
  for (const job of jobs) {
    const titleWords = norm(job.title).split(" ").filter((w) => w.length > 3);
    if (titleWords.length === 0) continue;
    const hits = titleWords.filter((w) => words.includes(w)).length;
    const score = hits / titleWords.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { job, score };
  }
  return best?.job ?? null;
}

/**
 * Scan one connection's inbox and update `summary` in place.
 * When `jobScope` is set, only emails matching that job are touched.
 */
export async function pollConnection(
  conn: ConnectionRow,
  summary: MailboxSummary,
  jobScope?: { id: string; title: string }
): Promise<void> {
  const admin = createAdminClient();

  // Decrypt refresh token (server-only) → access token.
  const { data: token } = await admin.rpc("gmail_get_token", {
    p_recruiter: conn.recruiter_id,
    p_key: process.env.GMAIL_ENCRYPTION_KEY!,
  });
  if (!token) throw new Error("no stored token");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: token as string,
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokenRes.ok || !tokens.access_token) {
    throw new Error(`gmail auth failed (${tokenRes.status})`);
  }
  const auth = { Authorization: `Bearer ${tokens.access_token}` };

  // Recent incoming messages with attachments only (never the recruiter's
  // own outbox).
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=" +
      encodeURIComponent("has:attachment newer_than:7d -from:me") +
      "&maxResults=20",
    { headers: auth }
  );
  if (!listRes.ok) throw new Error(`gmail list failed (${listRes.status})`);
  const list = (await listRes.json()) as { messages?: { id: string }[] };

  // Scoped pulls match against the target job regardless of status (the
  // recruiter is on that job's page — explicit intent); the global poll
  // only routes to OPEN jobs.
  let openJobs: { id: string; title: string }[] = [];
  if (jobScope) {
    openJobs = [jobScope];
  } else {
    const { data } = await admin
      .from("jobs")
      .select("id, title")
      .eq("status", "open")
      .eq("recruiter_id", conn.recruiter_id);
    openJobs = (data ?? []) as { id: string; title: string }[];
  }

  for (const msg of list.messages ?? []) {
    summary.scanned++;

    // Idempotency: skip already-processed messages.
    const { data: seen } = await admin
      .from("processed_emails")
      .select("message_id")
      .eq("message_id", msg.id)
      .maybeSingle();
    if (seen) {
      summary.skipped++;
      continue;
    }

    const fullRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: auth }
    );
    if (!fullRes.ok) continue;
    const full = (await fullRes.json()) as {
      snippet?: string;
      internalDate?: string;
      payload?: {
        headers?: { name: string; value: string }[];
        parts?: {
          filename?: string;
          mimeType?: string;
          body?: { attachmentId?: string; size?: number };
        }[];
      };
    };

    const headers = full.payload?.headers ?? [];
    const header = (n: string) =>
      headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";
    const fromRaw = header("from");
    const senderEmail = (fromRaw.match(/<([^>]+)>/) ?? [, fromRaw])[1] as string;
    const senderName = fromRaw.includes("<")
      ? fromRaw.slice(0, fromRaw.indexOf("<")).replace(/["']/g, "").trim()
      : null;
    const subject = header("subject");

    // First PDF/DOCX attachment part.
    const part = (full.payload?.parts ?? []).find(
      (p) => p.filename && /\.(pdf|docx)$/i.test(p.filename) && p.body?.attachmentId
    );
    if (!part || !part.body?.attachmentId) {
      if (jobScope) {
        // Not this job's concern — let the global poll decide.
        summary.other++;
      } else {
        await admin.from("processed_emails").insert({
          message_id: msg.id,
          recruiter_id: conn.recruiter_id,
          action: "skipped",
          detail: { subject, reason: "no CV attachment" },
        });
        summary.skipped++;
      }
      continue;
    }

    // Scoped: bail before the attachment fetch if the email isn't about
    // this job — Gmail API calls aren't free.
    if (jobScope && !matchJob(subject, full.snippet ?? "", openJobs)) {
      summary.other++;
      continue;
    }

    const attRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${part.body.attachmentId}`,
      { headers: auth }
    );
    if (!attRes.ok) continue;
    const att = (await attRes.json()) as { data?: string; size?: number };
    if (!att.data) continue;
    const buffer = Buffer.from(att.data, "base64");

    const job = matchJob(subject, full.snippet ?? "", openJobs);
    if (!job) {
      // Global mode: preserve the CV + flag for manual assignment — never drop.
      const path = `unmatched/${conn.recruiter_id}/${randomUUID()}-${part.filename!.replace(/[^\w.\-]+/g, "_")}`;
      await admin.storage.from("cvs").upload(path, buffer, {
        contentType: "application/octet-stream",
      });
      await admin.from("unmatched_emails").insert({
        recruiter_id: conn.recruiter_id,
        sender_name: senderName,
        sender_email: senderEmail,
        subject,
        snippet: full.snippet?.slice(0, 500) ?? null,
        attachment_name: part.filename!,
        storage_path: path,
        received_at: full.internalDate
          ? new Date(Number(full.internalDate)).toISOString()
          : null,
      });
      await admin.from("processed_emails").insert({
        message_id: msg.id,
        recruiter_id: conn.recruiter_id,
        action: "unmatched",
        detail: { subject, sender: senderEmail },
      });
      summary.unmatched++;
      continue;
    }

    const outcome = await ingestCv({
      jobId: job.id,
      filename: part.filename!,
      buffer,
      candidateEmail: senderEmail,
      candidateName: senderName,
      source: "email",
    });
    await admin.from("processed_emails").insert({
      message_id: msg.id,
      recruiter_id: conn.recruiter_id,
      action: outcome.status === "created" ? "ingested" : "skipped",
      detail: {
        subject,
        job: job.title,
        application_id: outcome.applicationId ?? null,
        duplicate: outcome.duplicate ?? false,
        note: outcome.message,
      },
    });
    if (outcome.status === "created") summary.ingested++;
    else summary.skipped++;
  }

  await admin
    .from("gmail_connections")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("recruiter_id", conn.recruiter_id);
}
