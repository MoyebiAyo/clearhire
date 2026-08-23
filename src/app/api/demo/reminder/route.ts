import { NextResponse } from "next/server";

import { runDueReminders } from "@/lib/reminders-runner";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/demo/reminder — demo-safe time fast-forward (spec Phase 8):
 * arms the earliest unsent future reminder for the candidate's latest
 * interview (fire_at → now) and immediately runs the reminder engine
 * server-side. No manual database surgery during demos; session-auth'd.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const applicationId = body?.application_id as string | undefined;
  if (!applicationId) {
    return NextResponse.json({ error: "application_id required" }, { status: 400 });
  }

  const { data: app } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Latest interview for this application with an unsent future reminder.
  const { data: interviews } = await supabase
    .from("interviews")
    .select("id, reminder_jobs(id, fire_at, sent)")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });

  const armed: string | null = null;
  let reminderId: string | null = null;
  for (const iv of interviews ?? []) {
    const pending = ((iv.reminder_jobs ?? []) as { id: string; fire_at: string; sent: boolean }[])
      .filter((r) => !r.sent && new Date(r.fire_at).getTime() > Date.now())
      .sort((a, b) => a.fire_at.localeCompare(b.fire_at));
    if (pending.length > 0) {
      reminderId = pending[0].id;
      const { error } = await supabase
        .from("reminder_jobs")
        .update({ fire_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", reminderId);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      break;
    }
  }
  if (!reminderId) {
    return NextResponse.json(
      { error: "No future reminder to fire — schedule an interview first." },
      { status: 409 }
    );
  }
  void armed;

  const { status, body: result } = await runDueReminders();
  return NextResponse.json(
    { armed: true, result },
    { status: status === 502 ? 502 : 200 }
  );
}
