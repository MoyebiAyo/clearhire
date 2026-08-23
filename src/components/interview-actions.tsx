"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CalendarPlus, ClipboardCopy, Star, ThumbsDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import type { ShortlistRow } from "@/components/shortlist";

export interface TemplateOption {
  id: string;
  tone: string;
  subject: string;
}

/**
 * Post-reveal actions for a shortlist card: schedule an interview (with
 * invite preview + send), reject (draft → edit → send), submit a scorecard,
 * and copy the candidate's scheduling link.
 */
export function InterviewActions({ row }: { row: ShortlistRow }) {
  const router = useRouter();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [firing, setFiring] = useState(false);

  const interview = row.interview;

  /** Demo-safe time fast-forward (Phase 8): arm + fire the next reminder. */
  async function fireReminder() {
    setFiring(true);
    try {
      const res = await fetch("/api/demo/reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: row.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't fire the reminder.");
        return;
      }
      const r = body.result ?? {};
      toast.success(
        r.sent > 0
          ? `Reminder fired — ${r.sent} sent via Resend batch ✉️`
          : "Reminder armed, but nothing sent — check the worker/engine logs."
      );
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setFiring(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!interview && (
          <Button size="sm" onClick={() => setScheduleOpen(true)} disabled={row.score === null}
            title={row.score === null ? "Score the shortlist before scheduling." : "Offer up to 3 slots or book a time directly; the AI drafts the invite for your review."}>
            <CalendarPlus aria-hidden /> Schedule interview
          </Button>
        )}
        {interview && (
          <>
            <Button size="sm" variant="outline" onClick={() => setScoreOpen(true)}
              title="Record your post-interview rating next to the AI's original score.">
              <Star aria-hidden /> Scorecard
            </Button>
            {interview.schedule_token && (
              <Button
                size="sm"
                variant="ghost"
                title="Copy the candidate's personal scheduling link"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/schedule/${interview.schedule_token}`
                  );
                  toast.success("Scheduling link copied");
                }}
              >
                <ClipboardCopy aria-hidden /> Copy link
              </Button>
            )}
            {interview.scheduled_time && (
              <Button
                size="sm"
                variant="ghost"
                onClick={fireReminder}
                loading={firing}
                title="Demo action: fast-forwards the next unsent reminder to now and runs the engine — no database surgery."
              >
                <BellRing aria-hidden /> Fire reminder
              </Button>
            )}
          </>
        )}
        {row.status !== "rejected" && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setRejectOpen(true)}
            title="Drafts a kind, personalized rejection for your review — nothing sends until you say so.">
            <ThumbsDown aria-hidden /> Reject
          </Button>
        )}
      </div>

      {scheduleOpen && (
        <ScheduleDialog row={row} onClose={() => setScheduleOpen(false)} onDone={() => router.refresh()} />
      )}
      {rejectOpen && (
        <RejectDialog applicationId={row.id} candidateName={row.name ?? row.email} onClose={() => setRejectOpen(false)} onDone={() => router.refresh()} />
      )}
      {scoreOpen && interview && (
        <ScorecardDialog interview={interview} onClose={() => setScoreOpen(false)} onDone={() => router.refresh()} />
      )}
    </>
  );
}

// ── Schedule ─────────────────────────────────────────────────────────────────

function ScheduleDialog({
  row,
  onClose,
  onDone,
}: {
  row: ShortlistRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [interviewer, setInterviewer] = useState("");
  const [location, setLocation] = useState("");
  const [mode, setMode] = useState<"slots" | "direct">("slots");
  const [slots, setSlots] = useState<string[]>(["", "", ""]);
  const [direct, setDirect] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [stage, setStage] = useState<"details" | "preview" | "sending">("details");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [interviewId, setInterviewId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validSlots = slots.filter((s) => s !== "");

  async function createInterview() {
    setError(null);
    if (!interviewer.trim() || !location.trim()) {
      setError("Interviewer name and location/link are required.");
      return;
    }
    if (mode === "slots" && validSlots.length === 0) {
      setError("Offer at least one time slot (or switch to booking a time directly).");
      return;
    }
    if (mode === "direct" && !direct) {
      setError("Pick a time for the interview.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: row.id,
          interviewer: interviewer.trim(),
          location_or_link: location.trim(),
          ...(mode === "slots"
            ? { slots: validSlots.map(localToIso) }
            : { scheduled_time: localToIso(direct) }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't create the interview.");
        return;
      }
      setInterviewId(data.interview.id);
      if (data.remindersCreated > 0) {
        toast.success("Interview booked", {
          description: `${data.remindersCreated} reminders scheduled (2 days, 1 day, 12 hours and 2 hours before).`,
        });
      }

      // Draft the invite for preview.
      const draftRes = await fetch(`/api/interviews/${data.interview.id}/send-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId || undefined, dry_run: true }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) {
        setError(draft.error ?? "Couldn't draft the invite.");
        return;
      }
      setSubject(draft.subject);
      setBody(draft.body);
      if (draft.fallback) {
        toast.info("Using the template as-is — the AI drafter was unavailable.");
      }
      setStage("preview");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    setStage("sending");
    try {
      const res = await fetch(`/api/interviews/${interviewId}/send-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId || undefined, subject, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't send the invite.");
        setStage("preview");
        return;
      }
      toast.success("Invite sent", {
        description: "Logged in email_log — the candidate can now pick a slot from the email link.",
      });
      onClose();
      onDone();
    } catch {
      setError("Network error — please try again.");
      setStage("preview");
    }
  }

  return (
    <Modal open onClose={onClose} title={`Schedule interview — ${row.name ?? row.email}`} wide>
      {stage === "details" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="interviewer">Interviewer</Label>
              <Input
                id="interviewer"
                placeholder="e.g. Ada (Engineering)"
                value={interviewer}
                onChange={(e) => setInterviewer(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location / link</Label>
              <Input
                id="location"
                placeholder="Zoom link, office address…"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Booking:</Label>
            {(["slots", "direct"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  mode === m
                    ? "border-primary/40 bg-primary-soft text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {m === "slots" ? "Candidate picks a slot" : "I set the time"}
              </button>
            ))}
          </div>

          {mode === "slots" ? (
            <div className="space-y-2">
              <Label>Offered slots (up to 3 — the candidate picks one)</Label>
              {slots.map((s, i) => (
                <Input
                  key={i}
                  type="datetime-local"
                  value={s}
                  onChange={(e) =>
                    setSlots((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="direct">Interview time</Label>
              <Input
                id="direct"
                type="datetime-local"
                value={direct}
                onChange={(e) => setDirect(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Booking directly queues all 4 reminders immediately.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="template">Invite tone</Label>
            <select
              id="template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Default (formal)</option>
              {row.templates
                .filter((t) => t.id !== undefined)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tone}
                  </option>
                ))}
            </select>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={createInterview} loading={busy}>
              Draft invite
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            ✍️ AI-drafted from your template — edit anything before sending.
            The scheduling link is included automatically.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="subj">Subject</Label>
            <Input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body">Email body</Label>
            <Textarea
              id="body"
              className="min-h-[220px] font-mono text-xs"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={sendInvite} loading={stage === "sending"}>
              Send invite
            </Button>
            <Button variant="ghost" onClick={onClose}>Close without sending</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function localToIso(local: string): string {
  return new Date(local).toISOString();
}

// ── Reject ───────────────────────────────────────────────────────────────────

export function RejectDialog({
  applicationId,
  candidateName,
  onClose,
  onDone,
}: {
  applicationId: string;
  candidateName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<"drafting" | "edit">("drafting");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function draft() {
    setBusy(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't draft the rejection.");
        return;
      }
      setSubject(data.subject);
      setBody(data.body);
      setStage("edit");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't send.");
        return;
      }
      if (data.email_error) {
        toast.warning("Candidate marked rejected — but the email didn't go out", {
          description: data.email_error,
        });
      } else {
        toast.success("Rejection sent and logged");
      }
      onClose();
      onDone();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reject — ${candidateName}`} wide>
      {stage === "drafting" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We'll draft a kind, personalized rejection — drawing lightly on the
            gap analysis, never blunt, never fabricating. You review and edit
            before anything sends.
          </p>
          <Button onClick={draft} loading={busy}>
            Draft rejection email
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rsubj">Subject</Label>
            <Input id="rsubj" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rbody">Email body</Label>
            <Textarea
              id="rbody"
              className="min-h-[200px] font-mono text-xs"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {stage === "edit" && (
        <div className="mt-4 flex items-center gap-3">
          <Button variant="destructive" onClick={send} loading={busy}>
            Send and reject
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      )}
    </Modal>
  );
}

// ── Scorecard ────────────────────────────────────────────────────────────────

function ScorecardDialog({
  interview,
  onClose,
  onDone,
}: {
  interview: NonNullable<ShortlistRow["interview"]>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(4);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/interviews/${interview.id}/scorecard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewer_rating: rating, interviewer_notes: notes.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't save the scorecard.");
        return;
      }
      toast.success("Scorecard saved — displayed next to the AI score");
      onClose();
      onDone();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Interview scorecard">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="rating">Your rating (1–5)</Label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                aria-pressed={rating === n}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  rating === n
                    ? "border-primary/40 bg-primary-soft text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Stored next to the AI's blind score — comparing the two over time
            is how you audit the rubric.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            placeholder="Strengths, concerns, follow-ups…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={submit} loading={busy}>
          Save scorecard
        </Button>
      </div>
    </Modal>
  );
}
