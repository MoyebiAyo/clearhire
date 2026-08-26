import { NextResponse } from "next/server";

import { drawForCandidate, optionOrderFor, SUBMIT_GRACE_SECONDS } from "@/lib/exam";
import { resolveInvite, sweepTimedOut } from "@/lib/exam-state";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/exam/[token]/questions — the candidate's stable, seeded draw
 * (same questions + option order on every call) with correct_index
 * stripped. Served only while the attempt is genuinely running.
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
  if (status !== "in_progress") {
    return NextResponse.json({ status }, { status: 409 });
  }

  const overtime =
    resolved.invite.started_at !== null &&
    Date.now() > Math.min(
      new Date(resolved.invite.started_at).getTime() +
        (resolved.exam.duration_minutes * 60 + SUBMIT_GRACE_SECONDS) * 1000,
      resolved.exam.available_until
        ? new Date(resolved.exam.available_until).getTime() + SUBMIT_GRACE_SECONDS * 1000
        : Number.POSITIVE_INFINITY
    );
  if (overtime) {
    return NextResponse.json({ status: "forfeited" }, { status: 409 });
  }

  const admin = createAdminClient();
  const { data: questions } = await admin
    .from("exam_questions")
    .select("id, topic, difficulty, question, options, correct_index")
    .eq("exam_id", resolved.exam.id);
  const all = questions ?? [];
  if (all.length === 0) {
    return NextResponse.json({ error: "no_questions" }, { status: 500 });
  }

  const drawnIds = drawForCandidate(
    token,
    all.map((q) => q.id),
    resolved.exam.questions_per_candidate
  );
  const byId = new Map(all.map((q) => [q.id, q]));

  const payload = drawnIds
    .map((qid) => byId.get(qid))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map((q) => {
      const options: string[] = Array.isArray(q.options) ? q.options : [];
      const order = optionOrderFor(token, q.id);
      return {
        id: q.id,
        topic: q.topic,
        difficulty: q.difficulty,
        question: q.question,
        // Shuffled per candidate; correct_index deliberately omitted.
        options: order.map((i) => options[i] ?? ""),
      };
    });

  return NextResponse.json({
    questions: payload,
    endsAt: new Date(Math.min(
      new Date(resolved.invite.started_at!).getTime() + resolved.exam.duration_minutes * 60_000,
      resolved.exam.available_until
        ? new Date(resolved.exam.available_until).getTime()
        : Number.POSITIVE_INFINITY
    )).toISOString(),
    serverNow: new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
