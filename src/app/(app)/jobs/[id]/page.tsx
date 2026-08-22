import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, EyeOff, Scale } from "lucide-react";

import { AiPipeline } from "@/components/ai-pipeline";
import { CvUploader } from "@/components/cv-uploader";
import { JobActions } from "@/components/job-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aiConfigured } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import type { Gap, Score } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

interface CandidateRow {
  id: string;
  applied_at: string;
  flagged_duplicate: boolean;
  candidate: { name: string | null; email: string; source: string | null };
  extracted: boolean;
  extract_error: string | null;
  score: Score | null;
}

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
      "id, applied_at, flagged_duplicate, candidates(name, email, source), cv_extractions(skills, extract_error), scores(id, skills_score, experience_score, certifications_score, tools_score, total_score, gaps, rationale, scored_at)"
    )
    .eq("job_id", id)
    .order("applied_at", { ascending: false });

  const rows: CandidateRow[] = (appRows ?? []).map((r) => {
    const ext = (r.cv_extractions as unknown[] | null)?.[0] as
      | { skills: string[] | null; extract_error: string | null }
      | undefined;
    const score = (r.scores as unknown[] | null)?.[0] as Score | undefined;
    return {
      id: r.id,
      applied_at: r.applied_at,
      flagged_duplicate: r.flagged_duplicate,
      candidate: r.candidates as unknown as CandidateRow["candidate"],
      extracted: ext?.skills !== null && ext !== undefined,
      extract_error: ext?.extract_error ?? null,
      score: score ?? null,
    };
  });

  const pendingExtract = rows.filter((r) => !r.extracted).length;
  const scored = rows.filter((r) => r.score);
  const readyToScore = rows.filter((r) => r.extracted && !r.score).length;

  // Ranked: scored candidates by total desc, then the rest by applied date.
  rows.sort((a, b) => {
    if (a.score && b.score) return b.score.total_score - a.score.total_score;
    if (a.score) return -1;
    if (b.score) return 1;
    return 0;
  });

  const rubric = [
    { label: "Skills", value: Number(job.weight_skills) },
    { label: "Experience", value: Number(job.weight_experience) },
    { label: "Certifications", value: Number(job.weight_certifications) },
    { label: "Tools", value: Number(job.weight_tools) },
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

      <AiPipeline
        jobId={job.id}
        pendingExtract={pendingExtract}
        readyToScore={readyToScore}
        scoredCount={scored.length}
        aiConfigured={aiConfigured()}
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Candidates{" "}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              ({rows.length})
            </span>
          </CardTitle>
          {scored.length > 0 && (
            <Badge variant="warning" className="gap-1">
              <EyeOff className="size-3" aria-hidden /> Identities visible —
              blinding arrives in Week 3
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No CVs yet — upload a batch above and candidates appear here with
              their extracted details.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-6 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Candidate</th>
                    <th className="px-4 py-3 font-medium" title="Weighted total under this job's rubric">
                      Score
                    </th>
                    <th className="px-4 py-3 font-medium text-center" title="Skills / Experience / Certifications / Tools sub-scores">
                      S / E / C / T
                    </th>
                    <th className="px-4 py-3 font-medium">Gaps vs JD</th>
                    <th className="px-4 py-3 font-medium">Applied</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, i) => (
                    <tr key={row.id} className="align-top hover:bg-muted/60">
                      <td className="px-6 py-4 tabular-nums text-muted-foreground">
                        {row.score ? i + 1 : "—"}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium">
                          {row.candidate?.name || "Unknown name"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.candidate?.email} ·{" "}
                          {row.candidate?.source === "email" ? "Email" : "Upload"}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.flagged_duplicate && (
                            <Badge variant="warning">Possible duplicate</Badge>
                          )}
                          {!row.extracted && row.extract_error && (
                            <Badge variant="destructive" title={row.extract_error}>
                              Extract failed — retry Extract
                            </Badge>
                          )}
                        </div>
                        {row.score?.rationale && (
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-xs font-medium text-primary">
                              Why this score
                            </summary>
                            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                              {row.score.rationale}
                            </p>
                          </details>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {row.score ? (
                          <span className="text-lg font-semibold tabular-nums">
                            {Math.round(row.score.total_score)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center tabular-nums text-muted-foreground">
                        {row.score
                          ? `${Math.round(row.score.skills_score)} / ${Math.round(
                              row.score.experience_score
                            )} / ${Math.round(row.score.certifications_score)} / ${Math.round(
                              row.score.tools_score
                            )}`
                          : "—"}
                      </td>
                      <td className="px-4 py-4">
                        {row.score?.gaps && row.score.gaps.length > 0 ? (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {(row.score.gaps as Gap[]).slice(0, 4).map((g, j) => (
                              <Badge
                                key={j}
                                variant={g.severity === "hard" ? "destructive" : "secondary"}
                                title={`${g.requirement}${g.missing_skill ? ` — missing: ${g.missing_skill}` : ""}`}
                              >
                                {g.severity === "hard" ? "Hard: " : ""}
                                {g.requirement.length > 30
                                  ? `${g.requirement.slice(0, 30)}…`
                                  : g.requirement}
                              </Badge>
                            ))}
                            {row.score.gaps.length > 4 && (
                              <Badge variant="outline">
                                +{row.score.gaps.length - 4} more
                              </Badge>
                            )}
                          </div>
                        ) : row.score ? (
                          <Badge variant="success">No gaps found</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {formatDate(row.applied_at)}
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
