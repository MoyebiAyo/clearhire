import { NextResponse } from "next/server";

import { buildIcs } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { one } from "@/lib/utils";

/**
 * GET /api/schedule/[token]/ics — token-authorized .ics download for the
 * confirmed interview.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("interviews")
    .select("id, scheduled_time, interviewer, location_or_link, applications(jobs(title))")
    .eq("schedule_token", token)
    .maybeSingle();

  const interview = row as unknown as {
    id: string;
    scheduled_time: string | null;
    interviewer: string | null;
    location_or_link: string | null;
    applications: { jobs: { title: string }[] | null } | null;
  } | null;

  if (!interview?.scheduled_time) {
    return NextResponse.json({ error: "not_scheduled" }, { status: 404 });
  }

  const title = one<{ title: string }>(interview.applications?.jobs)?.title ?? "Interview";
  const ics = buildIcs({
    uid: `interview-${interview.id}@clearhire`,
    start: new Date(interview.scheduled_time),
    summary: `Interview: ${title}`,
    description: `Interview with ${interview.interviewer ?? "the team"}.\nLocation/link: ${interview.location_or_link ?? "to be shared"}.`,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="interview.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
