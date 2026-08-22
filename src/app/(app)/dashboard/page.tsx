import Link from "next/link";
import { ArrowRight, Briefcase, FileText, Scale, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();

  const [openJobs, totalApplications, totalCandidates, recentJobs] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      supabase.from("applications").select("id", { count: "exact", head: true }),
      supabase.from("candidates").select("id", { count: "exact", head: true }),
      supabase
        .from("jobs")
        .select("id, title, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const stats = [
    { label: "Open jobs", value: openJobs.count ?? 0, icon: Briefcase },
    { label: "Applications", value: totalApplications.count ?? 0, icon: FileText },
    { label: "Candidates", value: totalCandidates.count ?? 0, icon: Users },
  ];

  const recentJobsList = recentJobs.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your hiring pipeline at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-4 p-5">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {recentJobsList.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Briefcase className="size-6" aria-hidden />
            </span>
            <div className="max-w-md space-y-1">
              <h2 className="font-semibold">Create your first job</h2>
              <p className="text-sm text-muted-foreground">
                Paste a job description, set how much each criterion matters,
                then upload CVs. ClearHire scores them blind — without names or
                schools — and you make the call.
              </p>
            </div>
            <Link href="/jobs/new" className={cn(buttonVariants())}>
              Create a job <ArrowRight aria-hidden />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent jobs</CardTitle>
            <Link
              href="/jobs"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              View all <ArrowRight aria-hidden />
            </Link>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {recentJobsList.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="-mx-2 flex items-center justify-between rounded-lg px-2 py-3 transition-colors hover:bg-muted"
              >
                <span className="font-medium">{job.title}</span>
                <span className="flex items-center gap-3 text-sm text-muted-foreground">
                  {formatDate(job.created_at)}
                  <Badge variant={job.status === "open" ? "success" : "secondary"}>
                    {job.status}
                  </Badge>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="flex items-start gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
        <Scale className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        Coming in Week 2: every uploaded CV gets parsed and scored 0–100 per
        criterion against your rubric — identities stay hidden until you click
        Reveal, and scores are locked before you can see them.
      </p>
    </div>
  );
}
