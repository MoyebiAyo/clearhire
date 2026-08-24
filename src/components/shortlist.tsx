"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  Eye,
  EyeOff,
  FileDown,
  Info,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import type { RunProgress } from "@/components/job-stage";
import { InterviewActions } from "@/components/interview-actions";
import type { Gap } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

export interface TemplateOption {
  id: string;
  tone: string;
  subject: string;
}

export interface InterviewInfo {
  id: string;
  status: string;
  scheduled_time: string | null;
  schedule_token: string | null;
  interviewer: string | null;
  location_or_link: string | null;
  scorecard: { rating: number; notes: string | null } | null;
}

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
  status: string;
  /** Job titles this candidate applied to previously (other jobs). */
  returningJobs?: string[];
  score: ShortlistScore | null;
  interview: InterviewInfo | null;
  /** Exam session for the job's active exam, if invited. */
  exam?: { status: string; score: number | null } | null;
  templates: TemplateOption[];
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

/** Final = CV × wCv + Exam × wExam when an exam score exists (in code,
 * never by the AI); otherwise the CV total stands alone. */
function finalScore(
  row: ShortlistRow,
  examWeights: { cv: number; exam: number } | null
): number | null {
  if (!row.score) return null;
  if (examWeights && row.exam && row.exam.score !== null) {
    return (row.score.total * examWeights.cv + row.exam.score * examWeights.exam) / 100;
  }
  return row.score.total;
}

const EXAM_CHIP: Record<string, { label: string; variant: "default" | "warning" | "secondary" }> = {
  invited: { label: "Exam invited", variant: "secondary" },
  in_progress: { label: "Exam in progress", variant: "secondary" },
  submitted: { label: "Exam done", variant: "default" },
  forfeited: { label: "Exam forfeited", variant: "warning" },
  expired: { label: "Exam expired", variant: "secondary" },
};

export function Shortlist({
  rows,
  weights,
  busy,
  examWeights = null,
}: {
  rows: ShortlistRow[];
  weights: RubricWeights;
  busy: RunProgress | null;
  examWeights?: { cv: number; exam: number } | null;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [blindMode, setBlindMode] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [onlyHardGaps, setOnlyHardGaps] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dupId, setDupId] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const router = useRouter();

  /** Database reveal state AND the screen-sharing "hide identities" layer. */
  const isRevealed = (r: ShortlistRow) =>
    !blindMode && (r.revealed || revealed[r.id]);

  /** Rejected applications leave the main shortlist for their own bucket
   * below (viewable + undoable) — the ranked list stays decision-focused. */
  const activeRows = useMemo(
    () => rows.filter((r) => r.status !== "rejected"),
    [rows]
  );
  const rejectedRows = useMemo(
    () => rows.filter((r) => r.status === "rejected"),
    [rows]
  );

  const visible = useMemo(() => {
    let list = [...activeRows];
    if (onlyHardGaps) {
      list = list.filter((r) => (r.score?.gaps ?? []).some((g) => g.severity === "hard"));
    }
    list.sort((a, b) => {
      const get = (r: ShortlistRow) =>
        sortKey === "total"
          ? finalScore(r, examWeights) ?? -1
          : r.score
            ? r.score[sortKey]
            : -1;
      return get(b) - get(a);
    });
    return list;
  }, [activeRows, sortKey, onlyHardGaps, examWeights]);

  const scoredCount = activeRows.filter((r) => r.score).length;
  const hardGapCount = activeRows.filter((r) =>
    (r.score?.gaps ?? []).some((g) => g.severity === "hard")
  ).length;

  async function undoRejection(row: ShortlistRow) {
    setUndoingId(row.id);
    try {
      const res = await fetch(`/api/applications/${row.id}/undo-rejection`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't restore the application.");
        return;
      }
      toast.success(
        `Back on the shortlist as ${body.status === "screened" ? "screened" : "applied"} — their locked score is untouched`
      );
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setUndoingId(null);
    }
  }

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
            {examWeights
              ? `Final score = CV ${examWeights.cv}% + exam ${examWeights.exam}% — identities unlock per candidate after scores are locked in.`
              : "Identities unlock per candidate, only after scores are locked in."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBlindMode((v) => !v)}
            aria-pressed={blindMode}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              blindMode
                ? "border-primary/40 bg-primary-soft text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
            title="Blur every identity on screen without un-revealing anything — handy for screen shares and demos. Revealed candidates reappear when switched back."
          >
            {blindMode ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
            {blindMode ? "Identities hidden" : "Hide identities"}
          </button>
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

      {rows.length === 0 && !busy ? (
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
      ) : activeRows.length === 0 && !busy ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="text-3xl" aria-hidden>🗂️</span>
            <div className="max-w-sm space-y-1">
              <p className="font-medium">
                All {rejectedRows.length} application{rejectedRows.length === 1 ? "" : "s"} on
                this job were rejected
              </p>
              <p className="text-sm text-muted-foreground">
                Change your mind? Restore any of them from the Rejected list
                below — scores were never touched.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : scoredCount === 0 && !busy ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="text-3xl" aria-hidden>⚖️</span>
            <div className="max-w-sm space-y-1">
              <p className="font-medium">Not scored yet</p>
              <p className="text-sm text-muted-foreground">
                {activeRows.some((r) => !r.extracted)
                  ? "Run “1. Extract skills”, then “2. Score blind” above to build the shortlist."
                  : "CVs are extracted — run “2. Score blind” above to build the shortlist."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {busy && (
            <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2" aria-hidden>
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          )}
          <div className={cn("grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2", busy && "opacity-50")}>
            {visible.map((row) => (
              <ShortlistCard
                key={row.id}
                row={row}
                weights={weights}
                examWeights={examWeights}
                revealed={isRevealed(row)}
                blindMode={blindMode}
                onReveal={() => reveal(row)}
                onDetails={() => setOpenId(row.id)}
                onDownload={() => downloadCv(row)}
                onDuplicate={() => setDupId(row.id)}
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

      {rejectedRows.length > 0 && (
        <div className="rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setShowRejected((v) => !v)}
            aria-expanded={showRejected}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Archive className="size-4 text-muted-foreground" aria-hidden />
              Rejected candidates
              <Badge variant="secondary">{rejectedRows.length}</Badge>
              <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
                Out of the running — kept here so nothing is lost
              </span>
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                showRejected && "rotate-180"
              )}
              aria-hidden
            />
          </button>
          {showRejected && (
            <ul className="divide-y divide-border border-t border-border">
              {rejectedRows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground"
                      title="Rank when this shortlist loaded."
                    >
                      #{row.rank}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 truncate font-medium transition-all duration-500 select-none",
                        isRevealed(row) ? "blur-0" : "blur-[6px]"
                      )}
                      aria-hidden={!isRevealed(row)}
                    >
                      {row.name || row.email.split("@")[0]}
                    </span>
                    {!isRevealed(row) && (
                      <span className="text-muted-foreground">Candidate #{row.rank}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {row.score ? (
                      <span
                        className="tabular-nums text-muted-foreground"
                        title="Blind score, locked before rejection — unchanged by restore."
                      >
                        {Math.round(row.score.total)}/100
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">not scored</span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => undoRejection(row)}
                      loading={undoingId === row.id}
                      disabled={undoingId !== null}
                      title="Puts them back on the active shortlist with their locked score intact."
                    >
                      <Undo2 aria-hidden /> Undo
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
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

      {dupId && (
        <DuplicateDialog
          row={rows.find((r) => r.id === dupId)!}
          onClose={() => setDupId(null)}
        />
      )}
    </div>
  );
}

function DuplicateDialog({
  row,
  onClose,
}: {
  row: ShortlistRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"keep_both" | "use_this" | null>(null);

  async function resolve(action: "keep_both" | "use_this") {
    setBusy(action);
    try {
      const res = await fetch(`/api/applications/${row.id}/resolve-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't resolve.");
        return;
      }
      toast.success(
        action === "keep_both"
          ? "Kept both applications — flag cleared"
          : `Merged — removed ${body.removed} older application${body.removed === 1 ? "" : "s"}, this one is canonical`
      );
      onClose();
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose} title="Resolve possible duplicate">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{row.email}</strong> applied to
          this job more than once. Both applications are kept until you
          decide — nothing merges silently.
        </p>
        <div className="space-y-2">
          <Button
            className="w-full justify-start"
            variant="outline"
            loading={busy === "use_this"}
            disabled={busy !== null}
            onClick={() => resolve("use_this")}
            title="Removes the earlier application(s) from this job (their interviews and reminders go with them) and keeps this one."
          >
            Use this application — merge the rest into it
          </Button>
          <Button
            className="w-full justify-start"
            variant="outline"
            loading={busy === "keep_both"}
            disabled={busy !== null}
            onClick={() => resolve("keep_both")}
            title="Both applications stay; the duplicate flag is dismissed."
          >
            Keep both — they're separate applications
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ShortlistCard({
  row,
  weights,
  examWeights,
  revealed,
  blindMode,
  onReveal,
  onDetails,
  onDownload,
  onDuplicate,
}: {
  row: ShortlistRow;
  weights: RubricWeights;
  examWeights: { cv: number; exam: number } | null;
  revealed: boolean;
  blindMode: boolean;
  onReveal: () => void;
  onDetails: () => void;
  onDownload: () => void;
  onDuplicate: () => void;
}) {
  const s = row.score;
  const blended = examWeights && row.exam?.score !== null && row.exam?.score !== undefined;
  const final = s ? finalScore(row, examWeights) : null;
  const examChip = row.exam ? EXAM_CHIP[row.exam.status] : null;
  return (
    <Card className={cn("min-w-0 overflow-hidden transition-shadow hover:shadow-md", !s && "opacity-70")}>
      <CardContent className="space-y-4 p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate();
                  }}
                  className="rounded-full border border-transparent bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning transition-colors hover:border-warning/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="This email applied to this job before — click to merge or keep both."
                >
                  Duplicate — applied to this job · resolve
                </button>
              )}
              {!row.flaggedDuplicate && (row.returningJobs?.length ?? 0) > 0 && (
                <Badge
                  variant="default"
                  title={`Known from: ${row.returningJobs!.join(", ")}`}
                >
                  Returning — applied to{" "}
                  {row.returningJobs![0].length > 24
                    ? `${row.returningJobs![0].slice(0, 24)}…`
                    : row.returningJobs![0]}
                  {row.returningJobs!.length > 1 ? ` +${row.returningJobs!.length - 1}` : ""}
                </Badge>
              )}
              {row.extractError && (
                <Badge variant="destructive" title={row.extractError}>
                  Extract failed
                </Badge>
              )}
              {!row.extracted && !row.extractError && <Badge variant="secondary">Awaiting extraction</Badge>}
              {row.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
              {examChip && (
                <Badge
                  variant={examChip.variant}
                  title={
                    row.exam?.score !== null && row.exam?.score !== undefined
                      ? `Exam score ${row.exam.score}/100 — graded automatically, in code.`
                      : "Proctored online exam status."
                  }
                >
                  {examChip.label}
                  {row.exam?.score !== null && row.exam?.score !== undefined
                    ? ` · ${Math.round(row.exam.score)}`
                    : ""}
                </Badge>
              )}
              {row.interview?.scheduled_time && (
                <Badge variant="success" title={row.interview.location_or_link ?? undefined}>
                  Interview {formatDate(row.interview.scheduled_time)}
                </Badge>
              )}
              {row.interview && !row.interview.scheduled_time && (
                <Badge variant="secondary">Invite sent — awaiting pick</Badge>
              )}
              {row.interview?.scorecard && (
                <Badge variant="default" title="Human rating next to the AI score">Scorecard ★{row.interview.scorecard.rating}</Badge>
              )}
            </div>
          </div>
          {s && (
            <div
              className="self-end text-right sm:ml-auto sm:shrink-0 sm:self-start"
              title={
                blended && final !== null
                  ? `Final = CV ${Math.round(s.total)} × ${examWeights!.cv}% + Exam ${Math.round(row.exam!.score!)} × ${examWeights!.exam}% — computed in code, never by the AI.`
                  : "Weighted total under this job's rubric — computed in code, never by the AI."
              }
            >
              <p className="text-3xl font-semibold tabular-nums leading-none">
                {blended ? Math.round(final! * 10) / 10 : Math.round(s.total)}
              </p>
              <p className="text-xs text-muted-foreground">
                {blended ? `final · CV ${Math.round(s.total)} + exam ${Math.round(row.exam!.score!)}` : "/ 100"}
              </p>
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
            {examWeights && row.exam && (
              <div
                title={`Proctored exam score, weighted ${examWeights.exam}% in the final score. Graded automatically in code.`}
              >
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">
                    Exam <span className="tabular-nums opacity-70">{examWeights.exam}%</span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {row.exam.score !== null ? Math.round(row.exam.score) : "—"}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      row.exam.score !== null ? scoreColor(row.exam.score) : "bg-muted-foreground/20"
                    )}
                    style={{
                      width: row.exam.score !== null ? `${Math.min(row.exam.score, 100)}%` : "100%",
                    }}
                  />
                </div>
              </div>
            )}
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

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            className="w-full sm:w-auto"
            size="sm"
            variant="secondary"
            onClick={onReveal}
            disabled={revealed || blindMode}
            title={
              blindMode
                ? "Identities are hidden for screen sharing — switch 'Hide identities' off to reveal."
                : "Reveal this candidate's identity. The score was locked in before this moment."
            }
          >
            <Eye aria-hidden /> {revealed ? "Revealed" : "Reveal identity"}
          </Button>
          <Button className="flex-1 sm:flex-none" size="sm" variant="ghost" onClick={onDetails}>
            <Info aria-hidden /> Details
          </Button>
          {revealed && row.hasCv && (
            <Button className="flex-1 sm:flex-none" size="sm" variant="ghost" onClick={onDownload} title="Opens a private, 5-minute download link.">
              <FileDown aria-hidden /> CV
            </Button>
          )}
        </div>

        {revealed && row.score && <InterviewActions row={row} />}
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
        className="h-full w-full max-w-md overflow-x-hidden overflow-y-auto bg-card p-4 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-lg font-semibold">
            {revealed ? row.name || row.email : `Candidate #${row.rank}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <p className="break-all text-muted-foreground">{row.email}</p>
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
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 break-words">{g.requirement}</span>
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

            {row.interview && (
              <div className="rounded-lg border border-border p-3">
                <h4 className="text-sm font-medium">Interview</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.interview.scheduled_time
                    ? new Date(row.interview.scheduled_time).toUTCString()
                    : "Time not confirmed yet — waiting for the candidate to pick a slot."}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  {row.interview.interviewer} · {row.interview.location_or_link}
                </p>
                {row.interview.scorecard && s && (
                  <div className="mt-3 grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-lg bg-muted p-2">
                      <p className="text-xs text-muted-foreground">AI blind score</p>
                      <p className="text-xl font-semibold tabular-nums">{Math.round(s.total)}</p>
                    </div>
                    <div className="rounded-lg bg-primary-soft p-2">
                      <p className="text-xs text-primary">Human rating</p>
                      <p className="text-xl font-semibold tabular-nums">{row.interview.scorecard.rating}/5</p>
                    </div>
                  </div>
                )}
                {row.interview.scorecard?.notes && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Notes: {row.interview.scorecard.notes}
                  </p>
                )}
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
