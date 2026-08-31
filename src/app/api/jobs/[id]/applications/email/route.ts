import { NextResponse } from "next/server";
import { emailConfigured, logEmail, sendEmail } from "@/lib/email";
import { composeEmail, type EmailKind } from "@/lib/email-compose";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!emailConfigured()) return NextResponse.json({ error: "Email is not configured." }, { status: 503 });
  let body: { applicationIds?: string[]; kind?: EmailKind } = {};
  try { body = await request.json(); } catch { /* invalid body */ }
  const kind = ["offer", "interview", "exam", "reminder"].includes(body.kind || "") ? body.kind as EmailKind : null;
  const ids = Array.isArray(body.applicationIds) ? body.applicationIds.filter((value): value is string => typeof value === "string").slice(0, 20) : [];
  if (!kind || ids.length === 0) return NextResponse.json({ error: "Choose an email type and a candidate." }, { status: 400 });
  const { data: job } = await supabase.from("jobs").select("id, title").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const { data: recruiter } = await supabase.from("recruiters").select("org_name").eq("id", user.id).maybeSingle();
  const { data: apps } = await supabase.from("applications").select("id, candidates(name, email), interviews(schedule_token, scheduled_time, location_or_link), exam_invites(token)").eq("job_id", jobId).in("id", ids);
  const admin = createAdminClient(); const origin = new URL(request.url).origin; const results = [] as { applicationId: string; email: string; sent: boolean; error?: string }[];
  for (const app of apps ?? []) {
    const candidate = one<{ name: string | null; email: string }>(app.candidates); if (!candidate?.email) continue;
    const interview = one<{ schedule_token: string | null; scheduled_time: string | null; location_or_link: string | null }>(app.interviews);
    const exam = one<{ token: string }>(app.exam_invites);
    const message = composeEmail(kind, candidate.name || candidate.email.split("@")[0], job.title, recruiter?.org_name || "the hiring team", {
      interview: interview?.scheduled_time ? new Date(interview.scheduled_time).toUTCString() : null,
      location: interview?.location_or_link,
      schedule: interview?.schedule_token ? `${origin}/schedule/${interview.schedule_token}` : null,
      exam: exam?.token ? `${origin}/exam/${exam.token}` : null,
    });
    const sent = await sendEmail({ to: candidate.email, subject: message.subject, text: message.text });
    if (sent.ok) await logEmail(admin, { application_id: app.id, type: `${kind}_followup`, to_email: candidate.email, subject: message.subject, provider_message_id: sent.providerMessageId ?? null });
    results.push({ applicationId: app.id, email: candidate.email, sent: sent.ok, error: sent.error });
  }
  return NextResponse.json({ requested: results.length, sent: results.filter((item) => item.sent).length, failed: results.filter((item) => !item.sent), results });
}
