import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Scale } from "lucide-react";

import { CvUploader } from "@/components/cv-uploader";
import { JobActions } from "@/components/job-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { Application } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!job) notFound();

  const { data: applications } = await supabase
    .from("applications")
    .select("id, candidate_id, job_id, cv_file_path, status, applied_at, flagged_duplicate, candidates(name, email, source)")
    .eq("job_id", id)
    .order("applied_at", { ascending: false });

  const apps = (applications ?? []) as unknown as Application[];

  const rubric = [
    { label: "Skills", value: Number(job.weight_skills) },
    { label: "Experience", value: Number(job.weight_experience) },
    { label: "Certifications", value: Number(job.weight_certifications) },
    { label: "Tools", value: Number(job.weight_tools) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/jobs"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 text-muted-foreground"
          )}
        >
          <ArrowLeft aria-hidden /> All jobs
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              Created {formatDate(job.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={job.status === "open" ? "success" : "secondary"}>
              {job.status}
            </Badge>
            <JobActions jobId={job.id} status={job.status} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {rubric.map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label} weight</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}%</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="size-4 text-primary" aria-hidden />
            How this job is scored
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Every CV is parsed into structured data (skills, years of
            experience, certifications, tools) and scored 0–100 per criterion
            against this rubric. Scoring is <strong>blind</strong> — names,
            schools, and photos are stripped before the AI sees anything.
          </p>
          <details className="group rounded-lg border border-border">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-primary marker:content-none hover:bg-muted">
              Show job description
            </summary>
            <p className="whitespace-pre-wrap border-t border-border px-4 py-3 text-sm leading-relaxed text-foreground">
              {job.jd_text}
            </p>
          </details>
        </CardContent>
      </Card>

      <CvUploader jobId={job.id} jobStatus={job.status} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Candidates{" "}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              ({apps.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {apps.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No CVs yet — upload a batch above and candidates appear here with
              their extracted details.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-6 py-3 font-medium">Candidate</th>
                    <th className="px-6 py-3 font-medium">Source</th>
                    <th className="px-6 py-3 font-medium">Applied</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {apps.map((app) => (
                    <tr key={app.id} className="hover:bg-muted/60">
                      <td className="px-6 py-3">
                        <p className="font-medium">
                          {app.candidates?.name || "Unknown name"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {app.candidates?.email}
                        </p>
                        {app.flagged_duplicate && (
                          <Badge variant="warning" className="mt-1">
                            Possible duplicate — same email applied before
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant="secondary">{app.candidates?.source === "email" ? "Email" : "Upload"}</Badge>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {formatDate(app.applied_at)}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant="outline" className="capitalize">
                          {app.status.replace(/_/g, " ")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
