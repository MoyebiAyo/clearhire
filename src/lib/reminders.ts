import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The spec's no-show-killing cadence (2.4): on interview confirmation,
 * exactly four reminder_jobs rows at interview_time minus 2d / 1d / 12h / 2h.
 * Week 5's Cloudflare Worker sends them; this week we only create them.
 */
export const REMINDER_OFFSETS = [
  { offset_label: "2d", hours: 48 },
  { offset_label: "1d", hours: 24 },
  { offset_label: "12h", hours: 12 },
  { offset_label: "2h", hours: 2 },
] as const;

export async function createReminderJobs(
  db: SupabaseClient,
  interviewId: string,
  interviewTime: Date
): Promise<number> {
  const rows = REMINDER_OFFSETS.map(({ offset_label, hours }) => ({
    interview_id: interviewId,
    fire_at: new Date(interviewTime.getTime() - hours * 3_600_000).toISOString(),
    offset_label,
    sent: false,
  }));
  const { error } = await db.from("reminder_jobs").insert(rows);
  if (error) throw new Error(`Couldn't create reminder jobs: ${error.message}`);
  return rows.length;
}
