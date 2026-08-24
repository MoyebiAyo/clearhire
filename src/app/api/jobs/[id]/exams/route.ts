import { NextResponse } from "next/server";

import { validateExamConfig } from "@/lib/exam";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/jobs/[id]/exams — create a DRAFT exam for this job. The setup
 * flow then: generate the question bank (chunked, /generate), invite
 * candidates and go live (/activate). Creating a new exam closes any
 * previous active one — one live exam per job.
 *
 * GET — the job's current exam (active first, else latest draft) plus
 * per-invite status for the exam panel.
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
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS: only the owning recruiter sees this job.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  let body: Record<string, number | string> = {};
  try {
    body = (await request.json()) as Record<string, number>;
  } catch {
    // defaults apply
  }
  const { config, error } = validateExamConfig(body);
  if (!config) return NextResponse.json({ error }, { status: 400 });

  const admin = createAdminClient();
  // One live exam per job: retire any previous active exam.
  await admin
    .from("exams")
    .update({ status: "closed" })
    .eq("job_id", id)
    .eq("status", "active");

  const { data: exam, error: insertErr } = await admin
    .from("exams")
    .insert({
      job_id: id,
      status: "draft",
      bank_size: config.bankSize,
      questions_per_candidate: config.questionsPerCandidate,
      duration_minutes: config.durationMinutes,
      start_deadline_hours: config.startDeadlineHours,
      weight_cv: config.weightCv,
      weight_exam: config.weightExam,
      available_from: config.availableFrom,
      available_until: config.availableUntil,
    })
    .select("id, bank_size, questions_per_candidate, duration_minutes, start_deadline_hours, weight_cv, weight_exam, status, created_at")
    .single();
  if (insertErr || !exam) {
    return NextResponse.json({ error: "Couldn't create the exam." }, { status: 500 });
  }

  return NextResponse.json({ exam });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS join: only the owner's exams are visible.
  const { data: exam } = await supabase
    .from("exams")
    .select(
       "id, status, bank_size, questions_per_candidate, duration_minutes, start_deadline_hours, weight_cv, weight_exam, available_from, available_until, created_at"
    )
    .eq("job_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!exam) return NextResponse.json({ exam: null, invites: [], generated: 0 });

  const { count: generated } = await supabase
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", exam.id);

  const { data: inviteRows } = await supabase
    .from("exam_invites")
    .select(
      "id, token, status, score, violations, started_at, submitted_at, created_at, applications(id, revealed_at, candidates(email, name))"
    )
    .eq("exam_id", exam.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    exam,
    generated: generated ?? 0,
    invites: (inviteRows ?? []).map((r) => {
      const app = Array.isArray(r.applications) ? r.applications[0] : r.applications;
      const cand = app?.candidates
        ? Array.isArray(app.candidates)
          ? app.candidates[0]
          : app.candidates
        : null;
      return {
        id: r.id,
        token: r.token,
        status: r.status,
        score: r.score === null ? null : Number(r.score),
        violations: r.violations,
        applicationId: app?.id ?? null,
        // Identity discipline: email only for already-revealed applications.
        email: app?.revealed_at ? cand?.email ?? null : null,
        name: app?.revealed_at ? cand?.name ?? null : null,
        submittedAt: r.submitted_at,
      };
    }),
  });
}
