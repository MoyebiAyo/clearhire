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
 */

export interface Env {
  APP_URL?: string;
  SHARED_SECRET?: string;
  MODE?: string;
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

export default {
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
