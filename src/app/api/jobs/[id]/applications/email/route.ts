import { NextResponse } from "next/server";
import { emailConfigured, logEmail, sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

type EmailKind = "offer" | "interview" | "exam" | "reminder";

function compose(kind: EmailKind, name: string, title: string, org: string, details: { interview?: string | null; location?: string | null; schedule?: string | null; exam?: string | null }) {
  const greeting = name || "there";
  if (kind === "offer") return { subject: `Offer update for ${title}`, text: `Hi ${greeting},\n\nWe are pleased to let you know that your application for ${title} has progressed to the offer stage. ${org} will follow up with the offer details and next steps.\n\nWarm regards,\n${org}` };
  if (kind === "exam") return { subject: `Your assessment link for ${title}`, text: `Hi ${greeting},\n\nPlease complete the assessment for ${title} here:\n${details.exam || "Your assessment link is in your invitation."}\n\nPlease follow the instructions on the assessment page.\n\nRegards,\n${org}` };
  if (kind === "reminder") return { subject: `Reminder: next step for ${title}`, text: `Hi ${greeting},\n\nThis is a friendly reminder about your next step for ${title}.${details.interview ? ` Your interview is scheduled for ${details.interview}.` : ""}\n\n${details.location || ""}\n${details.schedule ? `Scheduling link: ${details.schedule}` : ""}\n\nRegards,\n${org}` };
  return { subject: `Interview invitation for ${title}`, text: `Hi ${greeting},\n\nWe would like to continue your application for ${title}. Please choose a suitable interview time here:\n${details.schedule || "The scheduling link is in your invitation."}\n\nRegards,\n${org}` };
}

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
    const message = compose(kind, candidate.name || candidate.email.split("@")[0], job.title, recruiter?.org_name || "the hiring team", {
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
