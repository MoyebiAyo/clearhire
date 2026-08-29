import { NextResponse } from "next/server";

import { ingestCv } from "@/lib/intake";
import { createClient } from "@/lib/supabase/server";
import type { CvUploadResult } from "@/lib/types";

const MAX_FILE_MB = 15;
const MAX_FILES = 20;
const MAX_TOTAL_MB = 100;

/**
 * POST /api/jobs/[id]/cvs — bulk CV upload. FormData: files (repeatable) +
 * optional emails (JSON map filename → email for the second pass).
 * Per file: shared ingest pipeline (text extraction → private bucket →
 * candidate + application + staged raw text). One bad file never aborts
 * the batch; the response carries a per-file report.
 *
 * NOTE: this route is re-deployed explicitly — a Vercel upload-cache miss
 * once shipped a build without it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "open") {
    return NextResponse.json(
      { error: "This job is closed — reopen it to add CVs." },
      { status: 409 }
    );
  }

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were sent." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Upload at most ${MAX_FILES} CVs at once.` }, { status: 400 });
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_MB * 1024 * 1024) {
    return NextResponse.json({ error: `The combined upload is over ${MAX_TOTAL_MB} MB.` }, { status: 400 });
  }

  let suppliedEmails: Record<string, string> = {};
  const rawEmails = form.get("emails");
  if (typeof rawEmails === "string" && rawEmails) {
    try {
      suppliedEmails = JSON.parse(rawEmails);
    } catch {
      suppliedEmails = {};
    }
  }

  const results: CvUploadResult[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      results.push({
        filename: file.name,
        status: "failed",
        message: `File is over ${MAX_FILE_MB} MB.`,
      });
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const outcome = await ingestCv({
      jobId,
      filename: file.name,
      buffer,
      source: "upload",
      suppliedEmail: suppliedEmails[file.name],
      contentType: file.type || undefined,
    });
    results.push({
      filename: file.name,
      status: outcome.status,
      email: outcome.email,
      duplicate: outcome.duplicate,
      returning: outcome.returning,
      message: outcome.message,
    });
  }

  return NextResponse.json({ results });
}
