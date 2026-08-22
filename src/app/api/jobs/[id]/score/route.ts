import { NextResponse } from "next/server";

import { chatJSON, debugAI, mapWithConcurrency } from "@/lib/ai";
import { parseRequirements, parseScoring, type Requirement } from "@/lib/ai-schemas";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const CONCURRENCY = 2;

export interface ScoreReportItem {
  application_id: string;
  email: string | null;
  status: "scored" | "failed";
  total_score?: number;
  message?: string;
}

/**
 * POST /api/jobs/[id]/score — spec Part 6 blind scoring pass, verbatim prompt.
 *
 * BLIND BOUNDARY (spec 2.2 + Part 7): the scoring payload is built
 * server-side from cv_extractions ONLY — skills, experience_years,
 * certifications, tools. Name, email, education/school, and any other
 * identifying field are NEVER included. The exact outgoing payload is
 * logged as [blind-audit] lines — this is the hackathon evidence that the
 * boundary is enforced at the API layer, not just hidden in the UI.
 *
 * total_score is computed in code as the weighted sum of the four sub-scores
 * under the job's rubric — the model never does arithmetic.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, jd_text, weight_skills, weight_experience, weight_certifications, weight_tools, requirements_cache"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // ── Step 1: structured JD requirements (derived once, cached on the job) ──
  let requirements = (job.requirements_cache as Requirement[] | null) ?? null;
  if (!requirements) {
    try {
      const raw = await chatJSON({
        user: `From the following job description, derive a JSON object:
{"requirements": [{"requirement": string, "type": "hard" | "nice-to-have"}]}
Base the type on explicit language: "must have"/"required" = hard;
"nice to have"/"plus"/"bonus" = nice-to-have. Return strict JSON only.

Job description:
${job.jd_text}`,
        purpose: "requirements",
        maxTokens: 1200,
      });
      requirements = parseRequirements(raw);
      await supabase
        .from("jobs")
        .update({ requirements_cache: requirements })
        .eq("id", jobId);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Couldn't derive job requirements: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        },
        { status: 502 }
      );
    }
  }

  // ── Step 2: applications with extraction done but no score yet ──
  const { data: raw } = await supabase
    .from("applications")
    .select(
      "id, candidates(email), cv_extractions(skills, experience_years, certifications, tools), scores(id)"
    )
    .eq("job_id", jobId);

  interface ScorableRow {
    id: string;
    candidates: { email: string }[] | null;
    cv_extractions:
      | {
          skills: string[] | null;
          experience_years: number | null;
          certifications: string[] | null;
          tools: string[] | null;
        }[]
      | null;
    scores: { id: string }[] | null;
  }
  const todo = ((raw ?? []) as unknown as ScorableRow[])
    .filter(
      (row) =>
        row.cv_extractions?.[0] !== undefined &&
        row.cv_extractions[0].skills !== null &&
        !row.scores?.[0]
    )
    .map((row) => {
      const ext = row.cv_extractions![0];
      return {
        applicationId: row.id,
        email: row.candidates?.[0]?.email ?? null,
        // BLIND PAYLOAD — identifying fields deliberately absent.
        profile: {
          skills: ext.skills ?? [],
          experience_years: ext.experience_years ?? 0,
          certifications: ext.certifications ?? [],
          tools: ext.tools ?? [],
        },
      };
    });

  if (todo.length === 0) {
    return NextResponse.json({
      results: [] as ScoreReportItem[],
      message: "Nothing to score — run extraction first, or all CVs are scored.",
    });
  }

  const weights = {
    skills: Number(job.weight_skills),
    experience: Number(job.weight_experience),
    certifications: Number(job.weight_certifications),
    tools: Number(job.weight_tools),
  };

  const results = await mapWithConcurrency(todo, CONCURRENCY, async (item) => {
    try {
      // Spec prompt, verbatim (Part 6) — placeholders substituted.
      const prompt = `Given this job's requirements: ${JSON.stringify(requirements)}
and this candidate's structured profile:
${JSON.stringify(item.profile)} — no identifying fields,
score the candidate 0–100 on each of: skills, experience,
certifications, tools. For each JD requirement not met, list it
with severity 'hard' or 'nice-to-have'.
Return strict JSON:
{skills_score, experience_score, certifications_score,
 tools_score, gaps: [...], rationale}`;

      // The blind audit: log the exact outgoing payload (non-identifying by
      // construction — this is the "evidence of testing" artifact).
      console.log(
        `[blind-audit] job=${jobId} app=${item.applicationId} payload=${JSON.stringify(
          item.profile
        )}`
      );
      debugAI("score-prompt", prompt);

      const raw = await chatJSON({ user: prompt, purpose: "score", maxTokens: 1500 });
      const parsed = parseScoring(raw);

      const total =
        (parsed.skills_score * weights.skills +
          parsed.experience_score * weights.experience +
          parsed.certifications_score * weights.certifications +
          parsed.tools_score * weights.tools) /
        100;
      const total_score = Math.round(total * 10) / 10;

      const { error } = await supabase.from("scores").insert({
        application_id: item.applicationId,
        skills_score: parsed.skills_score,
        experience_score: parsed.experience_score,
        certifications_score: parsed.certifications_score,
        tools_score: parsed.tools_score,
        total_score,
        gaps: parsed.gaps,
        rationale: parsed.rationale,
      });
      if (error) throw new Error(error.message);

      return {
        application_id: item.applicationId,
        email: item.email,
        status: "scored" as const,
        total_score,
      };
    } catch (err) {
      return {
        application_id: item.applicationId,
        email: item.email,
        status: "failed" as const,
        message: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  return NextResponse.json({ results });
}
