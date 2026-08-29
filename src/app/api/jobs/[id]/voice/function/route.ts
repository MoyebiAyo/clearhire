import { NextResponse } from "next/server";

import { buildCopilotContext, cvScan, resolveExamSetup, resolveRejectPreview } from "@/lib/copilot-brain";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST /api/jobs/[id]/voice/function { name, arguments } — the Deepgram
 * voice agent's function resolver. Same deterministic resolvers as the
 * typed Copilot, but the result carries a `speak` string (short, spoken)
 * alongside the same action card payload the drawer already renders.
 *
 * Guardrail: this PROPOSES only. Nothing executes here — the recruiter's
 * click on the card remains the single confirmation.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; arguments?: Record<string, unknown> | string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // handled below
  }
  const name = body.name ?? "";
  let args: Record<string, unknown> = {};
  if (typeof body.arguments === "string") {
    try {
      args = JSON.parse(body.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }
  } else if (body.arguments && typeof body.arguments === "object") {
    args = body.arguments;
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const { candidates } = await buildCopilotContext(supabase, id);

  if (name === "propose_rejection") {
    const resolved = resolveRejectPreview(candidates, args) as {
      count: number;
      tone: string;
      candidates: { rank: number; total: number | null }[];
    };
    const ranks = resolved.candidates.map((c) => `#${c.rank}`).join(", ");
    const speak =
      resolved.count === 0
        ? "Nobody matches that criteria, so there's nothing to reject."
        : `I've prepared a rejection for ${resolved.count} candidate${resolved.count === 1 ? "" : "s"} — ${ranks}. Review the card on screen and confirm when ready. Rejection emails go out with it, and it's undoable.`;
    return NextResponse.json({ speak, action: resolved });
  }

  if (name === "propose_exam") {
    const resolved = resolveExamSetup(candidates, args) as {
      count: number;
      applicationIds: string[];
      proposal: { minTotal: number | null; questionsPerCandidate: number; minutes: number; weightCv: number };
    };
    const speak =
      resolved.count === 0
        ? "There are no scored, active candidates above that bar yet — score the shortlist first."
        : `Exam proposal ready for ${resolved.count} candidate${resolved.count === 1 ? "" : "s"}: ${resolved.proposal.questionsPerCandidate} questions, ${resolved.proposal.minutes} minutes, final score weighted ${resolved.proposal.weightCv} percent CV. Check the card on screen and confirm to generate and invite.`;
    return NextResponse.json({ speak, action: resolved });
  }

  if (name === "scan_cv_evidence") {
    const query = String(args.query ?? "").slice(0, 200);
    if (!query) {
      return NextResponse.json({ speak: "What should I look for in the CVs?", action: null });
    }
    const scan = await cvScan(candidates, query);
    if (!scan) {
      return NextResponse.json({
        speak: "There are no scored candidates to scan yet.",
        action: null,
      });
    }
    const coverage =
      scan.scanned < scan.total
        ? ` I scanned the top ${scan.scanned} by score of ${scan.total}.`
        : "";
    const speak =
      scan.matches.length > 0
        ? `I found ${scan.matches.length === 1 ? "one match" : `${scan.matches.length} matches`} for ${query}. ${scan.matches
            .slice(0, 4)
            .map((m) => `Candidate number ${m.rank}: ${m.quote.replace(/\s+/g, " ").slice(0, 110)}`)
            .join(". ")}.${coverage} The full quotes are on screen.`
        : `No candidate's CV mentions ${query} in the scanned text.${coverage}`;
    return NextResponse.json({ speak, action: null, evidence: scan });
  }

  return NextResponse.json(
    { speak: "That action isn't available over voice yet.", action: null },
    { status: 400 }
  );
}
