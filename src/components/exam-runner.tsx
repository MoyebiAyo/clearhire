"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlarmClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Monitor,
  ShieldAlert,
  Timer,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The candidate-facing exam: briefing → timed questions → end state.
 *
 * Proctoring (3-strike policy, approved design):
 *  - strikes: tab switch / window blur, fullscreen exit, copy/context-menu
 *    attempts, screenshot key; the 3rd strike forfeits server-side.
 *  - closing the tab or navigating away fires a keepalive submit that
 *    forfeits immediately and grades whatever was answered.
 *  - the clock is server-authoritative: countdown is cosmetic, grading and
 *    overtime are decided from exam_invites.started_at on the server.
 */

interface ExamQ {
  id: string;
  topic: string;
  difficulty: string;
  question: string;
  options: string[];
}

interface Initial {
  status: string;
  jobTitle: string;
  questions: number;
  minutes: number;
  deadlineISO: string;
  startedAtISO: string | null;
  endsAtISO: string | null;
  violations: number;
  serverNowISO: string;
}

const STRIKE_LABEL: Record<string, string> = {
  tab_switch: "you switched tabs or windows",
  fullscreen_exit: "you left full screen",
  copy_attempt: "a copy action was blocked",
  screenshot: "a screenshot key was pressed",
  devtools: "developer tools were blocked",
  unknown: "the exam window lost focus",
};

export function ExamRunner({ token, initial }: { token: string; initial: Initial }) {
  const terminal =
    initial.status === "submitted" ||
    initial.status === "forfeited" ||
    initial.status === "expired";

  const [phase, setPhase] = useState<"brief" | "running" | "done">(
    terminal ? "done" : initial.status === "in_progress" ? "running" : "brief"
  );
  const [doneStatus, setDoneStatus] = useState<string | null>(
    terminal ? initial.status : null
  );
  const [starting, setStarting] = useState(false);
  const [questions, setQuestions] = useState<ExamQ[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(
    initial.endsAtISO ? new Date(initial.endsAtISO).getTime() : null
  );
  const [remaining, setRemaining] = useState<number>(0);
  const [strikes, setStrikes] = useState(initial.violations);
  const [warning, setWarning] = useState<{ n: number; reason: string } | null>(null);
  const [fsLost, setFsLost] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [ending, setEnding] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);

  /** Server-clock offset so the countdown tracks the server, not the laptop. */
  const clockOffset = useRef(new Date(initial.serverNowISO).getTime() - Date.now());
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const endingRef = useRef(ending);
  endingRef.current = ending;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const submit = useCallback(
    async (forfeit: boolean) => {
      if (endingRef.current) return;
      endingRef.current = true;
      setEnding(true);
      try {
        const res = await fetch(`/api/exam/${token}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: answersRef.current, forfeit }),
        });
        const body = (await res.json()) as { status?: string };
        setDoneStatus(body.status ?? (forfeit ? "forfeited" : "submitted"));
      } catch {
        setDoneStatus(forfeit ? "forfeited" : "submitted");
      } finally {
        setPhase("done");
        if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      }
    },
    [token]
  );

  const reportViolation = useCallback(
    async (type: string) => {
      if (phaseRef.current !== "running" || endingRef.current) return;
      try {
        const res = await fetch(`/api/exam/${token}/violation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        const body = (await res.json()) as {
          violations: number;
          forfeited: boolean;
        };
        setStrikes(body.violations);
        if (body.forfeited) {
          await submit(true);
        } else {
          setWarning({ n: body.violations, reason: STRIKE_LABEL[type] ?? "the exam window lost focus" });
        }
      } catch {
        // Proctoring reports must never break the exam itself.
      }
    },
    [submit, token]
  );

  const reportRef = useRef(reportViolation);
  reportRef.current = reportViolation;

  async function startExam() {
    setStarting(true);
    try {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
      const res = await fetch(`/api/exam/${token}/start`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDoneStatus((body as { status?: string }).status ?? "expired");
        setPhase("done");
        return;
      }
      const q = await fetch(`/api/exam/${token}/questions`);
      if (!q.ok) {
        const body = await q.json().catch(() => ({}));
        setDoneStatus((body as { status?: string }).status ?? "forfeited");
        setPhase("done");
        return;
      }
      const body = (await q.json()) as {
        questions: ExamQ[];
        endsAt: string;
        serverNow: string;
      };
      clockOffset.current = new Date(body.serverNow).getTime() - Date.now();
      setQuestions(body.questions);
      setEndsAt(new Date(body.endsAt).getTime());
      setPhase("running");
    } catch {
      setWarning({ n: 0, reason: "couldn't load the questions — check your connection and try again" });
    } finally {
      setStarting(false);
    }
  }

  /** Resume an in-progress attempt after a refresh (same seeded draw). */
  useEffect(() => {
    if (phase !== "running" || questions.length > 0 || ending) return;
    setResumeLoading(true);
    fetch(`/api/exam/${token}/questions`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setDoneStatus((body as { status?: string }).status ?? "forfeited");
          setPhase("done");
          return;
        }
        const body = (await r.json()) as { questions: ExamQ[]; endsAt: string; serverNow: string };
        clockOffset.current = new Date(body.serverNow).getTime() - Date.now();
        setQuestions(body.questions);
        setEndsAt(new Date(body.endsAt).getTime());
      })
      .finally(() => setResumeLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** Countdown — cosmetic mirror of the server clock. */
  useEffect(() => {
    if (phase !== "running" || endsAt === null) return;
    const tick = () => {
      const left = endsAt - (Date.now() + clockOffset.current);
      setRemaining(Math.max(left, 0));
      if (left <= 0) submit(false);
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [phase, endsAt, submit]);

  /** Proctoring listeners + close-forfeit beacon. */
  useEffect(() => {
    if (phase !== "running") return;

    const onVis = () => {
      if (document.hidden) reportRef.current("tab_switch");
    };
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const onBlurDebounced = () => {
      blurTimer = setTimeout(() => {
        if (!document.hasFocus()) reportRef.current("tab_switch");
      }, 800);
    };
    const onFocus = () => {
      if (blurTimer) clearTimeout(blurTimer);
    };
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setFsLost(true);
        reportRef.current("fullscreen_exit");
      } else {
        setFsLost(false);
      }
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      reportRef.current("copy_attempt");
    };
    const onCopyLike = (e: Event) => {
      e.preventDefault();
      reportRef.current("copy_attempt");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["c", "x", "s", "p"].includes(k)) {
        e.preventDefault();
        reportRef.current("copy_attempt");
      }
      if (e.key === "F12") {
        e.preventDefault();
        reportRef.current("devtools");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") reportRef.current("screenshot");
    };
    const onLeave = () => {
      if (endingRef.current) return;
      // Tab/window closed or navigated away: forfeit NOW, keep the beacon alive.
      navigator.sendBeacon?.(
        `/api/exam/${token}/submit`,
        new Blob(
          [JSON.stringify({ answers: answersRef.current, forfeit: true })],
          { type: "application/json" }
        )
      );
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlurDebounced);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("copy", onCopyLike);
    document.addEventListener("cut", onCopyLike);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlurDebounced);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("copy", onCopyLike);
      document.removeEventListener("cut", onCopyLike);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [phase, token]);

  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const timeLabel = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  const current = questions[idx];
  const answeredCount = Object.keys(answers).length;

  if (phase === "done") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        {doneStatus === "submitted" ? (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle2 className="size-7" aria-hidden />
            </span>
            <h1 className="mt-4 text-xl font-semibold">Your responses have been recorded</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Thank you for completing the assessment for{" "}
              <strong>{initial.jobTitle}</strong>. The hiring team has your
              results — you&apos;ll hear from them by email. You can close this
              window now.
            </p>
          </>
        ) : doneStatus === "forfeited" ? (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-warning-soft text-warning">
              <ShieldAlert className="size-7" aria-hidden />
            </span>
            <h1 className="mt-4 text-xl font-semibold">This attempt has ended</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The exam window lost focus three times, was closed, or ran out of
              time — the proctoring rules you saw before starting. Whatever you
              had answered has been saved, and the hiring team can see the
              result. If this felt wrong, reply to your invitation email.
            </p>
          </>
        ) : (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <AlarmClock className="size-7" aria-hidden />
            </span>
            <h1 className="mt-4 text-xl font-semibold">The assessment window has closed</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This link needed to be started before{" "}
              {new Date(initial.deadlineISO).toLocaleString()}. The hiring team
              can re-issue an invitation if the role is still open.
            </p>
          </>
        )}
      </div>
    );
  }

  if (phase === "brief") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-10">
        <Card>
          <CardContent className="space-y-5 p-6 sm:p-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Skills assessment
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {initial.jobTitle}
              </h1>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                <ClipboardList className="size-3.5" aria-hidden />
                {initial.questions} questions
              </Badge>
              <Badge variant="secondary">
                <Timer className="size-3.5" aria-hidden />
                {initial.minutes} minutes
              </Badge>
              <Badge variant="secondary">
                <AlarmClock className="size-3.5" aria-hidden />
                Start before {new Date(initial.deadlineISO).toLocaleString()}
              </Badge>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
              <p className="font-medium">Before you begin — the ground rules:</p>
              <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>The timer starts the moment you press start — no pausing.</li>
                <li>
                  The exam runs in full screen. You get{" "}
                  <strong className="text-foreground">3 chances</strong>: switching
                  tabs, minimising, or leaving full screen counts as a strike,
                  and the third strike ends your attempt.
                </li>
                <li>
                  Copying, right-click menus and screenshot keys are blocked and
                  recorded.
                </li>
                <li>
                  Closing this page before submitting ends the attempt — your
                  answers so far are saved.
                </li>
                <li>Answer every question you can — there&apos;s no negative marking.</li>
              </ul>
            </div>

            <Button className="w-full" size="lg" onClick={startExam} loading={starting}>
              I&apos;m ready — start the exam
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Make sure you have an uninterrupted {initial.minutes} minutes and a
              stable connection.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Running ─────────────────────────────────────────────────────────────
  return (
    <div
      className="flex min-h-dvh select-none flex-col"
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
    >
      {/* Top bar: identity, progress, clock, strikes */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{initial.jobTitle}</p>
            <p className="text-xs text-muted-foreground">
              Question {Math.min(idx + 1, questions.length || 1)} of{" "}
              {questions.length || initial.questions} · {answeredCount} answered
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-1.5"
              title="Proctoring strikes — three end the attempt."
              aria-label={`${3 - strikes} strikes remaining`}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "size-2.5 rounded-full",
                    i < strikes ? "bg-destructive" : "bg-muted-foreground/25"
                  )}
                />
              ))}
            </div>
            <span
              role="timer"
              aria-live="off"
              className={cn(
                "rounded-lg border px-3 py-1 font-mono text-lg font-semibold tabular-nums",
                remaining < 120_000
                  ? "border-destructive/40 bg-destructive-soft text-destructive"
                  : "border-border bg-card"
              )}
            >
              {timeLabel}
            </span>
          </div>
        </div>
      </header>

      {resumeLoading || questions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Restoring your exam…
        </div>
      ) : (
        current && (
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
            <div aria-live="polite" className="mb-3 flex flex-wrap gap-2">
              <Badge variant="outline">{current.topic}</Badge>
              <Badge
                variant={
                  current.difficulty === "hard"
                    ? "destructive"
                    : current.difficulty === "easy"
                      ? "secondary"
                      : "default"
                }
              >
                {current.difficulty}
              </Badge>
            </div>
            <h2 className="text-lg font-semibold leading-relaxed">
              {current.question}
            </h2>
            <div
              className="mt-5 grid gap-3"
              role="radiogroup"
              aria-label={`Question ${idx + 1} options`}
            >
              {current.options.map((opt, i) => {
                const selected = answers[current.id] === opt;
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() =>
                      setAnswers((a) => ({ ...a, [current.id]: opt }))
                    }
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left text-sm leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary bg-primary-soft"
                        : "border-border bg-card hover:border-primary/50 hover:bg-muted/50"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground"
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
              >
                <ChevronLeft aria-hidden /> Previous
              </Button>
              <div className="hidden gap-1.5 sm:flex" aria-hidden>
                {questions.map((q, i) => (
                  <span
                    key={q.id}
                    className={cn(
                      "size-2 rounded-full",
                      i === idx
                        ? "bg-primary"
                        : answers[q.id]
                          ? "bg-success"
                          : "bg-muted-foreground/25"
                    )}
                  />
                ))}
              </div>
              {idx < questions.length - 1 ? (
                <Button onClick={() => setIdx((i) => i + 1)}>
                  Next <ChevronRight aria-hidden />
                </Button>
              ) : (
                <Button onClick={() => setConfirmSubmit(true)}>Submit exam</Button>
              )}
            </div>
            {idx === questions.length - 1 && answeredCount < questions.length && (
              <p className="mt-2 text-right text-xs text-muted-foreground">
                {questions.length - answeredCount} unanswered — you can still
                submit
              </p>
            )}
          </main>
        )
      )}

      {/* Strike warning */}
      {warning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-6 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-label="Proctoring warning"
        >
          <Card className="w-full max-w-sm">
            <CardContent className="space-y-4 p-6 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning">
                <TriangleAlert className="size-6" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">
                  Strike {warning.n} of 3 — {warning.reason}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  One more and this attempt ends. Stay in this window until
                  you submit.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  setWarning(null);
                  if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen?.().catch(() => undefined);
                  }
                }}
              >
                Continue exam
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Fullscreen-lost overlay */}
      {fsLost && !warning && (
        <button
          type="button"
          onClick={() => {
            document.documentElement.requestFullscreen?.().catch(() => undefined);
          }}
          className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-background/95 text-center"
        >
          <Monitor className="size-8 text-primary" aria-hidden />
          <p className="font-semibold">You left full screen</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Click anywhere to return. This counted as a strike.
          </p>
        </button>
      )}

      {/* Submit confirmation */}
      {confirmSubmit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm submit"
        >
          <Card className="w-full max-w-sm">
            <CardContent className="space-y-4 p-6 text-center">
              <p className="font-semibold">Submit your exam?</p>
              <p className="text-sm text-muted-foreground">
                {answeredCount} of {questions.length} answered
                {answeredCount < questions.length
                  ? ` — ${questions.length - answeredCount} will be left blank.`
                  : " — everything is answered."}{" "}
                You can&apos;t change anything after this.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmSubmit(false)}>
                  Keep working
                </Button>
                <Button className="flex-1" loading={ending} onClick={() => submit(false)}>
                  Submit now
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
