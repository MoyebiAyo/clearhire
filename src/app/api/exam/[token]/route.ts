import { NextResponse } from "next/server";

import { resolveInvite, sweepTimedOut } from "@/lib/exam-state";

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
  const { invite, exam, job } = resolved;

  return NextResponse.json({
    status,
    jobTitle: job?.title ?? "the role",
    questions: exam.questions_per_candidate,
    minutes: exam.duration_minutes,
    deadline: new Date(
      new Date(invite.created_at).getTime() + exam.start_deadline_hours * 3600_000
    ).toISOString(),
    startedAt: invite.started_at,
    endsAt: invite.started_at
      ? new Date(
          new Date(invite.started_at).getTime() + exam.duration_minutes * 60_000
        ).toISOString()
      : null,
    violations: invite.violations,
    maxStrikes: 3,
    serverNow: new Date().toISOString(),
  });
}
