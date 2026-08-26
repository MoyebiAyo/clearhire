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
  const criteriaScores = body?.criteria_scores && typeof body.criteria_scores === "object"
    ? body.criteria_scores as Record<string, number>
    : null;

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "Rating must be a number between 1 and 5." },
      { status: 400 }
    );
  }

  const { data: interview } = await supabase
    .from("interviews")
    .select("id, application_id, applications(jobs(interview_scorecard_config))")
    .eq("id", id)
    .maybeSingle();
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  const app = Array.isArray(interview.applications) ? interview.applications[0] : interview.applications;
  const job = app?.jobs ? (Array.isArray(app.jobs) ? app.jobs[0] : app.jobs) : null;
  const config = Array.isArray(job?.interview_scorecard_config)
    ? job.interview_scorecard_config as { id: string; weight: number }[]
    : [];
  let weightedRating: number | null = null;
  if (criteriaScores && config.length > 0) {
    const valid = config.every((criterion) => {
      const value = Number(criteriaScores[criterion.id]);
      return Number.isFinite(value) && value >= 1 && value <= 5;
    });
    if (!valid) return NextResponse.json({ error: "Score every interview criterion from 1 to 5." }, { status: 400 });
    weightedRating = Math.round(
      config.reduce((sum, criterion) => sum + Number(criteriaScores[criterion.id]) * Number(criterion.weight), 0)
    ) / 100;
  }

  const { error } = await supabase.from("interview_scorecards").insert({
    interview_id: id,
    interviewer_rating: weightedRating ?? rating,
    interviewer_notes: notes,
    criteria_scores: criteriaScores,
    weighted_rating: weightedRating,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase
    .from("applications")
    .update({ status: "interviewed", status_changed_at: new Date().toISOString() })
    .eq("id", interview.application_id);

  return NextResponse.json({ saved: true, weighted_rating: weightedRating ?? rating }, { status: 201 });
}
