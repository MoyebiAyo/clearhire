import { NextResponse } from "next/server";

import { chatJSON } from "@/lib/ai";
import {
  buildContextLines,
  buildCopilotContext,
  buildEmailPreviews,
  cvScan,
  resolveExamSetup,
  resolveRejectPreview,
} from "@/lib/copilot-brain";
import type { EmailKind } from "@/lib/email-compose";
import { createClient } from "@/lib/supabase/server";
import { confirmedEmailIntent, validCopilotStage } from "@/lib/copilot-action";

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

  // Fresh, blind context every turn (shared with the voice copilot).
  const { candidates } = await buildCopilotContext(supabase, id);

  const identityExposed = candidates.filter((c) => c.identity).length;
  console.log(
    `[blind-audit] copilot job=${id} candidates=${candidates.length} identityExposed=${identityExposed}`
  );

  const contextLines = buildContextLines(candidates);

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
- "Send the offer email to Candidate #6", "send the interview invite", "remind Candidate #2", or "send the exam link" → action email_send with kind="offer"|"interview"|"reminder"|"exam" and targetRanks=[N].
- Accept plain-English intent such as "top candidate", "top 3", "the front-runner", "the strongest", and map them to the current rank-ordered shortlist.
- "Who has an exam invitation?" or "Who is waiting for an interview?" → answer from the data, with no action.
- "What should I do next?" → give a prioritized recommendation from status, score, gaps, interview, exam, and duplicate data.
- You can answer analytical questions about rankings, score breakdowns, hard gaps, skills, experience, certifications, tools, duplicate flags, pipeline status, interview status, and exam status directly from the context.
- If the recruiter asks "what can you do?" → summarize the supported action catalog in 3-6 short bullets without inventing new capabilities.
- If the request is interview scheduling, reminders, or email resends you cannot directly execute, explain the manual card/dialog that does it (for example: open the candidate card → Schedule interview → pick slots → Send).
- Safe action catalog: reject with email, create an exam, send or resend offer/interview/exam/reminder emails, move candidates between pipeline stages, reveal identity, and scan CV evidence.

Actions (choose at most one, or null):
{"name":"reject_preview","args":{"maxTotal":number?,"minTotal":number?,"onlyHardGaps":boolean?,"tone":"formal"|"casual"|"technical"}}
{"name":"exam_setup","args":{"minTotal":number?,"questionsPerCandidate":number?,"minutes":number?,"weightCv":number?,"bankSize":number?,"deadlineHours":number?,"tone":"formal"|"casual"|"technical"}}
{"name":"cv_scan","args":{"query":string}}
{"name":"exam_resend","args":{"targetRanks":number[],"tone":"formal"|"casual"|"technical"}}
{"name":"stage_update","args":{"targetRanks":number[],"status":"applied"|"screened"|"shortlisted"|"interview_scheduled"|"interviewed"|"offer"|"rejected"}}
{"name":"reveal","args":{"targetRanks":number[]}}
{"name":"email_send","args":{"kind":"offer"|"interview"|"exam"|"reminder","targetRanks":number[]}}

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
  // Follow-up confirmations such as “go ahead” must preserve the prior email
  // intent. Rebuild it from conversation text instead of trusting the model to
  // repeat the structured action on every turn.
  const confirmed = confirmedEmailIntent(conversation, lastUser);
  if (!action && confirmed) {
    action = { name: "email_send", args: { kind: confirmed.kind, targetRanks: [confirmed.rank] } };
    answer = `Ready to send the ${confirmed.kind} email to Candidate #${confirmed.rank}. Confirm on the card below.`;
  }

  // Resolve proposals deterministically in code.
  let resolved: unknown = null;
  if (action && action.name === "reject_preview") {
    resolved = resolveRejectPreview(candidates, action.args ?? {});
  } else if (action && action.name === "exam_setup") {
    resolved = resolveExamSetup(candidates, action.args ?? {});
  } else if (action && action.name === "cv_scan" && typeof action.args?.query === "string") {
    const query = String(action.args.query).slice(0, 200);
    const scan = await cvScan(candidates, query);
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
  } else if (action && (action.name === "exam_resend" || action.name === "stage_update" || action.name === "reveal" || action.name === "email_send")) {
    const args = action.args ?? {};
    const ranks = Array.isArray(args.targetRanks)
      ? args.targetRanks.filter((rank): rank is number => typeof rank === "number" && Number.isInteger(rank))
      : [];
    const selected = candidates.filter((candidate) => ranks.includes(candidate.rank));
    if (action.name === "email_send") {
      const kind = ["offer", "interview", "exam", "reminder"].includes(String(args.kind)) ? String(args.kind) : "reminder";
      const selectedCandidates = selected.map((candidate) => ({ applicationId: candidate.applicationId, rank: candidate.rank, identity: candidate.identity }));
      // Reviewable draft on the card (same template the send route sends).
      const { data: recruiter } = await supabase.from("recruiters").select("org_name").eq("id", user.id).maybeSingle();
      const preview = await buildEmailPreviews(
        supabase,
        { jobId: id, jobTitle: job.title, origin: new URL(request.url).origin, kind: kind as EmailKind, org: recruiter?.org_name || "the hiring team" },
        selectedCandidates
      );
      resolved = { name: "email_send", kind, count: selected.length, candidates: selectedCandidates, preview };
    } else if (action.name === "exam_resend") {
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
