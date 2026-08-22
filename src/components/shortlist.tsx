"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Eye,
  EyeOff,
  FileDown,
  Info,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Gap } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

export interface ShortlistScore {
  skills: number;
  experience: number;
  certifications: number;
  tools: number;
  total: number;
  gaps: Gap[];
  rationale: string | null;
}

export interface ShortlistRow {
  id: string;
  rank: number;
  revealed: boolean;
  name: string | null;
  email: string;
  source: "upload" | "email" | null;
  appliedAt: string;
  flaggedDuplicate: boolean;
  extracted: boolean;
  extractError: string | null;
  hasCv: boolean;
  score: ShortlistScore | null;
}

export interface RubricWeights {
  skills: number;
  experience: number;
  certifications: number;
  tools: number;
}

type SortKey = "total" | "skills" | "experience" | "certifications" | "tools";

const CRITERIA: { key: Exclude<SortKey, "total">; label: string; weightKey: keyof RubricWeights }[] = [
  { key: "skills", label: "Skills", weightKey: "skills" },
  { key: "experience", label: "Experience", weightKey: "experience" },
  { key: "certifications", label: "Certs", weightKey: "certifications" },
  { key: "tools", label: "Tools", weightKey: "tools" },
];

function scoreColor(v: number): string {
  if (v >= 75) return "bg-success";
  if (v >= 50) return "bg-primary";
  return "bg-warning";
}

export function Shortlist({
  rows,
  weights,
  busy,
}: {
  rows: ShortlistRow[];
  weights: RubricWeights;
  busy: "extract" | "score" | null;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [onlyHardGaps, setOnlyHardGaps] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const isRevealed = (r: ShortlistRow) => r.revealed || revealed[r.id];

  const visible = useMemo(() => {
    let list = [...rows];
    if (onlyHardGaps) {
      list = list.filter((r) => (r.score?.gaps ?? []).some((g) => g.severity === "hard"));
    }
    list.sort((a, b) => {
      const get = (r: ShortlistRow) => (r.score ? r.score[sortKey] : -1);
      return get(b) - get(a);
    });
    return list;
  }, [rows, sortKey, onlyHardGaps]);

  const scoredCount = rows.filter((r) => r.score).length;
  const hardGapCount = rows.filter((r) =>
    (r.score?.gaps ?? []).some((g) => g.severity === "hard")
  ).length;

  async function reveal(row: ShortlistRow) {
    setRevealed((s) => ({ ...s, [row.id]: true }));
    try {
      const res = await fetch(`/api/applications/${row.id}/reveal`, { method: "POST" });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't persist the reveal — it will reset on reload.");
    }
  }

  async function downloadCv(row: ShortlistRow) {
    try {
      const res = await fetch(`/api/applications/${row.id}/cv`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      window.open(body.url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't open the CV.");
    }
  }

  const openRow = rows.find((r) => r.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Ranked shortlist{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({scoredCount} scored)
            </span>
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <EyeOff className="size-3.5" aria-hidden />
            Identities unlock per candidate, only after scores are locked in.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="sort" className="text-xs text-muted-foreground">
              Sort by
            </Label>
            <select
              id="sort"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-8 rounded-lg border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Rank candidates by total score or by a single criterion."
            >
              <option value="total">Total score</option>
              <option value="skills">Skills</option>
              <option value="experience">Experience</option>
              <option value="certifications">Certifications</option>
              <option value="tools">Tools</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setOnlyHardGaps((v) => !v)}
            aria-pressed={onlyHardGaps}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              onlyHardGaps
                ? "border-destructive/40 bg-destructive-soft text-destructive"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
            title="Show only candidates missing at least one hard requirement."
          >
            Missing hard requirement ({hardGapCount})
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="text-3xl" aria-hidden>🗂️</span>
            <div className="max-w-sm space-y-1">
              <p className="font-medium">No candidates yet</p>
              <p className="text-sm text-muted-foreground">
                Upload CVs above, then run Extract and Score — your ranked,
                de-identified shortlist appears here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : scoredCount === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="text-3xl" aria-hidden>⚖️</span>
            <div className="max-w-sm space-y-1">
              <p className="font-medium">Not scored yet</p>
              <p className="text-sm text-muted-foreground">
                {rows.some((r) => !r.extracted)
                  ? "Run “1. Extract skills”, then “2. Score blind” above to build the shortlist."
                  : "CVs are extracted — run “2. Score blind” above to build the shortlist."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {busy && (
            <div className="space-y-3" aria-live="polite">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
                {busy === "extract" ? "Extracting" : "Scoring"} candidates —
                usually a couple of seconds per CV…
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Skeleton className="h-40" />
                <Skeleton className="h-40" />
              </div>
            </div>
          )}
          <div className={cn("grid gap-3 md:grid-cols-2", busy && "opacity-50")}>
            {visible.map((row) => (
              <ShortlistCard
                key={row.id}
                row={row}
                weights={weights}
                revealed={isRevealed(row)}
                onReveal={() => reveal(row)}
                onDetails={() => setOpenId(row.id)}
                onDownload={() => downloadCv(row)}
              />
            ))}
          </div>
          {visible.length === 0 && (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Every candidate meets the hard requirements — nothing matches this
              filter.
            </p>
          )}
        </>
      )}

      {openRow && (
        <DetailDrawer
          row={openRow}
          weights={weights}
          revealed={isRevealed(openRow)}
          onClose={() => setOpenId(null)}
          onDownload={() => downloadCv(openRow)}
        />
      )}
    </div>
  );
}

function ShortlistCard({
  row,
  weights,
  revealed,
  onReveal,
  onDetails,
  onDownload,
}: {
  row: ShortlistRow;
  weights: RubricWeights;
  revealed: boolean;
  onReveal: () => void;
  onDetails: () => void;
  onDownload: () => void;
}) {
  const s = row.score;
  return (
    <Card className={cn("transition-shadow hover:shadow-md", !s && "opacity-70")}>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary"
                title="Rank by total score when this shortlist loaded."
              >
                #{row.rank}
              </span>
              {/* Identity: blurred until revealed — smooth blur-lift on click. */}
              <div
                className={cn(
                  "min-w-0 transition-all duration-500 select-none",
                  revealed ? "blur-0" : "blur-[6px]"
                )}
                aria-hidden={!revealed}
              >
                <p className="truncate font-medium">
                  {row.name || row.email.split("@")[0]}
                </p>
                <p className="truncate text-xs text-muted-foreground">{row.email}</p>
              </div>
              {!revealed && (
                <p className="text-sm font-medium text-muted-foreground">
                  Candidate #{row.rank}
                </p>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {row.flaggedDuplicate && (
                <Badge variant="warning">Possible duplicate</Badge>
              )}
              {row.extractError && (
                <Badge variant="destructive" title={row.extractError}>
                  Extract failed
                </Badge>
              )}
              {!row.extracted && !row.extractError && <Badge variant="secondary">Awaiting extraction</Badge>}
            </div>
          </div>
          {s && (
            <div className="text-right" title="Weighted total under this job's rubric — computed in code, never by the AI.">
              <p className="text-3xl font-semibold tabular-nums leading-none">
                {Math.round(s.total)}
              </p>
              <p className="text-xs text-muted-foreground">/ 100</p>
            </div>
          )}
        </div>

        {s && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {CRITERIA.map(({ key, label, weightKey }) => (
              <div key={key} title={`${label} sub-score, weighted ${weights[weightKey]}% in this job's rubric.`}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">
                    {label} <span className="tabular-nums opacity-70">{weights[weightKey]}%</span>
                  </span>
                  <span className="font-semibold tabular-nums">{Math.round(s[key])}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", scoreColor(s[key]))}
                    style={{ width: `${Math.min(s[key], 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {s && s.gaps.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.gaps.slice(0, 3).map((g, i) => (
              <Badge
                key={i}
                variant={g.severity === "hard" ? "destructive" : "secondary"}
                title={`${g.severity === "hard" ? "Hard requirement not met" : "Nice-to-have not met"}${g.missing_skill ? ` — missing: ${g.missing_skill}` : ""}`}
              >
                {g.severity === "hard" ? "Hard: " : ""}
                {g.requirement.length > 34 ? `${g.requirement.slice(0, 34)}…` : g.requirement}
              </Badge>
            ))}
            {s.gaps.length > 3 && (
              <Badge variant="outline">+{s.gaps.length - 3} more</Badge>
            )}
          </div>
        )}
        {s && s.gaps.length === 0 && <Badge variant="success">Meets all requirements</Badge>}

        {s?.rationale && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-primary marker:content-none">
              Why this score
            </summary>
            <p className="mt-1 leading-relaxed text-muted-foreground">{s.rationale}</p>
          </details>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={onReveal} disabled={revealed}>
            <Eye aria-hidden /> {revealed ? "Revealed" : "Reveal identity"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDetails}>
            <Info aria-hidden /> Details
          </Button>
          {revealed && row.hasCv && (
            <Button size="sm" variant="ghost" onClick={onDownload} title="Opens a private, 5-minute download link.">
              <FileDown aria-hidden /> CV
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DetailDrawer({
  row,
  weights,
  revealed,
  onClose,
  onDownload,
}: {
  row: ShortlistRow;
  weights: RubricWeights;
  revealed: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  const s = row.score;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-foreground/30 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Candidate details"
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">
            {revealed ? row.name || row.email : `Candidate #${row.rank}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3.5" aria-hidden /> Applied {formatDate(row.appliedAt)}
          </span>
          <Badge variant="secondary">{row.source === "email" ? "Email" : "Upload"}</Badge>
          {row.flaggedDuplicate && <Badge variant="warning">Possible duplicate</Badge>}
        </div>

        {revealed ? (
          <div className="mt-4 space-y-1 rounded-lg bg-muted p-4 text-sm">
            <p className="font-medium">{row.name ?? "Name not detected"}</p>
            <p className="text-muted-foreground">{row.email}</p>
            {row.hasCv && (
              <Button size="sm" variant="outline" className="mt-2" onClick={onDownload}>
                <FileDown aria-hidden /> Download CV (private link)
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            Identity is hidden until you click <strong>Reveal</strong> on the
            card. The score was locked in before anyone — human or AI — could
            connect it to a person.
          </p>
        )}

        {s ? (
          <div className="mt-6 space-y-5">
            <div className="space-y-3">
              {CRITERIA.map(({ key, label, weightKey }) => (
                <div key={key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>
                      {label}{" "}
                      <span className="text-xs text-muted-foreground">
                        (weight {weights[weightKey]}%)
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{Math.round(s[key])}/100</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", scoreColor(s[key]))}
                      style={{ width: `${Math.min(s[key], 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
                <span className="font-medium">Weighted total</span>
                <span className="text-lg font-semibold tabular-nums">{Math.round(s.total)}/100</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium">Gaps vs job requirements</h4>
              {s.gaps.length === 0 ? (
                <p className="mt-1 text-sm text-success">Meets every requirement.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {s.gaps.map((g, i) => (
                    <li key={i} className="rounded-lg border border-border p-2.5 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span>{g.requirement}</span>
                        <Badge
                          variant={g.severity === "hard" ? "destructive" : "secondary"}
                          className="shrink-0"
                        >
                          {g.severity === "hard" ? "Hard requirement" : "Nice-to-have"}
                        </Badge>
                      </div>
                      {g.missing_skill && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Missing: {g.missing_skill}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {s.rationale && (
              <div>
                <h4 className="text-sm font-medium">Why this score</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {s.rationale}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            No score yet — run the AI pipeline above.
          </p>
        )}
      </div>
    </div>
  );
}
