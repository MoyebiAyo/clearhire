import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
