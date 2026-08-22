import { NextResponse } from "next/server";

import { aiUserMessage, chatJSON } from "@/lib/ai";
import { emailConfigured, logEmail, renderTemplate, sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/applications/[id]/reject
 *
 * Body: { dry_run?, subject?, body?, tone? }
 *  - dry_run → LLM drafts a respectful, personalized rejection drawing
 *    lightly on the candidate's gap analysis; nothing is sent or saved.
 *  - with body → sends via Resend, logs to email_log (type 'rejection'),
 *    and sets application status to 'rejected'.
 * Spec 2.5: "kept respectful, not blunt" — never fabricates, never lists
 * every gap, and never implies the AI made the decision.
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
    .from("applications")
    .select(
      "id, status, candidates(name, email), jobs(title, recruiters(org_name)), scores(gaps)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const candidate = (row.candidates as unknown as { name: string | null; email: string } | null);
  const job = (row.jobs as unknown as
    | { title: string; recruiters: { org_name: string | null }[] | null }
    | null);
  if (!candidate?.email || !job) {
    return NextResponse.json({ error: "Missing candidate or job" }, { status: 409 });
  }

  const firstName = candidate.name?.split(" ")[0] || candidate.email.split("@")[0];
  const recruiterName =
    job.recruiters?.[0]?.org_name || user.email?.split("@")[0] || "The hiring team";

  const gaps = ((row.scores as unknown as { gaps: { requirement: string; severity: string }[] | null }[] | null)?.[0]?.gaps ?? [])
    .filter((g) => g.severity !== "hard")
    .slice(0, 2)
    .map((g) => g.requirement);

  const subject =
    (body?.subject as string | undefined) || `Update on your ${job.title} application`;
  const fields = {
    candidate_name: firstName,
    recruiter_name: recruiterName,
    job_title: job.title,
  };

  // ── Draft mode. ──
  if (body?.dry_run || !body?.body) {
    try {
      const prompt = `Write a short, kind rejection email (120-180 words).
Rules: warm and respectful, never blunt; thank the candidate by name; do NOT
fabricate feedback or mention AI; you may draw LIGHTLY on these areas that
were competitive for this specific role (at most one clause, framed as "this
round was competitive" — never as flaws): ${JSON.stringify(gaps)}; end with
genuine encouragement to apply again; sign from the hiring team.
Merge fields available: candidate_name, recruiter_name, job_title.
Return strict JSON: {"subject": string, "body": string}. The body must use
{{candidate_name}}, {{recruiter_name}}, {{job_title}} placeholders.
Context: job_title=${job.title}, sender org=${recruiterName}.`;
      const raw = await chatJSON<{ subject?: string; body?: string }>({
        user: prompt,
        purpose: "rejection-draft",
        model: "openai/gpt-oss-20b",
        maxTokens: 700,
      });
      return NextResponse.json({
        subject: body?.subject || raw.subject || subject,
        body: raw.body || "",
        dry_run: true,
      });
    } catch (err) {
      return NextResponse.json(
        { error: `Couldn't draft the rejection — ${aiUserMessage(err)}` },
        { status: 502 }
      );
    }
  }

  // ── Send mode. ──
  const finalBody = renderTemplate(body.body as string, fields);
  const result = await sendEmail({ to: candidate.email, subject, text: finalBody });

  // Update status regardless of email outcome (recruiter chose to reject);
  // log only on successful send per spec's email_log semantics.
  if (result.ok) {
    const admin = createAdminClient();
    await logEmail(admin, {
      application_id: row.id,
      type: "rejection",
      to_email: candidate.email,
      subject,
      provider_message_id: result.providerMessageId ?? null,
    });
  }

  const { error: statusError } = await supabase
    .from("applications")
    .update({ status: "rejected" })
    .eq("id", row.id);
  if (statusError) {
    return NextResponse.json({ error: statusError.message }, { status: 500 });
  }

  return NextResponse.json({
    sent: result.ok,
    email_error: result.ok
      ? undefined
      : emailConfigured()
        ? "Email couldn't be delivered (test sender only reaches your own address until a domain is verified) — the candidate is marked rejected but received no email."
        : "RESEND_API_KEY isn't configured — candidate marked rejected without email.",
  });
}
