import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/applications/[id]/resolve-duplicate — the recruiter's
 * "merge / keep separate" decision on a flagged duplicate (spec 2.6).
 *
 * Body: { action: "keep_both" | "use_this" }
 *  - keep_both → dismiss the flag on THIS application.
 *  - use_this  → the flagged (newer) application is canonical: other
 *                applications from the same candidate to the same job are
 *                removed (their interviews/reminders/scores cascade), then
 *                the flag clears.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action as string | undefined;
  if (action !== "keep_both" && action !== "use_this") {
    return NextResponse.json({ error: "action must be keep_both or use_this" }, { status: 400 });
  }

  const { data: app } = await supabase
    .from("applications")
    .select("id, candidate_id, job_id")
    .eq("id", id)
    .maybeSingle();
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (action === "keep_both") {
    const { error } = await supabase
      .from("applications")
      .update({ flagged_duplicate: false })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ resolved: "keep_both" });
  }

  // use_this: remove sibling applications (same candidate + job), keep this one.
  const { data: siblings } = await supabase
    .from("applications")
    .select("id, applied_at")
    .eq("candidate_id", app.candidate_id)
    .eq("job_id", app.job_id)
    .neq("id", id);
  let removed = 0;
  for (const s of siblings ?? []) {
    const { error } = await supabase.from("applications").delete().eq("id", s.id);
    if (!error) removed++;
  }
  const { error: flagError } = await supabase
    .from("applications")
    .update({ flagged_duplicate: false })
    .eq("id", id);
  if (flagError) {
    return NextResponse.json({ error: flagError.message }, { status: 500 });
  }
  return NextResponse.json({ resolved: "use_this", removed });
}
