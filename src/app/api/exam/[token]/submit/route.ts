import { NextResponse } from "next/server";

import { SUBMIT_GRACE_SECONDS } from "@/lib/exam";
import { gradeAttempt, resolveInvite, sweepTimedOut } from "@/lib/exam-state";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/exam/[token]/submit — final submit, auto-submit at 00:00, and
 * the forfeit beacon (tab close / 3rd strike) all land here.
 * Body: { answers?: Record<questionId, optionText>, forfeit?: boolean }.
 *
 * Server-authoritative: elapsed time is measured from started_at on the
 * server. Within duration + grace ⇒ submitted; beyond it (or forfeit) ⇒
 * forfeited — but answers received are still graded in code either way,
 * so nobody loses credit for a slow network on the final click.
 * Idempotent: a second call returns the recorded result unchanged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const resolved = await resolveInvite(token);
  if (!resolved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: { answers?: Record<string, string>; forfeit?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // beacon with no body → treat as no answers
  }
  const answers = body.answers ?? {};

  const status = await sweepTimedOut(resolved);
  const admin = createAdminClient();
  const invite = resolved.invite;

  // Terminal: return the recorded outcome.
  if (status === "submitted") {
    return NextResponse.json({ status: "submitted", score: invite.score });
  }

  // Forfeited by strike-3 close race: the client submits its answers right
  // after the violation flipped the status. Grade them once, keep forfeited.
  if (status === "forfeited") {
    if (invite.submitted_at) {
      return NextResponse.json({ status: "forfeited", score: invite.score });
    }
    const graded = await gradeAttempt(resolved, answers);
    const { data: completed, error } = await admin.rpc("complete_exam_invite", {
      p_invite: invite.id,
      p_status: "forfeited",
      p_score: graded.score,
    });
    if (error) return NextResponse.json({ error: "submit_failed" }, { status: 500 });
    const row = Array.isArray(completed) ? completed[0] : completed;
    if (!row) {
      const current = await resolveInvite(token);
      return NextResponse.json({ status: current?.invite.status ?? "forfeited", score: current?.invite.score ?? invite.score });
    }
    return NextResponse.json({ status: row.status, score: row.score });
  }

  if (status !== "in_progress") {
    return NextResponse.json({ status }, { status: 409 });
  }

  const overtime =
    invite.started_at !== null &&
    Date.now() > Math.min(
      new Date(invite.started_at).getTime() +
        (resolved.exam.duration_minutes * 60 + SUBMIT_GRACE_SECONDS) * 1000,
      resolved.exam.available_until
        ? new Date(resolved.exam.available_until).getTime() + SUBMIT_GRACE_SECONDS * 1000
        : Number.POSITIVE_INFINITY
    );
  const finalStatus = body.forfeit || overtime ? "forfeited" : "submitted";

  const graded = await gradeAttempt(resolved, answers);
  const { data: completed, error } = await admin.rpc("complete_exam_invite", {
    p_invite: invite.id,
    p_status: finalStatus,
    p_score: graded.score,
  });
  if (error) return NextResponse.json({ error: "submit_failed" }, { status: 500 });
  const row = Array.isArray(completed) ? completed[0] : completed;
  if (!row) {
    const current = await resolveInvite(token);
    return NextResponse.json({ status: current?.invite.status ?? invite.status, score: current?.invite.score ?? invite.score });
  }

  return NextResponse.json({
    status: row.status,
    score: row.score,
    answered: graded.answered,
    drawn: graded.drawn,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
