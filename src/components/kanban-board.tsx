"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Copy, Mail, Upload } from "lucide-react";
import { toast } from "sonner";

import { RejectDialog } from "@/components/interview-actions";

export interface KanbanCard {
  id: string;
  status: string;
  jobId: string;
  jobTitle: string;
  name: string | null;
  email: string;
  source: "upload" | "email" | null;
  revealed: boolean;
  flaggedDuplicate: boolean;
  total: number | null;
  appliedAt: string;
}
import { Badge } from "@/components/ui/badge";

const COLUMNS = [
  { key: "applied", label: "Applied", hint: "CVs in — uploaded or emailed. Waiting for the AI screen." },
  { key: "screened", label: "Screened", hint: "Blind-scored by the AI against the job's rubric." },
  { key: "shortlisted", label: "Shortlisted", hint: "You've picked them as worth talking to." },
  { key: "interview_scheduled", label: "Interview Scheduled", hint: "Invite sent / slot picked; 4 reminders armed." },
  { key: "interviewed", label: "Interviewed", hint: "The conversation happened; scorecard expected." },
  { key: "offer", label: "Offer / Rejected", hint: "The end of the line — offer made or a respectful rejection sent." },
] as const;

const ALL_STATUSES = [
  "applied",
  "screened",
  "shortlisted",
  "interview_scheduled",
  "interviewed",
  "offer",
  "rejected",
];

const STAGE_LABEL: Record<string, string> = {
  applied: "Applied",
  screened: "Screened",
  shortlisted: "Shortlisted",
  interview_scheduled: "Interview Scheduled",
  interviewed: "Interviewed",
  offer: "Offer",
  rejected: "Rejected",
};

export function KanbanBoard({ initialCards }: { initialCards: KanbanCard[] }) {
  const router = useRouter();
  const [cards, setCards] = useState(initialCards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [rejectCard, setRejectCard] = useState<KanbanCard | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function move(card: KanbanCard, status: string) {
    if (card.status === status) return;
    setBusyId(card.id);
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, status } : c)));
    try {
      const res = await fetch(`/api/applications/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      if (status === "rejected") {
        setRejectCard({ ...card, status });
        toast.info("Marked rejected — draft the closing email?", {
          description: "The dialog that opens can send a kind, AI-drafted rejection.",
        });
      }
      router.refresh();
    } catch {
      setCards(prev);
      toast.error("Couldn't move the card — try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 overflow-x-auto md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const inCol = cards.filter(
            (c) =>
              (col.key === "offer" && (c.status === "offer" || c.status === "rejected")) ||
              c.status === col.key
          );
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                setHoverCol(col.key);
              }}
              onDragLeave={() => setHoverCol((h) => (h === col.key ? null : h))}
              onDrop={(e) => {
                e.preventDefault();
                setHoverCol(null);
                const card = cards.find((c) => c.id === dragId);
                setDragId(null);
                if (card) {
                  const target =
                    col.key === "offer" && card.status !== "offer" ? "rejected" : col.key;
                  move(card, target);
                }
              }}
              className={`min-w-[230px] rounded-xl border p-3 transition-colors ${
                hoverCol === col.key
                  ? "border-primary/60 bg-primary-soft/40"
                  : "border-border bg-muted/40"
              }`}
            >
              <div className="mb-3 flex items-center justify-between" title={col.hint}>
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {col.label}
                </span>
                <Badge variant="secondary" className="tabular-nums">{inCol.length}</Badge>
              </div>
              <div className="space-y-2">
                {inCol.map((card) => (
                  <article
                    key={card.id}
                    draggable={busyId !== card.id}
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => setDragId(null)}
                    className={`cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-all hover:shadow-md active:cursor-grabbing ${
                      dragId === card.id ? "opacity-40" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {card.revealed
                            ? card.name || card.email.split("@")[0]
                            : `Candidate · ${card.email.split("@")[0].slice(0, 3)}···`}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {card.jobTitle}
                        </p>
                      </div>
                      {card.total !== null && (
                        <span className="ml-auto shrink-0 rounded-md bg-primary-soft px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                          {Math.round(card.total)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="gap-1">
                        {card.source === "email" ? <Mail className="size-3" aria-hidden /> : <Upload className="size-3" aria-hidden />}
                        {card.source === "email" ? "Email" : "Upload"}
                      </Badge>
                      {card.flaggedDuplicate && <Badge variant="warning"><Copy className="size-3" aria-hidden /> Dup</Badge>}
                      {card.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
                      {card.status === "offer" && <Badge variant="success">Offer</Badge>}
                    </div>
                    {/* Keyboard-accessible stage move */}
                    <select
                      value={card.status}
                      disabled={busyId === card.id}
                      onChange={(e) => move(card, e.target.value)}
                      className="mt-2 h-7 w-full rounded-md border border-input bg-card px-2 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Move ${card.revealed ? card.name ?? card.email : "candidate"} to stage`}
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
                {inCol.length === 0 && (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                    {col.key === "applied"
                      ? "Upload or email CVs to get started"
                      : "Empty"}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {rejectCard && (
        <RejectDialog
          applicationId={rejectCard.id}
          candidateName={rejectCard.revealed ? rejectCard.name ?? rejectCard.email : "candidate"}
          onClose={() => setRejectCard(null)}
          onDone={() => router.refresh()}
        />
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellRing className="size-3.5" aria-hidden />
        Hover a column title to learn what that stage means. Scores are locked
        before identities unlock — the board never changes them.
      </p>
    </div>
  );
}
