import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase E2E environment is not configured.");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `clearhire-e2e-${randomUUID()}@example.com`;
const candidateIds: string[] = [];
let userId: string | null = null;

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  return { response, body: await response.json() };
}

async function createApplication(jobId: string, suffix: string) {
  const candidate = await admin
    .from("candidates")
    .insert({ name: `E2E Candidate ${suffix}`, email: `${randomUUID()}@example.com`, source: "upload" })
    .select("id")
    .single();
  assert.ifError(candidate.error);
  candidateIds.push(candidate.data.id);
  const application = await admin
    .from("applications")
    .insert({ candidate_id: candidate.data.id, job_id: jobId, status: "screened" })
    .select("id")
    .single();
  assert.ifError(application.error);
  return application.data.id as string;
}

async function createExam(jobId: string, from: Date, until: Date) {
  const exam = await admin
    .from("exams")
    .insert({
      job_id: jobId,
      status: "active",
      bank_size: 10,
      questions_per_candidate: 5,
      duration_minutes: 30,
      start_deadline_hours: 48,
      weight_cv: 70,
      weight_exam: 30,
      available_from: from.toISOString(),
      available_until: until.toISOString(),
    })
    .select("id")
    .single();
  assert.ifError(exam.error);
  return exam.data.id as string;
}

async function createInvite(examId: string, applicationId: string) {
  const token = randomBytes(16).toString("hex");
  const invite = await admin
    .from("exam_invites")
    .insert({ exam_id: examId, application_id: applicationId, token })
    .select("id")
    .single();
  assert.ifError(invite.error);
  return token;
}

async function main() {
  console.log("E2E: creating temporary recruiter");
  const createdUser = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
  assert.ifError(createdUser.error);
  userId = createdUser.data.user.id;
  await admin.from("recruiters").upsert({ id: userId, org_name: "ClearHire E2E" });

  const job = await admin
    .from("jobs")
    .insert({ recruiter_id: userId, title: "E2E Engineer", jd_text: "Temporary end-to-end exam test role with TypeScript and API requirements." })
    .select("id")
    .single();
  assert.ifError(job.error);
  const jobId = job.data.id as string;

  const openExam = await createExam(jobId, new Date(Date.now() - 60_000), new Date(Date.now() + 3600_000));
  console.log("E2E: testing open exam");
  const openApplication = await createApplication(jobId, "Open");
  const openToken = await createInvite(openExam, openApplication);
  const questions = Array.from({ length: 5 }, (_, index) => ({
    exam_id: openExam,
    topic: "TypeScript",
    difficulty: "medium",
    question: `Which answer is correct for test question ${index + 1}?`,
    options: [`Wrong ${index}`, `Correct ${index}`, `Distractor A ${index}`, `Distractor B ${index}`],
    correct_index: 1,
  }));
  assert.ifError((await admin.from("exam_questions").insert(questions)).error);

  let result = await json(`/api/exam/${openToken}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "invited");
  result = await json(`/api/exam/${openToken}/start`, { method: "POST" });
  assert.equal(result.response.status, 200);
  result = await json(`/api/exam/${openToken}/questions`);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.questions.length, 5);
  assert.equal(JSON.stringify(result.body).includes("correct_index"), false);
  const answers = Object.fromEntries(
    result.body.questions.map((question: { id: string; options: string[] }) => [
      question.id,
      question.options.find((option) => option.startsWith("Correct ")),
    ])
  );
  result = await json(`/api/exam/${openToken}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  assert.equal(result.body.status, "submitted");
  assert.equal(result.body.score, 100);
  const repeated = await json(`/api/exam/${openToken}/submit`, { method: "POST" });
  assert.equal(repeated.body.status, "submitted");
  assert.equal(repeated.body.score, 100);

  const violationApplication = await createApplication(jobId, "Violation");
  console.log("E2E: testing violation forfeiture");
  const violationToken = await createInvite(openExam, violationApplication);
  assert.equal((await json(`/api/exam/${violationToken}/start`, { method: "POST" })).response.status, 200);
  for (let strike = 1; strike <= 3; strike++) {
    result = await json(`/api/exam/${violationToken}/violation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "tab_switch" }),
    });
    assert.equal(result.body.violations, strike);
  }
  assert.equal(result.body.forfeited, true);
  assert.equal((await json(`/api/exam/${violationToken}/questions`)).response.status, 409);

  const scheduledExam = await createExam(jobId, new Date(Date.now() + 3600_000), new Date(Date.now() + 7200_000));
  console.log("E2E: testing scheduled exam");
  const scheduledApplication = await createApplication(jobId, "Scheduled");
  const scheduledToken = await createInvite(scheduledExam, scheduledApplication);
  result = await json(`/api/exam/${scheduledToken}`);
  assert.equal(result.body.status, "scheduled");
  result = await json(`/api/exam/${scheduledToken}/start`, { method: "POST" });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.status, "scheduled");

  const expiredExam = await createExam(jobId, new Date(Date.now() - 7200_000), new Date(Date.now() - 3600_000));
  console.log("E2E: testing expired exam");
  const expiredApplication = await createApplication(jobId, "Expired");
  const expiredToken = await createInvite(expiredExam, expiredApplication);
  result = await json(`/api/exam/${expiredToken}`);
  assert.equal(result.body.status, "expired");

  assert.equal((await json("/api/exam/not-a-token")).response.status, 404);
  console.log("Exam E2E passed: scheduled, start, safe questions, grading, idempotency, strikes, expiry, bad token.");
}

main().finally(async () => {
  console.log("E2E: cleanup");
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (candidateIds.length) await admin.from("candidates").delete().in("id", candidateIds);
});
