import { NextResponse } from "next/server";

import { examAvailability, resolveInvite, sweepTimedOut } from "@/lib/exam-state";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/exam/[token]/start — begin the timed attempt. Only while
 * `invited` and before the start deadline; idempotent if already running
 * (resume after refresh).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const resolved = await resolveInvite(token);
  if (!resolved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const swept = await sweepTimedOut(resolved);
  const availability = examAvailability(resolved);
  if (swept === "invited" && availability.state === "scheduled") {
    return NextResponse.json(
      { status: "scheduled", availableFrom: availability.availableFrom },
      { status: 409 }
    );
  }
  if (swept !== "invited" && swept !== "in_progress") {
    return NextResponse.json({ status: swept }, { status: 409 });
  }

  if (swept === "in_progress" && resolved.invite.started_at) {
    return NextResponse.json({ startedAt: resolved.invite.started_at });
  }

  const { data: started, error } = await createAdminClient().rpc("start_exam_invite", {
    p_invite: resolved.invite.id,
  });
  if (error) {
    return NextResponse.json({ error: "start_failed" }, { status: 500 });
  }
  const row = Array.isArray(started) ? started[0] : started;
  return NextResponse.json({ startedAt: row?.started_at ?? resolved.invite.started_at });
}
