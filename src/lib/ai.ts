import "server-only";

/**
 * Provider-agnostic LLM wrapper — the ONLY module that talks to an AI API.
 *
 * Primary: Groq (OpenAI-compatible, free tier). Switching or adding a
 * provider is a base-URL + key change (FALLBACK_AI_*), not a rewrite.
 * Every structured call uses temperature 0 and JSON mode (response_format),
 * with one retry per provider before failing over.
 */

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
// Groq's current largest instruct model (verified live: handles JSON mode +
// the spec prompts cleanly). Override with AI_MODEL if the lineup changes.
const DEFAULT_MODEL = process.env.AI_MODEL ?? "openai/gpt-oss-120b";
const REQUEST_TIMEOUT_MS = 45_000;

export class AiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** Seconds to wait before retrying, when the provider sends retry-after. */
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = "AiError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429s and 5xx are transient — they deserve backoff, not instant retries. */
function isTransient(err: unknown): boolean {
  return (
    err instanceof AiError &&
    (err.status === 429 || (err.status !== undefined && err.status >= 500))
  );
}

function backoffMs(err: unknown, attempt: number): number {
  const retryAfter = err instanceof AiError ? err.retryAfter : undefined;
  if (retryAfter && retryAfter > 0) return Math.min(retryAfter * 1000, 20_000);
  return Math.min(1500 * 2 ** (attempt - 1), 12_000);
}

interface Provider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function providers(): Provider[] {
  const list: Provider[] = [];
  if (process.env.GROQ_API_KEY) {
    list.push({
      name: "groq",
      baseUrl: process.env.GROQ_BASE_URL || DEFAULT_BASE_URL,
      apiKey: process.env.GROQ_API_KEY,
      model: DEFAULT_MODEL,
    });
  }
  if (process.env.FALLBACK_AI_BASE_URL && process.env.FALLBACK_AI_API_KEY) {
    list.push({
      name: "fallback",
      baseUrl: process.env.FALLBACK_AI_BASE_URL,
      apiKey: process.env.FALLBACK_AI_API_KEY,
      model: process.env.FALLBACK_AI_MODEL || DEFAULT_MODEL,
    });
  }
  return list;
}

export function aiConfigured(): boolean {
  return providers().length > 0;
}

interface ChatJsonOptions {
  /** Verbatim prompt text sent as the user message. */
  user: string;
  /** Short label used in error/log lines. */
  purpose: string;
  model?: string;
  maxTokens?: number;
}

/** Runs a JSON-mode chat completion and returns the parsed object. */
export async function chatJSON<T = unknown>(opts: ChatJsonOptions): Promise<T> {
  const configured = providers();
  if (configured.length === 0) {
    throw new AiError(
      "No AI provider configured — set GROQ_API_KEY (see README)."
    );
  }

  const failures: string[] = [];
  for (const provider of configured) {
    // Transient failures (429 rate limits, 5xx) back off exponentially —
    // honoring retry-after when sent — before failing over to the next
    // provider. Free-tier token budgets make 429s routine under load.
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await callOnce<T>(provider, opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${provider.name}#${attempt}: ${msg}`);
        if (isTransient(err) && attempt < 4) {
          await sleep(backoffMs(err, attempt));
          continue;
        }
        break;
      }
    }
  }
  throw new AiError(`AI call (${opts.purpose}) failed — ${failures.join(" | ")}`);
}

async function callOnce<T>(provider: Provider, opts: ChatJsonOptions): Promise<T> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model || provider.model,
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: opts.maxTokens ?? 2000,
      messages: [{ role: "user", content: opts.user }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiError(
      `${provider.name} HTTP ${res.status}: ${body.slice(0, 200)}`,
      res.status,
      Number(res.headers.get("retry-after")) || undefined
    );
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new AiError(`${provider.name} returned an empty completion`);
  }
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new AiError(`${provider.name} returned invalid JSON: ${content.slice(0, 200)}`);
  }
}

/** Runs an async mapper over items with at most `limit` in flight. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

/** Debug-gated prompt log; enable with AI_DEBUG=true. */
export function debugAI(label: string, payload: unknown): void {
  if (process.env.AI_DEBUG === "true") {
    console.log(`[ai:${label}] ${JSON.stringify(payload).slice(0, 2000)}`);
  }
}
