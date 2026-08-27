import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { jobStatusSchema, requirementsSchema, weightsSchema } from "@/lib/validation";

export async function GET(
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

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

/**
 * PATCH /api/jobs/[id] — modes (combinable except status):
 *
 * 1. { status }                      → open/close the job.
 * 2. { weight_* } (+ optional jd_text unchanged)
 *    → save new rubric weights and RECOMPUTE all existing total_scores in
 *      code from the stored blind sub-scores. No LLM call — a uniform rubric
 *      re-score keeps the blind boundary intact (payload never changes).
 * 3. { jd_text } changed              → save the new JD, drop the cached
 *      requirements AND the job's scores rows (warned in the UI), so the
 *      recruiter re-runs "Score blind" under the new requirements.
 * 4. { requirements }                 → replace the authored scoring
 *      criteria (empty array = back to AI derivation from the JD). A change
 *      clears existing scores, same as a JD change.
 */
export async function PATCH(
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

  const json = await request.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── Mode 1: status toggle ──
  if (jobStatusSchema.safeParse(json.status).success && !("weight_skills" in json)) {
    const { data: job, error } = await supabase
      .from("jobs")
      .update({ status: jobStatusSchema.parse(json.status) })
      .eq("id", id)
      .select("id, status")
      .single();
    if (error || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ job });
  }

  // ── Modes 2 & 3: rubric / JD editing ──
  const parsed = weightsSchema.safeParse({
    weight_skills: Number(json.weight_skills),
    weight_experience: Number(json.weight_experience),
    weight_certifications: Number(json.weight_certifications),
    weight_tools: Number(json.weight_tools),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid weights" },
      { status: 400 }
    );
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, jd_text, requirements, weight_skills, weight_experience, weight_certifications, weight_tools")
    .eq("id", id)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const newJd =
    typeof json.jd_text === "string" && json.jd_text.trim().length >= 30
      ? json.jd_text.trim()
      : null;
  const jdChanged = newJd !== null && newJd !== job.jd_text;
  const weightsChanged =
    parsed.data.weight_skills !== Number(job.weight_skills) ||
    parsed.data.weight_experience !== Number(job.weight_experience) ||
    parsed.data.weight_certifications !== Number(job.weight_certifications) ||
    parsed.data.weight_tools !== Number(job.weight_tools);

  // Optional scoring-criteria override (rides along with the weights).
  let cleanedReqs: { requirement: string; type: "hard" | "nice-to-have" }[] | null = null;
  let requirementsChanged = false;
  if (Array.isArray(json.requirements)) {
    const filtered = (json.requirements as { requirement?: unknown; type?: unknown }[])
      .filter((r) => typeof r?.requirement === "string" && r.requirement.trim().length >= 2)
      .map((r) => ({
        requirement: String(r.requirement).trim(),
        type: r.type === "nice-to-have" ? ("nice-to-have" as const) : ("hard" as const),
      }));
    const parsedReqs = requirementsSchema.safeParse(filtered);
    if (!parsedReqs.success) {
      return NextResponse.json(
        { error: "Invalid scoring criteria — keep each between 2 and 240 characters, max 30." },
        { status: 400 }
      );
    }
    cleanedReqs = parsedReqs.data;
    const existing = Array.isArray(job.requirements) ? (job.requirements as typeof cleanedReqs) : [];
    requirementsChanged = JSON.stringify(existing) !== JSON.stringify(cleanedReqs);
  }

  if (!jdChanged && !weightsChanged && !requirementsChanged) {
    return NextResponse.json({ job, changed: false });
  }

  const update: Record<string, unknown> = { ...parsed.data };
  if (jdChanged) {
    update.jd_text = newJd;
    update.requirements_cache = null;
  }
  if (requirementsChanged) {
    update.requirements = cleanedReqs;
  }

  const { error: updateError } = await supabase
    .from("jobs")
    .update(update)
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  let recomputed = 0;
  let scoresCleared = 0;

  if (jdChanged || requirementsChanged) {
    // The yardstick changed → existing scores no longer apply. Remove them so
    // "Score blind" re-runs cleanly (idempotency: only unscored apps run).
    const { data: apps } = await supabase
      .from("applications")
      .select("id")
      .eq("job_id", id);
    for (const app of apps ?? []) {
      const { data: deleted } = await supabase
        .from("scores")
        .delete()
        .eq("application_id", app.id)
        .select("id");
      scoresCleared += deleted?.length ?? 0;
    }
  } else if (weightsChanged) {
    // Weights-only change → recompute totals in code from stored sub-scores.
    const { data: apps } = await supabase
      .from("applications")
      .select("id, scores(id, skills_score, experience_score, certifications_score, tools_score)")
      .eq("job_id", id);
    for (const app of apps ?? []) {
      const s = (app.scores as unknown[] | null)?.[0] as
        | {
            id: string;
            skills_score: number;
            experience_score: number;
            certifications_score: number;
            tools_score: number;
          }
        | undefined;
      if (!s) continue;
      const total =
        (Number(s.skills_score) * parsed.data.weight_skills +
          Number(s.experience_score) * parsed.data.weight_experience +
          Number(s.certifications_score) * parsed.data.weight_certifications +
          Number(s.tools_score) * parsed.data.weight_tools) /
        100;
      await supabase
        .from("scores")
        .update({ total_score: Math.round(total * 10) / 10 })
        .eq("id", s.id);
      recomputed++;
    }
  }

  return NextResponse.json({
    job: { id },
    changed: true,
    recomputed,
    scoresCleared,
    jdChanged,
    requirementsChanged,
  });
}
