import { NextResponse } from "next/server";

import { aiUserMessage, chatJSON, debugAI, mapWithConcurrency } from "@/lib/ai";
import { parseExtraction } from "@/lib/ai-schemas";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Cap raw CV size sent to the model (chars) — keeps requests inside
 * free-tier token budgets while preserving all meaningful CV content. */
const MAX_RAW_CHARS = 10_000;
const CONCURRENCY = 2;

export interface ExtractReportItem {
  application_id: string;
  email: string | null;
  status: "extracted" | "failed";
  message?: string;
}

/**
 * POST /api/jobs/[id]/extract?limit=N — spec Part 6 extraction pass, verbatim
 * prompt. Chunked: processes at most `limit` pending CVs per call (default 3,
 * max 10) and returns the remaining pending count, so the client loops in
 * small bites that never hit serverless time limits. Idempotent: only
 * applications whose cv_extractions row has skills IS NULL run; failures
 * persist extract_error and are retried by the next chunk/click.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const limit = Math.min(
    Math.max(Number(new URL(request.url).searchParams.get("limit")) || 3, 1),
    10
  );
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: raw } = await supabase
    .from("applications")
    .select(
      "id, candidates(email), cv_extractions(id, raw_text, skills)"
    )
    .eq("job_id", jobId);

  interface PendingRow {
    id: string;
    candidates: { email: string }[] | null;
    cv_extractions:
      | { id: string; raw_text: string | null; skills: string[] | null }[]
      | null;
  }
  const todo = ((raw ?? []) as unknown as PendingRow[])
    .filter(
      (row) =>
        row.cv_extractions?.[0] &&
        row.cv_extractions[0].raw_text &&
        row.cv_extractions[0].skills === null
    )
    .map((row) => ({
      applicationId: row.id,
      email: row.candidates?.[0]?.email ?? null,
      extractionId: row.cv_extractions![0].id,
      rawText: row.cv_extractions![0].raw_text!.slice(0, MAX_RAW_CHARS),
    }));

  if (todo.length === 0) {
    return NextResponse.json({
      results: [] as ExtractReportItem[],
      remaining: 0,
      message: "Nothing to extract — every CV is already processed.",
    });
  }

  const batch = todo.slice(0, limit);
  const results = await mapWithConcurrency(batch, CONCURRENCY, async (item) => {
    try {
      // Spec prompt, verbatim (Part 6) — [raw_text] substituted.
      const prompt = `Extract the following from this CV text as strict JSON only, no prose:
skills (array), experience_years (number),
education (array of {degree, institution}),
certifications (array), tools (array).
CV text: ${item.rawText}`;

      const raw = await chatJSON({ user: prompt, purpose: "extract", maxTokens: 1500 });
      const parsed = parseExtraction(raw);
      debugAI("extract-result", parsed);

      const { error } = await supabase
        .from("cv_extractions")
        .update({
          skills: parsed.skills,
          experience_years: parsed.experience_years,
          education: parsed.education,
          certifications: parsed.certifications,
          tools: parsed.tools,
          extracted_at: new Date().toISOString(),
          extract_error: null,
        })
        .eq("id", item.extractionId);

      if (error) throw new Error(error.message);

      return {
        application_id: item.applicationId,
        email: item.email,
        status: "extracted" as const,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // Full detail to server logs only; users see a sanitized message (the
      // raw error can contain provider org IDs and internals).
      console.error(`[extract] app=${item.applicationId}: ${message}`);
      // Persist the sanitized reason for debugging; skills stays NULL so a
      // re-run retries it.
      await supabase
        .from("cv_extractions")
        .update({ extract_error: aiUserMessage(err).slice(0, 500) })
        .eq("id", item.extractionId);
      return {
        application_id: item.applicationId,
        email: item.email,
        status: "failed" as const,
        message: aiUserMessage(err),
      };
    }
  });

  const succeeded = results.filter((r) => r.status === "extracted").length;
  return NextResponse.json({
    results,
    remaining: Math.max(todo.length - succeeded, 0),
  });
}
