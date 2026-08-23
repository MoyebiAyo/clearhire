import { timingSafeEqual } from "crypto";
import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { ingestCv } from "@/lib/intake";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

export const maxDuration = 60;

/**
 * POST /api/mailbox/poll — scan connected Gmail inboxes for CV emails and
 * ingest them (spec 2.1 email intake).
 *
 * Auth: either the worker shared secret (cron) or a logged-in recruiter
 * (manual "Poll now" button). Idempotent per message via processed_emails.
 * Job matching: exact title → normalized title → word overlap; unmatched
 * CVs are preserved in the private bucket and flagged in unmatched_emails
 * for manual assignment — never dropped.
 */

function workerAuthorized(request: Request): boolean {
  const expected = process.env.CLOUDFLARE_WORKER_SHARED_SECRET;
  const provided = request.headers.get("x-worker-secret") ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
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

interface ConnectionRow {
  recruiter_id: string;
  gmail_address: string;
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viaWorker = workerAuthorized(request);
  if (!viaWorker && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Worker polls every connection; a recruiter polls their own.
  const { data: connections } = viaWorker
    ? await admin.from("gmail_connections").select("recruiter_id, gmail_address")
    : await admin
        .from("gmail_connections")
        .select("recruiter_id, gmail_address")
        .eq("recruiter_id", user!.id);
  const conns = (connections ?? []) as unknown as ConnectionRow[];
  if (conns.length === 0) {
    return NextResponse.json({ connections: 0, scanned: 0, ingested: 0, unmatched: 0, skipped: 0 });
  }

  const summary = { connections: conns.length, scanned: 0, ingested: 0, unmatched: 0, skipped: 0 };
  const errors: string[] = [];

  for (const conn of conns) {
    try {
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

      // Recent messages with attachments.
      const listRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=" +
          encodeURIComponent("has:attachment newer_than:7d -from:me") +
          "&maxResults=20",
        { headers: auth }
      );
      if (!listRes.ok) throw new Error(`gmail list failed (${listRes.status})`);
      const list = (await listRes.json()) as { messages?: { id: string }[] };

      const { data: openJobs } = await admin
        .from("jobs")
        .select("id, title")
        .eq("status", "open")
        .eq("recruiter_id", conn.recruiter_id);

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
          await admin.from("processed_emails").insert({
            message_id: msg.id,
            recruiter_id: conn.recruiter_id,
            action: "skipped",
            detail: { subject, reason: "no CV attachment" },
          });
          summary.skipped++;
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

        const job = matchJob(
          subject,
          full.snippet ?? "",
          (openJobs ?? []) as { id: string; title: string }[]
        );

        if (!job) {
          // Preserve the CV + flag for manual assignment — never drop.
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
    } catch (err) {
      errors.push(
        `${conn.gmail_address}: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  return NextResponse.json({ ...summary, errors });
}
