import { NextResponse } from "next/server";

import { examAvailability, resolveInvite, sweepTimedOut } from "@/lib/exam-state";

/**
 * GET /api/exam/[token] — public state summary for the candidate's exam
 * page. The token is the capability; no session required.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const resolved = await resolveInvite(token);
  if (!resolved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const status = await sweepTimedOut(resolved);
  const availability = examAvailability(resolved);
  const { invite, exam, job } = resolved;

  return NextResponse.json({
    status: status === "invited" && availability.state === "scheduled" ? "scheduled" : status,
    jobTitle: job?.title ?? "the role",
    questions: exam.questions_per_candidate,
    minutes: exam.duration_minutes,
    availableFrom: availability.availableFrom,
    deadline: availability.availableUntil,
    startedAt: invite.started_at,
    endsAt: invite.started_at
      ? new Date(
          new Date(invite.started_at).getTime() + exam.duration_minutes * 60_000
        ).toISOString()
      : null,
    violations: invite.violations,
    maxStrikes: 3,
    serverNow: new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
