import { notFound } from "next/navigation";

import { ExamRunner } from "@/components/exam-runner";
import { resolveInvite, sweepTimedOut } from "@/lib/exam-state";

/**
 * Public exam page — the unguessable token in the URL is the candidate's
 * capability (same model as /schedule/[token]).
 */
export default async function ExamPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveInvite(token);
  if (!resolved) notFound();

  const status = await sweepTimedOut(resolved);
  const { invite, exam, job } = resolved;

  return (
    <main className="min-h-dvh bg-background">
      <ExamRunner
        token={token}
        initial={{
          status,
          jobTitle: job?.title ?? "this role",
          questions: exam.questions_per_candidate,
          minutes: exam.duration_minutes,
          deadlineISO: new Date(
            new Date(invite.created_at).getTime() +
              exam.start_deadline_hours * 3600_000
          ).toISOString(),
          startedAtISO: invite.started_at,
          endsAtISO: invite.started_at
            ? new Date(
                new Date(invite.started_at).getTime() +
                  exam.duration_minutes * 60_000
              ).toISOString()
            : null,
          violations: invite.violations,
          serverNowISO: new Date().toISOString(),
        }}
      />
    </main>
  );
}
