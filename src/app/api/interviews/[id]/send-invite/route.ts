import { NextResponse } from "next/server";

import { aiUserMessage, chatJSON } from "@/lib/ai";
import { emailConfigured, formatSlots, logEmail, renderTemplate, sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

/**
 * POST /api/interviews/[id]/send-invite
 *
 * Body: { template_id, subject?, body?, dry_run? }
 *  - dry_run (or missing body) → LLM drafts the email via the spec's email
 *    prompt and returns the preview WITHOUT sending.
 *  - with body → sends via Resend, logs to email_log (type 'invite').
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
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const { data: row } = await supabase
    .from("interviews")
    .select(
      "id, schedule_token, offered_slots, scheduled_time, interviewer, location_or_link, applications(id, candidates(name, email), jobs(title, recruiters(org_name)))"
    )
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  const app = one<{
    id: string;
    candidates: unknown;
    jobs: unknown;
  }>((row as { applications?: unknown }).applications);
  const candidate = one<{ name: string | null; email: string }>(app?.candidates);
  const jobRow = one<{ title: string; recruiters: unknown }>(app?.jobs);
  const recruiterOrg = one<{ org_name: string | null }>(jobRow?.recruiters)?.org_name;
  if (!candidate?.email || !jobRow) {
    return NextResponse.json({ error: "Missing candidate or job" }, { status: 409 });
  }
  const job = jobRow;

  const { data: template } = await supabase
    .from("email_templates")
    .select("id, subject, body, tone")
    .eq("id", body?.template_id)
    .maybeSingle();
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const slots = (row.offered_slots as string[] | null) ?? [];
  const times = row.scheduled_time ? [row.scheduled_time] : slots;

  const fields = {
    candidate_name: candidate.name?.split(" ")[0] || candidate.email.split("@")[0],
    recruiter_name:
      recruiterOrg || user.email?.split("@")[0] || "The hiring team",
    job_title: job.title,
    proposed_times: formatSlots(times),
    location_or_link: row.location_or_link ?? "",
    schedule_link: `${origin}/schedule/${row.schedule_token}`,
  };

  const subject = renderTemplate(
    (body?.subject as string | undefined) || template.subject || `Interview — ${job.title}`,
    fields
  );

  // ── Draft mode: LLM writes the body (spec Part 6 email prompt, verbatim). ──
  if (body?.dry_run || !body?.body) {
    try {
      const prompt = `Using this template: ${template.body}
and these merge fields:
${JSON.stringify(fields, null, 2)},
produce a complete, ready-to-send email body.`;
      const raw = await chatJSON<{ body?: string; email_body?: string; text?: string }>({
        user: prompt,
        purpose: "email-draft",
        model: "openai/gpt-oss-20b",
        maxTokens: 800,
      });
      const draft =
        raw.body || raw.email_body || raw.text || renderTemplate(template.body, fields);
      return NextResponse.json({ subject, body: draft, dry_run: true, fields });
    } catch (err) {
      // Drafting failed — fall back to the raw template so the flow continues.
      return NextResponse.json({
        subject,
        body: renderTemplate(template.body, fields),
        dry_run: true,
        fallback: true,
        note: aiUserMessage(err),
        fields,
      });
    }
  }

  // ── Send mode. ──
  const finalBody = renderTemplate(body.body as string, fields);
  const result = await sendEmail({ to: candidate.email, subject, text: finalBody });

  if (result.ok) {
    const admin = createAdminClient();
    await logEmail(admin, {
      application_id: app!.id,
      type: "invite",
      to_email: candidate.email,
      subject,
      provider_message_id: result.providerMessageId ?? null,
    });
    return NextResponse.json({ sent: true });
  }

  return NextResponse.json(
    {
      sent: false,
      error: emailConfigured()
        ? "The email provider rejected the send — if you're on Resend's test sender, it only delivers to your own account email until you verify a domain."
        : "RESEND_API_KEY isn't configured — set it to send email.",
    },
    { status: 502 }
  );
}
