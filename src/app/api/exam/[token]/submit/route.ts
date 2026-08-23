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
    await admin
      .from("exam_invites")
      .update({
        submitted_at: new Date().toISOString(),
        score: graded.score,
      })
      .eq("id", invite.id);
    return NextResponse.json({ status: "forfeited", score: graded.score });
  }

  if (status !== "in_progress") {
    return NextResponse.json({ status }, { status: 409 });
  }

  const overtime =
    invite.started_at !== null &&
    Date.now() >
      new Date(invite.started_at).getTime() +
        (resolved.exam.duration_minutes * 60 + SUBMIT_GRACE_SECONDS) * 1000;
  const finalStatus = body.forfeit || overtime ? "forfeited" : "submitted";

  const graded = await gradeAttempt(resolved, answers);
  await admin
    .from("exam_invites")
    .update({
      status: finalStatus,
      submitted_at: new Date().toISOString(),
      score: graded.score,
    })
    .eq("id", invite.id);

  return NextResponse.json({
    status: finalStatus,
    score: graded.score,
    answered: graded.answered,
    drawn: graded.drawn,
  });
}
