import "server-only";

import { emailConfigured, emailFrom, logEmail, renderTemplate } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { one } from "@/lib/utils";

/**
 * The exactly-once reminder engine (spec 2.4). Shared by the
 * worker-called route and the demo "fire now" action. See Week 5 notes for
 * the live concurrency test that verified claim semantics.
 */

interface DueRow {
  id: string;
  offset_label: string;
  /** PostgREST embed key = relation name ("interviews"). */
  interviews: {
    id: string;
    status: string;
    scheduled_time: string | null;
    interviewer: string | null;
    location_or_link: string | null;
    applications: unknown;
  } | null;
}


export async function runDueReminders(recruiterId?: string): Promise<{ status: number; body: unknown }> {
const admin = createAdminClient();

  // 1. Due + unsent, with everything needed to compose the reminder.
  const { data: dueRows } = await admin
    .from("reminder_jobs")
    .select(
      "id, offset_label, interviews!inner(id, status, scheduled_time, interviewer, location_or_link, applications(id, candidates(name, email), jobs(title, recruiter_id, recruiters(id, org_name))))"
    )
    .eq("sent", false)
    .lte("fire_at", new Date().toISOString());

  const due = ((dueRows ?? []) as unknown as DueRow[]).filter((r) => {
    if (r.interviews?.status !== "scheduled" || !r.interviews.scheduled_time) return false;
    if (!recruiterId) return true;
    const app = one<{ jobs: unknown }>(r.interviews.applications);
    const job = one<{ recruiter_id?: string; recruiters?: unknown }>(app?.jobs);
    return job?.recruiter_id === recruiterId || one<{ id: string }>(job?.recruiters)?.id === recruiterId;
  });
  const skippedCancelled = (dueRows ?? []).length - due.length;
  if (due.length === 0) {
    return (function json(o: unknown, s?: number) { return { status: s ?? 200, body: o }; })({ due: 0, claimed: 0, sent: 0, skippedCancelled });
  }

  // 2. Reminder template (recruiter's own if any, else the shared default).
  const firstJob = one<{ recruiters: unknown }>(
    one<{ jobs: unknown }>(due[0].interviews?.applications)?.jobs
  );
  const templateRecruiterId = one<{ id: string }>(firstJob?.recruiters)?.id;
  let template: { subject: string; body: string } | null = null;
  if (templateRecruiterId) {
    const { data: own } = await admin
      .from("email_templates")
      .select("subject, body")
      .eq("recruiter_id", templateRecruiterId)
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
    return (function json(o: unknown, s?: number) { return { status: s ?? 200, body: o }; })({
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
      row.interviews?.applications
    );
    const candidate = one<{ name: string | null; email: string }>(app?.candidates);
    const job = one<{ title: string; recruiters: unknown }>(app?.jobs);
    const org = one<{ org_name: string | null }>(job?.recruiters)?.org_name;
    const fields = {
      candidate_name: candidate?.name?.split(" ")[0] || "there",
      recruiter_name: org ?? "the hiring team",
      job_title: job?.title ?? "your interview",
      interview_time: row.interviews!.scheduled_time
        ? new Date(row.interviews!.scheduled_time).toUTCString()
        : "(time to be confirmed)",
      location_or_link: row.interviews?.location_or_link ?? "details to follow",
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
      return (function json(o: unknown, s?: number) { return { status: s ?? 200, body: o }; })(
        {
          due: due.length,
          claimed: claimedIds.size,
          sent: 0,
          skippedCancelled,
          error: "batch-send-failed-reclaimed",
        },
        502
      );
    }
  }

  return (function json(o: unknown, s?: number) { return { status: s ?? 200, body: o }; })({
    due: due.length,
    claimed: claimedIds.size,
    sent,
    skippedCancelled,
  });
}
