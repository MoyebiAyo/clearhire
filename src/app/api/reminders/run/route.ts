import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { runDueReminders } from "@/lib/reminders-runner";

export const maxDuration = 60;

/**
 * POST /api/reminders/run — called by the Cloudflare Worker cron.
 * Auth: x-worker-secret must match CLOUDFLARE_WORKER_SHARED_SECRET.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CLOUDFLARE_WORKER_SHARED_SECRET;
  const provided = request.headers.get("x-worker-secret") ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { status, body } = await runDueReminders();
  return NextResponse.json(body, { status });
}
