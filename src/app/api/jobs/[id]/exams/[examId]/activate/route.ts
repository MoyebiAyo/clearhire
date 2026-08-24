import { randomBytes } from "crypto";

import { NextResponse } from "next/server";

import { logEmail, renderTemplate, sendEmailBatch } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST /api/jobs/[id]/exams/[examId]/activate — invite candidates and go
 * live. Body: { candidateIds?: string[], minTotal?: number, tone?: string,
 * sendEmails?: boolean }.
 *
 * Selection (deterministic, computed in code — never by the AI):
 * explicit candidateIds, OR every non-rejected application whose locked CV
 * total ≥ minTotal. Invites are created first; emails are best-effort via
 * the batch endpoint (chunked, rate-limit friendly) and logged per send.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; examId: string }> }
) {
  const { id, examId } = await params;
  const origin = new URL(request.url).origin;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  let body: {
    candidateIds?: string[];
    minTotal?: number;
    tone?: string;
    sendEmails?: boolean;
    availableFrom?: string;
    availableUntil?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    // defaults below
  }
  const tone =
    body.tone === "casual" || body.tone === "technical" ? body.tone : "formal";
  const sendEmails = body.sendEmails !== false;

  const admin = createAdminClient();
  const { data: exam } = await supabase
    .from("exams")
    .select(
      "id, status, bank_size, questions_per_candidate, duration_minutes, start_deadline_hours, available_from, available_until"
    )
    .eq("id", examId)
    .eq("job_id", id)
    .maybeSingle();
  if (!exam) return NextResponse.json({ error: "Exam not found." }, { status: 404 });
  if (exam.status !== "draft") {
    return NextResponse.json(
      { error: "Only a draft exam can be activated." },
      { status: 400 }
    );
  }

  const { count: qCount } = await admin
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);
  if ((qCount ?? 0) < exam.questions_per_candidate) {
    return NextResponse.json(
      {
        error: `The bank has ${qCount ?? 0} questions but each candidate needs ${exam.questions_per_candidate}. Generate more first.`,
      },
      { status: 400 }
    );
  }

  // Deterministic candidate selection in code.
  const ids = body.candidateIds?.length ? body.candidateIds : null;
  let appsQuery = supabase
    .from("applications")
    .select("id, status, scores(total_score), candidates(email, name)")
    .eq("job_id", id);
  if (ids) {
    appsQuery = appsQuery.in("id", ids);
  } else {
    appsQuery = appsQuery.neq("status", "rejected");
  }
  const { data: apps } = await appsQuery;
  const minTotal = ids ? null : typeof body.minTotal === "number" ? body.minTotal : null;

  let targets: { id: string; email: string; name: string | null; token: string }[] = [];
  for (const app of apps ?? []) {
    if (app.status === "rejected") continue;
    if (minTotal !== null) {
      const s = Array.isArray(app.scores) ? app.scores[0] : app.scores;
      if (!s || Number(s.total_score) < minTotal) continue;
    }
    const cand = Array.isArray(app.candidates) ? app.candidates[0] : app.candidates;
    if (!cand?.email) continue;
    targets.push({
      id: app.id,
      email: cand.email,
      name: cand.name ?? null,
      token: randomBytes(16).toString("hex"),
    });
  }
  targets = targets.filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i);

  if (targets.length === 0) {
    return NextResponse.json(
      { error: "No matching candidates to invite." },
      { status: 400 }
    );
  }

  // Template + recruiter signature.
  const { data: template } = await supabase
    .from("email_templates")
    .select("subject, body")
    .eq("type", "exam_invite")
    .eq("tone", tone)
    .order("recruiter_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const { data: recruiter } = await supabase
    .from("recruiters")
    .select("org_name")
    .eq("id", user.id)
    .maybeSingle();
  const signature = recruiter?.org_name || "the hiring team";

  const availableFrom = exam.available_from ?? new Date().toISOString();
  const availableUntil = exam.available_until ?? new Date(
    Date.now() + exam.start_deadline_hours * 3600_000
  ).toISOString();
  const windowStart = new Date(availableFrom);
  const windowEnd = new Date(availableUntil);
  if (!Number.isFinite(windowStart.getTime()) || !Number.isFinite(windowEnd.getTime()) || windowEnd <= windowStart) {
    return NextResponse.json({ error: "The exam availability window is invalid." }, { status: 400 });
  }
  const deadline = windowEnd.toUTCString();

  // Invites first (the exam works even if emails fail).
  const inviteRows = targets.map((t) => ({
    exam_id: examId,
    application_id: t.id,
    token: t.token,
  }));
  const { error: inviteErr } = await admin.from("exam_invites").upsert(inviteRows, {
    onConflict: "exam_id,application_id",
    ignoreDuplicates: false,
  });
  if (inviteErr) {
    return NextResponse.json({ error: "Couldn't create invites." }, { status: 500 });
  }

  // Tokens actually stored (upsert may have kept prior drafts' tokens).
  const { data: storedInvites } = await admin
    .from("exam_invites")
    .select("token, application_id")
    .eq("exam_id", examId);
  const tokenByApp = new Map(
    (storedInvites ?? []).map((r) => [r.application_id, r.token])
  );

  await admin.from("exams").update({ status: "active" }).eq("id", examId);

  const failed: { email: string; error: string }[] = [];
  let emailed = 0;
  if (sendEmails && template) {
    const messages = targets.map((t) => {
      const token = tokenByApp.get(t.id) ?? t.token;
      const fields = {
        candidate_name: t.name || t.email.split("@")[0],
        job_title: job.title,
        exam_url: `${origin}/exam/${token}`,
        deadline,
        available_from: windowStart.toUTCString(),
        available_until: windowEnd.toUTCString(),
        duration_minutes: String(exam.duration_minutes),
        question_count: String(exam.questions_per_candidate),
        recruiter_name: signature,
      };
      return {
        to: t.email,
        subject: renderTemplate(template.subject ?? "", fields),
        text: `${renderTemplate(template.body ?? "", fields)}\n\nExam availability\nOpens: ${windowStart.toUTCString()}\nCloses: ${windowEnd.toUTCString()}`,
      };
    });
    const results = await sendEmailBatch(messages);
    await Promise.all(
      targets.map(async (t, i) => {
        if (results[i]?.ok) emailed++;
        else failed.push({ email: t.email, error: results[i]?.error ?? "unknown" });
        await logEmail(admin, {
          application_id: t.id,
          type: "exam_invite",
          to_email: t.email,
          subject: messages[i].subject,
          provider_message_id: results[i]?.providerMessageId ?? null,
        }).catch(() => undefined);
      })
    );
  }

  return NextResponse.json({
    invited: targets.length,
    emailed,
    failed,
    invites: targets.map((t) => ({
      applicationId: t.id,
      email: t.email,
      token: tokenByApp.get(t.id) ?? t.token,
    })),
  });
}
