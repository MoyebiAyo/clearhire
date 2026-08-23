import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { emailConfigured, emailFrom, logEmail, renderTemplate } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { one } from "@/lib/utils";

export const maxDuration = 60;

/**
 * POST /api/reminders/run — called by the Cloudflare Worker cron (and safe
 * to call manually). Auth: x-worker-secret must match
 * CLOUDFLARE_WORKER_SHARED_SECRET.
 *
 * Exactly-once semantics (spec 2.4): due rows are CLAIMED first via a
 * guarded update (…WHERE sent = false) so a concurrent double-invoke can
 * never claim — or send — the same reminder twice. If the batch send fails,
 * claimed rows are unclaimed so the next run retries them. Reminders for
 * interviews no longer in status 'scheduled' (cancelled/completed/
 * rescheduled-away) are skipped.
 */

function authorized(request: Request): boolean {
  const expected = process.env.CLOUDFLARE_WORKER_SHARED_SECRET;
  const provided = request.headers.get("x-worker-secret") ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface DueRow {
  id: string;
  offset_label: string;
  interview: {
    id: string;
    status: string;
    scheduled_time: string | null;
    interviewer: string | null;
    location_or_link: string | null;
    applications: unknown;
  } | null;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1. Due + unsent, with everything needed to compose the reminder.
  const { data: dueRows } = await admin
    .from("reminder_jobs")
    .select(
      "id, offset_label, interviews!inner(id, status, scheduled_time, interviewer, location_or_link, applications(id, candidates(name, email), jobs(title, recruiters(org_name))))"
    )
    .eq("sent", false)
    .lte("fire_at", new Date().toISOString());

  const due = ((dueRows ?? []) as unknown as DueRow[]).filter(
    (r) => r.interview?.status === "scheduled" && r.interview.scheduled_time
  );
  const skippedCancelled = (dueRows ?? []).length - due.length;
  if (due.length === 0) {
    return NextResponse.json({ due: 0, claimed: 0, sent: 0, skippedCancelled });
  }

  // 2. Reminder template (recruiter's own if any, else the shared default).
  const firstJob = one<{ recruiters: unknown }>(
    one<{ jobs: unknown }>(due[0].interview?.applications)?.jobs
  );
  const recruiterId = one<{ id: string }>(firstJob?.recruiters)?.id;
  let template: { subject: string; body: string } | null = null;
  if (recruiterId) {
    const { data: own } = await admin
      .from("email_templates")
      .select("subject, body")
      .eq("recruiter_id", recruiterId)
      .eq("type", "reminder")
      .limit(1);
    template = own?.[0] ?? null;
  }
  if (!template) {
    const { data: shared } = await admin
      .from("email_templates")
      .select("subject, body")
      .is("recruiter_id", null)
      .eq("type", "reminder")
      .eq("tone", "formal")
      .limit(1);
    template = shared?.[0] ?? null;
  }

  // 3. CLAIM atomically — the heart of exactly-once.
  const ids = due.map((r) => r.id);
  const { data: claimedRows, error: claimError } = await admin
    .from("reminder_jobs")
    .update({ sent: true, sent_at: new Date().toISOString() })
    .eq("sent", false)
    .in("id", ids)
    .select("id");
  const claimedIds = new Set((claimedRows ?? []).map((r) => (r as { id: string }).id));
  if (claimError || claimedIds.size === 0) {
    return NextResponse.json({
      due: due.length,
      claimed: claimedIds.size,
      sent: 0,
      skippedCancelled,
      note: claimError?.message ?? "nothing claimed (raced with another run)",
    });
  }
  const toSend = due.filter((r) => claimedIds.has(r.id));

  // 4. Compose + batch send via Resend.
  const emails = toSend.map((row) => {
    const app = one<{ id: string; candidates: unknown; jobs: unknown }>(
      row.interview?.applications
    );
    const candidate = one<{ name: string | null; email: string }>(app?.candidates);
    const job = one<{ title: string; recruiters: unknown }>(app?.jobs);
    const org = one<{ org_name: string | null }>(job?.recruiters)?.org_name;
    const fields = {
      candidate_name: candidate?.name?.split(" ")[0] || "there",
      recruiter_name: org ?? "the hiring team",
      job_title: job?.title ?? "your interview",
      interview_time: row.interview!.scheduled_time
        ? new Date(row.interview!.scheduled_time).toUTCString()
        : "(time to be confirmed)",
      location_or_link: row.interview?.location_or_link ?? "details to follow",
    };
    return {
      applicationId: app!.id,
      to: candidate!.email,
      subject: renderTemplate(template?.subject ?? "Reminder: your interview", fields),
      text: renderTemplate(
        template?.body ??
          "Hi {{candidate_name}},\n\nA reminder that your interview for {{job_title}} is on {{interview_time}} at {{location_or_link}}.\n\nSee you soon!",
        fields
      ),
    };
  });

  let sent = 0;
  if (emailConfigured() && emails.length > 0) {
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          emails.map((e) => ({
            from: emailFrom(),
            to: [e.to],
            subject: e.subject,
            text: e.text,
          }))
        ),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`batch HTTP ${res.status}`);
      sent = emails.length;
      for (const e of emails) {
        await logEmail(admin, {
          application_id: e.applicationId,
          type: "reminder",
          to_email: e.to,
          subject: e.subject,
          provider_message_id: null,
        });
      }
    } catch {
      // Send failed — unclaim so the next run retries these reminders.
      await admin
        .from("reminder_jobs")
        .update({ sent: false, sent_at: null })
        .in("id", [...claimedIds]);
      return NextResponse.json(
        {
          due: due.length,
          claimed: claimedIds.size,
          sent: 0,
          skippedCancelled,
          error: "batch-send-failed-reclaimed",
        },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({
    due: due.length,
    claimed: claimedIds.size,
    sent,
    skippedCancelled,
  });
}
