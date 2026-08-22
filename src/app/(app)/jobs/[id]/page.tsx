import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Scale } from "lucide-react";

import { CvUploader } from "@/components/cv-uploader";
import { JobActions } from "@/components/job-actions";
import { JobStage } from "@/components/job-stage";
import { RubricEditor } from "@/components/rubric-editor";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aiConfigured } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import type { Gap } from "@/lib/types";
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

  const { data: appRows } = await supabase
    .from("applications")
    .select(
      "id, applied_at, flagged_duplicate, revealed_at, cv_file_path, candidates(name, email, source), cv_extractions(skills, extract_error), scores(skills_score, experience_score, certifications_score, tools_score, total_score, gaps, rationale)"
    )
    .eq("job_id", id)
    .order("applied_at", { ascending: false });

  interface RawRow {
    id: string;
    applied_at: string;
    flagged_duplicate: boolean;
    revealed_at: string | null;
    cv_file_path: string | null;
    candidates: { name: string | null; email: string; source: string | null }[] | null;
    cv_extractions: { skills: string[] | null; extract_error: string | null }[] | null;
    scores:
      | {
          skills_score: number;
          experience_score: number;
          certifications_score: number;
          tools_score: number;
          total_score: number;
          gaps: Gap[] | null;
          rationale: string | null;
        }[]
      | null;
  }

  const rows = ((appRows ?? []) as unknown as RawRow[]).map((r) => {
    const score = r.scores?.[0];
    return {
      id: r.id,
      appliedAt: r.applied_at,
      revealed: r.revealed_at !== null,
      name: r.candidates?.[0]?.name ?? null,
      email: r.candidates?.[0]?.email ?? "(unknown)",
      source: (r.candidates?.[0]?.source as "upload" | "email" | null) ?? null,
      flaggedDuplicate: r.flagged_duplicate,
      extracted: r.cv_extractions?.[0]?.skills !== null && r.cv_extractions !== null,
      extractError: r.cv_extractions?.[0]?.extract_error ?? null,
      hasCv: r.cv_file_path !== null,
      score: score
        ? {
            skills: Number(score.skills_score),
            experience: Number(score.experience_score),
            certifications: Number(score.certifications_score),
            tools: Number(score.tools_score),
            total: Number(score.total_score),
            gaps: score.gaps ?? [],
            rationale: score.rationale,
          }
        : null,
      rank: 0,
    };
  });

  // Stable candidate numbers: rank by total score at page load.
  const rankedOrder = [...rows]
    .filter((r) => r.score)
    .sort((a, b) => b.score!.total - a.score!.total);
  rankedOrder.forEach((r, i) => (r.rank = i + 1));
  let nextRank = rankedOrder.length;
  for (const r of rows) {
    if (!r.score) r.rank = ++nextRank;
  }

  const weights = {
    skills: Number(job.weight_skills),
    experience: Number(job.weight_experience),
    certifications: Number(job.weight_certifications),
    tools: Number(job.weight_tools),
  };

  const rubric = [
    { label: "Skills", value: weights.skills },
    { label: "Experience", value: weights.experience },
    { label: "Certifications", value: weights.certifications },
    { label: "Tools", value: weights.tools },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
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
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={job.status === "open" ? "success" : "secondary"}>
              {job.status}
            </Badge>
            <JobActions jobId={job.id} status={job.status} />
            <RubricEditor
              jobId={job.id}
              jdText={job.jd_text}
              initialWeights={{
                weight_skills: weights.skills,
                weight_experience: weights.experience,
                weight_certifications: weights.certifications,
                weight_tools: weights.tools,
              }}
            />
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

      <JobStage
        jobId={job.id}
        rows={rows}
        weights={weights}
        aiConfigured={aiConfigured()}
      />
    </div>
  );
}
