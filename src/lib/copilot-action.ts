export type CopilotStage =
  | "applied"
  | "screened"
  | "shortlisted"
  | "interview_scheduled"
  | "interviewed"
  | "offer"
  | "rejected";

export function validCopilotStage(value: unknown): CopilotStage | null {
  const stages: CopilotStage[] = ["applied", "screened", "shortlisted", "interview_scheduled", "interviewed", "offer", "rejected"];
  return typeof value === "string" && stages.includes(value as CopilotStage)
    ? value as CopilotStage
    : null;
}

export function confirmedEmailIntent(conversation: string, lastUser: string): {
  kind: "offer" | "interview" | "exam" | "reminder";
  rank: number;
} | null {
  if (!/\b(go ahead|send it|confirm|proceed|yes|do it)\b/i.test(lastUser)) return null;
  const context = conversation.toLowerCase();
  const ranks = [...context.matchAll(/(?:candidate\s*)?#\s*(\d+)/g)].map((match) => Number(match[1]));
  const rank = ranks.at(-1);
  if (!rank) return null;
  if (/offer email|offer stage|hire candidate/.test(context)) return { kind: "offer", rank };
  if (/exam (?:email|invite|link)|assessment (?:email|invite|link)/.test(context)) return { kind: "exam", rank };
  if (/interview (?:email|invite|link)/.test(context)) return { kind: "interview", rank };
  if (/remind|reminder/.test(context)) return { kind: "reminder", rank };
  return null;
}
