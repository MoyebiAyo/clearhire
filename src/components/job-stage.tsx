"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AiPipeline } from "@/components/ai-pipeline";
import { Shortlist, type RubricWeights, type ShortlistRow } from "@/components/shortlist";

interface ReportItem {
  application_id: string;
  status: "extracted" | "scored" | "failed";
  message?: string;
}

export interface RunProgress {
  kind: "extract" | "score";
  done: number;
  total: number;
}

const CHUNK_SIZE = 3;
/** Hard stop for the chunk loop (poison-CV protection is the zero-progress
 * check below; this is a final backstop). */
const MAX_CHUNKS = 60;

/**
 * Owns the run state shared by the pipeline controls and the shortlist.
 * AI passes run in small chunks (3 CVs per request) that each finish well
 * inside serverless limits; the client loops until `remaining` hits zero,
 * tracking progress so the shortlist can show live status.
 */
export function JobStage({
  jobId,
  rows,
  weights,
  aiConfigured,
  examWeights = null,
}: {
  jobId: string;
  rows: ShortlistRow[];
  weights: RubricWeights;
  aiConfigured: boolean;
  examWeights?: { cv: number; exam: number } | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState<RunProgress | null>(null);

  const pendingExtract = rows.filter((r) => !r.extracted).length;
  const readyToScore = rows.filter((r) => r.extracted && !r.score).length;
  const scoredCount = rows.filter((r) => r.score).length;

  async function run(kind: "extract" | "score") {
    const initialTotal = kind === "extract" ? pendingExtract : readyToScore;
    setRunning({ kind, done: 0, total: initialTotal });

    const allResults: ReportItem[] = [];
    try {
      for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
        const res = await fetch(`/api/jobs/${jobId}/${kind}?limit=${CHUNK_SIZE}`, {
          method: "POST",
        });
        const body = await res.json();
        if (!res.ok) {
          toast.error(body.error ?? "The AI pass failed. Please try again.");
          return;
        }

        const results = (body.results ?? []) as ReportItem[];
        if (results.length === 0) {
          if (allResults.length === 0) toast.info(body.message ?? "Nothing to do.");
          break;
        }

        const okCount = results.filter((r) => r.status !== "failed").length;
        allResults.push(...results);
        const remaining: number = body.remaining ?? 0;

        setRunning((r) =>
          r
            ? {
                ...r,
                done: r.done + okCount,
                total: Math.max(r.done + okCount + remaining, r.total),
              }
            : r
        );

        if (remaining === 0) break;
        if (okCount === 0) {
          // A full chunk failed — stop instead of retrying forever.
          break;
        }
      }

      const ok = allResults.filter((r) => r.status !== "failed");
      const failed = allResults.filter((r) => r.status === "failed");
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
      toast.error(
        "Connection interrupted — everything done so far is saved. Click again to resume where it stopped."
      );
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-6">
      <AiPipeline
        pendingExtract={pendingExtract}
        readyToScore={readyToScore}
        scoredCount={scoredCount}
        aiConfigured={aiConfigured}
        running={running?.kind ?? null}
        onExtract={() => run("extract")}
        onScore={() => run("score")}
      />
      <Shortlist rows={rows} weights={weights} busy={running} examWeights={examWeights} />
    </div>
  );
}
