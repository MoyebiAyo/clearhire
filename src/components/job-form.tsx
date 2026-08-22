"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RUBRIC_FIELDS, type RubricFieldName } from "@/lib/validation";
import { cn } from "@/lib/utils";

const DEFAULTS: Record<RubricFieldName, number> = {
  weight_skills: 40,
  weight_experience: 30,
  weight_certifications: 15,
  weight_tools: 15,
};

export function JobForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [jdText, setJdText] = useState("");
  const [weights, setWeights] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(
    () => Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0),
    [weights]
  );
  const balanced = total === 100;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!balanced) {
      setError(`Weights add up to ${total}% — adjust them to total exactly 100%.`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, jd_text: jdText, ...weights }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't save the job. Please try again.");
        return;
      }
      toast.success("Job created", {
        description: "Next step: upload CVs on the job page.",
      });
      router.push(`/jobs/${body.job.id}`);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="title">Job title</Label>
            <Input
              id="title"
              placeholder="e.g. Senior Backend Engineer"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="jd">Job description</Label>
            <Textarea
              id="jd"
              placeholder="Paste the full JD — requirements, responsibilities, must-have skills…"
              className="min-h-[180px]"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              The AI reads this to derive the requirements each CV is scored
              against. The more complete it is, the fairer the scoring.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-medium">Scoring rubric</h2>
              <p className="text-xs text-muted-foreground">
                How much each criterion matters when CVs are scored. Must total
                exactly 100%.
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
                balanced
                  ? "bg-success-soft text-success"
                  : total > 100
                    ? "bg-destructive-soft text-destructive"
                    : "bg-warning-soft text-warning"
              )}
              aria-live="polite"
            >
              {total}% / 100%
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuenow={Math.min(total, 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Rubric weight total"
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all",
                balanced ? "bg-success" : total > 100 ? "bg-destructive" : "bg-primary"
              )}
              style={{ width: `${Math.min(total, 100)}%` }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {RUBRIC_FIELDS.map((field) => (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={field.name}>
                  {field.label}{" "}
                  <span className="font-normal text-muted-foreground">(%)</span>
                </Label>
                <Input
                  id={field.name}
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
                <p className="text-xs text-muted-foreground">{field.hint}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" loading={loading}>
          Create job
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
