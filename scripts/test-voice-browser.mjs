/**
 * REAL-BROWSER voice check — covers what the mic-less E2E structurally
 * cannot: that TTS audio is actually wired to the speaker. Headless
 * Chromium + Chrome's fake mic; instruments AudioBufferSourceNode before
 * app code runs, drives the real UI (job page -> Ask AI -> voice toggle),
 * then asserts buffer sources were connect()-ed to the destination and
 * started, and that binary TTS frames flowed through the worker proxy.
 *
 * Usage: node scripts/test-voice-browser.mjs
 * Env: PLAYWRIGHT_CHROME (optional path to chrome.exe; defaults to the
 * Playwright cache). Requires: npm i -D playwright-core.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.CLOUDFLARE_WORKER_SHARED_SECRET || process.env.GMAIL_ENCRYPTION_KEY;

const email = "voice.e2e.brw" + Math.random().toString(36).slice(2, 8) + "@ayodev.tech";
const password = "Vc!9tStR0ng1";
// Admin-create (signup endpoint rate-limits after a day of testing).
let r = await fetch(SB + "/auth/v1/admin/users", {
  method: "POST",
  headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!r.ok) { console.error("admin create failed", r.status, (await r.text()).slice(0, 150)); process.exit(1); }
r = await fetch(SB + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const sess = (await r.json());
if (!sess.access_token) { console.error("login failed", r.status, JSON.stringify(sess).slice(0, 150)); process.exit(1); }

const cookieName = "sb-" + SB.replace(/^https:\/\/([a-z0-9]+)\..*$/i, "$1") + "-auth-token";
const cookieVal = JSON.stringify({ access_token: sess.access_token, token_type: sess.token_type ?? "bearer", expires_in: sess.expires_in ?? 3600, expires_at: sess.expires_at, refresh_token: sess.refresh_token, user: sess.user ?? sess.profile ?? null });

r = await fetch("https://clearhire-rho.vercel.app/api/jobs", {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: `${cookieName}=${cookieVal}` },
  body: JSON.stringify({ title: "Browser audio check", jd_text: "Senior engineer. React, Node.js.", weight_skills: 40, weight_experience: 30, weight_certifications: 15, weight_tools: 15 }),
});
const jb = await r.json();
const jobId = jb.job?.id ?? jb.id;
console.log("job:", r.status, jobId ? "ok" : JSON.stringify(jb).slice(0, 150));

const INIT = `
window.__audio = { starts: 0, connects: 0, ctxState: "none" };
const _connect = AudioBufferSourceNode.prototype.connect;
AudioBufferSourceNode.prototype.connect = function (...a) {
  window.__audio.connects++; return _connect.apply(this, a);
};
const _start = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (...a) {
  window.__audio.starts++; return _start.apply(this, a);
};
const _AC = window.AudioContext;
window.AudioContext = class extends _AC {
  constructor(...a) { super(...a); window.__audio.ctxState = this.state; this.addEventListener("statechange", () => { window.__audio.ctxState = this.state; }); }
};
window.__ws = { binaryBytes: 0, textMsgs: [] };
const _WS = window.WebSocket;
window.WebSocket = class extends _WS {
  constructor(...a) { super(...a); this.addEventListener("message", (ev) => { if (ev.data instanceof ArrayBuffer) window.__ws.binaryBytes += ev.data.byteLength; else if (typeof ev.data === "string" && window.__ws.textMsgs.length < 60) { try { const p = JSON.parse(ev.data); if (p.type) window.__ws.textMsgs.push(p.type + (p.description ? ": " + p.description : "")); } catch {} } }); }
};
`;

const consoleErrors = [];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROME ?? "C:/Users/NEW USER/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});
try {
  const ctx = await browser.newContext({ baseURL: "https://clearhire-rho.vercel.app" });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, url: "https://clearhire-rho.vercel.app" }]);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));

  await page.goto(`https://clearhire-rho.vercel.app/jobs/${jobId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  console.log("landed on:", page.url());
  console.log("title:", await page.title());

  // Open the copilot drawer.
  const askBtn = page.locator("button", { hasText: /Ask AI|Copilot/i }).first();
  console.log("ask-ai candidates:", await askBtn.count());
  if (await askBtn.count()) await askBtn.click();
  else {
    const labels = await page.locator("button").allInnerTexts();
    console.log("buttons on page:", JSON.stringify(labels.slice(0, 25)));
  }
  await page.waitForTimeout(1200);
  if (!(await page.locator('button[aria-label="Start voice"]').count())) {
    const labels2 = await page.locator("button").allInnerTexts();
    console.log("buttons after drawer attempt:", JSON.stringify(labels2.slice(0, 30)));
  }

  // Start voice — the toggle auto-starts the session.
  const mic = page.locator('button[aria-label="Talk to the copilot"]').first();
  if (!(await mic.count())) {
    console.log("FAIL: voice toggle not found");
  } else {
    await mic.click();
    console.log("clicked voice toggle (auto-starts)");
    await page.waitForTimeout(15000); // mint + WS + settings + greeting TTS
  }

  const out = await page.evaluate(() => ({
    audio: window.__audio,
    ws: { binaryBytes: window.__ws.binaryBytes, textMsgs: window.__ws.textMsgs },
    voiceStatusText: document.body.innerText.match(/Listening[^\n]*|Speaking[^\n]*|Thinking[^\n]*|Connecting[^\n]*|Tap the mic[^\n]*/)?.[0] ?? "(none)",
  }));
  console.log("voice status:", out.voiceStatusText);
  console.log("audio graph:", JSON.stringify(out.audio));
  console.log("ws binary bytes:", out.ws.binaryBytes);
  console.log("ws text messages:", out.ws.textMsgs.join(" | ").slice(0, 400));
  console.log("console errors:", consoleErrors.length ? consoleErrors.slice(0, 6).join(" || ") : "(none)");

  const pass = out.audio.starts > 0 && out.audio.connects > 0 && out.ws.binaryBytes > 10000 && /speaking|listening/i.test(out.voiceStatusText);
  console.log(pass ? "PLAYBACK-PATH: PASS (TTS sources connected to destination + started)" : "PLAYBACK-PATH: FAIL");
} finally {
  await browser.close();
  const uid = (await (await fetch(SB + "/auth/v1/admin/users?per_page=100", { headers: { apikey: SRK, Authorization: "Bearer " + SRK } })).json()).users.find((u) => u.email === email);
  if (uid) await fetch(SB + "/auth/v1/admin/users/" + uid.id, { method: "DELETE", headers: { apikey: SRK, Authorization: "Bearer " + SRK } });
  console.log("cleaned up temp user");
}
