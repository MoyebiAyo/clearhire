"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Gem, Quote } from "lucide-react";

/**
 * HiddenGems — the AI "second look": scans CV text of candidates ranked
 * outside the top ranks and surfaces overlooked evidence. Read-only.
 */

interface Gem {
  rank: number;
  total: number | null;
  quote: string;
  reason: string;
}

export function HiddenGems({ jobId, jobStatus }: { jobId: string; jobStatus: string }) {
  const [busy, setBusy] = useState(false);
  const [gems, setGems] = useState<Gem[] | null>(null);
  const [meta, setMeta] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setGems(null);
    setMeta(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/hidden-gems`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The second look didn't work — try again.");
      setGems(body.gems ?? []);
      setMeta(
        body.message ??
          (body.gems?.length
            ? `Scanned ${body.scanned} candidates ranked beyond #${5}`
            : `Scanned ${body.scanned} candidates — nothing overlooked found.`)
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The second look didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = jobStatus !== "open";

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Gem className="size-4 text-primary" aria-hidden /> Hidden gems
          </p>
          <p className="text-xs text-muted-foreground">
            The AI re-reads CVs ranked outside the top 5 for evidence the rubric may have underweighted.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={run} loading={busy} disabled={disabled || busy}>
          {gems ? "Run again" : "Run second look"}
        </Button>
      </div>

      {busy && (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-5" aria-live="polite">
          <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-primary" aria-hidden />
          Re-reading the overlooked CVs — this takes a few seconds…
        </p>
      )}

      {!busy && gems !== null && (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          {gems.length === 0 ? (
            <p className="text-sm text-muted-foreground">{meta ?? "Nothing overlooked found — the top ranks hold up."}</p>
          ) : (
            <div className="space-y-3">
              {gems.map((gem) => (
                <div key={gem.rank} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Candidate #{gem.rank}</Badge>
                    {gem.total !== null && <Badge variant="outline">Blind score {gem.total}</Badge>}
                  </div>
                  <p className="mt-2 flex gap-2 text-sm leading-relaxed">
                    <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    “{gem.quote}”
                  </p>
                  {gem.reason && <p className="mt-1 text-xs text-muted-foreground">{gem.reason}</p>}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{meta}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
