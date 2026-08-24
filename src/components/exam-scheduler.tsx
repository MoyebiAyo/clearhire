"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, GraduationCap } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ExamCandidate {
  id: string;
  label: string;
  score: number | null;
  status: string;
}

function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ExamScheduler({
  jobId,
  candidates,
  aiConfigured,
}: {
  jobId: string;
  candidates: ExamCandidate[];
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [availableFrom, setAvailableFrom] = useState(() =>
    localInputValue(new Date(Date.now() + 5 * 60_000))
  );
  const [availableUntil, setAvailableUntil] = useState(() =>
    localInputValue(new Date(Date.now() + 48 * 3600_000))
  );
  const [questions, setQuestions] = useState(10);
  const [minutes, setMinutes] = useState(30);
  const [weightCv, setWeightCv] = useState(70);
  const [tone, setTone] = useState("formal");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const selectable = candidates.filter((candidate) => candidate.status !== "rejected");

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  async function scheduleExam() {
    if (selected.length === 0) {
      toast.error("Select at least one candidate.");
      return;
    }
    const from = new Date(availableFrom);
    const until = new Date(availableUntil);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || until <= from) {
      toast.error("The exam closing date must be after its opening date.");
      return;
    }

    setBusy(true);
    try {
      setProgress("Creating the exam schedule...");
      const create = await fetch(`/api/jobs/${jobId}/exams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionsPerCandidate: questions,
          bankSize: Math.max(questions, 10),
          minutes,
          weightCv,
          availableFrom: from.toISOString(),
          availableUntil: until.toISOString(),
        }),
      });
      const created = await create.json();
      if (!create.ok) throw new Error(created.error ?? "Couldn't create the exam.");
      const examId = created.exam.id as string;

      let total = 0;
      const bankSize = Math.max(questions, 10);
      for (let attempt = 0; attempt < 10 && total < bankSize; attempt++) {
        setProgress(`Writing questions from the job description... ${total}/${bankSize}`);
        const generated = await fetch(
          `/api/jobs/${jobId}/exams/${examId}/generate?limit=12`,
          { method: "POST" }
        );
        const result = await generated.json();
        if (!generated.ok) throw new Error(result.error ?? "Question generation failed.");
        total = Number(result.total ?? total);
        if (Number(result.remaining ?? 0) === 0) break;
        if (Number(result.generated ?? 0) === 0) {
          throw new Error("The question bank could not be completed. Try scheduling again.");
        }
      }
      if (total < questions) throw new Error("Not enough valid questions were generated.");

      setProgress(`Emailing ${selected.length} selected candidate${selected.length === 1 ? "" : "s"}...`);
      const activate = await fetch(`/api/jobs/${jobId}/exams/${examId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: selected, tone }),
      });
      const activated = await activate.json();
      if (!activate.ok) throw new Error(activated.error ?? "Couldn't activate the exam.");

      toast.success(
        `Exam scheduled for ${activated.invited} candidate${activated.invited === 1 ? "" : "s"}; ${activated.emailed} email${activated.emailed === 1 ? "" : "s"} sent.`
      );
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't schedule the exam.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="size-4 text-primary" aria-hidden />
            Candidate examination
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Set the exam window, choose candidates, generate role-specific questions, and send personal links.
          </p>
        </div>
        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setOpen((value) => !value)}>
          <CalendarClock aria-hidden /> {open ? "Close" : "Schedule exam"}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-5 border-t border-border pt-5">
          {!aiConfigured && (
            <p className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
              Configure an AI provider before generating exam questions.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Opens
              <Input
                type="datetime-local"
                value={availableFrom}
                onChange={(event) => setAvailableFrom(event.target.value)}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Closes
              <Input
                type="datetime-local"
                value={availableUntil}
                onChange={(event) => setAvailableUntil(event.target.value)}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Questions per candidate
              <Input
                type="number"
                min={5}
                max={50}
                value={questions}
                onChange={(event) => setQuestions(Number(event.target.value))}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Time limit in minutes
              <Input
                type="number"
                min={5}
                max={180}
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              CV weight
              <Input
                type="number"
                min={0}
                max={100}
                value={weightCv}
                onChange={(event) => setWeightCv(Number(event.target.value))}
              />
              <span className="block text-xs font-normal text-muted-foreground">
                Exam weight: {100 - weightCv}%
              </span>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Email tone
              <select
                value={tone}
                onChange={(event) => setTone(event.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm"
              >
                <option value="formal">Formal</option>
                <option value="casual">Casual</option>
                <option value="technical">Technical</option>
              </select>
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Candidates</p>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() =>
                  setSelected(selected.length === selectable.length ? [] : selectable.map((item) => item.id))
                }
              >
                {selected.length === selectable.length ? "Clear all" : "Select all eligible"}
              </button>
            </div>
            <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {selectable.map((candidate) => (
                <label key={candidate.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={selected.includes(candidate.id)}
                    onChange={() => toggle(candidate.id)}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{candidate.label}</span>
                  {candidate.score !== null && <Badge variant="secondary">{Math.round(candidate.score)}/100</Badge>}
                </label>
              ))}
              {selectable.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No eligible candidates are available.</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {progress ?? `${selected.length} candidate${selected.length === 1 ? "" : "s"} selected`}
            </p>
            <Button
              className="w-full sm:w-auto"
              onClick={scheduleExam}
              loading={busy}
              disabled={busy || !aiConfigured || selected.length === 0}
            >
              <GraduationCap aria-hidden /> Generate, schedule and email
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
