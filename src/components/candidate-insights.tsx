"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Sparkles, Quote, ArrowRight } from "lucide-react";

/**
 * CandidateInsights — the "What did the AI see?" view, rendered inside the
 * candidate detail drawer. Shows the exact blind payload the scoring model
 * saw, the candidate's story (rationale, gaps, quotable CV evidence), and
 * a deterministic suggested next action.
 */

interface InsightsBlind {
  rank: number | null;
  skills: string[];
  experience_years: number | null;
  certifications: string[];
  tools: string[];
  education: { degree: string; institution: string }[];
  subscores: { skills: number; experience: number; certifications: number; tools: number; total: number } | null;
  gaps: { requirement: string; missing_skill: string | null; severity: "hard" | "nice-to-have" }[];
  rationale: string | null;
  status: string;
  exam_status: string | null;
  exam_score: number | null;
}

interface InsightsStory {
  quotes: string[];
  nextAction: { label: string; reason: string } | null;
}

interface Insights {
  blind: InsightsBlind;
  profile: {
    name: string | null;
    email: string | null;
    source: string | null;
    applied_at: string;
    revealed: boolean;
    interview_status: string | null;
    interview_scheduled_time: string | null;
  };
  story: InsightsStory;
}

function Chips({ items, tone = "default" }: { items: string[]; tone?: "default" | "success" | "destructive" }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground">None recorded</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, 10).map((item) => (
        <Badge key={item} variant={tone} className="max-w-full truncate font-normal">
          {item}
        </Badge>
      ))}
      {items.length > 10 && <Badge variant="secondary" className="font-normal">+{items.length - 10}</Badge>}
    </div>
  );
}

export function CandidateInsights({ jobId, applicationId }: { jobId: string; applicationId: string }) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetch(`/api/jobs/${jobId}/applications/${applicationId}/insights`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't load insights.");
        return body as Insights;
      })
      .then((body) => alive && setData(body))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Couldn't load insights."));
    return () => {
      alive = false;
    };
  }, [jobId, applicationId]);

  if (error) {
    return <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">{error}</p>;
  }

  if (!data) {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const { blind, story } = data;
  const hardGaps = blind.gaps.filter((g) => g.severity === "hard");
  const niceGaps = blind.gaps.filter((g) => g.severity !== "hard");

  return (
    <div className="space-y-4" aria-label="AI insights">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="size-4 text-primary" aria-hidden /> What the AI saw
      </p>

      {/* The blind payload — exactly what the scoring model was given. */}
      <div className="rounded-xl border border-primary/20 bg-primary-soft/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Blind scoring payload</p>
          {blind.rank ? <Badge variant="secondary">Ranked #{blind.rank}</Badge> : null}
        </div>
        {blind.subscores ? (
          <div className="mt-2 grid grid-cols-4 gap-2 text-center">
            {(["skills", "experience", "certifications", "tools"] as const).map((k) => (
              <div key={k} className="rounded-lg bg-background px-1 py-2">
                <p className="text-base font-semibold">{blind.subscores![k]}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.slice(0, 4)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Not scored yet.</p>
        )}
        <dl className="mt-3 space-y-2 text-xs">
          <div>
            <dt className="font-medium text-muted-foreground">Skills the model matched</dt>
            <dd className="mt-1"><Chips items={blind.skills} tone="success" /></dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Tools</dt>
            <dd className="mt-1"><Chips items={blind.tools} /></dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Certifications</dt>
            <dd className="mt-1"><Chips items={blind.certifications} /></dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Experience</dt>
            <dd>{blind.experience_years !== null ? `${blind.experience_years} years` : "Not detected"}</dd>
          </div>
        </dl>
        <p className="mt-3 rounded-lg bg-background px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          No name, email, school, gender, photo or age was part of scoring — only the fields above.
        </p>
      </div>

      {/* Rationale + gaps */}
      {blind.rationale && (
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why this score</p>
          <p className="mt-1 text-sm leading-relaxed">{blind.rationale}</p>
          {blind.gaps.length > 0 && (
            <div className="mt-3 space-y-2">
              {hardGaps.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-destructive">Hard gaps</p>
                  <div className="mt-1"><Chips items={hardGaps.map((g) => (g.missing_skill ? `${g.requirement} — missing: ${g.missing_skill}` : g.requirement))} tone="destructive" /></div>
                </div>
              )}
              {niceGaps.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Nice-to-have gaps</p>
                  <div className="mt-1"><Chips items={niceGaps.map((g) => g.requirement)} /></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Evidence + suggested next step */}
      <div className="rounded-xl border border-border p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">From the CV text</p>
        {story.quotes.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {story.quotes.map((quote, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <Quote className="mt-0.5 size-3 shrink-0" aria-hidden /> “{quote}”
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">No standout evidence lines detected in the CV text.</p>
        )}
      </div>

      {story.nextAction && (
        <div className={cn("flex items-start gap-2 rounded-xl border border-primary/20 bg-primary-soft/30 p-3")}>
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-medium">Suggested next: {story.nextAction.label}</p>
            <p className="text-xs text-muted-foreground">{story.nextAction.reason}</p>
          </div>
        </div>
      )}
    </div>
  );
}
