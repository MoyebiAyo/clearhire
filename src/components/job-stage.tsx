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

/**
 * Owns the run state shared by the pipeline controls and the shortlist, so
 * the shortlist can show skeletons while a pass is in flight.
 */
export function JobStage({
  jobId,
  rows,
  weights,
  aiConfigured,
}: {
  jobId: string;
  rows: ShortlistRow[];
  weights: RubricWeights;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState<"extract" | "score" | null>(null);

  const pendingExtract = rows.filter((r) => !r.extracted).length;
  const readyToScore = rows.filter((r) => r.extracted && !r.score).length;
  const scoredCount = rows.filter((r) => r.score).length;

  async function run(kind: "extract" | "score") {
    setRunning(kind);
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
        running={running}
        onExtract={() => run("extract")}
        onScore={() => run("score")}
      />
      <Shortlist rows={rows} weights={weights} busy={running} />
    </div>
  );
}
