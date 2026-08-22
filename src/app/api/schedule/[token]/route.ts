import { NextResponse } from "next/server";

import { buildIcs, emailConfigured, logEmail, sendEmail } from "@/lib/email";
import { createReminderJobs } from "@/lib/reminders";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public, token-authorized scheduling endpoints (the token IS the
 * capability — 32 hex chars, unguessable, single-purpose).
 *
 * GET  /api/schedule/[token]  → job title, candidate first name, offered
 *                              slots (or the confirmed time).
 * POST /api/schedule/[token]  → { slot } picks a slot: sets scheduled_time,
 *                              writes the 4 reminder_jobs rows (spec 2.4),
 *                              and emails a confirmation with a .ics
 *                              attachment. Email failure is non-blocking —
 *                              the confirmation screen still offers the
 *                              .ics download.
 */
async function loadByToken(token: string) {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("interviews")
    .select(
      "id, status, scheduled_time, offered_slots, interviewer, location_or_link, applications(id, candidates(name, email), jobs(title, recruiters(org_name)))"
    )
    .eq("schedule_token", token)
    .maybeSingle();
  return row as unknown as
    | {
        id: string;
        status: string;
        scheduled_time: string | null;
        offered_slots: string[] | null;
        interviewer: string | null;
        location_or_link: string | null;
        applications:
          | {
              id: string;
              candidates: { name: string | null; email: string }[] | null;
              jobs: { title: string; recruiters: { org_name: string | null }[] | null }[] | null;
            }
          | null;
      }
    | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const row = await loadByToken(token);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const app = row.applications;
  return NextResponse.json({
    job_title: app?.jobs?.[0]?.title ?? "your interview",
    company: app?.jobs?.[0]?.recruiters?.[0]?.org_name,
    candidate_first_name:
      app?.candidates?.[0]?.name?.split(" ")[0] || "there",
    interviewer: row.interviewer,
    location_or_link: row.location_or_link,
    slots: (row.offered_slots ?? []).filter((s) => new Date(s).getTime() > Date.now()),
    scheduled_time: row.scheduled_time,
    status: row.status,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const slot = body?.slot as string | undefined;

  const row = await loadByToken(token);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.scheduled_time) {
    return NextResponse.json(
      { error: "already_scheduled", scheduled_time: row.scheduled_time },
      { status: 409 }
    );
  }

  const offered = row.offered_slots ?? [];
  if (!slot || !offered.includes(slot) || new Date(slot).getTime() <= Date.now()) {
    return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("interviews")
    .update({ scheduled_time: slot })
    .eq("id", row.id);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  // Spec 2.4: on confirmation, exactly 4 reminder rows (2d/1d/12h/2h before).
  await createReminderJobs(admin, row.id, new Date(slot));

  // Confirmation email with .ics — non-blocking on failure.
  const app = row.applications;
  const candidateEmail = app?.candidates?.[0]?.email;
  const jobTitle = app?.jobs?.[0]?.title ?? "your interview";
  const company = app?.jobs?.[0]?.recruiters?.[0]?.org_name ?? "the hiring team";
  let emailSent = false;
  if (candidateEmail && emailConfigured()) {
    const ics = buildIcs({
      uid: `interview-${row.id}@clearhire`,
      start: new Date(slot),
      summary: `Interview: ${jobTitle}`,
      description: `Interview with ${row.interviewer ?? "the team"}.\nLocation/link: ${row.location_or_link ?? "to be shared"}.`,
    });
    const when = new Date(slot).toUTCString();
    const result = await sendEmail({
      to: candidateEmail,
      subject: `Confirmed: your ${jobTitle} interview`,
      text: `Great news — your interview is confirmed!\n\nRole: ${jobTitle}\nWhen: ${when}\nWhere: ${row.location_or_link ?? "details to follow"}\n\nThe calendar file is attached — we've also scheduled friendly reminders so it won't sneak up on you.\n\nSee you soon,\n${company}`,
      attachment: {
        filename: "interview.ics",
        contentBase64: Buffer.from(ics, "utf-8").toString("base64"),
      },
    });
    if (result.ok) {
      emailSent = true;
      await logEmail(admin, {
        application_id: app!.id,
        type: "confirmation",
        to_email: candidateEmail,
        subject: `Confirmed: your ${jobTitle} interview`,
        provider_message_id: result.providerMessageId ?? null,
      });
    }
  }

  return NextResponse.json({
    scheduled_time: slot,
    email_sent: emailSent,
    ics_url: `/api/schedule/${token}/ics`,
  });
}
