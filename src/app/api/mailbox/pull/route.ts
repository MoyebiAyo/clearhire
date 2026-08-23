import { NextResponse } from "next/server";

import { pollConnection, type MailboxSummary } from "@/lib/mailbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST /api/mailbox/pull { jobId } — per-job inbox pull from the job page.
 * Session-auth only (no worker path). Scans the recruiter's connected inbox
 * and ingests ONLY emails whose subject matches this job; everything else is
 * left untouched for the global poll (cron / Settings). Idempotent per
 * message via processed_emails — pulling twice never duplicates a candidate.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let jobId: string | undefined;
  try {
    jobId = ((await request.json()) as { jobId?: string }).jobId;
  } catch {
    // fall through to the validation below
  }
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }

  // RLS via the session client verifies the job belongs to this recruiter.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: connRow } = await admin
    .from("gmail_connections")
    .select("recruiter_id, gmail_address")
    .eq("recruiter_id", user.id)
    .maybeSingle();
  if (!connRow) {
    return NextResponse.json(
      { error: "Gmail isn't connected yet — connect it in Settings first." },
      { status: 400 }
    );
  }

  const summary: MailboxSummary = {
    connections: 1,
    scanned: 0,
    ingested: 0,
    unmatched: 0,
    skipped: 0,
    other: 0,
    errors: [],
  };
  try {
    await pollConnection(
      { recruiter_id: (connRow as { recruiter_id: string }).recruiter_id, gmail_address: (connRow as { gmail_address: string }).gmail_address },
      summary,
      { id: job.id as string, title: job.title as string }
    );
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : "unknown");
  }

  return NextResponse.json(summary);
}
