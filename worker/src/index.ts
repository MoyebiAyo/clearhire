/**
 * ClearHire scheduler worker — built ISOLATION-FIRST (spec Phase 5).
 *
 * Phase 1 (isolation): MODE unset or "log-only" — every cron fire only logs.
 *   Deploy, confirm via `wrangler tail` that both crons fire on schedule,
 *   then flip to live.
 * Phase 2 (live): MODE="live" —
 *   - the 15-minute cron calls POST APP_URL/api/reminders/run (reminders)
 *   - the 10-minute cron calls POST APP_URL/api/mailbox/poll (Gmail intake)
 *   Both carry the shared secret header the app requires.
 *
 * Voice proxy (GET /ws/agent?ticket=…) — pipes a browser WebSocket to the
 * Deepgram Voice Agent so the DEEPGRAM_API_KEY never reaches the client.
 * The ticket is the app's HMAC voice ticket (short-lived, job-bound) —
 * verified here with the same shared secret.
 */

export interface Env {
  APP_URL?: string;
  SHARED_SECRET?: string;
  MODE?: string;
  DEEPGRAM_API_KEY?: string;
}

function cronKind(cron: string): "reminders" | "mailbox" | "unknown" {
  // "0,15,30,45 * * * *"-style 15-minute cadence → reminders; 10-minute → mailbox.
  if (cron.includes("*/15")) return "reminders";
  if (cron.includes("*/10")) return "mailbox";
  return "unknown";
}

async function callApp(env: Env, path: string): Promise<string> {
  const res = await fetch(`${env.APP_URL}${path}`, {
    method: "POST",
    headers: { "x-worker-secret": env.SHARED_SECRET ?? "" },
  });
  const body = await res.text().catch(() => "");
  return `HTTP ${res.status} ${body.slice(0, 300)}`;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Verify the app's HMAC voice ticket (same scheme as src/lib/voice-ticket.ts). */
async function verifyVoiceTicket(ticket: string, secret: string): Promise<boolean> {
  const dot = ticket.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = ticket.slice(0, dot);
  let sig: Uint8Array;
  let payload: { exp?: number };
  try {
    sig = b64urlToBytes(ticket.slice(dot + 1));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
  } catch {
    return false;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    sig as unknown as ArrayBuffer,
    new TextEncoder().encode(body)
  );
}

/**
 * Frames can arrive as string, ArrayBuffer, Blob (Workers delivers binary
 * messages as Blobs in some paths) or a TypedArray view. Forwarding a Blob
 * raw makes the runtime stringify it ("[object Blob]") — Deepgram then
 * kills the session with UNPARSABLE_CLIENT_MESSAGE. Normalize to
 * string | Uint8Array before every send.
 */
async function normalizeFrame(data: unknown): Promise<string | Uint8Array> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  const blob = data as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (blob && typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  const view = data as ArrayBufferView;
  if (view && view.buffer instanceof ArrayBuffer) {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return String(data);
}

async function handleAgentProxy(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  if (!env.DEEPGRAM_API_KEY || !env.SHARED_SECRET) {
    return new Response("Voice proxy not configured", { status: 502 });
  }
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket") ?? "";
  if (!(await verifyVoiceTicket(ticket, env.SHARED_SECRET))) {
    return new Response("Invalid or expired voice session", { status: 401 });
  }

  const pair = new WebSocketPair();
  const client = (pair as unknown as { 0: WebSocket; 1: WebSocket })[0];
  const server = (pair as unknown as { 0: WebSocket; 1: WebSocket })[1];
  server.accept();

  // Buffer client frames that arrive before the upstream socket is open.
  const pendingToUpstream: (string | Uint8Array)[] = [];
  let upstream: WebSocket | null = null;
  let upstreamOpen = false;
  let closed = false;

  const closeAll = (code?: number, reason?: string) => {
    if (closed) return;
    closed = true;
    try { server.close(code, reason); } catch { /* already closed */ }
    try { upstream?.close(); } catch { /* already closed */ }
  };

  const openUpstream = () => {
    // Outbound WebSockets from a Worker use https:// + Upgrade header
    // (wss:// in fetch is not supported by the Workers runtime).
    fetch("https://agent.deepgram.com/v1/agent/converse", {
      headers: {
        Upgrade: "websocket",
        // Deepgram's browser-style auth: the credential rides the subprotocol.
        "Sec-WebSocket-Protocol": `token, ${env.DEEPGRAM_API_KEY}`,
      },
    })
      .then((res) => {
        const sock = (res as unknown as { webSocket?: WebSocket }).webSocket;
        if (!sock || res.status !== 101) {
          server.close(1011, "Deepgram refused the voice connection");
          closed = true;
          return;
        }
        upstream = sock;
        upstreamOpen = true;
        sock.accept();
        sock.addEventListener("message", async (ev) => {
          // Deepgram → browser: JSON text frames + binary TTS audio.
          if (closed) return;
          try {
            const frame = await normalizeFrame(ev.data);
            if (!closed) server.send(frame as never);
          } catch { /* upstream died mid-frame */ }
        });
        sock.addEventListener("close", (ev) => {
          closed = true;
          try { server.close(ev.code || 1000, ev.reason || undefined); } catch { /* client gone */ }
        });
        sock.addEventListener("error", () => {
          try { server.close(1011, "upstream error"); } catch { /* client gone */ }
        });
        // Flush anything the client queued during the handshake.
        for (const frame of pendingToUpstream.splice(0)) {
          try { sock.send(frame as never); } catch { /* upstream died mid-flush */ }
        }
      })
      .catch(() => {
        try { server.close(1011, "proxy failed"); } catch { /* client gone */ }
        closed = true;
      });
  };

  server.addEventListener("message", async (ev) => {
    let frame: string | Uint8Array;
    try {
      frame = await normalizeFrame(ev.data);
    } catch {
      return;
    }
    if (upstreamOpen && upstream) {
      try { upstream.send(frame as never); } catch { /* upstream gone */ }
    } else {
      pendingToUpstream.push(frame);
    }
  });
  server.addEventListener("close", () => closeAll());
  server.addEventListener("error", () => closeAll());

  openUpstream();
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws/agent") {
      return handleAgentProxy(request, env);
    }
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, mode: env.MODE ?? "log-only" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("ClearHire worker", { status: 200 });
  },

  async scheduled(
    event: { cron: string; scheduledTime: number },
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ) {
    const kind = cronKind(event.cron);
    const at = new Date(event.scheduledTime).toISOString();

    if (env.MODE !== "live" || !env.APP_URL || !env.SHARED_SECRET) {
      // ── Isolation phase: log only, touch nothing. ──
      console.log(`[clearhire][isolation] cron=${event.cron} kind=${kind} at=${at}`);
      return;
    }

    const path = kind === "reminders" ? "/api/reminders/run" : "/api/mailbox/poll";
    ctx.waitUntil(
      callApp(env, path)
        .then((out) => console.log(`[clearhire] ${kind} ${at} → ${out}`))
        .catch((err) =>
          console.error(`[clearhire] ${kind} ${at} FAILED: ${String(err)}`)
        )
    );
  },
};
