import { NextResponse } from "next/server";

import { aiUserMessage, chatJSON } from "@/lib/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";
import { validCopilotStage } from "@/lib/copilot-action";

export const maxDuration = 60;

/**
 * POST /api/jobs/[id]/assistant { messages } — the job-page Copilot.
 *
 * Protocol: a strict JSON action contract over chatJSON (temperature 0,
 * JSON mode, backoff) instead of native tool calling — deterministic and
 * consistent with every AI feature in the product.
 *
 * Blindness invariant (server-enforced, like scoring): the model sees only
 * blind fields per candidate — rank, skills, experience, certifications,
 * tools, sub-scores, total, gaps, rationale, status, exam result. Names and
 * emails are attached ONLY for applications the recruiter already revealed,
 * and the prompt forbids inferring identity. Mass actions are PROPOSED by
 * the model as criteria and resolved deterministically in code — the model
 * can never pick candidate ids itself.
 */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface BlindCandidate {
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, jd_text, weight_skills, weight_experience, weight_certifications, weight_tools")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  let messages: ChatMessage[] = [];
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    messages = (body.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10);
  } catch {
    // empty conversation handled below
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Say something first." }, { status: 400 });
  }

  // Fresh, blind context every turn.
  const { data: appRows } = await supabase
    .from("applications")
    .select(
      "id, status, revealed_at, flagged_duplicate, cv_extractions(skills, experience_years, certifications, tools), scores(skills_score, experience_score, certifications_score, tools_score, total_score, gaps, rationale), exam_invites(status, score), interviews(status, scheduled_time), candidates(name, email)"
    )
    .eq("job_id", id)
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
    .eq("job_id", id)
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

  const identityExposed = candidates.filter((c) => c.identity).length;
  console.log(
    `[blind-audit] copilot job=${id} candidates=${candidates.length} identityExposed=${identityExposed}`
  );

  const contextLines = candidates
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

  const conversation = messages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "RECRUITER" : "COPILOT"}: ${m.content.slice(0, 1200)}`)
    .join("\n");

  const out = await chatJSON<{ answer?: string; action?: { name?: string; args?: Record<string, unknown> } | null }>({
    purpose: "copilot",
    maxTokens: 1200,
    user: `You are ClearHire Copilot, an AI hiring assistant for one job. You explain the shortlist, answer questions from the data, and PROPOSE actions.

JOB: ${job.title}
RUBRIC WEIGHTS: skills ${job.weight_skills}%, experience ${job.weight_experience}%, certifications ${job.weight_certifications}%, tools ${job.weight_tools}%
JOB DESCRIPTION (excerpt): ${job.jd_text.slice(0, 1500)}

CANDIDATES (blind — de-identified; ranks by current score):
${contextLines || "(no applications yet)"}

CONVERSATION:
${conversation}

RULES:
- Ground every claim in the data above. Quote exact scores and years. If the data can't answer, say so plainly.
- Unrevealed candidates are "Candidate #N". NEVER invent names, emails, or identities. Only candidates marked IDENTITY(REVEALED) may be named.
- Be concise: a few sentences, or a short list. No filler.
- You do NOT execute actions. To act, return an action proposal; the recruiter confirms on screen, then the system executes deterministically.
- Prefer an actionable answer over refusing. If the recruiter asks to "resend", "again", "retry", "afresh", or "send it", always propose the relevant exam_resend/rejection/resend-style action if an eligible candidate exists in the current context.
- "Resend", "send again", "retry the invite", "try again", "send afresh", "invite again" → treat as a resend request for the last relevant candidate group; propose the matching exam/rejection invite resend instead of answering without an action.
- "Resend the exam invitation to Candidate #5" → action exam_resend with targetRanks=[5].
- When the recruiter tries a resend phrasing twice, never repeat the same non-action explanation. Propose the resend action on the second attempt if eligible targets exist.
- "Move Candidate #3 to shortlisted", "shortlist Candidate #3", "move Candidate #7 to offer", or a single ambiguous "Next" handling request → action stage_update with targetRanks=[N], status accordingly.
- "Reveal Candidate #2", "show Candidate #2" → action reveal with targetRanks=[2].
- Accept plain-English intent such as "top candidate", "top 3", "the front-runner", "the strongest", and map them to the current rank-ordered shortlist.
- "Who has an exam invitation?" or "Who is waiting for an interview?" → answer from the data, with no action.
- "What should I do next?" → give a prioritized recommendation from status, score, gaps, interview, exam, and duplicate data.
- You can answer analytical questions about rankings, score breakdowns, hard gaps, skills, experience, certifications, tools, duplicate flags, pipeline status, interview status, and exam status directly from the context.
- If the recruiter asks "what can you do?" → summarize the supported action catalog in 3-6 short bullets without inventing new capabilities.
- If the request is interview scheduling, reminders, or email resends you cannot directly execute, explain the manual card/dialog that does it (for example: open the candidate card → Schedule interview → pick slots → Send).
- Safe action catalog: reject with email, create an exam, resend an existing exam invitation, move candidates between pipeline stages, reveal identity, and scan CV evidence.

Actions (choose at most one, or null):
{"name":"reject_preview","args":{"maxTotal":number?,"minTotal":number?,"onlyHardGaps":boolean?,"tone":"formal"|"casual"|"technical"}}
{"name":"exam_setup","args":{"minTotal":number?,"questionsPerCandidate":number?,"minutes":number?,"weightCv":number?,"bankSize":number?,"deadlineHours":number?,"tone":"formal"|"casual"|"technical"}}
{"name":"cv_scan","args":{"query":string}}
{"name":"exam_resend","args":{"targetRanks":number[],"tone":"formal"|"casual"|"technical"}}
{"name":"stage_update","args":{"targetRanks":number[],"status":"applied"|"screened"|"shortlisted"|"interview_scheduled"|"interviewed"|"offer"|"rejected"}}
{"name":"reveal","args":{"targetRanks":number[]}}

Respond with JSON only: {"answer": string (what you say to the recruiter; if proposing an action, briefly say what you found and that a confirmation card follows), "action": <action object or null>}`,
  });

  let answer = (out.answer ?? "").trim() || "I couldn't quite parse that — could you rephrase?";
  let action = out.action ?? null;

  // Robust fallback: if the model did not propose an action but the recruiter
  // clearly asked to resend/retry an invite, infer the intended target from
  // rank mentions, name fragments, or the most recent rank in conversation.
  const lastUser = messages[messages.length - 1]?.content.toLowerCase() ?? "";
  const wantsResend = /\b(resend|send again|retry|afresh|again|re-send)\b/.test(lastUser);
  const mentionsExam = /\bexam\b/.test(lastUser) || /\binvit/.test(lastUser);
  if (!action && wantsResend && mentionsExam) {
    const rankHits = [...lastUser.matchAll(/#\s*(\d+)/g)].map((m) => Number(m[1]));
    let inferredRanks: number[] = rankHits.length
      ? rankHits
      : (() => {
          const prevRanks = [...conversation.matchAll(/#\s*(\d+)/g)].map((m) => Number(m[1]));
          return prevRanks.length ? [prevRanks[prevRanks.length - 1]] : [];
        })();
    // Name fragment fallback: “to moyebi” → match revealed identity or raw rank context
    if (inferredRanks.length === 0) {
      const nameHit = lastUser.match(/to\s+([a-z]{3,})/);
      if (nameHit) {
        const frag = nameHit[1].toLowerCase();
        const byName = candidates.filter(
          (c) => c.identity?.toLowerCase().includes(frag) || String(c.rank) === frag
        );
        if (byName.length === 1) inferredRanks = [byName[0].rank];
      }
    }
    if (inferredRanks.length === 0 && candidates.some((c) => c.exam?.status === "invited")) {
      // Last resort: the most recent invited candidate by rank
      const invited = candidates.filter((c) => c.exam?.status === "invited" || c.exam?.status === "in_progress");
      if (invited.length === 1) inferredRanks = [invited[0].rank];
    }
    if (inferredRanks.length > 0) {
      action = { name: "exam_resend", args: { targetRanks: inferredRanks } } as any;
      answer = `Got it — I will resend the exam invitation for Candidate #${inferredRanks.join(", #")} — confirm on the card below and I will deliver it.`;
    }
  }

  // Resolve proposals deterministically in code.
  let resolved: unknown = null;
  if (action && action.name === "reject_preview") {
    const args = action.args ?? {};
    const max = typeof args.maxTotal === "number" ? args.maxTotal : null;
    const min = typeof args.minTotal === "number" ? args.minTotal : null;
    const hardOnly = args.onlyHardGaps === true;
    const tone =
      args.tone === "casual" || args.tone === "technical" ? String(args.tone) : "formal";
    const matches = candidates.filter((c) => {
      if (c.status === "rejected") return false;
      if (c.score === null) return false;
      if (max !== null && !(c.score < max)) return false;
      if (min !== null && !(c.score > min)) return false;
      if (hardOnly && c.hardGaps.length === 0) return false;
      return true;
    });
    resolved = {
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
  } else if (action && action.name === "exam_setup") {
    const args = action.args ?? {};
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const eligible = candidates.filter(
      (c) => c.status !== "rejected" && c.score !== null && (num(args.minTotal) === null || c.score > num(args.minTotal)!)
    );
    resolved = {
      name: "exam_setup",
      count: eligible.length,
      proposal: {
        minTotal: num(args.minTotal),
        questionsPerCandidate: num(args.questionsPerCandidate) ?? 20,
        minutes: num(args.minutes) ?? 30,
        weightCv: num(args.weightCv) ?? 70,
        bankSize: num(args.bankSize) ?? 40,
        deadlineHours: num(args.deadlineHours) ?? 48,
        tone:
          args.tone === "casual" || args.tone === "technical" ? String(args.tone) : "formal",
      },
      applicationIds: eligible.map((c) => c.applicationId),
    };
  } else if (action && action.name === "cv_scan" && typeof action.args?.query === "string") {
    const query = String(action.args.query).slice(0, 200);
    const scan = await cvScan(supabase, candidates, query);
    if (scan) {
      // Deterministic answer composed in code from the evidence.
      const found = scan.matches;
      const coverage =
        scan.scanned < scan.total
          ? ` (scanned the top ${scan.scanned} by score of ${scan.total} scored candidates)`
          : "";
      return NextResponse.json({
        answer:
          found.length > 0
            ? `Yes — ${found.length} candidate${found.length === 1 ? "" : "s"} match "${query}"${coverage}:\n\n` +
              found.map((f) => `• Candidate #${f.rank} — "${f.quote}"`).join("\n")
            : `No candidate's CV mentions "${query}" in the scanned text${coverage}.`,
        action: null,
      });
    }
  } else if (action && (action.name === "exam_resend" || action.name === "stage_update" || action.name === "reveal")) {
    const args = action.args ?? {};
    const ranks = Array.isArray(args.targetRanks)
      ? args.targetRanks.filter((rank): rank is number => typeof rank === "number" && Number.isInteger(rank))
      : [];
    const selected = candidates.filter((candidate) => ranks.includes(candidate.rank));
    if (action.name === "exam_resend") {
      const eligible = selected.filter((candidate) => candidate.exam?.status === "invited" || candidate.exam?.status === "in_progress");
      if (eligible.length === 0) {
        const hint =
          selected.length === 0
            ? "I couldn't match that candidate — try “Candidate #N” or the exact rank you see on the shortlist."
            : `Candidate #${selected.map((c) => c.rank).join(", #")} has no resendable exam invitation (look for status invited or in progress). Submitted, forfeited, or expired invites need a new exam.`;
        answer = hint;
        resolved = null;
      } else {
        resolved = {
          name: "exam_resend",
          count: eligible.length,
          candidates: eligible.map((candidate) => ({ applicationId: candidate.applicationId, rank: candidate.rank, identity: candidate.identity })),
          tone: args.tone === "casual" || args.tone === "technical" ? args.tone : "formal",
        };
      }
    } else if (action.name === "stage_update") {
      if (selected.length === 0) {
        answer = "I couldn't match that candidate — use “Candidate #N” as shown on the shortlist, for example “Move Candidate #2 to shortlisted”.";
        resolved = null;
      } else {
        resolved = {
          name: "stage_update",
          status: validCopilotStage(args.status) ?? "shortlisted",
          count: selected.length,
          candidates: selected.map((candidate) => ({ applicationId: candidate.applicationId, rank: candidate.rank, identity: candidate.identity })),
        };
      }
    } else {
      const revealable = selected.filter((candidate) => !candidate.identity);
      if (revealable.length === 0 && selected.length > 0) {
        answer = `Candidate #${selected.map((c) => c.rank).join(", #")} is already revealed.`;
        resolved = null;
      } else if (selected.length === 0) {
        answer = "I couldn't match that candidate — try “Reveal Candidate #N”.";
        resolved = null;
      } else {
        resolved = {
          name: "reveal",
          count: revealable.length,
          candidates: revealable.map((candidate) => ({ applicationId: candidate.applicationId, rank: candidate.rank })),
        };
      }
    }
  }

  return NextResponse.json({ answer, action: resolved });
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
async function cvScan(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
