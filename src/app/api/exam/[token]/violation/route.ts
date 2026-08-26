import { NextResponse } from "next/server";

import { MAX_STRIKES } from "@/lib/exam";
import { resolveInvite, sweepTimedOut } from "@/lib/exam-state";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/exam/[token]/violation { type } — record a proctoring strike
 * (tab switch, fullscreen exit, copy attempt, screenshot key, window
 * close). At MAX_STRIKES the attempt flips to `forfeited` server-side;
 * the client immediately submits whatever was answered, which is graded
 * in the submit route's late-answers path.
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

  const status = await sweepTimedOut(resolved);
  if (status !== "in_progress") {
    return NextResponse.json({ violations: resolved.invite.violations, forfeited: true, status });
  }

  let type = "unknown";
  try {
    type = ((await request.json()) as { type?: string }).type ?? "unknown";
  } catch {
    // keep default
  }

  const { data: updated, error } = await createAdminClient().rpc("record_exam_violation", {
    p_invite: resolved.invite.id,
    p_max: MAX_STRIKES,
  });
  if (error) return NextResponse.json({ error: "violation_failed" }, { status: 500 });
  const row = Array.isArray(updated) ? updated[0] : updated;
  const violations = Number(row?.violations ?? resolved.invite.violations);
  const forfeited = row?.status === "forfeited";

  return NextResponse.json({ violations, maxStrikes: MAX_STRIKES, forfeited });
}
