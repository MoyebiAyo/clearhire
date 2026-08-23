"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EyeOff,
  GraduationCap,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Copilot — the job-page AI assistant. Conversational answers plus two
 * structured action cards (mass reject, exam setup) that the model PROPOSES
 * and the recruiter executes with one click. Everything the model saw to
 * answer was blind: skills and scores, never identities (unless revealed).
 */

interface RejectCandidate {
  applicationId: string;
  rank: number;
  total: number | null;
  identity: string | null;
}

interface RejectCard {
  name: "reject_preview";
  tone: string;
  count: number;
  candidates: RejectCandidate[];
}

interface ExamCard {
  name: "exam_setup";
  count: number;
  applicationIds: string[];
  proposal: {
    minTotal: number | null;
    questionsPerCandidate: number;
    minutes: number;
    weightCv: number;
    bankSize: number;
    deadlineHours: number;
    tone: string;
  };
}

type ActionCard = RejectCard | ExamCard;

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  action?: ActionCard | null;
  actionDone?: string | null;
}

const SUGGESTIONS = [
  "Who's below 60?",
  "Who held leadership roles?",
  "Summarise the top 3 candidates",
  "Set up an exam for everyone above 70",
];

const TONES = ["formal", "casual", "technical"];

export function CopilotDrawer({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [examProgress, setExamProgress] = useState<string | null>(null);
  const [rejectBusy, setRejectBusy] = useState<string | null>(null); // msg id
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, examProgress]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setInput("");
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content };
    const history = [...msgs, userMsg];
    setMsgs(history);
    setSending(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMsgs((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: body.error ?? "Something went wrong — please try again.",
          },
        ]);
        return;
      }
      setMsgs((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: body.answer as string,
          action: (body.action as ActionCard | null) ?? null,
        },
      ]);
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setSending(false);
    }
  }

  async function runReject(msg: ChatMsg, card: RejectCard, tone: string) {
    if (card.candidates.length === 0) return;
    setRejectBusy(msg.id);
    try {
      const res = await fetch("/api/applications/reject-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: card.candidates.map((c) => c.applicationId),
          tone,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "The rejection didn't go through.");
        return;
      }
      const outcome = `Rejected ${body.rejected} candidate${body.rejected === 1 ? "" : "s"} — ${body.emailed} email${body.emailed === 1 ? "" : "s"} sent${(body.failed?.length ?? 0) > 0 ? `, ${body.failed.length} email(s) failed (retry from their cards)` : ""}. They moved to the Rejected list on the shortlist.`;
      setMsgs((m) =>
        m.map((x) =>
          x.id === msg.id ? { ...x, actionDone: outcome } : x
        )
      );
      toast.success(`${body.rejected} rejected · ${body.emailed} emailed`);
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setRejectBusy(null);
    }
  }

  async function runExam(msg: ChatMsg, card: ExamCard, cfg: ExamCard["proposal"]) {
    setExamProgress("Creating the exam…");
    try {
      // 1. Draft exam with the chosen config.
      const createRes = await fetch(`/api/jobs/${jobId}/exams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionsPerCandidate: cfg.questionsPerCandidate,
          minutes: cfg.minutes,
          weightCv: cfg.weightCv,
          bankSize: cfg.bankSize,
          deadlineHours: cfg.deadlineHours,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        toast.error(created.error ?? "Couldn't create the exam.");
        return;
      }
      const examId: string = created.exam.id;

      // 2. Generate the question bank in small chunks (serverless- AND
      // rate-limit-safe: Groq's free tier caps prompt+max_tokens per minute).
      let total = 0;
      for (let i = 0; i < 10; i++) {
        setExamProgress(`Writing questions from the job description… ${total}/${cfg.bankSize}`);
        const g = await fetch(`/api/jobs/${jobId}/exams/${examId}/generate?limit=12`, {
          method: "POST",
        });
        const gb = await g.json();
        if (!g.ok) {
          toast.error(gb.error ?? "Question generation failed.");
          return;
        }
        total = gb.total ?? total;
        if ((gb.remaining ?? 0) === 0) break;
        if ((gb.generated ?? 0) === 0) break; // zero-progress guard
      }
      setExamProgress(`Inviting ${card.count} candidate${card.count === 1 ? "" : "s"}…`);

      // 3. Invite + go live.
      const act = await fetch(`/api/jobs/${jobId}/exams/${examId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: card.applicationIds, tone: cfg.tone }),
      });
      const ab = await act.json();
      if (!act.ok) {
        toast.error(ab.error ?? "Couldn't send the invitations.");
        return;
      }
      const outcome = `Exam is live: ${cfg.questionsPerCandidate} questions · ${cfg.minutes} minutes · final score = CV ${cfg.weightCv}% + exam ${100 - cfg.weightCv}%. Invited ${ab.invited}, ${ab.emailed} emailed. Exam scores will blend into the shortlist automatically as candidates submit.`;
      setMsgs((m) => m.map((x) => (x.id === msg.id ? { ...x, actionDone: outcome } : x)));
      toast.success(`Exam live — ${ab.invited} invited`);
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setExamProgress(null);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sparkles aria-hidden /> Ask AI
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-foreground/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="AI copilot"
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  <Sparkles className="size-4 text-primary" aria-hidden /> Copilot
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <EyeOff className="size-3" aria-hidden />
                  Sees merit, not names — {jobTitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close copilot"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {msgs.length === 0 && (
                <div className="space-y-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Ask about your candidates, or tell me what to do. Actions
                    always show you a confirmation card first.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {msgs.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      {m.content}
                    </p>
                  </div>
                ) : (
                  <div key={m.id} className="space-y-2">
                    <p className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm leading-relaxed">
                      {m.content}
                    </p>
                    {m.action?.name === "reject_preview" && !m.actionDone && (
                      <RejectActionCard
                        card={m.action}
                        busy={rejectBusy === m.id}
                        onRun={(tone) => runReject(m, m.action as RejectCard, tone)}
                      />
                    )}
                    {m.action?.name === "exam_setup" && !m.actionDone && (
                      <ExamActionCard
                        card={m.action}
                        busy={examProgress !== null}
                        progress={examProgress}
                        onRun={(cfg) => runExam(m, m.action as ExamCard, cfg)}
                      />
                    )}
                    {m.actionDone && (
                      <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft/50 px-3 py-2 text-xs leading-relaxed">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                        {m.actionDone}
                      </p>
                    )}
                  </div>
                )
              )}

              {sending && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                  <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
                  Reading the shortlist…
                </p>
              )}
            </div>

            {/* Input */}
            <form
              className="flex items-center gap-2 border-t border-border px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask, or describe an action…"
                aria-label="Message the copilot"
                className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="sm" loading={sending} disabled={!input.trim()}>
                <Send aria-hidden /> Send
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function labelFor(c: RejectCandidate): string {
  return c.identity ? c.identity.split("<")[0].trim() : `Candidate #${c.rank}`;
}

function RejectActionCard({
  card,
  busy,
  onRun,
}: {
  card: RejectCard;
  busy: boolean;
  onRun: (tone: string) => void;
}) {
  const [tone, setTone] = useState(card.tone);
  if (card.count === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        Nobody matches that criteria right now — nothing to reject.
      </p>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Reject {card.count} candidate{card.count === 1 ? "" : "s"}</p>
        <Badge variant="destructive">Pending your confirm</Badge>
      </div>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
        {card.candidates.slice(0, 8).map((c) => (
          <li key={c.applicationId} className="flex justify-between gap-3">
            <span className="truncate">{labelFor(c)}</span>
            <span className="tabular-nums">{c.total ?? "—"}/100</span>
          </li>
        ))}
        {card.candidates.length > 8 && <li>+{card.candidates.length - 8} more</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor={`tone-${card.candidates[0]?.applicationId}`}>
          Tone
        </label>
        <select
          id={`tone-${card.candidates[0]?.applicationId}`}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          className="h-8 rounded-lg border border-input bg-card px-2 text-xs"
        >
          {TONES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="destructive"
          loading={busy}
          disabled={busy}
          onClick={() => onRun(tone)}
          className="ml-auto"
        >
          <XCircle aria-hidden /> Reject &amp; email {card.count}
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Each gets a kind rejection email (sent in throttled batches). They move
        to the Rejected list — undoable any time, scores untouched.
      </p>
    </div>
  );
}

function ExamActionCard({
  card,
  busy,
  progress,
  onRun,
}: {
  card: ExamCard;
  busy: boolean;
  progress: string | null;
  onRun: (cfg: ExamCard["proposal"]) => void;
}) {
  const [cfg, setCfg] = useState(card.proposal);
  const num = (k: keyof ExamCard["proposal"]) => ({
    value: String(cfg[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setCfg((c) => ({ ...c, [k]: Number(e.target.value) || 0 })),
  });

  if (card.count === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        No scored, active candidates match that filter — score the shortlist
        first, then set up the exam.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <GraduationCap className="size-4 text-primary" aria-hidden />
          Exam for {card.count} candidate{card.count === 1 ? "" : "s"}
        </p>
        <Badge variant="secondary">AI proposal — edit freely</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Field label="Questions each" {...num("questionsPerCandidate")} />
        <Field label="Minutes" {...num("minutes")} />
        <Field label={`CV weight % (exam ${100 - (cfg.weightCv || 0)}%)`} {...num("weightCv")} />
        <Field label="Bank size" {...num("bankSize")} />
        <Field label="Start within (hours)" {...num("deadlineHours")} />
        <div>
          <label className="text-muted-foreground" htmlFor="exam-tone">Email tone</label>
          <select
            id="exam-tone"
            value={cfg.tone}
            onChange={(e) => setCfg((c) => ({ ...c, tone: e.target.value }))}
            className="mt-1 h-8 w-full rounded-lg border border-input bg-card px-2 text-xs"
          >
            {TONES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {busy && progress ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
          {progress}
        </p>
      ) : (
        <Button size="sm" className="w-full" onClick={() => onRun(cfg)} disabled={busy}>
          Generate {cfg.bankSize} questions &amp; invite {card.count}
        </Button>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Questions are written from your job description, drawn per candidate
        (no answer sharing), proctored with 3-strike tab-switch protection,
        and graded automatically. Exam scores blend into the final ranking.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="text-muted-foreground" htmlFor={`f-${label}`}>{label}</label>
      <input
        id={`f-${label}`}
        type="number"
        value={value}
        onChange={onChange}
        className={cn(
          "mt-1 h-8 w-full rounded-lg border border-input bg-card px-2 text-xs tabular-nums",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      />
    </div>
  );
}
