import { verifyVoiceTicket } from "@/lib/voice-ticket";

export const maxDuration = 60;

const ALLOWED_MODEL = "openai/gpt-oss-120b";

/**
 * POST /api/voice/llm — OpenAI-compatible passthrough for the Deepgram
 * voice agent's "think" step. Deepgram's servers call this with the
 * session's voice ticket; we validate it, swap in the real Groq key, and
 * stream the completion straight through. The Groq key never reaches the
 * browser, and the model is whitelisted to ours.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const ticket = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const ticketData = ticket ? verifyVoiceTicket(ticket) : null;
  if (!ticketData) {
    return new Response(JSON.stringify({ error: "Invalid or expired voice session." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Whitelist the model — the voice brain is always ours.
  body.model = ALLOWED_MODEL;
  // Keep agent turns snappy; huge completions aren't useful when spoken.
  if (typeof body.max_tokens !== "number" || (body.max_tokens as number) > 300) {
    body.max_tokens = 300;
  }

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!groqRes.ok) {
    const errBody = await groqRes.text().catch(() => "");
    console.error(`[voice-llm] groq error ${groqRes.status}: ${errBody.slice(0, 200)}`);
    return new Response(
      JSON.stringify({ error: { message: "LLM provider error", type: "upstream_error" } }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Stream the completion (SSE or plain JSON) straight through.
  return new Response(groqRes.body, {
    status: 200,
    headers: {
      "Content-Type": groqRes.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}
