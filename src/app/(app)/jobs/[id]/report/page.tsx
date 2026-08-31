import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const dynamic = "force-dynamic";

/**
 * /jobs/[id]/report — a one-page, print-to-PDF process report: intake,
 * blind scoring outcome, decisions, and the fairness statement. Zero
 * chrome: a print stylesheet strips everything except the report itself.
 */

export default async function JobReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, jd_text, created_at, status, weight_skills, weight_experience, weight_certifications, weight_tools")
    .eq("id", jobId)
    .maybeSingle();

  if (!user || !job) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <p className="text-sm text-muted-foreground">Report not available — open it from your job page.</p>
      </main>
    );
  }

  const { data: recruiter } = await supabase.from("recruiters").select("org_name").eq("id", user.id).maybeSingle();

  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, status, applied_at, revealed_at, flagged_duplicate, candidates(name, email), scores(total_score, rationale), interviews(scheduled_time)"
    )
    .eq("job_id", job.id);

  type AppRow = {
    id: string;
    status: string;
    applied_at: string;
    revealed_at: string | null;
    flagged_duplicate: boolean;
    candidates: { name: string | null; email: string }[] | null;
    scores: { total_score: number | null; rationale: string | null }[] | null;
    interviews: { scheduled_time: string | null }[] | null;
  };
  const rows = ((apps ?? []) as unknown as AppRow[]).map((r) => ({
    flaggedDuplicate: r.flagged_duplicate,
    name: r.candidates?.[0]?.name ?? r.candidates?.[0]?.email ?? "Unknown",
    revealed: r.revealed_at !== null,
    status: r.status,
    appliedAt: r.applied_at,
    total: r.scores?.[0]?.total_score ?? null,
    rationale: r.scores?.[0]?.rationale ?? null,
    interviewAt: r.interviews?.[0]?.scheduled_time ?? null,
  }));
  rows.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));

  const scored = rows.filter((r) => r.total !== null);
  const counts = {
    applications: rows.length,
    scored: scored.length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    interviewed: rows.filter((r) => r.interviewAt).length,
    offers: rows.filter((r) => r.status === "offer").length,
    duplicates: rows.filter((r) => r.flaggedDuplicate).length,
  };
  const avg = scored.length ? Math.round((scored.reduce((s, r) => s + (r.total ?? 0), 0) / scored.length) * 10) / 10 : null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-background p-6 print:p-0">
      <style>{`@media print {
        body { background: white; }
        .no-print { display: none !important; }
        main { padding: 0 !important; max-width: none !important; }
      }
      @page { margin: 14mm; }`}</style>

      <div className="no-print mb-6 flex items-center justify-between">
        <Link
          href={`/jobs/${job.id}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
        >
          ← Back to job
        </Link>
        <PrintButton />
      </div>

      <div className="print-area space-y-6 text-[13px] leading-relaxed text-foreground">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-foreground pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">ClearHire · hiring process report</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{job.title}</h1>
            <p className="text-sm text-muted-foreground">
              {recruiter?.org_name || "Hiring team"} · job opened {fmt(job.created_at ?? null)} · report generated {fmt(new Date().toISOString())}
            </p>
          </div>
        </header>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">The funnel, at a glance</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              ["Applied", counts.applications],
              ["Scored", counts.scored],
              ["Rejected", counts.rejected],
              ["Interviews", counts.interviewed],
              ["Offers", counts.offers],
              ["Duplicates", rows.filter((r) => r.flaggedDuplicate).length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border p-2 text-center">
                <p className="text-xl font-bold tabular-nums">{value}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Rubric weights: skills {job.weight_skills}% · experience {job.weight_experience}% · certifications{" "}
            {job.weight_certifications}% · tools {job.weight_tools}%
            {avg !== null ? ` · average blind score ${avg}` : ""}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Blind shortlist outcome</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-foreground/30 text-left">
                <th className="py-1 pr-2 font-semibold">#</th>
                <th className="py-1 pr-2 font-semibold">Candidate</th>
                <th className="py-1 pr-2 font-semibold">Score</th>
                <th className="py-1 pr-2 font-semibold">Status</th>
                <th className="py-1 font-semibold">Why (AI rationale, abridged)</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((r, i) => (
                <tr key={r.name + i} className="border-b border-border align-top">
                  <td className="py-1 pr-2 tabular-nums">{r.total !== null ? i + 1 : "—"}</td>
                  <td className="py-1 pr-2">
                    {r.revealed ? r.name : `Candidate #${i + 1}`}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">{r.total ?? "—"}</td>
                  <td className="py-1 pr-2 capitalize">{r.status}</td>
                  <td className="py-1 text-muted-foreground">{r.rationale ? `${r.rationale.slice(0, 140)}${r.rationale.length > 140 ? "…" : ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 10 && <p className="mt-1 text-xs text-muted-foreground">+ {rows.length - 10} more candidates below the top 10.</p>}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">How this stayed fair</h2>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed">
            <li>
              Every CV was scored blind: the model saw skills, experience, certifications, tools and sub-scores — never
              names, emails, schools, photos or dates of birth.
            </li>
            <li>Identities were revealed only after scores were locked, and only when the recruiter clicked Reveal.</li>
            <li>AI-proposed actions (rejections, exams, emails) executed only after a human confirmed each card.</li>
            <li>
              Human judgement stayed in the loop: interview scorecards sit beside the AI score, and every rejection is
              reversible.
            </li>
          </ul>
        </section>

        <footer className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          Generated by ClearHire — AI recruitment assistant · {fmt(new Date().toISOString())} · scores are advisory; all
          hiring decisions were made by {recruiter?.org_name || "the hiring team"}.
        </footer>
      </div>
    </main>
  );
}
