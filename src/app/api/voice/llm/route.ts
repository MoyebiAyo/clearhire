import { verifyVoiceTicket } from "@/lib/voice-ticket";

export const maxDuration = 60;

const ALLOWED_MODEL = "openai/gpt-oss-120b";

/**
 * The TTS speaks exactly what the model streams, and gpt-oss leaks
 * markdown ("**bold**" is pronounced "star star") even when told not to.
 * Scrub spoken-hostile markup from the stream BEFORE Deepgram sees it:
 * emphasis/backtick markers are removed outright, bullets and headings at
 * line start are unwrapped, and "#12" becomes "number 12".
 *
 * Deltas are token fragments — "#" or "-" arrive alone, so patterns can't
 * be matched within one delta. The sanitizer holds a line-start prefix
 * (and a trailing "#") until the next fragment makes it resolvable.
 */
function createSpeechSanitizer() {
  let atLineStart = true;
  let pending = "";
  const process = (src: string, atStart: boolean): string => {
    if (atStart) {
      const lead = src.match(/^(\s*)([-–•]|\*|#{1,6}|[-=_*]{3,})(\s+|$)/);
      if (lead) src = src.slice(lead[0].length);
    }
    const out = src.replace(/[*`]+/g, "");
    if (out.endsWith("#")) {
      // "#"+digit may split across deltas — hold the "#" one turn.
      pending = "#";
      return out.slice(0, -1);
    }
    return out.replace(/#(?=\d)/g, "number ");
  };
  return {
    push(fragment: string): string {
      const src = pending + fragment;
      pending = "";
      // A line-start run of only marker characters may still be an
      // unfinished bullet/heading — hold it until we can judge it.
      if (atLineStart && src.length > 0 && /^[\s\-*#–•=_]*$/.test(src)) {
        pending = src;
        return "";
      }
      const out = process(src, atLineStart);
      atLineStart = out.endsWith("\n") || (atLineStart && out.length === 0);
      return out;
    },
    flush(): string {
      const rest = pending;
      pending = "";
      return rest.replace(/[*`#]+/g, " ").replace(/^\s+/, "");
    },
  };
}

/** Wrap Groq's SSE stream so every content delta is spoken-safe. */
function scrubbedStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const sanitize = createSpeechSanitizer();
  let buf = "";

  const scrubLine = (line: string): string => {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) return line;
    try {
      const msg = JSON.parse(line.slice(6)) as {
        choices?: { delta?: { content?: string | null } }[];
      };
      for (const choice of msg.choices ?? []) {
        if (typeof choice.delta?.content === "string" && choice.delta.content.length > 0) {
          choice.delta.content = sanitize.push(choice.delta.content);
        }
      }
      return "data: " + JSON.stringify(msg);
    } catch {
      return line;
    }
  };

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) controller.enqueue(encoder.encode(scrubLine(line) + "\n"));
      },
      flush(controller) {
        if (buf) controller.enqueue(encoder.encode(scrubLine(buf) + "\n"));
        const tail = sanitize.flush();
        if (tail) {
          controller.enqueue(
            encoder.encode(
              "data: " + JSON.stringify({ choices: [{ delta: { content: tail } }] }) + "\n\n"
            )
          );
        }
      },
    })
  );
}

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
  if (typeof body.max_tokens !== "number" || (body.max_tokens as number) > 400) {
    body.max_tokens = 400;
  }
  // gpt-oss streams its chain-of-thought in delta.reasoning, which eats the
  // max_tokens budget BEFORE the spoken answer (observed: 283 of 300 tokens
  // went to thinking). Voice needs short final answers, not deep reasoning.
  body.reasoning_effort = "low";

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
    // Two tries per key: Groq's token window often resets in under a
    // second, so a brief wait on a 429 is usually all a live conversation
    // needs. Anything longer goes to the next key — voice can't wait out
    // a real quota window.
    for (let attempt = 0; attempt < 2; attempt++) {
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
        if (request.signal.aborted) {
          // Deepgram hung up on this think call — do NOT keep calling Groq
          // for a conversation turn that no longer exists.
          return new Response(null, { status: 499 });
        }
        console.error(`[voice-llm] groq network failure: ${String(err).slice(0, 160)}`);
        lastStatus = 504;
        break;
      }

      if (groqRes.ok) {
        // Stream the completion straight through, with markdown scrubbed
        // from every delta so the TTS never pronounces markup.
        return new Response(scrubbedStream(groqRes.body!), {
          status: 200,
          headers: {
            "Content-Type": groqRes.headers.get("content-type") ?? "application/json",
            "Cache-Control": "no-store",
          },
        });
      }

      lastStatus = groqRes.status;
      const errBody = await groqRes.text().catch(() => "");
      console.error(`[voice-llm] groq error ${groqRes.status} (attempt ${attempt + 1}): ${errBody.slice(0, 200)}`);
      // A malformed request fails on every key — stop immediately.
      if (groqRes.status === 400 || groqRes.status === 422) {
        return new Response(
          JSON.stringify({ error: { message: "LLM provider error", type: "upstream_error" } }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
      // 429 with a short reset: wait once, then retry this same key.
      const retryAfter = Number(groqRes.headers.get("retry-after"));
      if (groqRes.status === 429 && attempt === 0 && Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 2) {
        await new Promise((r) => setTimeout(r, retryAfter * 1000 + 150));
        continue;
      }
      break; // next key
    }
  }

  return new Response(
    JSON.stringify({ error: { message: "LLM provider error", type: "upstream_error" } }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
