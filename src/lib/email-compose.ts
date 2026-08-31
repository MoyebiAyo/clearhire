/**
 * Deterministic email templates for copilot-proposed emails. Used by BOTH
 * the send route (/api/jobs/[id]/applications/email) and the proposal-time
 * preview (copilot-brain.buildEmailPreviews) so what the recruiter reviews
 * on the card is exactly what gets sent.
 */

export type EmailKind = "offer" | "interview" | "exam" | "reminder";

export interface ComposeDetails {
  interview?: string | null;
  location?: string | null;
  schedule?: string | null;
  exam?: string | null;
}

export function composeEmail(
  kind: EmailKind,
  name: string,
  title: string,
  org: string,
  details: ComposeDetails
): { subject: string; text: string } {
  const greeting = name || "there";
  if (kind === "offer") return { subject: `Offer update for ${title}`, text: `Hi ${greeting},\n\nWe are pleased to let you know that your application for ${title} has progressed to the offer stage. ${org} will follow up with the offer details and next steps.\n\nWarm regards,\n${org}` };
  if (kind === "exam") return { subject: `Your assessment link for ${title}`, text: `Hi ${greeting},\n\nPlease complete the assessment for ${title} here:\n${details.exam || "Your assessment link is in your invitation."}\n\nPlease follow the instructions on the assessment page.\n\nRegards,\n${org}` };
  if (kind === "reminder") return { subject: `Reminder: next step for ${title}`, text: `Hi ${greeting},\n\nThis is a friendly reminder about your next step for ${title}.${details.interview ? ` Your interview is scheduled for ${details.interview}.` : ""}\n\n${details.location || ""}\n${details.schedule ? `Scheduling link: ${details.schedule}` : ""}\n\nRegards,\n${org}` };
  return { subject: `Interview invitation for ${title}`, text: `Hi ${greeting},\n\nWe would like to continue your application for ${title}. Please choose a suitable interview time here:\n${details.schedule || "The scheduling link is in your invitation."}\n\nRegards,\n${org}` };
}
