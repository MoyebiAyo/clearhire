import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Briefcase, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { Job } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Jobs" };

export default async function JobsPage() {
  const supabase = await createClient();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, recruiter_id, title, jd_text, weight_skills, weight_experience, weight_certifications, weight_tools, status, created_at")
    .order("created_at", { ascending: false });

  if (error) notFound();

  const { data: appCounts } = await supabase
    .from("applications")
    .select("job_id");

  const countByJob = new Map<string, number>();
  for (const row of appCounts ?? []) {
    countByJob.set(row.job_id, (countByJob.get(row.job_id) ?? 0) + 1);
  }

  const jobsWithCounts: Job[] = (jobs ?? []).map((job) => ({
    ...job,
    application_count: countByJob.get(job.id) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One job per role — each with its own JD and scoring rubric.
          </p>
        </div>
        <Link href="/jobs/new" className={cn(buttonVariants())}>
          <Plus aria-hidden /> New job
        </Link>
      </div>

      {jobsWithCounts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Briefcase className="size-6" aria-hidden />
            </span>
            <div className="max-w-md space-y-1">
              <h2 className="font-semibold">No jobs yet</h2>
              <p className="text-sm text-muted-foreground">
                Create your first job — paste the JD, set the rubric weights
                (they must total 100%), and upload CVs to get started.
              </p>
            </div>
            <Link href="/jobs/new" className={cn(buttonVariants())}>
              Create your first job <ArrowRight aria-hidden />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {jobsWithCounts.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{job.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {job.application_count}{" "}
                    {job.application_count === 1 ? "application" : "applications"}{" "}
                    · Created {formatDate(job.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant={job.status === "open" ? "success" : "secondary"}>
                    {job.status}
                  </Badge>
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
