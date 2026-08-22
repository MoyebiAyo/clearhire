"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Template {
  id: string;
  type: string;
  tone: string;
  subject: string;
  body: string;
  shared: boolean;
}

const MERGE_FIELDS = [
  "candidate_name",
  "recruiter_name",
  "job_title",
  "proposed_times",
  "location_or_link",
  "schedule_link",
];

export function TemplateEditor({
  templates,
  from,
}: {
  templates: Template[];
  from: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.type] ??= []).push(t);
    return acc;
  }, {});

  function open(t: Template) {
    setEditing(t.id);
    setDraft({ subject: t.subject, body: t.body });
    setError(null);
  }

  async function save(id: string) {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't save.");
        return;
      }
      toast.success(body.forked ? "Saved as your own copy" : "Template saved");
      setEditing(null);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Sending from <code className="rounded bg-muted px-1">{from}</code> ·
        Merge fields:{" "}
        {MERGE_FIELDS.map((f) => (
          <code key={f} className="mx-0.5 rounded bg-muted px-1">
            {`{{${f}}}`}
          </code>
        ))}
      </p>

      {Object.entries(grouped).map(([type, list]) => (
        <div key={type} className="space-y-2">
          <h2 className="text-sm font-semibold capitalize">{type} emails</h2>
          {list.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="capitalize">{t.tone}</Badge>
                  {t.shared && <Badge variant="outline">shared default</Badge>}
                </div>
                {editing === t.id && draft ? (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`s-${t.id}`}>Subject</Label>
                      <Input
                        id={`s-${t.id}`}
                        value={draft.subject}
                        onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`b-${t.id}`}>Body</Label>
                      <Textarea
                        id={`b-${t.id}`}
                        className="min-h-[180px] font-mono text-xs"
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                      />
                    </div>
                    {error && (
                      <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
                        {error}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => save(t.id)} loading={busy}>
                        Save {t.shared ? "(creates your copy)" : ""}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => open(t)}
                    className="mt-2 block w-full text-left text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {t.subject}
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}
