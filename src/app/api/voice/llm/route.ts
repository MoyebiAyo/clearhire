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

  // Same key chain as lib/ai.ts. Barge-in and the typed Copilot share the
  // primary key, so bursts of concurrent think calls hit Groq's rate limit
  // (verified: 2 of 6 parallel calls 429). Voice can't wait out a
  // Retry-After — fail over to the next key immediately instead.
  const keyChain = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_FALLBACK_API_KEY,
    process.env.GROQ_FALLBACK_API_KEY_2,
  ].filter((k): k is string => Boolean(k));
  if (keyChain.length === 0) {
    return new Response(JSON.stringify({ error: "LLM provider not configured." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = JSON.stringify(body);
  let lastStatus = 502;
  for (const key of keyChain) {
    let groqRes: Response;
    try {
      groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: payload,
        // If Deepgram cancels the think call (barge-in), release the Groq
        // request too — otherwise every interruption leaves a phantom call
        // burning the rate limit for up to 45s.
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
      });
    } catch (err) {
      console.error(`[voice-llm] groq network failure: ${String(err).slice(0, 160)}`);
      lastStatus = 504;
      continue;
    }

    if (groqRes.ok) {
      // Stream the completion (SSE or plain JSON) straight through.
      return new Response(groqRes.body, {
        status: 200,
        headers: {
          "Content-Type": groqRes.headers.get("content-type") ?? "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    lastStatus = groqRes.status;
    const errBody = await groqRes.text().catch(() => "");
    console.error(`[voice-llm] groq error ${groqRes.status}: ${errBody.slice(0, 200)}`);
    // A malformed request fails on every key — stop immediately.
    if (groqRes.status === 400 || groqRes.status === 422) break;
  }

  return new Response(
    JSON.stringify({ error: { message: "LLM provider error", type: "upstream_error" } }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
