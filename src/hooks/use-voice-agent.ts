"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * use-voice-agent — the browser half of the Deepgram Voice Copilot.
 *
 * One hook owns the whole voice session:
 *   start()  → mint session (/api/voice/session) → open the agent socket
 *              → send Settings (BYO-Groq think via /api/voice/llm) → stream
 *              mic PCM → speak TTS frames back with instant barge-in.
 *   stop()   → clean close.
 *
 * Events flow out through callbacks so the Copilot drawer stays in charge
 * of the chat: onTranscript (both sides), onFunctionAction (renders the
 * same confirm cards as typed chat), onStatus, onError.
 *
 * Guardrail: this hook never executes actions. Function calls are resolved
 * server-side into speak + card; the click happens in the drawer.
 */

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

interface VoiceSessionResponse {
  wsProxyUrl: string;
  voiceTicket: string;
  llmProxyUrl: string;
  session: {
    prompt: string;
    functions: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }[];
    greeting: string;
  };
}

interface UseVoiceAgentOpts {
  jobId: string;
  onTranscript: (role: "user" | "assistant", text: string) => void;
  onFunctionAction: (
    name: string,
    result: { speak: string; action: unknown }
  ) => void;
  onStatus?: (s: VoiceStatus) => void;
  onError?: (message: string) => void;
}

export function useVoiceAgent({ jobId, onTranscript, onFunctionAction, onStatus, onError }: UseVoiceAgentOpts) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [muted, setMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mutedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playHeadRef = useRef(0);
  const liveSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef<VoiceStatus>("idle");
  const activeRef = useRef(false);
  const callbacksRef = useRef({ onTranscript, onFunctionAction, onStatus, onError });
  callbacksRef.current = { onTranscript, onFunctionAction, onStatus, onError };

  const setStatusSafe = useCallback((s: VoiceStatus) => {
    statusRef.current = s;
    setStatus(s);
    callbacksRef.current.onStatus?.(s);
  }, []);

  const stopPlayback = useCallback(() => {
    // Barge-in: kill every scheduled/playing buffer the instant the user speaks.
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    for (const src of liveSourcesRef.current) {
      try { src.stop(); src.disconnect(); } catch { /* already ended */ }
    }
    liveSourcesRef.current.clear();
    playHeadRef.current = ctx.currentTime;
  }, []);

  const playAudioChunk = useCallback((data: ArrayBuffer) => {
    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = ctx;
    }
    const frames = new Int16Array(data);
    if (frames.length === 0) return;
    const buf = ctx.createBuffer(1, frames.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < frames.length; i++) ch[i] = frames[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Sequential scheduling; barge-in stops live sources outright.
    const startAt = Math.max(ctx.currentTime, playHeadRef.current) + 0.005;
    src.start(startAt);
    playHeadRef.current = startAt + buf.duration;
    liveSourcesRef.current.add(src);
    src.onended = () => liveSourcesRef.current.delete(src);
  }, []);

  const sendJson = useCallback((obj: unknown) => {
    wsRef.current?.send(JSON.stringify(obj));
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    setStatusSafe("connecting");
    try {
      // 1. Mint the session server-side.
      const sessRes = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const sess = (await sessRes.json()) as VoiceSessionResponse & { error?: string };
      if (!sessRes.ok) throw new Error(sess.error ?? "Voice session failed");

      // 2. Mic capture via AudioWorklet (16kHz PCM16 chunks).
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = mic;
      const ctx = new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      await ctx.audioWorklet.addModule("/voice-worklet.js");
      const node = new AudioWorkletNode(ctx, "voice-capture", {
        processorOptions: {},
      });
      workletNodeRef.current = node;
      node.port.postMessage({ type: "init", targetSampleRate: 16000 });
      // Mic frames → socket. Assigned before the socket opens so no frames
      // are dropped; the readyState guard holds them back until we're live.
      node.port.onmessage = (e: MessageEvent) => {
        if (wsRef.current?.readyState === WebSocket.OPEN && !mutedRef.current) {
          wsRef.current.send(e.data as ArrayBuffer);
        }
      };
      sourceRef.current = ctx.createMediaStreamSource(mic);
      sourceRef.current.connect(node);
      // The worklet's output is consumed via port messages — a zero-gain
      // sink keeps the graph pulled so process() always runs in Chrome.
      const silentSink = ctx.createGain();
      silentSink.gain.value = 0;
      node.connect(silentSink);
      silentSink.connect(ctx.destination);

      // 3. Open the agent socket through our Cloudflare worker proxy —
      // the ticket is the credential; the Deepgram key stays in the worker.
      const ws = new WebSocket(`${sess.wsProxyUrl}?ticket=${encodeURIComponent(sess.voiceTicket)}`);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        // 4. Settings: BYO-Groq brain through our proxy, Nova-3 ears, Flux voice.
        sendJson({
          type: "Settings",
          audio: {
            input: { encoding: "linear16", sample_rate: 16000 },
            output: { encoding: "linear16", sample_rate: 24000, container: "none" },
          },
          agent: {
            language: "en",
            listen: {
              provider: {
                type: "deepgram",
                model: "nova-3",
                // A conversational beat before the agent decides you're done —
                // cutting in at the default feels like interruption.
                endpointing: 650,
              },
            },
            think: {
              provider: { type: "groq", model: "openai/gpt-oss-120b", temperature: 0.4 },
              endpoint: {
                url: sess.llmProxyUrl,
                headers: { Authorization: `Bearer ${sess.voiceTicket}` },
              },
              prompt: sess.session.prompt,
              functions: sess.session.functions,
            },
            speak: { provider: { type: "deepgram", version: "v2", model: "flux-kit-en" } },
            greeting: sess.session.greeting,
          },
        });

        // Mic frames → socket wiring happens right after worklet creation.

        // KeepAlive while the mic is muted or idle (server closes silent sessions).
        keepAliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && statusRef.current !== "listening") {
            sendJson({ type: "KeepAlive" });
          }
        }, 8000);

        activeRef.current = true;
        setStatusSafe("listening");
      };

      ws.onmessage = (ev: MessageEvent) => {
        // Binary frame = TTS audio.
        if (ev.data instanceof ArrayBuffer) {
          playAudioChunk(ev.data);
          return;
        }
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        } catch {
          return;
        }
        switch (msg.type) {
          case "Welcome":
            break;
          case "SettingsApplied":
            break;
          case "ConversationText": {
            const role = msg.role === "assistant" ? "assistant" : "user";
            const text = String(msg.content ?? "");
            if (text) callbacksRef.current.onTranscript(role, text);
            break;
          }
          case "UserStartedSpeaking":
            stopPlayback();
            setStatusSafe("listening");
            break;
          case "AgentThinking":
            setStatusSafe("thinking");
            break;
          case "AgentStartedSpeaking":
            setStatusSafe("speaking");
            break;
          case "AgentAudioDone":
            setStatusSafe("listening");
            break;
          case "FunctionCallRequest": {
            const funcs = (msg.functions ?? []) as {
              id: string;
              name: string;
              arguments: string;
            }[];
            for (const fn of funcs) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(fn.arguments ?? "{}") as Record<string, unknown>;
              } catch {
                args = {};
              }
              fetch(`/api/jobs/${jobId}/voice/function`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: fn.name, arguments: args }),
              })
                .then(async (res) => (await res.json()) as { speak?: string; action?: unknown; error?: string })
                .then((result) => {
                  const speak =
                    result.speak ??
                    (result.error ?? "That action isn't available over voice right now.");
                  sendJson({
                    type: "FunctionCallResponse",
                    id: fn.id,
                    name: fn.name,
                    content: JSON.stringify({ spoken_result: speak }),
                  });
                  callbacksRef.current.onFunctionAction(fn.name, { speak, action: result.action ?? null });
                })
                .catch(() => {
                  sendJson({
                    type: "FunctionCallResponse",
                    id: fn.id,
                    name: fn.name,
                    content: JSON.stringify({ spoken_result: "Something went wrong handling that." }),
                  });
                });
            }
            break;
          }
          case "Error": {
            const desc = String(msg.description ?? "Voice error");
            callbacksRef.current.onError?.(desc);
            break;
          }
          case "Warning":
            console.warn("[voice] warning:", msg.description);
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        callbacksRef.current.onError?.("Voice connection failed — please try again.");
        setStatusSafe("error");
      };

      ws.onclose = () => {
        if (activeRef.current) cleanupAudio();
        activeRef.current = false;
        if (statusRef.current !== "error") setStatusSafe("idle");
      };
    } catch (err) {
      cleanupAudio();
      const message =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone access was blocked — allow it in your browser to talk."
          : err instanceof Error
            ? err.message
            : "Couldn't start the voice session.";
      callbacksRef.current.onError?.(message);
      setStatusSafe("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, playAudioChunk, setStatusSafe, stopPlayback]);

  const cleanupAudio = useCallback(() => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    playHeadRef.current = 0;
    liveSourcesRef.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    try {
      sendJson({ type: "CloseStream" });
    } catch {
      // socket may already be closing
    }
    wsRef.current?.close();
    wsRef.current = null;
    cleanupAudio();
    setStatusSafe("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupAudio, setStatusSafe]);

  const setMutedValue = useCallback((value: boolean) => {
    mutedRef.current = value;
    setMuted(value);
    workletNodeRef.current?.port.postMessage({ type: "mute", value });
  }, []);

  const injectText = useCallback(
    (text: string) => {
      // Manual utterance injection — used for the voice panel's quick actions.
      sendJson({ type: "InjectUserMessage", content: text });
    },
    [sendJson]
  );

  // Unmount safety.
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        try {
          sendJson({ type: "CloseStream" });
        } catch {
          // ignore
        }
        wsRef.current?.close();
        cleanupAudio();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, muted, start, stop, setMuted: setMutedValue, injectText };
}
