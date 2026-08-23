import { NextResponse } from "next/server";

import { logEmail, renderTemplate, sendEmailBatch } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST /api/applications/reject-bulk { ids: string[], tone?: string } —
 * mass rejection for the Copilot's confirmed actions. Idempotent per
 * candidate: status flips first (only from non-rejected), emails follow
 * best-effort through the chunked batch endpoint; failures are reported,
 * never block the rejection, and stay retryable from each card.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { ids?: string[]; tone?: string } = {};
  try {
    body = await request.json();
  } catch {
    // handled below
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((v) => typeof v === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No applications selected." }, { status: 400 });
  }
  if (ids.length > 50) {
    return NextResponse.json({ error: "Reject at most 50 at a time." }, { status: 400 });
  }
  const tone =
    body.tone === "casual" || body.tone === "technical" ? body.tone : "formal";

  // RLS read: only this recruiter's applications come back.
  const { data: apps } = await supabase
    .from("applications")
    .select("id, status, candidates(email, name), jobs(title)")
    .in("id", ids)
    .neq("status", "rejected");
  if (!apps || apps.length === 0) {
    return NextResponse.json(
      { error: "Nothing to reject — those applications are already rejected or not yours." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Claim first: flip status on exactly the readable, not-yet-rejected rows.
  const { error: updateErr } = await admin
    .from("applications")
    .update({ status: "rejected", status_changed_at: now })
    .in(
      "id",
      apps.map((a) => a.id)
    );
  if (updateErr) {
    return NextResponse.json({ error: "Couldn't update the applications." }, { status: 500 });
  }

  // Rejection email from the shared/default template (own copy wins).
  const { data: template } = await supabase
    .from("email_templates")
    .select("subject, body")
    .eq("type", "rejection")
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

  let emailed = 0;
  const failed: { email: string; error: string }[] = [];
  if (template) {
    const messages = apps.map((a) => {
      const cand = Array.isArray(a.candidates) ? a.candidates[0] : a.candidates;
      const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
      const fields = {
        candidate_name: cand?.name || cand?.email?.split("@")[0] || "there",
        job_title: job?.title ?? "your application",
        recruiter_name: signature,
      };
      return {
        to: cand?.email ?? "unknown@example.invalid",
        subject: renderTemplate(template.subject ?? "", fields),
        text: renderTemplate(template.body ?? "", fields),
      };
    });
    const results = await sendEmailBatch(messages);
    await Promise.all(
      apps.map(async (a, i) => {
        const cand = Array.isArray(a.candidates) ? a.candidates[0] : a.candidates;
        if (results[i]?.ok) emailed++;
        else failed.push({ email: cand?.email ?? "?", error: results[i]?.error ?? "unknown" });
        await logEmail(admin, {
          application_id: a.id,
          type: "rejection",
          to_email: cand?.email ?? "unknown",
          subject: messages[i].subject,
          provider_message_id: results[i]?.providerMessageId ?? null,
        }).catch(() => undefined);
      })
    );
  }

  return NextResponse.json({
    rejected: apps.length,
    emailed,
    failed,
  });
}
