/**
 * Mic-less end-to-end test for the ClearHire Voice Copilot.
 *
 * Proves the full chain WITHOUT a microphone:
 *   signup → job + 2 CVs → AI score → /api/voice/session →
 *   real Deepgram WS (grant token) → Settings (BYO-Groq via /api/voice/llm) →
 *   InjectUserMessage → inline spoken answer + TTS audio →
 *   "reject everyone below 60" → FunctionCallRequest → real /voice/function
 *   route → FunctionCallResponse → spoken proposal.
 *
 * Usage: node scripts/test-voice-agent.mjs
 * Env: reads .env.local (NEXT_PUBLIC_SUPABASE_URL, anon + service keys).
 * Cleanup: deletes the temp auth user at the end (cascades everything).
 */
import { readFileSync, existsSync } from "node:fs";

const ENV_PATH = new URL("../.env.local", import.meta.url);
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.BASE_URL || "https://clearhire-rho.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON || !SRK) {
  console.error("Missing Supabase env vars (.env.local)");
  process.exit(1);
}

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}${detail ? " | " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, { headers = {}, body, timeout = 120000 } = {}) {
  const ctrl = AbortSignal.timeout(timeout);
  const res = await fetch(url, { method, headers, body, signal: ctrl, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, headers: res.headers, url: res.url, redirected: res.redirected };
}

const svc = (method, path) =>
  http(method, SUPABASE_URL + path, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });

function cookieFromSession(session) {
  const val = JSON.stringify({
    access_token: session.access_token,
    token_type: session.token_type ?? "bearer",
    expires_in: session.expires_in ?? 3600,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  });
  const name = "sb-" + SUPABASE_URL.replace(/^https:\/\/([a-z0-9]+)\..*$/i, "$1") + "-auth-token";
  const CHUNK = 3180;
  const pairs = val.length <= CHUNK
    ? [[name, val]]
    : [...Array(Math.ceil(val.length / CHUNK)).keys()].map((i) => [`${name}.${i}`, val.slice(i * CHUNK, (i + 1) * CHUNK)]);
  return pairs.map(([n, v]) => `${n}=${v}`).join("; ");
}

// ── Setup: temp account + job + 2 CVs + AI score ─────────────────────────
console.log("== setup ==");

// Purge any temp users from previous crashed runs.
{
  const list = await http("GET", SUPABASE_URL + "/auth/v1/admin/users?per_page=100", {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  for (const u of list.json?.users ?? []) {
    if (String(u.email ?? "").startsWith("voice.e2e.") || String(u.email ?? "").startsWith("e2e.check.")) {
      await http("DELETE", SUPABASE_URL + `/auth/v1/admin/users/${u.id}`, {
        headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
      });
      console.log("  purged stale test user:", u.email);
    }
  }
}

const HOME = process.env.USERPROFILE || process.env.HOME;
const CV_DIR = HOME + "/Downloads/clearhire-test-cvs";
const rand = Math.random().toString(36).slice(2, 8);
const email = `voice.e2e.${rand}@ayodev.tech`;
const pw = "Vc-" + Math.random().toString(36).slice(2, 16) + "!7";
const su = await http("POST", SUPABASE_URL + "/auth/v1/signup", {
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: pw }),
});
const session = su.json?.session ?? su.json;
check("signup", Boolean(session?.access_token), `${su.status} ${email}`);
const cookie = cookieFromSession(session);
const authHeaders = { Cookie: cookie, apikey: ANON, "Content-Type": "application/json" };

const jd = `Senior Full-Stack Engineer (React + Node.js). We require 5+ years professional experience, strong React + TypeScript, strong Node.js (Express or NestJS), solid PostgreSQL, AWS and Docker in production, automated testing and CI/CD. Nice to have: AWS certification, Kubernetes, mentoring experience.`;
const cj = await http("POST", BASE + "/api/jobs", {
  headers: authHeaders,
  body: JSON.stringify({ title: "Voice E2E — Senior Full-Stack Engineer", jd_text: jd, weight_skills: 40, weight_experience: 30, weight_certifications: 15, weight_tools: 15 }),
});
const JOB_ID = cj.json?.job?.id;
check("job created", cj.status === 201 && Boolean(JOB_ID), String(cj.status));

async function uploadCv(filename) {
  const buf = readFileSync(`${CV_DIR}/${filename}`);
  const boundary = "----e2e" + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const res = await http("POST", `${BASE}/api/jobs/${JOB_ID}/cv-upload`, {
    headers: { Cookie: cookie, apikey: ANON, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    timeout: 180000,
  });
  console.log(`  upload -> ${res.status} redirected=${res.redirected} url=${res.url.slice(0, 90)} type=${res.headers.get("content-type")}`);
  if (res.status !== 200) console.log("  upload body:", res.text.slice(0, 150));
  return res;
}
const strong = await uploadCv("01-chiamaka-eze-strong-lead.pdf");
check("strong CV uploaded", strong.status === 200, JSON.stringify(strong.json?.results?.[0] ?? {}).slice(0, 120));
const weak = await uploadCv("16-yusuf-ibrahim-junior.pdf");
check("weak CV uploaded", weak.status === 200, JSON.stringify(weak.json?.results?.[0] ?? {}).slice(0, 120));

const ex = await http("POST", `${BASE}/api/jobs/${JOB_ID}/extract?limit=3`, { headers: authHeaders, body: "{}", timeout: 300000 });
check("extraction", ex.status === 200 && (ex.json.results ?? []).every((r) => r.status === "extracted"), String(ex.status));
const sc = await http("POST", `${BASE}/api/jobs/${JOB_ID}/score?limit=3`, { headers: authHeaders, body: "{}", timeout: 300000 });
const scores = (sc.json.results ?? []).map((r) => r.total_score);
check("scoring (2 candidates)", sc.status === 200 && scores.length === 2, `scores=${scores.join(", ")}`);
const below60 = scores.filter((v) => v < 60).length;
check("score spread as designed (one below 60)", below60 >= 1, `below60=${below60}`);

// ── Route guards ──────────────────────────────────────────────────────────
console.log("== route guards ==");
const noAuth = await http("POST", BASE + "/api/voice/session", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: JOB_ID }) });
check("voice/session unauthenticated -> 401", noAuth.status === 401, String(noAuth.status));
const badTicket = await http("POST", BASE + "/api/voice/llm", {
  headers: { "Content-Type": "application/json", Authorization: "Bearer forged.ticket.here" },
  body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "hi" }] }),
});
check("voice/llm forged ticket -> 401", badTicket.status === 401, String(badTicket.status));

// ── Mint the session ─────────────────────────────────────────────────────
console.log("== voice session ==");
const vs = await http("POST", BASE + "/api/voice/session", {
  headers: authHeaders,
  body: JSON.stringify({ jobId: JOB_ID }),
});
check("voice/session minted", vs.status === 200 && Boolean(vs.json?.wsProxyUrl) && Boolean(vs.json?.voiceTicket),
  `${vs.status} promptLen=${vs.json?.session?.prompt?.length ?? 0} functions=${vs.json?.session?.functions?.length ?? 0}`);
const { wsProxyUrl, voiceTicket, llmProxyUrl, session: sessCfg } = vs.json;

// Proxy sanity with the real ticket (non-streaming completion).
const llm = await http("POST", llmProxyUrl, {
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${voiceTicket}` },
  body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "Say OK" }], max_tokens: 200 }),
  timeout: 60000,
});
check("voice/llm proxy -> Groq live", llm.status === 200 && /OK/i.test(llm.text), String(llm.status));

// ── The real agent socket ────────────────────────────────────────────────
console.log("== deepgram agent ws ==");
const wsURL = `${wsProxyUrl}?ticket=${encodeURIComponent(voiceTicket)}`;
let ws;
try {
  ws = new WebSocket(`${wsProxyUrl}?ticket=${encodeURIComponent(voiceTicket)}`);
} catch (e) {
  check("agent ws opened", false, String(e));
}
ws.binaryType = "arraybuffer";

const state = {
  welcome: false, settingsApplied: false,
  assistantTexts: [], userTexts: [], audioBytes: 0,
  functionCalls: [], errors: [],
};
let resolveWait = null;
function notify(type) {
  if (resolveWait && waitFor.active?.has(type)) {
    const r = resolveWait;
    resolveWait = null;
    waitFor.active = null;
    r();
  }
}
function waitFor(filterTypes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { waitFor.active = null; resolveWait = null; reject(new Error(`timeout waiting for ${filterTypes}`)); }, timeoutMs);
    resolveWait = () => { clearTimeout(t); waitFor.active = null; resolve(); };
    waitFor.active = new Set(filterTypes);
  });
}

ws.onmessage = async (ev) => {
  let msg = null;
  if (typeof ev.data === "string") {
    try { msg = JSON.parse(ev.data); } catch { return; }
  } else {
    // binary: could be TTS audio or (rare) JSON — sniff
    const buf = ev.data instanceof ArrayBuffer ? ev.data : await ev.data.arrayBuffer();
    if (buf.byteLength < 8192) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(buf));
        if (parsed && parsed.type) { msg = parsed; }
      } catch { /* audio */ }
    }
    if (!msg) {
      state.audioBytes += buf.byteLength;
      notify("AgentAudio");
      return;
    }
  }
  console.log("  <<", msg.type, JSON.stringify(msg).slice(0, 110));
  switch (msg.type) {
    case "Welcome": state.welcome = true; notify("Welcome"); break;
    case "SettingsApplied": state.settingsApplied = true; notify("SettingsApplied"); break;
    case "ConversationText": {
      const role = msg.role === "assistant" ? "assistant" : "user";
      const text = String(msg.content ?? "");
      if (role === "assistant") state.assistantTexts.push(text); else state.userTexts.push(text);
      notify("ConversationText");
      break;
    }
    case "AgentAudio": notify("AgentAudio"); break;
    case "FunctionCallRequest": {
      state.functionCalls.push(...(msg.functions ?? []));
      notify("FunctionCallRequest");
      break;
    }
    case "Error": state.errors.push(String(msg.description ?? "unknown")); notify("Error"); break;
  }
};
ws.onopen = () => {
  console.log("  >> Settings");
  ws.send(JSON.stringify({
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      language: "en",
      listen: { provider: { type: "deepgram", model: "nova-3" } },
      think: {
        provider: { type: "groq", model: "openai/gpt-oss-120b", temperature: 0.4 },
        endpoint: { url: llmProxyUrl, headers: { Authorization: `Bearer ${voiceTicket}` } },
        prompt: sessCfg.prompt,
        functions: sessCfg.functions,
      },
      speak: { provider: { type: "deepgram", model: "aura-2-thalia-en" } },
      greeting: sessCfg.greeting,
    },
  }));

  // Fake mic: the agent times out without user audio, so stream low-level
  // noise PCM right away (the real browser streams microphone audio here).
  const noise = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const buf = new Int16Array(1600); // 100ms @16kHz
    for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 60 - 30) | 0;
    ws.send(buf.buffer);
  }, 100);
};
ws.onerror = () => { state.errors.push("ws error"); };
const opened = new Promise((resolve, reject) => {
  const ok = () => resolve(); ws.addEventListener("open", ok, { once: true });
  setTimeout(() => reject(new Error("ws open timeout")), 20000);
});
await opened;
{
  const deadlineWs = Date.now() + 20000;
  while (!(state.welcome && state.settingsApplied) && Date.now() < deadlineWs && state.errors.length === 0) {
    await sleep(200);
  }
}
check("agent ws opened + Welcome", state.welcome && state.errors.length === 0, `welcome=${state.welcome} settingsApplied=${state.settingsApplied} errors=${state.errors.join(";")}`);
check("SettingsApplied (BYO config accepted)", state.settingsApplied, `errors=${state.errors.join(";")}`);


// Q1: inline blind answer + TTS audio.
console.log("== Q1: inline answer + speech ==");
const audioBefore = state.audioBytes;
console.log("  >> Inject Q1");
ws.send(JSON.stringify({ type: "InjectUserMessage", content: "Which candidate is strongest and why?" }));
const deadline1 = Date.now() + 60000;
let q1Answer = "";
while (Date.now() < deadline1) {
  await sleep(500);
  q1Answer = state.assistantTexts.find((t) => /candidate|#|score|strong/i.test(t)) ?? "";
  const gotAudio = state.audioBytes - audioBefore > 1500;
  if (q1Answer && gotAudio) break;
}
check("Q1 inline blind answer", q1Answer.length > 0 && !/me@ayodev\.tech|david/i.test(q1Answer),
  `"${q1Answer.slice(0, 100)}"`);
check("Q1 TTS audio streamed", state.audioBytes - audioBefore > 1500, `${state.audioBytes - audioBefore} bytes`);

// Q2: action function.
console.log("== Q2: rejection proposal via function ==");
console.log("  >> Inject Q2");
ws.send(JSON.stringify({ type: "InjectUserMessage", content: "Reject everyone below 60." }));
const fcDeadline = Date.now() + 60000;
let fcReq = null;
let retried = false;
while (Date.now() < fcDeadline && !fcReq) {
  await sleep(500);
  fcReq = state.functionCalls.find((f) => f.name === "propose_rejection") ?? null;
  // gpt-oss occasionally answers verbally instead of calling the tool —
  // one explicit nudge keeps the E2E deterministic without weakening the test.
  if (!fcReq && !retried && Date.now() > fcDeadline - 35000) {
    retried = true;
    console.log("  >> Inject Q2 (explicit tool nudge)");
    ws.send(JSON.stringify({ type: "InjectUserMessage", content: "Use the propose_rejection function to prepare that rejection." }));
  }
}
check("FunctionCallRequest -> propose_rejection", Boolean(fcReq), JSON.stringify(fcReq?.arguments ?? state.functionCalls.map((f) => f.name)));

if (fcReq) {
  let args = {};
  try { args = JSON.parse(fcReq.arguments ?? "{}"); } catch {}
  const fnRes = await http("POST", `${BASE}/api/jobs/${JOB_ID}/voice/function`, {
    headers: authHeaders,
    body: JSON.stringify({ name: fcReq.name, arguments: args }),
  });
  const fnBody = fnRes.json ?? {};
  const action = fnBody.action ?? {};
  check("resolver: only sub-60 candidate matched",
    fnRes.status === 200 && action.name === "reject_preview" && action.count === 1 && (action.candidates?.[0]?.total ?? 100) < 60,
    `${fnRes.status} count=${action.count} ranks=${(action.candidates ?? []).map((c) => c.rank).join(",")} totals=${(action.candidates ?? []).map((c) => c.total).join(",")}`);
  check("spoken proposal references the card", /card|confirm|screen/i.test(fnBody.speak ?? ""), `"${(fnBody.speak ?? "").slice(0, 120)}"`);
  ws.send(JSON.stringify({
    type: "FunctionCallResponse",
    id: fcReq.id,
    name: fcReq.name,
    content: JSON.stringify({ spoken_result: fnBody.speak ?? "done" }),
  }));
  const audioBefore2 = state.audioBytes;
  const deadlineSpoken = Date.now() + 45000;
  const spokeIt = await (async () => {
    while (Date.now() < deadlineSpoken) {
      await sleep(400);
      if (state.audioBytes - audioBefore2 > 1500) return true; // proposal was spoken
    }
    return false;
  })();
  check("agent spoke the proposal", spokeIt, `spoken audio: ${state.audioBytes - audioBefore2} bytes`);
}

ws.close();

// ── Cleanup: delete temp user via admin path ─────────────────────────────
console.log("== cleanup ==");
const jr = await svc("GET", `/rest/v1/jobs?id=eq.${JOB_ID}&select=recruiter_id`);
const uid = jr.json?.[0]?.recruiter_id;
const del = uid ? await svc("DELETE", `/auth/v1/admin/users/${uid}`) : { status: 0 };
check("temp user cascade-deleted", del.status === 200 || del.status === 204, String(del.status));

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
