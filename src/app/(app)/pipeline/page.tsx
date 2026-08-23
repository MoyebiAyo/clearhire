import Link from "next/link";

import { KanbanBoard, type KanbanCard } from "@/components/kanban-board";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job: jobFilter } = await searchParams;
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title")
    .order("created_at", { ascending: false });

  let query = supabase
    .from("applications")
    .select(
      "id, status, applied_at, flagged_duplicate, revealed_at, candidates(name, email, source), scores(total_score), jobs(title)"
    )
    .order("applied_at", { ascending: true });
  if (jobFilter) query = query.eq("job_id", jobFilter);
  const { data: appRows } = await query;

  const cards: KanbanCard[] = ((appRows ?? []) as unknown as Record<string, unknown>[]).map(
    (r) => {
      const cand = one<{ name: string | null; email: string; source: string | null }>(
        r.candidates
      );
      const job = one<{ title: string }>(r.jobs);
      const score = (r.scores as { total_score: number }[] | null)?.[0];
      return {
        id: r.id as string,
        status: r.status as string,
        jobId: (r.job_id as string) ?? jobFilter ?? "",
        jobTitle: job?.title ?? "—",
        name: cand?.name ?? null,
        email: cand?.email ?? "(unknown)",
        source: (cand?.source as "upload" | "email" | null) ?? null,
        revealed: Boolean(r.revealed_at),
        flaggedDuplicate: Boolean(r.flagged_duplicate),
        total: score ? Number(score.total_score) : null,
        appliedAt: r.applied_at as string,
      };
    }
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground" title="Stages: Applied (uploaded or emailed) → Screened (AI-scored blind) → Shortlisted → Interview Scheduled → Interviewed → Offer or Rejected. Drag cards or use the stage menu on a card.">
            Every candidate, one board. Drag a card between stages — or use its
            stage menu. Moving to Rejected offers to draft the closing email.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jobs && jobs.length > 0 && (
            <select
              value={jobFilter ?? ""}
              onChange={(e) => {
                window.location.href = e.target.value
                  ? `/pipeline?job=${e.target.value}`
                  : "/pipeline";
              }}
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Filter by job"
            >
              <option value="">All jobs</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          )}
          <Link
            href="/analytics"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            View analytics →
          </Link>
        </div>
      </div>

      <KanbanBoard initialCards={cards} />
    </div>
  );
}
