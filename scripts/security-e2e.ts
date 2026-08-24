import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3050";
if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Missing Supabase E2E configuration.");

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const createdUsers: string[] = [];
const createdCandidates: string[] = [];

async function createUser(label: string) {
  const email = `clearhire-security-${label}-${randomUUID()}@example.com`;
  const password = `T3st-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  const id = created.data.user.id;
  createdUsers.push(id);
  await admin.from("recruiters").upsert({ id, org_name: `Security ${label}` });
  const client = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  return { id, client };
}

async function createCandidate(label: string) {
  const row = await admin
    .from("candidates")
    .insert({ name: `Security ${label}`, email: `${randomUUID()}@example.com`, source: "upload" })
    .select("id")
    .single();
  assert.ifError(row.error);
  createdCandidates.push(row.data.id);
  return row.data.id as string;
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  return { response, body };
}

async function main() {
  console.log("Security E2E: creating isolated tenants");
  const a = await createUser("a");
  const b = await createUser("b");

  const jobA = await a.client
    .from("jobs")
    .insert({
      recruiter_id: a.id,
      title: "Security A Engineer",
      jd_text: "Security test job requiring TypeScript, APIs, PostgreSQL, and production operations.",
    })
    .select("id")
    .single();
  assert.ifError(jobA.error);

  console.log("Security E2E: verifying RLS isolation");
  const readAFromB = await b.client.from("jobs").select("id").eq("id", jobA.data.id);
  assert.ifError(readAFromB.error);
  assert.equal(readAFromB.data.length, 0, "Tenant B could read tenant A's job");
  const updateAFromB = await b.client
    .from("jobs")
    .update({ title: "Compromised" })
    .eq("id", jobA.data.id)
    .select("id");
  assert.ifError(updateAFromB.error);
  assert.equal(updateAFromB.data.length, 0, "Tenant B could update tenant A's job");

  const candidateA = await createCandidate("Candidate A");
  const applicationA = await admin
    .from("applications")
    .insert({ candidate_id: candidateA, job_id: jobA.data.id, status: "screened" })
    .select("id")
    .single();
  assert.ifError(applicationA.error);
  const readApplicationFromB = await b.client
    .from("applications")
    .select("id")
    .eq("id", applicationA.data.id);
  assert.ifError(readApplicationFromB.error);
  assert.equal(readApplicationFromB.data.length, 0, "Tenant B could read tenant A's application");

  console.log("Security E2E: probing SECURITY DEFINER RPC permissions");
  const anonymous = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
  const rpcResult = await anonymous.rpc("gmail_store_token", {
    p_recruiter: a.id,
    p_address: "security-probe@example.com",
    p_token: "temporary-security-probe",
    p_key: "temporary-security-key",
  });
  assert.equal(rpcResult.error, null, "Expected public RPC exposure was not reproducible");
  const insertedConnection = await admin
    .from("gmail_connections")
    .select("gmail_address")
    .eq("recruiter_id", a.id)
    .single();
  assert.equal(insertedConnection.data?.gmail_address, "security-probe@example.com");
  await admin.from("gmail_connections").delete().eq("recruiter_id", a.id);

  console.log("Security E2E: testing schedule capability happy path");
  const scheduleToken = randomBytes(16).toString("hex");
  const slot = new Date(Date.now() + 48 * 3600_000).toISOString();
  const interview = await admin
    .from("interviews")
    .insert({
      application_id: applicationA.data.id,
      status: "scheduled",
      interviewer: "Security Tester",
      location_or_link: "https://example.com/security-interview",
      schedule_token: scheduleToken,
      offered_slots: [slot],
    })
    .select("id")
    .single();
  assert.ifError(interview.error);
  let result = await api(`/api/schedule/${scheduleToken}`);
  assert.equal(result.response.status, 200);
  result = await api(`/api/schedule/${scheduleToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot }),
  });
  assert.equal(result.response.status, 200);
  const reminders = await admin
    .from("reminder_jobs")
    .select("id")
    .eq("interview_id", interview.data.id);
  assert.equal(reminders.data?.length, 4, "Scheduling did not create exactly four reminders");
  result = await api(`/api/schedule/${scheduleToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot }),
  });
  assert.equal(result.response.status, 409, "Scheduling was not idempotently blocked");
  result = await api(`/api/schedule/${scheduleToken}/ics`);
  assert.equal(result.response.status, 200);
  assert.match(String(result.body), /BEGIN:VCALENDAR/);

  console.log("Security E2E: verifying protected endpoint denials");
  const protectedRequests = [
    ["/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
    [`/api/applications/${applicationA.data.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "offer" }) }],
    ["/api/interviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
    ["/api/mailbox/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
  ] as const;
  for (const [path, init] of protectedRequests) {
    const denied = await api(path, init);
    assert.equal(denied.response.status, 401, `${path} did not deny unauthenticated access`);
  }
  assert.equal((await api("/api/reminders/run", { method: "POST" })).response.status, 401);
  assert.equal((await api("/api/mailbox/poll", { method: "POST" })).response.status, 401);
  assert.equal((await api("/api/exam/not-a-token")).response.status, 404);

  console.log("Security E2E passed: RLS isolation, auth denials, scheduling, private RPC exposure probe.");
}

main().finally(async () => {
  console.log("Security E2E: cleanup");
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  if (createdCandidates.length) await admin.from("candidates").delete().in("id", createdCandidates);
});
