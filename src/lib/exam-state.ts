import "server-only";

import { drawForCandidate, SUBMIT_GRACE_SECONDS } from "@/lib/exam";
import { examAttemptEndsAt, examWindowState } from "@/lib/exam-window";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side exam session resolution for the public /exam/[token] pages
 * and APIs. The unguessable token IS the capability (same model as
 * interviews.schedule_token), so reads go through the admin client.
 */

export interface ResolvedInvite {
  invite: {
    id: string;
    token: string;
    status: string;
    started_at: string | null;
    submitted_at: string | null;
    score: number | null;
    violations: number;
    created_at: string;
    application_id: string;
  };
  exam: {
    id: string;
    status: string;
    questions_per_candidate: number;
    duration_minutes: number;
    start_deadline_hours: number;
    available_from: string | null;
    available_until: string | null;
    weight_cv: number;
    weight_exam: number;
  };
  job: { title: string } | null;
}

export async function resolveInvite(token: string): Promise<ResolvedInvite | null> {
  if (!/^[a-f0-9]{32}$/i.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("exam_invites")
    .select(
      "id, token, status, started_at, submitted_at, score, violations, created_at, application_id, exams(id, status, questions_per_candidate, duration_minutes, start_deadline_hours, available_from, available_until, weight_cv, weight_exam, jobs(title))"
    )
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;

  const examRow = Array.isArray(data.exams) ? data.exams[0] : data.exams;
  if (!examRow) return null;
  if (examRow.status !== "active") return null;
  const jobRow = Array.isArray(examRow.jobs) ? examRow.jobs[0] : examRow.jobs;

  return {
    invite: {
      id: data.id,
      token: data.token,
      status: data.status,
      started_at: data.started_at,
      submitted_at: data.submitted_at,
      score: data.score === null ? null : Number(data.score),
      violations: data.violations,
      created_at: data.created_at,
      application_id: data.application_id,
    },
    exam: {
      id: examRow.id,
      status: examRow.status,
      questions_per_candidate: Number(examRow.questions_per_candidate),
      duration_minutes: Number(examRow.duration_minutes),
      start_deadline_hours: Number(examRow.start_deadline_hours),
      available_from: examRow.available_from,
      available_until: examRow.available_until,
      weight_cv: Number(examRow.weight_cv),
      weight_exam: Number(examRow.weight_exam),
    },
    job: jobRow ? { title: jobRow.title } : null,
  };
}

/**
 * Advance terminal-ish states that time out on their own:
 *  - invited past the start deadline → expired
 *  - in_progress past duration + grace → forfeited (no answers received)
 * Returns the (possibly updated) invite status.
 */
export async function sweepTimedOut(resolved: ResolvedInvite): Promise<string> {
  const admin = createAdminClient();
  const now = Date.now();
  const { invite, exam } = resolved;

  if (invite.status === "invited") {
    const deadline = exam.available_until
      ? new Date(exam.available_until).getTime()
      : new Date(invite.created_at).getTime() + exam.start_deadline_hours * 3600_000;
    if (now > deadline) {
      await admin.from("exam_invites").update({ status: "expired" }).eq("id", invite.id).eq("status", "invited");
      return "expired";
    }
    return "invited";
  }

  if (invite.status === "in_progress" && invite.started_at) {
    const endTime = examAttemptEndsAt(
      invite.started_at,
      exam.duration_minutes,
      exam.available_until
    ) + SUBMIT_GRACE_SECONDS * 1000;
    if (now > endTime) {
      await admin.from("exam_invites").update({ status: "forfeited" }).eq("id", invite.id).eq("status", "in_progress");
      return "forfeited";
    }
    return "in_progress";
  }

  return invite.status;
}

export function examAvailability(resolved: ResolvedInvite): {
  state: "scheduled" | "open" | "closed";
  availableFrom: string;
  availableUntil: string;
} {
  const from = resolved.exam.available_from ?? resolved.invite.created_at;
  const until = resolved.exam.available_until ?? new Date(
    new Date(resolved.invite.created_at).getTime() +
      resolved.exam.start_deadline_hours * 3600_000
  ).toISOString();
  const now = Date.now();
  return {
    state: examWindowState(from, until, now),
    availableFrom: from,
    availableUntil: until,
  };
}

/**
 * Grade an attempt in code (the model never grades): answers map
 * questionId → the OPTION TEXT the candidate saw. Text comparison against
 * options[correct_index] sidesteps per-candidate option shuffling entirely.
 */
export async function gradeAttempt(
  resolved: ResolvedInvite,
  answers: Record<string, string>
): Promise<{ score: number; answered: number; drawn: number }> {
  const admin = createAdminClient();
  const { data: questions } = await admin
    .from("exam_questions")
    .select("id, options, correct_index")
    .eq("exam_id", resolved.exam.id);
  const all = questions ?? [];
  const drawnIds = drawForCandidate(
    resolved.invite.token,
    all.map((q) => q.id),
    resolved.exam.questions_per_candidate
  );
  const byId = new Map(all.map((q) => [q.id, q]));

  let correct = 0;
  let answered = 0;
  for (const qid of drawnIds) {
    const q = byId.get(qid);
    if (!q) continue;
    const given = (answers[qid] ?? "").trim();
    if (!given) continue;
    answered++;
    const expected = (q.options?.[q.correct_index] ?? "").trim();
    if (given === expected) correct++;
  }
  const n = drawnIds.length || 1;
  return {
    score: Math.round((correct / n) * 1000) / 10,
    answered,
    drawn: drawnIds.length,
  };
}
