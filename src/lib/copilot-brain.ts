import "server-only";

import { chatJSON } from "@/lib/ai";
import { composeEmail, type EmailKind } from "@/lib/email-compose";
import { createAdminClient } from "@/lib/supabase/admin";
import { one } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Copilot brain, shared by the typed assistant route and the voice
 * (Deepgram) function route. Everything here enforces the blindness
 * invariant: candidates are de-identified unless the recruiter revealed
 * them, and action proposals resolve to concrete candidate sets
 * deterministically in code — the model never picks ids.
 */

export interface BlindCandidate {
  rank: number;
  status: string;
  score: number | null;
  skills: number | null;
  experience: number | null;
  certifications: number | null;
  tools: number | null;
  skillsList: string[];
  experienceYears: number | null;
  certificationsList: string[];
  toolsList: string[];
  hardGaps: string[];
  softGaps: string[];
  rationale: string | null;
  exam: { status: string; score: number | null } | null;
  interview: { status: string; scheduled: boolean } | null;
  flaggedDuplicate: boolean;
  identity: string | null; // only when revealed_at is set
  applicationId: string;
}

/**
 * Fresh, blind context for one job: every application mapped to
 * BlindCandidate, ranked by score (exam-blended when an exam score exists).
 */
export async function buildCopilotContext(
  supabase: SupabaseClient,
  jobId: string
): Promise<{ candidates: BlindCandidate[] }> {
  const { data: appRows } = await supabase
    .from("applications")
    .select(
      "id, status, revealed_at, flagged_duplicate, cv_extractions(skills, experience_years, certifications, tools), scores(skills_score, experience_score, certifications_score, tools_score, total_score, gaps, rationale), exam_invites(status, score), interviews(status, scheduled_time), candidates(name, email)"
    )
    .eq("job_id", jobId)
    .order("applied_at", { ascending: true });

  const candidates: BlindCandidate[] = ((appRows ?? []) as unknown as Record<string, unknown>[]).map(
    (r) => {
      const ext = one<Record<string, unknown>>(r.cv_extractions as unknown) ?? null;
      const sc = one<Record<string, unknown>>(r.scores as unknown) ?? null;
      const inv = one<Record<string, unknown>>(r.exam_invites as unknown) ?? null;
      const intr = one<Record<string, unknown>>(r.interviews as unknown) ?? null;
      const cand = one<Record<string, unknown>>(r.candidates as unknown) ?? null;
      const gaps = Array.isArray(sc?.gaps) ? (sc!.gaps as { requirement: string; severity: string }[]) : [];
      const revealed = Boolean(r.revealed_at);
      return {
        rank: 0,
        status: String(r.status),
        score: sc ? Number(sc.total_score) : null,
        skills: sc ? Number(sc.skills_score) : null,
        experience: sc ? Number(sc.experience_score) : null,
        certifications: sc ? Number(sc.certifications_score) : null,
        tools: sc ? Number(sc.tools_score) : null,
        skillsList: Array.isArray(ext?.skills) ? (ext!.skills as string[]) : [],
        experienceYears: ext?.experience_years != null ? Number(ext!.experience_years) : null,
        certificationsList: Array.isArray(ext?.certifications) ? (ext!.certifications as string[]) : [],
        toolsList: Array.isArray(ext?.tools) ? (ext!.tools as string[]) : [],
        hardGaps: gaps.filter((g) => g.severity === "hard").map((g) => g.requirement),
        softGaps: gaps.filter((g) => g.severity !== "hard").map((g) => g.requirement),
        rationale: sc?.rationale ? String(sc.rationale) : null,
        exam: inv ? { status: String(inv.status), score: inv.score === null ? null : Number(inv.score) } : null,
        interview: intr ? { status: String(intr.status), scheduled: Boolean(intr.scheduled_time) } : null,
        flaggedDuplicate: Boolean(r.flagged_duplicate),
        identity: revealed
          ? `${cand?.name ?? "Name not detected"} <${cand?.email ?? "no email"}>`
          : null,
        applicationId: String(r.id),
      };
    }
  );

  // Rank by score (exam-blended when an exam score exists).
  const { data: examRow } = await supabase
    .from("exams")
    .select("weight_cv, weight_exam")
    .eq("job_id", jobId)
    .eq("status", "active")
    .maybeSingle();
  const blend = (c: BlindCandidate) => {
    if (c.score === null) return -1;
    if (examRow && c.exam?.score !== null && c.exam?.score !== undefined) {
      return (c.score * Number(examRow.weight_cv) + c.exam.score * Number(examRow.weight_exam)) / 100;
    }
    return c.score;
  };
  candidates.sort((a, b) => blend(b) - blend(a));
  candidates.forEach((c, i) => (c.rank = i + 1));

  return { candidates };
}

/** Pipe-delimited blind context lines fed to the model. */
export function buildContextLines(candidates: BlindCandidate[]): string {
  return candidates
    .map((c) => {
      const parts = [
        `#${c.rank}`,
        `status=${c.status}`,
        c.score !== null
          ? `total=${Math.round(c.score)} (skills ${Math.round(c.skills ?? 0)}, exp ${Math.round(c.experience ?? 0)}, certs ${Math.round(c.certifications ?? 0)}, tools ${Math.round(c.tools ?? 0)})`
          : "not scored yet",
        c.skillsList.length ? `skills=[${c.skillsList.slice(0, 8).join("; ")}]` : null,
        c.experienceYears !== null ? `years=${c.experienceYears}` : null,
        c.toolsList.length ? `tools=[${c.toolsList.slice(0, 6).join("; ")}]` : null,
        c.hardGaps.length ? `hardGaps=[${c.hardGaps.slice(0, 3).join("; ")}]` : null,
        c.exam ? `exam=${c.exam.status}${c.exam.score !== null ? `(${Math.round(c.exam.score)})` : ""}` : null,
        c.interview ? `interview=${c.interview.status}${c.interview.scheduled ? "(scheduled)" : "(unscheduled)"}` : null,
        c.flaggedDuplicate ? "flaggedDuplicate" : null,
        c.identity ? `IDENTITY(REVEALED)=${c.identity}` : null,
      ].filter(Boolean);
      return parts.join(" | ");
    })
    .join("\n");
}

interface ResolverArgs {
  maxTotal?: unknown;
  minTotal?: unknown;
  onlyHardGaps?: unknown;
  tone?: unknown;
  minTotalLoose?: unknown;
  questionsPerCandidate?: unknown;
  minutes?: unknown;
  weightCv?: unknown;
  bankSize?: unknown;
  deadlineHours?: unknown;
}

/** reject_preview: everyone matching the stated criteria (strict below / above). */
export function resolveRejectPreview(
  candidates: BlindCandidate[],
  args: ResolverArgs
): Record<string, unknown> {
  const max = typeof args.maxTotal === "number" ? args.maxTotal : null;
  const min = typeof args.minTotal === "number" ? args.minTotal : null;
  const hardOnly = args.onlyHardGaps === true;
  const tone = args.tone === "casual" || args.tone === "technical" ? String(args.tone) : "formal";
  const matches = candidates.filter((c) => {
    if (c.status === "rejected") return false;
    if (c.score === null) return false;
    if (max !== null && !(c.score < max)) return false;
    if (min !== null && !(c.score > min)) return false;
    if (hardOnly && c.hardGaps.length === 0) return false;
    return true;
  });
  return {
    name: "reject_preview",
    tone,
    count: matches.length,
    candidates: matches.map((c) => ({
      applicationId: c.applicationId,
      rank: c.rank,
      total: c.score !== null ? Math.round(c.score) : null,
      identity: c.identity,
    })),
  };
}

/** exam_setup: eligible = scored, active candidates above the stated bar. */
export function resolveExamSetup(
  candidates: BlindCandidate[],
  args: ResolverArgs
): Record<string, unknown> {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const floor = num(args.minTotal);
  const eligible = candidates.filter(
    (c) => c.status !== "rejected" && c.score !== null && (floor === null || c.score > floor)
  );
  return {
    name: "exam_setup",
    count: eligible.length,
    proposal: {
      minTotal: floor,
      questionsPerCandidate: num(args.questionsPerCandidate) ?? 20,
      minutes: num(args.minutes) ?? 30,
      weightCv: num(args.weightCv) ?? 70,
      bankSize: num(args.bankSize) ?? 40,
      deadlineHours: num(args.deadlineHours) ?? 48,
      tone: args.tone === "casual" || args.tone === "technical" ? String(args.tone) : "formal",
    },
    applicationIds: eligible.map((c) => c.applicationId),
  };
}

/**
 * Deep CV scan for questions the structured data can't answer. Sends FULL
 * stored CV text (up to 14k chars each — dense 2-pagers included, so page-2
 * leadership/achievement evidence isn't lost), packed into requests of
 * ≤24k chars (~6k tokens) that each stay under Groq's ~8k per-request
 * ceiling. Up to 3 sequential calls in rank order; the shared backoff
 * absorbs any rolling-window 429s between calls. Blind — quotes contain
 * role/skill text only; identity never enters the prompt.
 */
export async function cvScan(
  candidates: BlindCandidate[],
  query: string
): Promise<{ matches: { rank: number; quote: string }[]; scanned: number; total: number } | null> {
  const eligible = candidates.filter((c) => c.status !== "rejected" && c.score !== null);
  if (eligible.length === 0) return null;
  const total = eligible.length;

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("cv_extractions")
    .select("application_id, raw_text")
    .in(
      "application_id",
      eligible.map((c) => c.applicationId)
    );
  const textByApp = new Map((rows ?? []).map((r) => [r.application_id, r.raw_text ?? ""]));

  // Rank-ordered FULL documents, packed into token-safe chunks.
  const MAX_CHUNK_CHARS = 24_000;
  const MAX_CALLS = 3;
  const chunks: string[] = [];
  let current = "";
  for (const c of eligible) {
    const doc = `CANDIDATE #${c.rank}:\n${textByApp.get(c.applicationId) ?? ""}`.slice(0, 14_500);
    if (current.length > 0 && current.length + doc.length > MAX_CHUNK_CHARS) {
      chunks.push(current);
      if (chunks.length >= MAX_CALLS) break; // coverage is reported honestly
      current = "";
    }
    current += (current ? "\n\n---\n\n" : "") + doc;
  }
  if (current && chunks.length < MAX_CALLS) chunks.push(current);

  const rankSet = new Set(eligible.map((c) => c.rank));
  const matches: { rank: number; quote: string }[] = [];
  let scanned = 0;
  for (const chunk of chunks) {
    scanned += chunk.split("CANDIDATE #").length - 1;
    const out = await chatJSON<{ matches?: { rank?: number; found?: boolean; quote?: string }[] }>({
      purpose: "cv-scan",
      maxTokens: 900,
      user: `Search these CV texts — FULL documents, check experience sections and later pages too — and find evidence matching: "${query}".

Rules: only report candidates with a clear, quotable piece of evidence. The quote must be copied from the text (max 140 chars, trimmed sensibly). Ignore candidates with no evidence. Ranks are numbers like 4.

CV TEXTS:
${chunk}

Respond JSON only: {"matches": [{"rank": number, "found": true, "quote": string}]}`,
    });
    for (const m of out.matches ?? []) {
      if (
        m.found !== false &&
        typeof m.rank === "number" &&
        typeof m.quote === "string" &&
        rankSet.has(m.rank)
      ) {
        matches.push({ rank: m.rank, quote: String(m.quote).slice(0, 140) });
      }
    }
  }
  const seenRank = new Set<number>();
  const unique = matches.filter((m) => !seenRank.has(m.rank) && seenRank.add(m.rank));
  return { matches: unique, scanned: Math.min(scanned, total), total };
}

/**
 * Proposal-time email previews. Composes the EXACT deterministic template
 * the send route will send (lib/email-compose), so "review the card" is
 * real: the recruiter reads subject + body before confirming. Blindness
 * is preserved — unrevealed candidates greet as "there"; the real name is
 * only inserted at send time.
 */
export interface CopilotEmailPreview {
  rank: number;
  subject: string;
  text: string;
}

export async function buildEmailPreviews(
  supabase: SupabaseClient,
  opts: { jobId: string; jobTitle: string; origin: string; kind: EmailKind; org: string },
  selected: { applicationId: string; rank: number; identity: string | null }[]
): Promise<CopilotEmailPreview[]> {
  if (selected.length === 0) return [];
  const ids = selected.map((s) => s.applicationId);
  const { data: apps } = await supabase
    .from("applications")
    .select("id, interviews(schedule_token, scheduled_time, location_or_link), exam_invites(token)")
    .eq("job_id", opts.jobId)
    .in("id", ids);
  const byId = new Map<string, {
    interviews: { schedule_token: string | null; scheduled_time: string | null; location_or_link: string | null }[] | null;
    exam_invites: { token: string }[] | null;
  }>((apps ?? []).map((a) => [a.id, a]));
  const previews: CopilotEmailPreview[] = [];
  for (const s of selected) {
    const app = byId.get(s.applicationId);
    if (!app) continue;
    const interview = one<{ schedule_token: string | null; scheduled_time: string | null; location_or_link: string | null }>(app.interviews);
    const exam = one<{ token: string }>(app.exam_invites);
    const message = composeEmail(opts.kind, s.identity ?? "", opts.jobTitle, opts.org, {
      interview: interview?.scheduled_time ? new Date(interview.scheduled_time).toUTCString() : null,
      location: interview?.location_or_link,
      schedule: interview?.schedule_token ? `${opts.origin}/schedule/${interview.schedule_token}` : null,
      exam: exam?.token ? `${opts.origin}/exam/${exam.token}` : null,
    });
    previews.push({ rank: s.rank, subject: message.subject, text: message.text });
  }
  return previews;
}

/**
 * Hidden gems — the AI "second look". Takes candidates ranked OUTSIDE the
 * shortlist's top ranks, reads their raw CV text, and surfaces overlooked
 * evidence the rubric may have underweighted. One chunked AI call, same
 * token-caps as cvScan; deterministic rank→candidate mapping in code.
 */
export interface HiddenGem {
  rank: number;
  total: number | null;
  quote: string;
  reason: string;
}

export async function findHiddenGems(
  supabase: SupabaseClient,
  jobId: string,
  beyondRank = 5
): Promise<{ gems: HiddenGem[]; scanned: number; total: number } | null> {
  const { candidates } = await buildCopilotContext(supabase, jobId);
  const eligible = candidates.filter((c) => c.status !== "rejected" && c.score !== null);
  if (eligible.length <= beyondRank) return null;
  const ranked = [...eligible].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const overlooked = ranked.slice(beyondRank).slice(0, 8);
  const total = eligible.length;

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("cv_extractions")
    .select("application_id, raw_text")
    .in(
      "application_id",
      overlooked.map((c) => c.applicationId)
    );
  const textByApp = new Map((rows ?? []).map((r) => [r.application_id, r.raw_text ?? ""]));

  const MAX_CHUNK_CHARS = 24_000;
  const PER_DOC = 3_500;
  const chunks: string[] = [];
  let current = "";
  for (const c of overlooked) {
    const doc = `CANDIDATE #${c.rank} (total score ${c.score ?? "?"}):\n${(textByApp.get(c.applicationId) ?? "").slice(0, PER_DOC)}`;
    if (current.length > 0 && current.length + doc.length > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + doc;
  }
  if (current) chunks.push(current);
  const doc = chunks[0];

  const out = await chatJSON<{ gems?: { rank?: number; quote?: string; reason?: string }[] }>({
    user: `A recruiter's AI shortlist ranks candidates by a rubric (skills, experience, certifications, tools). Below are candidates ranked OUTSIDE the top ${beyondRank}. Read each CV excerpt and surface up to 4 "hidden gems": candidates whose text shows genuinely strong evidence the rubric may have underweighted (leadership, shipped products, scale, rare depth, initiative). Only cite text that is actually present; skip anyone unremarkable.
Return strict JSON: {"gems": [{"rank": <candidate number>, "quote": "<verbatim short quote>", "reason": "<one sentence why this matters>"}]}. If nothing qualifies, return {"gems": []}.

${doc}`,
    purpose: "hidden-gems",
    maxTokens: 900,
  });

  const byRank = new Map(overlooked.map((c) => [c.rank, c]));
  const seenRank = new Set<number>();
  const gems: HiddenGem[] = (out.gems ?? [])
    .map((g) => {
      const rank = Number(g.rank);
      const match = byRank.get(rank);
      if (!match || typeof g.quote !== "string" || !g.quote.trim()) return null;
      return {
        rank,
        total: match.score,
        quote: String(g.quote).trim().slice(0, 220),
        reason: String(g.reason ?? "").trim().slice(0, 220),
      };
    })
    .filter((g): g is HiddenGem => g !== null)
    .slice(0, 4);

  return { gems, scanned: overlooked.length, total };
}
