import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/interviews/[id]/scorecard — spec 2.5: short structured form
 * (rating + notes) stored in interview_scorecards next to the AI's original
 * score for later comparison. Also advances the application to
 * 'interviewed'.
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
  const rating = Number(body?.interviewer_rating);
  const notes = (body?.interviewer_notes as string | undefined)?.trim() || null;

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "Rating must be a number between 1 and 5." },
      { status: 400 }
    );
  }

  const { data: interview } = await supabase
    .from("interviews")
    .select("id, application_id")
    .eq("id", id)
    .maybeSingle();
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  const { error } = await supabase.from("interview_scorecards").insert({
    interview_id: id,
    interviewer_rating: rating,
    interviewer_notes: notes,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase
    .from("applications")
    .update({ status: "interviewed", status_changed_at: new Date().toISOString() })
    .eq("id", interview.application_id);

  return NextResponse.json({ saved: true }, { status: 201 });
}
