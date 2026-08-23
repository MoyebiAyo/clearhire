import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/applications/[id]/undo-rejection — restore a rejected
 * application to the active shortlist. Reverts to `screened` when the
 * candidate has a locked score (the score is still valid — it was computed
 * blind and never changes), otherwise back to `applied`.
 */
export async function POST(
  _request: Request,
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

  // RLS: only the owning recruiter can read/update this application.
  const { data: app } = await supabase
    .from("applications")
    .select("id, status, scores(id)")
    .eq("id", id)
    .maybeSingle();

  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (app.status !== "rejected") {
    return NextResponse.json(
      { error: "Only rejected applications can be restored." },
      { status: 400 }
    );
  }

  const hasScore =
    Array.isArray(app.scores) ? app.scores.length > 0 : Boolean(app.scores);
  const { error } = await supabase
    .from("applications")
    .update({
      status: hasScore ? "screened" : "applied",
      status_changed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    restored: true,
    status: hasScore ? "screened" : "applied",
  });
}
