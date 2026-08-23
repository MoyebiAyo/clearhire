import { NextResponse } from "next/server";

import { aiUserMessage, chatJSON } from "@/lib/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/utils";

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
      "id, status, revealed_at, flagged_duplicate, cv_extractions(skills, experience_years, certifications, tools), scores(skills_score, experience_score, certifications_score, tools_score, total_score, gaps, rationale), exam_invites(status, score), candidates(name, email)"
    )
    .eq("job_id", id)
    .order("applied_at", { ascending: true });

  const candidates: BlindCandidate[] = ((appRows ?? []) as unknown as Record<string, unknown>[]).map(
    (r) => {
      const ext = one<Record<string, unknown>>(r.cv_extractions as unknown) ?? null;
      const sc = one<Record<string, unknown>>(r.scores as unknown) ?? null;
      const inv = one<Record<string, unknown>>(r.exam_invites as unknown) ?? null;
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
- "Reject everyone below 60" → action reject_preview with maxTotal=60 (below means strictly less than).
- "Set up an exam for those above 70" → action exam_setup with minTotal=70. Only fill config fields the recruiter stated; the system recommends the rest.
- Questions about CV content you can't see (leadership, achievements…) → action cv_scan with a tight query string.

ACTIONS (choose at most one, or null):
{"name":"reject_preview","args":{"maxTotal":number?,"minTotal":number?,"onlyHardGaps":boolean?,"tone":"formal"|"casual"|"technical"}}
{"name":"exam_setup","args":{"minTotal":number?,"questionsPerCandidate":number?,"minutes":number?,"weightCv":number?,"bankSize":number?,"deadlineHours":number?,"tone":"formal"|"casual"|"technical"}}
{"name":"cv_scan","args":{"query":string}}

Respond with JSON only: {"answer": string (what you say to the recruiter; if proposing an action, briefly say what you found and that a confirmation card follows), "action": <action object or null>}`,
  });

  const answer = (out.answer ?? "").trim() || "I couldn't quite parse that — could you rephrase?";
  const action = out.action ?? null;

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
    resolved = await cvScan(supabase, candidates, query);
    if (resolved) {
      // Deterministic answer composed in code from the evidence.
      const found = (resolved as { matches: { rank: number; quote: string }[] }).matches;
      return NextResponse.json({
        answer:
          found.length > 0
            ? `Yes — ${found.length} candidate${found.length === 1 ? "" : "s"} match "${query}":\n\n` +
              found.map((f) => `• Candidate #${f.rank} — "${f.quote}"`).join("\n")
            : `No candidate's CV mentions "${query}" in the extracted text.`,
        action: null,
      });
    }
  }

  return NextResponse.json({ answer, action: resolved });
}

/**
 * Deep CV scan for questions the structured data can't answer: pulls raw
 * extraction text (capped) for up to 12 scored, active candidates and asks
 * one bounded model pass for evidence. Blind — quotes contain role/skill
 * text only; identity never enters the prompt.
 */
async function cvScan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  candidates: BlindCandidate[],
  query: string
): Promise<{ matches: { rank: number; quote: string }[] } | null> {
  // Corpus stays small: Groq's free tier counts prompt + max_tokens
  // against a per-minute ceiling, so 8 CVs × 2200 chars ≈ 4.4k tokens.
  const eligible = candidates
    .filter((c) => c.status !== "rejected" && c.score !== null)
    .slice(0, 8);
  if (eligible.length === 0) return null;

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("cv_extractions")
    .select("application_id, raw_text")
    .in(
      "application_id",
      eligible.map((c) => c.applicationId)
    );
  const textByApp = new Map((rows ?? []).map((r) => [r.application_id, r.raw_text ?? ""]));

  const corpus = eligible
    .map((c) => {
      const text = (textByApp.get(c.applicationId) ?? "").slice(0, 2200);
      return `CANDIDATE #${c.rank}:\n${text}`;
    })
    .join("\n\n---\n\n");

  const out = await chatJSON<{ matches?: { rank?: number; found?: boolean; quote?: string }[] }>({
    purpose: "cv-scan",
    maxTokens: 1200,
    user: `Search these CV extracts and find evidence matching: "${query}".

Rules: only report candidates with a clear, quotable piece of evidence. The quote must be copied from the text (max 140 chars, trimmed sensibly). Ignore candidates with no evidence. Ranks are numbers like 4.

CV EXTRACTS:
${corpus}

Respond JSON only: {"matches": [{"rank": number, "found": true, "quote": string}]}`,
  });

  const matches = (out.matches ?? [])
    .filter((m) => m.found !== false && typeof m.rank === "number" && typeof m.quote === "string")
    .map((m) => ({ rank: Number(m.rank), quote: String(m.quote).slice(0, 140) }))
    .filter((m) => eligible.some((c) => c.rank === m.rank));
  return { matches };
}
