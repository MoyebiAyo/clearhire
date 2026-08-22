"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Sparkles, TriangleAlert, WandSparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ReportItem {
  application_id: string;
  email: string | null;
  status: "extracted" | "scored" | "failed";
  total_score?: number;
  message?: string;
}

export function AiPipeline({
  jobId,
  pendingExtract,
  readyToScore,
  scoredCount,
  aiConfigured,
}: {
  jobId: string;
  pendingExtract: number;
  readyToScore: number;
  scoredCount: number;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [extracting, setExtracting] = useState(false);
  const [scoring, setScoring] = useState(false);

  async function run(
    kind: "extract" | "score",
    setLoading: (v: boolean) => void
  ) {
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/${kind}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "The AI pass failed. Please try again.");
        return;
      }
      const results = (body.results ?? []) as ReportItem[];
      if (results.length === 0) {
        toast.info(body.message ?? "Nothing to do.");
        return;
      }
      const ok = results.filter((r) => r.status !== "failed");
      const failed = results.filter((r) => r.status === "failed");
      if (ok.length > 0) {
        toast.success(
          kind === "extract"
            ? `Extracted structured data from ${ok.length} CV${ok.length === 1 ? "" : "s"}`
            : `Scored ${ok.length} candidate${ok.length === 1 ? "" : "s"} — blind, as always`
        );
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} CV${failed.length === 1 ? "" : "s"} failed`, {
          description: failed[0]?.message?.slice(0, 180),
        });
      }
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

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
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => run("extract", setExtracting)}
              loading={extracting}
              disabled={pendingExtract === 0 || scoring}
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
              onClick={() => run("score", setScoring)}
              loading={scoring}
              disabled={readyToScore === 0 || extracting}
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
        <p className="text-xs text-muted-foreground">
          Re-running either step is safe: already-processed CVs are skipped, and
          totals are always computed from your rubric weights in code — the AI
          never does the math.
        </p>
      </CardContent>
    </Card>
  );
}
