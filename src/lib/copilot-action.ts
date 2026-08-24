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
