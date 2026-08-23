import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { pollConnection, type ConnectionRow, type MailboxSummary } from "@/lib/mailbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST /api/mailbox/poll — global scan of connected Gmail inboxes (spec 2.1
 * email intake). Auth: either the worker shared secret (cron) or a logged-in
 * recruiter (manual "Poll now" button). Idempotent per message via
 * processed_emails. Per-job pulls live at /api/mailbox/pull.
 */

function workerAuthorized(request: Request): boolean {
  const expected = process.env.CLOUDFLARE_WORKER_SHARED_SECRET;
  const provided = request.headers.get("x-worker-secret") ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viaWorker = workerAuthorized(request);
  if (!viaWorker && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Worker polls every connection; a recruiter polls their own.
  const { data: connections } = viaWorker
    ? await admin.from("gmail_connections").select("recruiter_id, gmail_address")
    : await admin
        .from("gmail_connections")
        .select("recruiter_id, gmail_address")
        .eq("recruiter_id", user!.id);
  const conns = (connections ?? []) as unknown as ConnectionRow[];

  const summary: MailboxSummary = {
    connections: conns.length,
    scanned: 0,
    ingested: 0,
    unmatched: 0,
    skipped: 0,
    other: 0,
    errors: [],
  };

  for (const conn of conns) {
    try {
      await pollConnection(conn, summary);
    } catch (err) {
      summary.errors.push(
        `${conn.gmail_address}: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  return NextResponse.json(summary);
}
