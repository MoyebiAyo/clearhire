import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

export const maxDuration = 60;

/**
 * GET /api/jobs/[id]/applications/[appId]/insights — powers the candidate
 * "AI insights" view: (1) the exact BLIND payload the scoring model saw,
 * side-by-side with the recruiter's profile view, and (2) the candidate's
 * story — rationale, gaps, quotable CV evidence, and a deterministic
 * suggested next action. Evidence quotes are heuristic (keyword scan of
 * the raw CV text) so this endpoint stays fast and AI-free.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; appId: string }> }
) {
  const { id: jobId, appId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: app } = await supabase
    .from("applications")
    .select(
      "id, status, applied_at, revealed_at, candidates(name, email, source), cv_extractions(skills, experience_years, certifications, tools, education, raw_text), scores(skills_score, experience_score, certifications_score, tools_score, total_score, gaps, rationale), interviews(status, scheduled_time), exam_invites(status, score)"
    )
    .eq("id", appId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (!app) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  type AppRow = {
    id: string;
    status: string;
    applied_at: string;
    revealed_at: string | null;
    candidates: { name: string | null; email: string; source: string | null }[] | null;
    cv_extractions: {
      skills: string[] | null;
      experience_years: number | null;
      certifications: string[] | null;
      tools: string[] | null;
      education: { degree: string; institution: string }[] | null;
      raw_text: string | null;
    }[] | null;
    scores: {
      skills_score: number;
      experience_score: number;
      certifications_score: number;
      tools_score: number;
      total_score: number;
      gaps: { requirement: string; missing_skill: string | null; severity: "hard" | "nice-to-have" }[] | null;
      rationale: string | null;
    }[] | null;
    interviews: { status: string; scheduled_time: string | null }[] | null;
    exam_invites: { status: string; score: number | null }[] | null;
  };
  const row = app as unknown as AppRow;

  // Rank = position by final score among this job's scored applications.
  const { data: allScores } = await supabase
    .from("applications")
    .select("id, scores(total_score)")
    .eq("job_id", jobId);
  const ranked = ((allScores ?? []) as unknown as { id: string; scores: { total_score: number | null }[] | null }[])
    .map((a) => ({ id: a.id, total: Number(a.scores?.[0]?.total_score ?? -1) }))
    .sort((a, b) => b.total - a.total);
  const rank = ranked.findIndex((a) => a.id === appId) + 1;

  const extraction = one<NonNullable<AppRow["cv_extractions"]>[number]>(row.cv_extractions ?? []);
  const score = one<NonNullable<AppRow["scores"]>[number]>(row.scores ?? []);
  const interview = one<NonNullable<AppRow["interviews"]>[number]>(row.interviews ?? []);
  const exam = one<NonNullable<AppRow["exam_invites"]>[number]>(row.exam_invites ?? []);
  const cand = one<NonNullable<AppRow["candidates"]>[number]>(row.candidates ?? []);

  // Evidence quotes: heuristic keyword scan of the raw CV text — cheap,
  // deterministic, and quotable on screen. PDF text often arrives as few
  // very long lines, so split into sentence-like pieces first.
  const raw = (extraction?.raw_text ?? "").replace(/\r/g, "");
  const quotes: string[] = [];
  const seen = new Set<string>();
  const pieces = raw.split(/(?<=[.!?])\s+|\n+/).map((l) => l.trim());
  for (const piece of pieces) {
    if (quotes.length >= 2) break;
    if (piece.length < 40 || piece.length > 240) continue;
    if (!/\b(led|managed|mentored|built|shipped|delivered|designed|founded|migrated|reduced|improved|award|achiev)/i.test(piece)) continue;
    if (/\b(we are|you will|about the role|responsibilities|requirements)/i.test(piece)) continue;
    const key = piece.slice(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    quotes.push(piece);
  }

  const total = score ? Number(score.total_score) : null;
  const hasExamInvite = Boolean(exam);
  const interviewScheduled = interview?.status === "scheduled" || interview?.status === "completed";

  let nextAction: { label: string; reason: string } | null = null;
  if (row.status === "rejected") {
    nextAction = { label: "Undo rejection", reason: "This candidate is in the rejected list — the pipeline keeps everything reversible." };
  } else if (!score) {
    nextAction = { label: "Extract & score the CV", reason: "This CV hasn't been scored yet — the ranked shortlist can't include it." };
  } else if (total !== null && total < 60) {
    nextAction = { label: "Reject with a kind email", reason: "The blind total is below the usual 60 bar — a humane rejection with feedback closes the loop." };
  } else if (!hasExamInvite && total !== null && total >= 70) {
    nextAction = { label: "Invite to the AI exam", reason: "Strong blind profile (70+) — an exam verifies the skills before anyone meets anyone." };
  } else if (hasExamInvite && exam && !interviewScheduled && exam.status === "completed") {
    nextAction = { label: "Send an interview invite", reason: "The exam is done — the next step is a conversation." };
  } else if (interviewScheduled) {
    nextAction = { label: "Probe the gap areas in the interview", reason: "The interview is booked — the gap list below is your question bank." };
  } else if (total !== null && total >= 85) {
    nextAction = { label: "Reveal & send the offer email", reason: "Top-of-shortlist blind profile — move while the candidate is warm." };
  } else {
    nextAction = { label: "Reveal identity", reason: "You've reviewed the blind profile — reveal to make contact." };
  }

  return NextResponse.json({
    blind: {
      rank: rank || null,
      skills: extraction?.skills ?? [],
      experience_years: extraction?.experience_years ?? null,
      certifications: extraction?.certifications ?? [],
      tools: extraction?.tools ?? [],
      education: extraction?.education ?? [],
      subscores: score
        ? {
            skills: Number(score.skills_score),
            experience: Number(score.experience_score),
            certifications: Number(score.certifications_score),
            tools: Number(score.tools_score),
            total: Number(score.total_score),
          }
        : null,
      gaps: score?.gaps ?? [],
      rationale: score?.rationale ?? null,
      status: row.status,
      exam_status: exam?.status ?? null,
      exam_score: exam?.score ?? null,
    },
    profile: {
      name: cand?.name ?? null,
      email: cand?.email ?? null,
      source: cand?.source ?? null,
      applied_at: row.applied_at,
      revealed: row.revealed_at !== null,
      interview_status: interview?.status ?? null,
      interview_scheduled_time: interview?.scheduled_time ?? null,
    },
    story: { quotes, nextAction },
  });
}
