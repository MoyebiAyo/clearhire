import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Stateless, HMAC-signed voice tickets. A ticket authorizes ONE browser
 * voice session to use /api/voice/llm (the Groq proxy) for ONE job. The
 * browser passes it to Deepgram in the think.endpoint headers; Deepgram's
 * servers present it on every LLM call. TTL keeps a leaked ticket's value
 * bounded; the signature keeps it unforgeable.
 */

const TTL_MS = 60 * 60 * 1000; // 60 minutes — covers a long voice session

function secret(): string {
  // Reuse an existing server-only secret; no new env var needed.
  return process.env.CLOUDFLARE_WORKER_SHARED_SECRET || process.env.GMAIL_ENCRYPTION_KEY || "clearhire-voice-dev";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createVoiceTicket(userId: string, jobId: string): string {
  const payload = JSON.stringify({ userId, jobId, exp: Date.now() + TTL_MS });
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyVoiceTicket(
  ticket: string
): { userId: string; jobId: string } | null {
  const dot = ticket.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  const mac = Buffer.from(ticket.slice(dot + 1));
  const expected = Buffer.from(sign(body));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      userId: string;
      jobId: string;
      exp: number;
    };
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    if (!parsed.userId || !parsed.jobId) return null;
    return { userId: parsed.userId, jobId: parsed.jobId };
  } catch {
    return null;
  }
}
