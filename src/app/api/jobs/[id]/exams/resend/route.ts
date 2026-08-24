import { NextResponse } from "next/server";

import { emailConfigured, logEmail, renderTemplate, sendEmailBatch } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  let body: { applicationIds?: string[]; tone?: string } = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const ids = Array.isArray(body.applicationIds)
    ? body.applicationIds.filter((value): value is string => typeof value === "string").slice(0, 50)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "Select at least one invited candidate." }, { status: 400 });
  if (!emailConfigured()) return NextResponse.json({ error: "RESEND_API_KEY is not configured." }, { status: 503 });

  const tone = body.tone === "casual" || body.tone === "technical" ? body.tone : "formal";
  const { data: exam } = await supabase
    .from("exams")
    .select("id, status, duration_minutes, questions_per_candidate, available_from, available_until, start_deadline_hours")
    .eq("job_id", jobId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!exam) return NextResponse.json({ error: "There is no active exam for this job." }, { status: 409 });

  const { data: rows } = await supabase
    .from("applications")
    .select("id, candidates(name, email), exam_invites!inner(token, status)")
    .eq("job_id", jobId)
    .in("id", ids);
  const admin = createAdminClient();
  const { data: recruiter } = await supabase.from("recruiters").select("org_name").eq("id", user.id).maybeSingle();
  const { data: template } = await supabase
    .from("email_templates")
    .select("subject, body")
    .eq("type", "exam_invite")
    .eq("tone", tone)
    .order("recruiter_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!template) return NextResponse.json({ error: "Exam invitation template not found." }, { status: 500 });

  const availableFrom = exam.available_from ?? new Date().toISOString();
  const availableUntil = exam.available_until ?? new Date(Date.now() + exam.start_deadline_hours * 3600_000).toISOString();
  const start = new Date(availableFrom);
  const end = new Date(availableUntil);
  const origin = new URL(request.url).origin;
  const targets = (rows ?? []).flatMap((row) => {
    const invite = one<{ token: string; status: string }>(row.exam_invites);
    const candidate = one<{ name: string | null; email: string }>(row.candidates);
    if (!invite || !candidate?.email || ["submitted", "forfeited", "expired"].includes(invite.status)) return [];
    const fields = {
      candidate_name: candidate.name || candidate.email.split("@")[0],
      job_title: job.title,
      exam_url: `${origin}/exam/${invite.token}`,
      deadline: end.toUTCString(),
      available_from: start.toUTCString(),
      available_until: end.toUTCString(),
      duration_minutes: String(exam.duration_minutes),
      question_count: String(exam.questions_per_candidate),
      recruiter_name: recruiter?.org_name || "the hiring team",
    };
    return [{
      applicationId: row.id,
      to: candidate.email,
      subject: renderTemplate(template.subject ?? "Exam invitation", fields),
      text: `${renderTemplate(template.body ?? "", fields)}\n\nExam availability\nOpens: ${start.toUTCString()}\nCloses: ${end.toUTCString()}`,
    }];
  });
  if (targets.length === 0) return NextResponse.json({ error: "No resendable exam invitations were found." }, { status: 409 });

  const results = await sendEmailBatch(targets);
  const failed: { email: string; error: string }[] = [];
  let emailed = 0;
  await Promise.all(targets.map(async (target, index) => {
    const result = results[index];
    if (result?.ok) emailed++;
    else failed.push({ email: target.to, error: result?.error ?? "unknown" });
    await logEmail(admin, {
      application_id: target.applicationId,
      type: "exam_invite_resend",
      to_email: target.to,
      subject: target.subject,
      provider_message_id: result?.providerMessageId ?? null,
    }).catch(() => undefined);
  }));
  return NextResponse.json({ requested: targets.length, emailed, failed });
}
