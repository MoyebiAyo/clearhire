import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/applications/[id]/reveal — persist the recruiter's identity
 * reveal (applications.revealed_at) so it stays revealed.
 *
 * Per spec Part 5 this is a presentation gate, NOT a security boundary:
 * identity data is only ever served to the authenticated, RLS-authorized
 * recruiter either way. Scores were locked before any reveal can happen and
 * are never recomputed per-candidate after it.
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

  const { data: app } = await supabase
    .from("applications")
    .select("id, revealed_at")
    .eq("id", id)
    .maybeSingle();

  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (app.revealed_at) {
    return NextResponse.json({ revealed_at: app.revealed_at });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("applications")
    .update({ revealed_at: now })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ revealed_at: now });
}
