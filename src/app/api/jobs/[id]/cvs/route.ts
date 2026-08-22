import { NextResponse } from "next/server";

import { extractCvText, guessName, parseEmail } from "@/lib/cv/text";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CvUploadResult } from "@/lib/types";

const MAX_FILE_MB = 15;

/**
 * POST /api/jobs/[id]/cvs — bulk CV upload.
 *
 * FormData: files (repeatable) + optional emails (JSON map filename → email,
 * used on the second pass when no email could be parsed from a document).
 *
 * Per file: extract raw text → upload original to the PRIVATE `cvs` bucket →
 * create candidate + application (+ cv_extractions row staging the raw text
 * for Week 2). One bad file never aborts the batch; the response carries a
 * per-file report.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;

  // Authenticate and verify the job belongs to this recruiter (RLS makes the
  // select return nothing otherwise).
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

  let suppliedEmails: Record<string, string> = {};
  const rawEmails = form.get("emails");
  if (typeof rawEmails === "string" && rawEmails) {
    try {
      suppliedEmails = JSON.parse(rawEmails);
    } catch {
      suppliedEmails = {};
    }
  }

  // Service-role client: storage writes to the private bucket, plus the
  // duplicate check needs to see candidates that have no application for any
  // of this recruiter's jobs yet (RLS would hide them from the anon client).
  const admin = createAdminClient();
  const results: CvUploadResult[] = [];

  for (const file of files) {
    const filename = file.name;
    try {
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        throw new Error(`File is over ${MAX_FILE_MB} MB.`);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await extractCvText(buffer, filename);

      const email = (suppliedEmails[filename] ?? parseEmail(text) ?? "")
        .trim()
        .toLowerCase();
      if (!email) {
        results.push({ filename, status: "needs_email" });
        continue;
      }

      // Duplicate guard: reuse the existing candidate, flag the application.
      const { data: existing } = await admin
        .from("candidates")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      let candidateId: string;
      let duplicate = false;
      if (existing) {
        candidateId = existing.id;
        duplicate = true;
      } else {
        const { data: inserted, error: candErr } = await admin
          .from("candidates")
          .insert({ name: guessName(text), email, source: "upload" })
          .select("id")
          .single();
        if (candErr || !inserted) {
          throw new Error("Couldn't save the candidate record.");
        }
        candidateId = inserted.id;
      }

      const storagePath = `${jobId}/${crypto.randomUUID()}-${filename.replace(/[^\w.\-]+/g, "_")}`;
      const { error: storageErr } = await admin.storage
        .from("cvs")
        .upload(storagePath, buffer, {
          contentType: file.type || "application/octet-stream",
        });
      if (storageErr) {
        throw new Error("Couldn't store the CV file.");
      }

      const { data: application, error: appErr } = await admin
        .from("applications")
        .insert({
          candidate_id: candidateId,
          job_id: jobId,
          cv_file_path: storagePath,
          status: "applied",
          flagged_duplicate: duplicate,
        })
        .select("id")
        .single();
      if (appErr || !application) {
        throw new Error("Couldn't save the application record.");
      }

      // Stage the raw text now so Week 2's extract pass fills in the
      // structured fields on this same row (idempotent via skills IS NULL).
      await admin.from("cv_extractions").insert({
        application_id: application.id,
        raw_text: text,
      });

      results.push({ filename, status: "created", email, duplicate });
    } catch (err) {
      results.push({
        filename,
        status: "failed",
        message: err instanceof Error ? err.message : "Unknown error.",
      });
    }
  }

  return NextResponse.json({ results });
}
