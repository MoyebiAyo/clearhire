import { NextResponse } from "next/server";

import { aiUserMessage, chatJSON } from "@/lib/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST /api/jobs/[id]/exams/[examId]/generate?limit=12 — grow the draft
 * exam's question bank one chunk per call (serverless-safe, mirrors the
 * extract/score pattern). The client loops until `remaining` hits 0.
 *
 * Token budget: Groq's free tier counts prompt + max_tokens against a
 * ~8k tokens-per-minute ceiling, so chunks stay small (≤15 questions,
 * max_tokens 4200) to stay under it — speed comes from the client loop,
 * not one giant call.
 */

interface GeneratedQuestion {
  topic?: string;
  difficulty?: string;
  question?: string;
  options?: unknown;
  correct_index?: number;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; examId: string }> }
) {
  const { id, examId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 12), 1), 15);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS: job must belong to this recruiter.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, jd_text, requirements, requirements_cache")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const admin = createAdminClient();
  // Ownership of the exam via the same RLS client (exam → job chain).
  const { data: exam } = await supabase
    .from("exams")
    .select("id, status, bank_size")
    .eq("id", examId)
    .eq("job_id", id)
    .maybeSingle();
  if (!exam) return NextResponse.json({ error: "Exam not found." }, { status: 404 });
  if (exam.status !== "draft") {
    return NextResponse.json(
      { error: "This exam is already live — its questions are locked." },
      { status: 400 }
    );
  }

  const { count: existingCount } = await admin
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);
  const existing = existingCount ?? 0;
  const remaining = exam.bank_size - existing;
  if (remaining <= 0) {
    return NextResponse.json({ generated: 0, total: existing, remaining: 0 });
  }
  const toGenerate = Math.min(limit, remaining);

  // Existing question texts for duplicate suppression.
  const { data: existingRows } = await admin
    .from("exam_questions")
    .select("question")
    .eq("exam_id", examId);
  const seen = new Set(
    (existingRows ?? []).map((r) => (r.question ?? "").toLowerCase().trim())
  );

  const reqSummary = Array.isArray(job.requirements) && job.requirements.length > 0
    ? JSON.stringify(job.requirements).slice(0, 2500)
    : job.requirements_cache
      ? JSON.stringify(job.requirements_cache).slice(0, 2500)
      : "(no cached requirements — rely on the job description)";

  let result: { questions?: GeneratedQuestion[] };
  try {
    result = await chatJSON<{ questions?: GeneratedQuestion[] }>({
      purpose: "exam-generate",
      maxTokens: 4200,
      user: `You are building a multiple-choice skills assessment for a job. Generate EXACTLY ${toGenerate} questions.

JOB TITLE: ${job.title}

JOB DESCRIPTION:
${job.jd_text.slice(0, 6000)}

EXTRACTED ROLE REQUIREMENTS (skills, tools, experience bar):
${reqSummary}

Rules:
- Calibrate difficulty to the seniority the job description states (e.g. "3+ years" means mid/senior-level questions, not entry-level trivia).
- Cover the ACTUAL technical and role requirements from the description — skills, tools, practices, scenarios the candidate would face. Do not invent unrelated topics.
- Mix difficulties: roughly 30% easy, 45% medium, 25% hard.
- Each question: 4 options, exactly ONE clearly correct, three plausible-but-wrong distractors. No "all of the above", no trick wording.
- Questions must be answerable by a qualified candidate WITHOUT seeing your options list first (self-contained wording).
- Keep questions and options concise — one to two sentences each.

Return JSON: {"questions": [{"topic": string, "difficulty": "easy"|"medium"|"hard", "question": string, "options": [string, string, string, string], "correct_index": 0-3}]}`,
    });
  } catch (err) {
    // Clean JSON error so the client never sees an HTML 500 "network error".
    return NextResponse.json(
      { error: aiUserMessage(err) },
      { status: 500 }
    );
  }

  const raw = (result.questions ?? []).slice(0, toGenerate);
  const valid: {
    exam_id: string;
    topic: string;
    difficulty: string;
    question: string;
    options: string[];
    correct_index: number;
  }[] = [];

  for (const q of raw) {
    const text = typeof q.question === "string" ? q.question.trim() : "";
    const options = Array.isArray(q.options)
      ? q.options.map((o) => (typeof o === "string" ? o.trim() : ""))
      : [];
    const ci = Number(q.correct_index);
    const difficulty =
      q.difficulty === "easy" || q.difficulty === "hard" ? q.difficulty : "medium";
    if (!text || text.length < 12) continue;
    if (options.length !== 4 || options.some((o) => !o)) continue;
    if (!Number.isInteger(ci) || ci < 0 || ci > 3) continue;
    const uniq = new Set(options.map((o) => o.toLowerCase()));
    if (uniq.size !== 4) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({
      exam_id: examId,
      topic: (typeof q.topic === "string" && q.topic.trim()) || "general",
      difficulty,
      question: text,
      options,
      correct_index: ci,
    });
  }

  if (valid.length > 0) {
    const { error: insertErr } = await admin
      .from("exam_questions")
      .insert(valid);
    if (insertErr) {
      return NextResponse.json({ error: "Couldn't save the questions." }, { status: 500 });
    }
  }

  const total = existing + valid.length;
  return NextResponse.json({
    generated: valid.length,
    total,
    remaining: Math.max(exam.bank_size - total, 0),
  });
}
