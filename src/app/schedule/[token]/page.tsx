import { notFound } from "next/navigation";

import { SchedulePicker } from "@/components/schedule-picker";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const app = interview.applications;

  return (
    <SchedulePicker
      token={token}
      jobTitle={app?.jobs?.[0]?.title ?? "your interview"}
      company={app?.jobs?.[0]?.recruiters?.[0]?.org_name ?? "the hiring team"}
      firstName={app?.candidates?.[0]?.name?.split(" ")[0] || "there"}
      interviewer={interview.interviewer}
      location={interview.location_or_link}
      slots={(interview.offered_slots ?? []).filter(
        (s) => new Date(s).getTime() > Date.now()
      )}
      alreadyScheduled={interview.scheduled_time}
    />
  );
}
