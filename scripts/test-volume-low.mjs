/**
 * Volume + quality check for extract/score at LOW reasoning effort:
 * the full 20-CV pack through the real production pipeline, judged
 * against the pack's designed tiers (01-06 strong, 07-11 good,
 * 12-15 mid, 16-20 weak).
 */
import { readFileSync, readdirSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "https://clearhire-rho.vercel.app";
const svc = { apikey: SRK, Authorization: `Bearer ${SRK}` };

// Purge stale volume-test users from crashed runs.
{
  const stale = (await (await fetch(SB + "/auth/v1/admin/users?per_page=100", { headers: svc })).json()).users ?? [];
  for (const u of stale) if (String(u.email ?? "").startsWith("voice.e2e.vol.")) await fetch(SB + "/auth/v1/admin/users/" + u.id, { method: "DELETE", headers: svc });
}
const email = "voice.e2e.vol" + Math.random().toString(36).slice(2, 8) + "@ayodev.tech";
await fetch(SB + "/auth/v1/admin/users", { method: "POST", headers: { ...svc, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Vc!9tStR0ng1", email_confirm: true }) });
const lg = await (await fetch(SB + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Vc!9tStR0ng1" }) })).json();
const cookie = "sb-" + SB.replace(/^https:\/\/([a-z0-9]+)\..*$/i, "$1") + "-auth-token=" + JSON.stringify({ access_token: lg.access_token, token_type: "bearer", expires_in: lg.expires_in ?? 3600, expires_at: lg.expires_at, refresh_token: lg.refresh_token, user: lg.user });

const dir = process.env.USERPROFILE + "/Downloads/clearhire-test-cvs";
const jd = readFileSync(dir + "/JOB_DESCRIPTION.txt", "utf8");
const files = readdirSync(dir).filter((f) => /\.(pdf|docx)$/.test(f)).sort();

let r = await fetch(BASE + "/api/jobs", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ title: "Volume check — Senior Full-Stack Engineer", jd_text: jd, weight_skills: 40, weight_experience: 30, weight_certifications: 15, weight_tools: 15 }) });
const jobId = (await r.json()).job.id;
console.log("job:", r.status, jobId ? "ok" : "FAIL");

const form = new FormData();
for (const f of files) form.append("files", new File([readFileSync(dir + "/" + f)], f, { type: f.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
const tUpload = Date.now();
r = await fetch(BASE + `/api/jobs/${jobId}/cv-upload`, { method: "POST", headers: { cookie }, body: form });
const up = await r.json();
console.log("upload:", r.status, "ok:", (up.results ?? []).filter((x) => x.status === "created").length + "/" + files.length, `(${Date.now() - tUpload}ms)`);

// Extract to completion (10 per call).
let extracted = 0, extractCalls = 0;
const tExtract = Date.now();
for (let i = 0; i < 12; i++) {
  r = await fetch(BASE + `/api/jobs/${jobId}/extract?limit=4`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: "{}", signal: AbortSignal.timeout(180000) });
  const bodyText = await r.text();
  let body; try { body = JSON.parse(bodyText); } catch { console.log("extract non-JSON (server error page):", r.status, bodyText.slice(0, 100)); await new Promise((res) => setTimeout(res, 8000)); continue; }
  extractCalls++;
  if (r.status !== 200) { console.log("extract FAIL:", r.status, JSON.stringify(body).slice(0, 150)); break; }
  extracted += (body.results ?? []).filter((x) => x.status === "extracted").length;
  if (body.remaining === 0) break;
  await new Promise((res) => setTimeout(res, 4000));
}
console.log(`extract: ${extracted} CVs in ${extractCalls} calls, ${Math.round((Date.now() - tExtract) / 1000)}s total`);

// Score to completion.
let scored = 0, scoreCalls = 0;
const tScore = Date.now();
for (let i = 0; i < 12; i++) {
  r = await fetch(BASE + `/api/jobs/${jobId}/score?limit=4`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: "{}", signal: AbortSignal.timeout(180000) });
  const bodyText = await r.text();
  let body; try { body = JSON.parse(bodyText); } catch { console.log("score non-JSON (server error page):", r.status, bodyText.slice(0, 100)); await new Promise((res) => setTimeout(res, 8000)); continue; }
  scoreCalls++;
  if (r.status !== 200) { console.log("score FAIL:", r.status, JSON.stringify(body).slice(0, 150)); break; }
  scored += (body.results ?? []).filter((x) => x.status === "scored").length;
  if (body.remaining === 0) break;
  await new Promise((res) => setTimeout(res, 4000));
}
console.log(`score: ${scored} CVs in ${scoreCalls} calls, ${Math.round((Date.now() - tScore) / 1000)}s total`);

// Results vs designed tiers.
const rows = await (await fetch(SB + `/rest/v1/applications?job_id=eq.${jobId}&select=id,total_score,candidates(name)`, { headers: svc })).json();
const tierOf = (name) => {
  const n = String(name ?? "").toLowerCase();
  const file = files.find((f) => f.split("-").slice(1).some((p) => n.includes(p)));
  if (!file) return "?";
  const num = Number(file.split("-")[0]);
  if (num <= 6) return "strong";
  if (num <= 11) return "good";
  if (num <= 15) return "mid";
  return "weak";
};
const scored1 = rows.map((x) => ({ name: x.candidates?.name ?? "?", total: x.total_score, tier: tierOf(x.candidates?.name) })).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
console.log("\nrank | total | tier   | name");
scored1.forEach((x, i) => console.log(String(i + 1).padStart(4), "|", String(x.total ?? "null").padStart(5), "|", x.tier.padEnd(6), "|", x.name));

const avg = (t) => {
  const xs = scored1.filter((x) => x.tier === t && typeof x.total === "number");
  return xs.length ? Math.round(xs.reduce((s, x) => s + x.total, 0) / xs.length) : null;
};
console.log("\navg by tier: strong=" + avg("strong"), "good=" + avg("good"), "mid=" + avg("mid"), "weak=" + avg("weak"));
const weak = scored1.filter((x) => x.tier === "weak");
const weakBelow60 = weak.filter((x) => (x.total ?? 100) < 60).length;
const weakInTop10 = scored1.slice(0, 10).filter((x) => x.tier === "weak").length;
console.log(`weak tier: ${weakBelow60}/${weak.length} below 60 (reject line) | weak in top 10: ${weakInTop10}`);

// Cleanup.
const uid = (await (await fetch(SB + "/auth/v1/admin/users?per_page=100", { headers: svc })).json()).users.find((u) => u.email === email);
if (uid) await fetch(SB + "/auth/v1/admin/users/" + uid.id, { method: "DELETE", headers: svc });
console.log("cleaned up");
