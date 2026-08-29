import { NextResponse } from "next/server";

import { buildContextLines, buildCopilotContext } from "@/lib/copilot-brain";
import { createClient } from "@/lib/supabase/server";
import { createVoiceTicket } from "@/lib/voice-ticket";

export const maxDuration = 60;

/**
 * POST /api/voice/session { jobId } — mint everything a browser voice
 * session needs: the blind system prompt for the think step, the voice
 * ticket (authorizes Deepgram → our Groq proxy), and the WebSocket proxy
 * URL. Audio flows browser → Cloudflare worker → Deepgram, so the
 * DEEPGRAM_API_KEY and GROQ keys never reach the client.
 */

const VOICE_FUNCTIONS = [
  {
    name: "propose_rejection",
    description:
      "Prepare a rejection proposal for the recruiter to confirm on screen. Use whenever the recruiter asks to reject candidates by score or criteria, e.g. 'reject everyone below 60'. NEVER rejects anything itself.",
    parameters: {
      type: "object",
      properties: {
        maxTotal: { type: "number", description: "Reject candidates whose total is strictly below this number." },
        minTotal: { type: "number", description: "Only include candidates whose total is strictly above this number." },
        onlyHardGaps: { type: "boolean", description: "Only candidates missing a hard requirement." },
        tone: { type: "string", enum: ["formal", "casual", "technical"] },
      },
    },
  },
  {
    name: "propose_exam",
    description:
      "Prepare an AI exam proposal (questions written from the job description) for candidates above a score bar. Use for 'set up an exam for everyone above 70'. NEVER creates the exam itself.",
    parameters: {
      type: "object",
      properties: {
        minTotal: { type: "number", description: "Only candidates whose total score is strictly above this number." },
      },
    },
  },
  {
    name: "scan_cv_evidence",
    description:
      "Search candidates' full CV texts for evidence answering a question the structured scores can't, e.g. leadership, achievements, team sizes. Returns quoted evidence per candidate rank.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for in the CV texts, e.g. 'led a team'." },
      },
      required: ["query"],
    },
  },
] as const;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let jobId: string | undefined;
  try {
    jobId = ((await request.json()) as { jobId?: string }).jobId;
  } catch {
    // handled below
  }
  if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, jd_text, weight_skills, weight_experience, weight_certifications, weight_tools")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const { candidates } = await buildCopilotContext(supabase, jobId);
  const contextLines = buildContextLines(candidates);
  const identityExposed = candidates.filter((c) => c.identity).length;
  console.log(`[blind-audit] voice job=${jobId} candidates=${candidates.length} identityExposed=${identityExposed}`);

  const prompt = `You are ClearHire Copilot's VOICE — the spoken interface to one job's hiring shortlist. You are in a live, natural spoken conversation with the recruiter.

JOB: ${job.title}
RUBRIC WEIGHTS: skills ${job.weight_skills}%, experience ${job.weight_experience}%, certifications ${job.weight_certifications}%, tools ${job.weight_tools}%
JOB DESCRIPTION (excerpt): ${job.jd_text.slice(0, 1200)}

CANDIDATES (blind — de-identified; ranked by current score):
${contextLines || "(no applications yet)"}

HOW TO CONVERSE:
- This is a real-time spoken dialogue, not a Q&A box. Talk like a helpful colleague sitting next to the recruiter: contractions, natural connectors ("So—", "Well,"), relaxed rhythm. NEVER reintroduce yourself or repeat the greeting — you already said hello; just answer.
- Answer the actual question FIRST, in your first sentence. Then, only when it moves the hiring decision forward, end with one short follow-up question ("Want me to prep a rejection for them?"). Don't ask something every turn.
- Remember what was already said in this conversation and build on it — never ask for information the recruiter just gave you, and refer back naturally ("like I mentioned…").
- If you need a moment (a function call or CV scan), start with a quick spoken beat — "Let me check the shortlist…" — so the silence never feels dead.
- Match the recruiter's energy: if they're brief, be brief. If they're chatty, warm is fine. Small amounts of personality are welcome; never at the cost of accuracy.

HOW TO SPEAK:
- Your replies are SPOKEN aloud. Keep them to 1–3 short sentences. Plain words, no markdown, no lists, no emoji.
- Ground every claim in the data above; quote exact scores and years.
- Unrevealed candidates are "Candidate #N". NEVER invent names or emails. NEVER speak an email address aloud, even for revealed candidates. Only candidates the data marks as revealed may be named — and even then, prefer first names.
- You PROPOSE, you never execute. For rejection, exam, or CV-evidence requests call the matching function, then say a confirmation card is waiting on screen. Never say you rejected, sent, or created anything yourself.
- scan_cv_evidence is for anything about the actual CV text — leadership, achievements, team sizes. Otherwise answer directly from the data.
- If asked something unrelated to this job's hiring, say briefly that you focus on this shortlist, then offer what you can do.
- If you truly can't help, say so in one sentence and suggest the typed chat.`;

  // Voice credentials: the browser connects to the Cloudflare worker's WS
  // proxy with this ticket; the worker holds the real Deepgram key. (The
  // /v1/auth/grant token path was tested and rejected on the agent socket
  // for this account, so the proxy is the credential instead.)
  const proxyOrigin = "wss://clearhire-scheduler.clearhire-scheduler.workers.dev";

  return NextResponse.json({
    wsProxyUrl: `${proxyOrigin}/ws/agent`,
    voiceTicket: createVoiceTicket(user.id, jobId),
    llmProxyUrl: `${new URL(request.url).origin}/api/voice/llm`,
    session: {
      prompt,
      functions: VOICE_FUNCTIONS,
      greeting: `Hey, I'm your copilot for the ${job.title} shortlist. Who do you want to look at first?`,
    },
  });
}
