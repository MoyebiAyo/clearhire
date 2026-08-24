"use client";

import { EyeOff, Sparkles, TriangleAlert, WandSparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Presentational pipeline controls. The run logic lives in JobStage so the
 * shortlist can show skeletons while a pass is in flight.
 */
export function AiPipeline({
  pendingExtract,
  readyToScore,
  scoredCount,
  aiConfigured,
  running,
  busy,
  busyLine,
  onExtract,
  onScore,
}: {
  pendingExtract: number;
  readyToScore: number;
  scoredCount: number;
  aiConfigured: boolean;
  running: "extract" | "score" | null;
  busy: { done: number; total: number } | null;
  busyLine: string;
  onExtract: () => void;
  onScore: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <WandSparkles className="size-4 text-primary" aria-hidden />
          AI pipeline
        </CardTitle>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Scoring is <strong className="font-medium text-foreground">blind</strong>:
          the AI sees only skills, years, certifications and tools — never
          names, schools or photos — so the ranking can't be biased by identity.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!aiConfigured ? (
          <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="font-medium">AI provider not configured</p>
              <p className="text-muted-foreground">
                Set <code className="rounded bg-muted px-1">GROQ_API_KEY</code> in
                your environment (free key from console.groq.com) to enable
                extraction and scoring.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <Button
              className="w-full sm:w-auto"
              onClick={onExtract}
              loading={running === "extract"}
              disabled={pendingExtract === 0 || running !== null}
              title={
                pendingExtract === 0
                  ? "Every CV on this job already has structured data."
                  : "Parse each pending CV into skills, years, education, certifications and tools."
              }
            >
              <Sparkles aria-hidden />
              1. Extract skills
              {pendingExtract > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {pendingExtract} pending
                </Badge>
              )}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={onScore}
              loading={running === "score"}
              disabled={readyToScore === 0 || running !== null}
              title={
                readyToScore === 0
                  ? "Score after extraction — CVs must be extracted first."
                  : "Score each extracted CV 0–100 per criterion against this job's rubric."
              }
            >
              <EyeOff aria-hidden />
              2. Score blind
              {readyToScore > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {readyToScore} ready
                </Badge>
              )}
            </Button>
            {scoredCount > 0 && (
              <span className="text-sm text-muted-foreground">
                {scoredCount} scored — results below, ranked.
              </span>
            )}
          </div>
        )}
        {busy && (
          <div className="space-y-2" aria-live="polite">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
              <span key={busyLine} className="fade-swap break-words font-medium text-foreground">
                {busyLine}
              </span>
              <span className="tabular-nums">
                {busy.done} of {busy.total} done
              </span>
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{
                  width: `${busy.total > 0 ? Math.min((busy.done / busy.total) * 100, 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This can take up to 3 minutes depending on how many documents you
              uploaded — everything is saved as it goes, so it&apos;s safe to wait.
            </p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Re-running either step is safe: already-processed CVs are skipped, and
          totals are always computed from your rubric weights in code — the AI
          never does the math.
        </p>
      </CardContent>
    </Card>
  );
}
