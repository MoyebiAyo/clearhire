import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { batchEmailIds } from "@/lib/email-response";

/**
 * Outbound email via Resend's REST API (fetch — no SDK). Every send is
 * logged to email_log by the caller via logEmail(). Until RESEND_API_KEY +
 * a verified sender domain are configured, sends fail softly — flows still
 * complete and the UI explains what happened.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM || "ClearHire <onboarding@resend.dev>";
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; contentBase64: string };
}): Promise<EmailResult> {
  if (!emailConfigured()) {
    return { ok: false, error: "email-not-configured" };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        ...(opts.attachment
          ? {
              attachments: [
                {
                  filename: opts.attachment.filename,
                  content: opts.attachment.contentBase64,
                },
              ],
            }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `resend-${res.status}: ${body.slice(0, 120)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, providerMessageId: data.id };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function logEmail(
  admin: SupabaseClient,
  entry: {
    application_id: string;
    type: string;
    to_email: string;
    subject: string;
    provider_message_id: string | null;
  }
): Promise<void> {
  await admin.from("email_log").insert(entry);
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Batch send via Resend's /emails/batch endpoint, chunked at 10 per call
 * with a short pause between chunks — comfortably inside the rate limits
 * (10 req/s per team; each batch call counts as one request). Returns one
 * EmailResult per input, in order; a failed chunk marks only its own items
 * as failed.
 *
 * Transient failures (429 rate limit, 5xx, network) back off and retry up
 * to 3 attempts per chunk, honoring Retry-After (capped at 8s per wait;
 * windows longer than 30s — e.g. an exhausted daily quota — fail fast
 * since waiting can't help within this request). A retry budget keeps the
 * whole call inside the caller's 60s serverless window.
 */
export async function sendEmailBatch(
  messages: { to: string; subject: string; text: string }[]
): Promise<EmailResult[]> {
  if (messages.length === 0) return [];
  if (!emailConfigured()) {
    return messages.map(() => ({ ok: false, error: "email-not-configured" }));
  }
  const results: EmailResult[] = new Array(messages.length).fill(null);
  const CHUNK = 10;
  const retryDeadline = Date.now() + 35_000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < messages.length; i += CHUNK) {
    const slice = messages.slice(i, i + CHUNK);

    for (let attempt = 1; attempt <= 3; attempt++) {
      let lastError = "unknown";
      let waitMs = 1500 * 2 ** (attempt - 1);
      let succeeded = false;
      let retryable = false;

      try {
        const res = await fetch(`${RESEND_ENDPOINT}/batch`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            slice.map((m) => ({
              from: emailFrom(),
              to: [m.to],
              subject: m.subject,
              text: m.text,
            }))
          ),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          lastError = `resend-${res.status}: ${body.slice(0, 120)}`;
          if (res.status === 422 || res.status === 400) {
            // Resend rejects the entire batch if any recipient is invalid
            // (e.g. example.com). Fall back to individual sends so valid
            // addresses still get delivered.
            for (let j = 0; j < slice.length; j++) {
              results[i + j] = await sendEmail(slice[j]);
              if (j < slice.length - 1) await sleep(350);
            }
            succeeded = true;
          } else if (isTransientStatus(res.status)) {
            const retryAfter = Number(res.headers.get("retry-after")) || 0;
            if (retryAfter > 30) {
              retryable = false; // long window (e.g. daily quota) — fail fast
            } else {
              waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : waitMs;
              retryable = true;
            }
          }
        } else {
          // Resend returns { data: [{ id }, ...] } for batch sends. Accept the
          // bare array too so provider response changes fail closed per item.
          const payload = (await res.json()) as
            | { data?: { id?: string }[] }
            | { id?: string }[];
          const data = batchEmailIds(payload);
          slice.forEach((_, j) => {
            const sent = data?.[j];
            results[i + j] = sent?.id
              ? { ok: true, providerMessageId: sent.id }
              : { ok: false, error: "no-provider-id" };
          });
          succeeded = true;
        }
      } catch {
        lastError = "network";
        retryable = true;
      }

      if (succeeded) break;
      if (retryable && attempt < 3 && Date.now() < retryDeadline) {
        await sleep(waitMs);
        continue;
      }
      slice.forEach((_, j) => (results[i + j] = { ok: false, error: lastError }));
      break;
    }

    if (i + CHUNK < messages.length) {
      await sleep(500);
    }
  }
  return results;
}

/** Replaces {{merge_field}} placeholders. */
export function renderTemplate(body: string, fields: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (m, key) => fields[key] ?? m);
}

/** Formats ISO slots into friendly local-ish lines for email bodies. */
export function formatSlots(slots: string[]): string {
  return slots
    .map((s) => {
      const d = new Date(s);
      const utc = d.toUTCString().replace("GMT", "UTC");
      return `• ${d.toDateString()} — ${utc}`;
    })
    .join("\n");
}

// ── .ics ─────────────────────────────────────────────────────────────────────

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function toIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface IcsEvent {
  uid: string;
  start: Date;
  durationMinutes?: number;
  summary: string;
  description?: string;
  organizerName?: string;
  organizerEmail?: string;
}

/** Builds a valid VEVENT calendar invite string (UTC times). */
export function buildIcs(event: IcsEvent): string {
  const end = new Date(event.start.getTime() + (event.durationMinutes ?? 60) * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ClearHire//Interview//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(event.start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${icsEscape(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${icsEscape(event.description)}`] : []),
    ...(event.organizerEmail
      ? [
          `ORGANIZER;CN=${icsEscape(event.organizerName ?? "Interviewer")}:mailto:${event.organizerEmail}`,
        ]
      : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
