import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const STATUSES = [
  "applied",
  "screened",
  "shortlisted",
  "interview_scheduled",
  "interviewed",
  "offer",
  "rejected",
] as const;

/**
 * PATCH /api/applications/[id] — move an application along the Kanban
 * pipeline. Sets status + status_changed_at (RLS-scoped).
 */
export async function PATCH(
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

  const body = await request.json().catch(() => null);
  const status = body?.status as string | undefined;
  if (!status || !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }

  const { error } = await supabase
    .from("applications")
    .update({ status, status_changed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, status });
}
