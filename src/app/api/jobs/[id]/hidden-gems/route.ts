import { NextResponse } from "next/server";

import { aiConfigured, aiUserMessage } from "@/lib/ai";
import { findHiddenGems } from "@/lib/copilot-brain";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * POST /api/jobs/[id]/hidden-gems — the AI "second look": scans the CV
 * text of candidates ranked OUTSIDE the top ranks and surfaces overlooked
 * evidence. Read-only; proposes nothing.
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
  if (!aiConfigured()) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });

  try {
    const result = await findHiddenGems(supabase, id);
    if (!result) {
      return NextResponse.json({
        gems: [],
        scanned: 0,
        total: 0,
        message: "Not enough ranked candidates beyond the top 5 for a second look yet.",
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: aiUserMessage(err) }, { status: 502 });
  }
}
