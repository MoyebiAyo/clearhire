"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilLine, Plus, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RUBRIC_FIELDS, type Requirement } from "@/lib/validation";
import { cn } from "@/lib/utils";

export function RubricEditor({
  jobId,
  jdText,
  initialWeights,
  initialRequirements = [],
}: {
  jobId: string;
  jdText: string;
  initialWeights: Record<string, number>;
  initialRequirements?: Requirement[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [weights, setWeights] = useState(initialWeights);
  const [jd, setJd] = useState(jdText);
  const [jdOpen, setJdOpen] = useState(false);
  const [reqs, setReqs] = useState<Requirement[]>(initialRequirements);
  const [reqsOpen, setReqsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(
    () => Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0),
    [weights]
  );
  const balanced = total === 100;
  const jdChanged = jd.trim() !== jdText;
  const reqsChanged =
    JSON.stringify(reqs.filter((r) => r.requirement.trim())) !==
    JSON.stringify(initialRequirements);

  async function onSave() {
    setError(null);
    if (!balanced) {
      setError(`Weights add up to ${total}% — adjust them to total exactly 100%.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...weights,
          ...(jdOpen && jdChanged ? { jd_text: jd.trim() } : {}),
          ...(reqsChanged ? { requirements: reqs.filter((r) => r.requirement.trim()) } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't save. Please try again.");
        return;
      }
      if (body.jdChanged) {
        toast.success("Job description updated", {
          description: `Cleared ${body.scoresCleared} old score${body.scoresCleared === 1 ? "" : "s"} — run "Score blind" again under the new requirements.`,
        });
      } else if (body.requirementsChanged) {
        toast.success("Scoring criteria updated", {
          description:
            body.scoresCleared > 0
              ? `Cleared ${body.scoresCleared} old score${body.scoresCleared === 1 ? "" : "s"} — run "Score blind" again under the new criteria.`
              : 'Run "Score blind" to apply the new criteria.',
        });
      } else if (body.recomputed > 0) {
        toast.success("Rubric updated", {
          description: `Recomputed ${body.recomputed} total${body.recomputed === 1 ? "" : "s"} from the stored blind sub-scores — no AI re-run needed.`,
        });
      } else {
        toast.info("Saved — nothing needed recalculating.");
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden /> Edit scoring setup
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PencilLine className="size-4 text-primary" aria-hidden />
          Rubric & job description
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Changing weights only recomputes totals in code from the stored blind
          sub-scores — the AI never re-runs, so scoring stays exactly as blind
          as it was.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Weights</span>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
              balanced ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
            )}
            aria-live="polite"
          >
            {total}% / 100%
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {RUBRIC_FIELDS.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={`edit-${field.name}`}>
                {field.label} <span className="font-normal text-muted-foreground">(%)</span>
              </Label>
              <Input
                id={`edit-${field.name}`}
                type="number"
                min={0}
                max={100}
                value={weights[field.name]}
                onChange={(e) =>
                  setWeights((w) => ({
                    ...w,
                    [field.name]: e.target.value === "" ? 0 : Number(e.target.value),
                  }))
                }
              />
            </div>
          ))}
        </div>

        {reqsOpen ? (
          <div className="space-y-2">
            <Label>Scoring criteria</Label>
            <p className="text-xs text-muted-foreground">
              The requirements every CV is scored against. Clear the list to go
              back to the AI&apos;s derivation from the job description.
            </p>
            {reqs.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                <Input
                  aria-label={`Criterion ${index + 1}`}
                  placeholder="e.g. 5+ years professional experience"
                  value={item.requirement}
                  onChange={(e) =>
                    setReqs((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, requirement: e.target.value } : entry
                      )
                    )
                  }
                />
                <select
                  aria-label={`Criterion ${index + 1} importance`}
                  value={item.type}
                  onChange={(e) =>
                    setReqs((current) =>
                      current.map((entry, i) =>
                        i === index
                          ? { ...entry, type: e.target.value as Requirement["type"] }
                          : entry
                      )
                    )
                  }
                  className="h-9 rounded-lg border border-input bg-card px-3 text-sm"
                >
                  <option value="hard">Mandatory</option>
                  <option value="nice-to-have">Preferred</option>
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove criterion ${index + 1}`}
                  onClick={() => setReqs((current) => current.filter((_, i) => i !== index))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReqs((current) => [...current, { requirement: "", type: "hard" }])}
              disabled={reqs.length >= 30}
            >
              <Plus aria-hidden /> Add criterion
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReqsOpen(true)}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Edit scoring criteria
          </button>
        )}

        {jdOpen ? (
          <div className="space-y-1.5">
            <Label htmlFor="edit-jd">Job description</Label>
            <Textarea
              id="edit-jd"
              className="min-h-[150px]"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
            {jdChanged && (
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                Heads up: saving a changed JD clears the cached requirements and
                all existing scores for this job — you'll re-run “Score blind”
                afterward.
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setJdOpen(true)}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Edit job description (clears scores)
          </button>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Button className="w-full sm:w-auto" onClick={onSave} loading={loading}>
            Save changes
          </Button>
            <Button
              className="w-full sm:w-auto"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setWeights(initialWeights);
                setJd(jdText);
                setReqs(initialRequirements);
                setError(null);
              }}
            >
              Cancel
            </Button>
        </div>
      </CardContent>
    </Card>
  );
}
