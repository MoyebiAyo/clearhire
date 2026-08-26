import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Scale } from "lucide-react";

import { CvUploader } from "@/components/cv-uploader";
import { ExamScheduler } from "@/components/exam-scheduler";
import { CopilotDrawer } from "@/components/copilot-drawer";
import { JobActions } from "@/components/job-actions";
import { JobStage } from "@/components/job-stage";
import { RubricEditor } from "@/components/rubric-editor";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aiConfigured } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import type { Gap } from "@/lib/types";
import { cn, formatDate, one } from "@/lib/utils";

interface ExamStatus {
  status: string;
  score: number | null;
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
      "id, status, applied_at, flagged_duplicate, revealed_at, cv_file_path, candidates(id, name, email, source), cv_extractions(skills, extract_error), scores(skills_score, experience_score, certifications_score, tools_score, total_score, gaps, rationale), interviews(id, status, scheduled_time, schedule_token, interviewer, location_or_link, interview_scorecards(interviewer_rating, interviewer_notes, criteria_scores, weighted_rating))"
    )
    .eq("job_id", id)
    .order("applied_at", { ascending: false });
  const applicationIds = (appRows ?? []).map((row) => row.id);
  const { data: emailRows } = applicationIds.length > 0
    ? await supabase
        .from("email_log")
        .select("id, type, to_email, subject, sent_at, provider_message_id")
        .in("application_id", applicationIds)
        .order("sent_at", { ascending: false })
        .limit(8)
    : { data: [] };

  const { data: templateRows } = await supabase
    .from("email_templates")
    .select("id, type, tone, subject")
    .eq("type", "invite")
    .order("tone");
  const templates = (templateRows ?? []).map((t) => ({
    id: t.id as string,
    tone: t.tone as string,
    subject: t.subject as string,
  }));

  // Gmail intake state for the per-job "Pull from Gmail" button.
  const { data: gmailConn } = await supabase
    .from("gmail_connections")
    .select("gmail_address")
    .maybeSingle();
  const gmail = {
    connected: !!gmailConn,
    address:
      gmailConn?.gmail_address && gmailConn.gmail_address !== "(unknown)"
        ? (gmailConn.gmail_address as string)
        : null,
  };

  // Active exam (if any) drives the blended final score: CV% + Exam% = 100.
  const { data: examRow } = await supabase
    .from("exams")
    .select(
      "id, status, questions_per_candidate, duration_minutes, weight_cv, weight_exam"
    )
    .eq("job_id", id)
    .eq("status", "active")
    .maybeSingle();
  const examWeights = examRow
    ? { cv: Number(examRow.weight_cv), exam: Number(examRow.weight_exam) }
    : null;
  const inviteByApp = new Map<string, ExamStatus>();
  if (examRow) {
    const { data: inviteRows } = await supabase
      .from("exam_invites")
      .select("application_id, status, score")
      .eq("exam_id", examRow.id);
    for (const inv of inviteRows ?? []) {
      inviteByApp.set(inv.application_id, {
        status: inv.status,
        score: inv.score === null ? null : Number(inv.score),
      });
    }
  }

  interface RawRow {
    id: string;
    status: string;
    applied_at: string;
    flagged_duplicate: boolean;
    revealed_at: string | null;
    cv_file_path: string | null;
    candidates: { id: string; name: string | null; email: string; source: string | null }[] | null;
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
    interviews:
      | {
          id: string;
          status: string;
          scheduled_time: string | null;
          schedule_token: string | null;
          interviewer: string | null;
          location_or_link: string | null;
          interview_scorecards:
            | { interviewer_rating: number; interviewer_notes: string | null; criteria_scores: Record<string, number> | null; weighted_rating: number | null }[]
            | null;
        }[]
      | null;
  }

  const rows = ((appRows ?? []) as unknown as RawRow[]).map((r) => {
    const score = r.scores?.[0];
    const interview = r.interviews?.[0];
    const cand = one<{ id: string; name: string | null; email: string; source: string | null }>(
      r.candidates
    );
    return {
      id: r.id,
      candidateId: cand?.id ?? null,
      appliedAt: r.applied_at,
      revealed: r.revealed_at !== null,
      name: cand?.name ?? null,
      email: cand?.email ?? "(unknown)",
      source: (cand?.source as "upload" | "email" | null) ?? null,
      flaggedDuplicate: r.flagged_duplicate,
      extracted: r.cv_extractions?.[0]?.skills !== null && r.cv_extractions !== null,
      extractError: r.cv_extractions?.[0]?.extract_error ?? null,
      hasCv: r.cv_file_path !== null,
      status: r.status,
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
      interview: interview
        ? {
            id: interview.id,
            status: interview.status,
            scheduled_time: interview.scheduled_time,
            schedule_token: interview.schedule_token,
            interviewer: interview.interviewer,
            location_or_link: interview.location_or_link,
            scorecard: interview.interview_scorecards?.[0]
              ? {
                   rating: Number(interview.interview_scorecards[0].interviewer_rating),
                   weightedRating: interview.interview_scorecards[0].weighted_rating === null ? null : Number(interview.interview_scorecards[0].weighted_rating),
                   criteriaScores: interview.interview_scorecards[0].criteria_scores,
                  notes: interview.interview_scorecards[0].interviewer_notes,
                }
              : null,
          }
        : null,
      exam: inviteByApp.get(r.id) ?? null,
      templates,
      returningJobs: [] as string[],
      rank: 0,
    };
  });

  // Returning candidates: prior applications by these candidates on OTHER
  // jobs (RLS-scoped to this recruiter's jobs), used for the friendly
  // "Returning — applied to X" badge — as opposed to a true duplicate,
  // which is flagged_duplicate on this job's application.
  const candidateIds = rows
    .map((r) => r.candidateId)
    .filter((v): v is string => Boolean(v));
  const returningMap = new Map<string, string[]>();
  if (candidateIds.length > 0) {
    const { data: priorApps } = await supabase
      .from("applications")
      .select("candidate_id, jobs(title)")
      .in("candidate_id", candidateIds)
      .neq("job_id", id);
    for (const pa of (priorApps ?? []) as unknown as {
      candidate_id: string;
      jobs: unknown;
    }[]) {
      const title = one<{ title: string }>(pa.jobs)?.title;
      if (!title) continue;
      const list = returningMap.get(pa.candidate_id) ?? [];
      if (!list.includes(title)) list.push(title);
      returningMap.set(pa.candidate_id, list);
    }
  }
  for (const r of rows) {
    r.returningJobs = r.candidateId ? (returningMap.get(r.candidateId) ?? []) : [];
  }

  // Stable candidate numbers: rank by FINAL score (CV + exam blend) when an
  // active exam exists, otherwise by the CV total.
  const finalOf = (r: (typeof rows)[number]) => {
    const s = r.score;
    if (!s) return -1;
    if (examWeights && r.exam?.score !== null && r.exam?.score !== undefined) {
      return (s.total * examWeights.cv + r.exam.score * examWeights.exam) / 100;
    }
    return s.total;
  };
  const rankedOrder = [...rows]
    .filter((r) => r.score)
    .sort((a, b) => finalOf(b) - finalOf(a));
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
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold tracking-tight">{job.title}</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              Created {formatDate(job.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={job.status === "open" ? "success" : "secondary"}>
              {job.status}
            </Badge>
            <CopilotDrawer jobId={job.id} jobTitle={job.title} />
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
            <p className="whitespace-pre-wrap break-words border-t border-border px-4 py-3 text-sm leading-relaxed text-foreground">
              {job.jd_text}
            </p>
            </details>
            {Array.isArray(job.requirements) && job.requirements.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {job.requirements.map((requirement: { requirement: string; type: string }) => (
                  <Badge key={`${requirement.type}-${requirement.requirement}`} variant={requirement.type === "hard" ? "destructive" : "secondary"}>
                    {requirement.type === "hard" ? "Mandatory" : "Preferred"}: {requirement.requirement}
                  </Badge>
                ))}
              </div>
            )}
        </CardContent>
      </Card>

      <CvUploader
        jobId={job.id}
        jobStatus={job.status}
        jobTitle={job.title}
        gmail={gmail}
      />

      <ExamScheduler
        jobId={job.id}
        aiConfigured={aiConfigured()}
        candidates={rows.map((row) => ({
          id: row.id,
          label: row.revealed
            ? row.name || row.email
            : `Candidate #${row.rank}`,
          score: row.score?.total ?? null,
          status: row.status,
        }))}
      />

      <details className="group rounded-xl border border-border bg-card shadow-sm">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 marker:content-none sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-medium">Email activity</p>
            <p className="text-xs text-muted-foreground">
              {(emailRows ?? []).filter((email) => email.provider_message_id).length} sent
              {(emailRows ?? []).some((email) => !email.provider_message_id)
                ? ` · ${(emailRows ?? []).filter((email) => !email.provider_message_id).length} need attention`
                : ""}
            </p>
          </div>
          <span className="text-xs font-medium text-primary group-open:hidden">View history</span>
          <span className="hidden text-xs font-medium text-primary group-open:inline">Hide history</span>
        </summary>
        <div className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border">
          {(emailRows ?? []).length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No emails sent for this job yet.</p>
          ) : (emailRows ?? []).map((email) => (
            <div key={email.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{email.subject}</p>
                <p className="break-all text-xs text-muted-foreground">{email.to_email} · {email.type.replaceAll("_", " ")} · {formatDate(email.sent_at)}</p>
              </div>
              <Badge variant={email.provider_message_id ? "success" : "warning"}>
                {email.provider_message_id ? "Sent" : "Needs attention"}
              </Badge>
            </div>
          ))}
        </div>
      </details>

      <JobStage
        jobId={job.id}
        rows={rows}
        weights={weights}
        aiConfigured={aiConfigured()}
        examWeights={examWeights}
      />
    </div>
  );
}
