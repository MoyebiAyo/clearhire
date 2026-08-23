import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

export const metadata = { title: "Analytics" };

const STAGE_ORDER = [
  ["applied", "Applied"],
  ["screened", "Screened"],
  ["shortlisted", "Shortlisted"],
  ["interview_scheduled", "Interview scheduled"],
  ["interviewed", "Interviewed"],
  ["offer", "Offer"],
] as const;

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: appRows } = await supabase
    .from("applications")
    .select(
      "id, status, applied_at, status_changed_at, candidates(source), scores(total_score), jobs(title)"
    )
    .order("applied_at", { ascending: true });

  interface Row {
    id: string;
    status: string;
    applied_at: string;
    status_changed_at: string | null;
    candidates: unknown;
    jobs: unknown;
  }
  const rows = (appRows ?? []) as unknown as Row[];

  // ── Time to hire: applied → offer, per job + averaged ──
  const offers = rows.filter((r) => r.status === "offer" && r.status_changed_at);
  const days = (a: string, b: string) =>
    Math.max((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000, 0);
  const ttHByJob = new Map<string, { title: string; days: number }>();
  for (const o of offers) {
    const title = one<{ title: string }>(o.jobs)?.title ?? "Unknown job";
    const d = days(o.applied_at, o.status_changed_at!);
    const prev = ttHByJob.get(o.id)?.days;
    ttHByJob.set(o.id, { title, days: prev === undefined ? d : (prev + d) / 2 });
  }
  const avgTtH = offers.length
    ? [...ttHByJob.values()].reduce((a, b) => a + b.days, 0) / ttHByJob.size
    : null;

  // ── Source split ──
  const bySource = { email: 0, upload: 0 };
  for (const r of rows) {
    const s = one<{ source: string | null }>(r.candidates)?.source;
    if (s === "email") bySource.email++;
    else bySource.upload++;
  }
  const totalApps = rows.length;

  // ── Stage funnel: highest stage reached per application ──
  const rank: Record<string, number> = Object.fromEntries(
    STAGE_ORDER.map(([k], i) => [k, i])
  );
  const maxStage = (r: Row) =>
    r.status === "rejected"
      ? rank.applied // rejected candidates still entered the funnel
      : (rank[r.status] ?? 0);
  const reach = STAGE_ORDER.map(() => 0);
  for (const r of rows) reach[maxStage(r)]++;
  const funnel = STAGE_ORDER.map(([key, label], i) => ({
    label,
    count: reach.slice(i).reduce((a, b) => a + b, 0), // reached stage i or beyond
  }));
  let biggestDrop = { from: "", pct: 0 };
  for (let i = 1; i < funnel.length; i++) {
    if (funnel[i - 1].count === 0) continue;
    const drop = 1 - funnel[i].count / funnel[i - 1].count;
    if (drop > biggestDrop.pct) biggestDrop = { from: funnel[i - 1].label, pct: drop };
  }
  const rejected = rows.filter((r) => r.status === "rejected").length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Small numbers, plainly explained — where candidates come from, how
          far they get, and how long hiring takes.
        </p>
      </div>

      {totalApps === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="text-3xl" aria-hidden>📊</span>
            <p className="font-medium">No applications yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Once CVs flow in — uploaded or emailed — this page fills with
              source split, stage drop-off, and time-to-hire.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where candidates come from</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(["upload", "email"] as const).map((src) => {
                const n = bySource[src];
                const pct = totalApps ? Math.round((n / totalApps) * 100) : 0;
                return (
                  <div key={src}>
                    <div className="flex justify-between text-sm">
                      <span className="capitalize">{src === "email" ? "Email inbox" : "Manual upload"}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {n} · {pct}%
                      </span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={src === "email" ? "h-full rounded-full bg-primary" : "h-full rounded-full bg-success"}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                {bySource.email >= bySource.upload
                  ? "Most CVs arrive by email — the connected inbox is doing the intake work."
                  : "Most CVs are uploaded manually — connect the Gmail inbox to automate intake."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stage drop-off funnel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {funnel.map((f) => {
                const pct = totalApps ? Math.round((f.count / totalApps) * 100) : 0;
                return (
                  <div key={f.label}>
                    <div className="flex justify-between text-sm">
                      <span>{f.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {f.count} · {pct}%
                      </span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/80" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                {biggestDrop.pct > 0
                  ? `Most drop-off happens between ${biggestDrop.from} and the next stage (${Math.round(biggestDrop.pct * 100)}% don't advance). ${rejected} candidate${rejected === 1 ? "" : "s"} rejected overall.`
                  : "Every candidate so far has advanced through every stage — early days!"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Time to hire</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {offers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No offers yet — the moment a card lands on Offer, this shows
                  days from application to offer, per job and averaged.
                </p>
              ) : (
                <>
                  {[...ttHByJob.values()].map((j, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span>{j.title}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {j.days.toFixed(1)} days
                      </span>
                    </div>
                  ))}
                  <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                    Average across jobs:{" "}
                    <strong className="text-foreground">{avgTtH?.toFixed(1)} days</strong>{" "}
                    from application to offer.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
