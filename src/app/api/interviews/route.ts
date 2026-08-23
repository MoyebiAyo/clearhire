import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { createReminderJobs } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/interviews — create an interview for an application.
 *
 * Body: { application_id, interviewer, location_or_link,
 *         slots?: string[] (1–3 future ISO — candidate self-scheduling),
 *         scheduled_time?: ISO (direct booking) }
 *
 * Direct bookings (scheduled_time) are confirmed at creation → the 4
 * reminder_jobs rows are written immediately (spec 2.4). Self-scheduling
 * interviews get their reminder rows when the candidate picks a slot.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const applicationId = body?.application_id as string | undefined;
  const interviewer = (body?.interviewer as string | undefined)?.trim();
  const location = (body?.location_or_link as string | undefined)?.trim();
  const slots = Array.isArray(body?.slots) ? (body.slots as string[]) : [];
  const scheduledTime = body?.scheduled_time as string | undefined;

  if (!applicationId || !interviewer || !location) {
    return NextResponse.json(
      { error: "application_id, interviewer and location_or_link are required." },
      { status: 400 }
    );
  }

  const validSlots = slots
    .filter((s) => !Number.isNaN(new Date(s).getTime()))
    .slice(0, 3);
  if (!scheduledTime && validSlots.length === 0) {
    return NextResponse.json(
      { error: "Offer at least one time slot, or book a time directly." },
      { status: 400 }
    );
  }

  // RLS: only the owning recruiter's application is visible here.
  const { data: app } = await supabase
    .from("applications")
    .select("id, jobs(title)")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const { data: interview, error } = await supabase
    .from("interviews")
    .insert({
      application_id: applicationId,
      interviewer,
      location_or_link: location,
      status: "scheduled",
      schedule_token: randomBytes(16).toString("hex"),
      offered_slots: validSlots.length > 0 ? validSlots : null,
      ...(scheduledTime && !Number.isNaN(new Date(scheduledTime).getTime())
        ? { scheduled_time: new Date(scheduledTime).toISOString() }
        : {}),
    })
    .select("id, schedule_token, scheduled_time")
    .single();

  if (error || !interview) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  let remindersCreated = 0;
  if (interview.scheduled_time) {
    remindersCreated = await createReminderJobs(
      supabase,
      interview.id,
      new Date(interview.scheduled_time)
    );
  }

  // Scheduling advances the pipeline (Kanban: Interview Scheduled).
  await supabase
    .from("applications")
    .update({
      status: "interview_scheduled",
      status_changed_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .in("status", ["applied", "screened", "shortlisted"]);

  return NextResponse.json({ interview, remindersCreated }, { status: 201 });
}
