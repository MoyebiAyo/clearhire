import { notFound } from "next/navigation";

import { SchedulePicker } from "@/components/schedule-picker";
import { createAdminClient } from "@/lib/supabase/admin";
import { one } from "@/lib/utils";

export const metadata = { title: "Pick your interview time" };

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("interviews")
    .select(
      "id, status, scheduled_time, offered_slots, interviewer, location_or_link, applications(candidates(name), jobs(title, recruiters(org_name)))"
    )
    .eq("schedule_token", token)
    .maybeSingle();

  const interview = row as unknown as {
    id: string;
    status: string;
    scheduled_time: string | null;
    offered_slots: string[] | null;
    interviewer: string | null;
    location_or_link: string | null;
    applications:
      | {
          candidates: { name: string | null }[] | null;
          jobs: { title: string; recruiters: { org_name: string | null }[] | null }[] | null;
        }
      | null;
  } | null;

  if (!interview) notFound();

  const app = one<{ candidates: unknown; jobs: unknown }>(interview.applications);
  const cand = one<{ name: string | null }>(app?.candidates);
  const jobRow = one<{ title: string; recruiters: unknown }>(app?.jobs);
  const company = one<{ org_name: string | null }>(jobRow?.recruiters)?.org_name ?? "the hiring team";

  return (
    <SchedulePicker
      token={token}
      jobTitle={jobRow?.title ?? "your interview"}
      company={company}
      firstName={cand?.name?.split(" ")[0] || "there"}
      interviewer={interview.interviewer}
      location={interview.location_or_link}
      slots={(interview.offered_slots ?? []).filter(
        (s) => new Date(s).getTime() > Date.now()
      )}
      alreadyScheduled={interview.scheduled_time}
    />
  );
}
