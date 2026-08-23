import "server-only";

import { randomUUID } from "crypto";

import { extractCvText, guessName, parseEmail } from "@/lib/cv/text";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The single CV intake pipeline shared by manual upload and Gmail intake
 * (spec Phase 1): extract text → private cvs bucket → candidate (deduped
 * by email) → application → cv_extractions row staging raw text for the
 * AI passes.
 */

export interface IngestInput {
  jobId: string;
  filename: string;
  buffer: Buffer;
  /** Known sender email (Gmail intake); for uploads parsed from CV text. */
  candidateEmail?: string;
  candidateName?: string | null;
  source: "upload" | "email";
  /** Supplied on the upload flow's second pass for email-less CVs. */
  suppliedEmail?: string;
  contentType?: string;
  maxBytes?: number;
}

export interface IngestResult {
  status: "created" | "needs_email" | "failed";
  email?: string;
  /** True duplicate: this email already applied to THIS job. */
  duplicate?: boolean;
  /** Returning candidate: known from OTHER jobs, new to this one. */
  returning?: boolean;
  message?: string;
  applicationId?: string;
  rawText?: string;
}

export const MAX_CV_MB = 15;

export async function ingestCv(input: IngestInput): Promise<IngestResult> {
  const admin = createAdminClient();
  try {
    const maxBytes = (input.maxBytes ?? MAX_CV_MB) * 1024 * 1024;
    if (input.buffer.byteLength > maxBytes) {
      throw new Error(`File is over ${input.maxBytes ?? MAX_CV_MB} MB.`);
    }

    const text = await extractCvText(input.buffer, input.filename);

    const email = (
      input.candidateEmail ||
      input.suppliedEmail ||
      parseEmail(text) ||
      ""
    )
      .trim()
      .toLowerCase();
    if (!email) {
      return { status: "needs_email", rawText: text };
    }

    const result = await persistCv({
      admin,
      jobId: input.jobId,
      filename: input.filename,
      buffer: input.buffer,
      contentType: input.contentType,
      text,
      email,
      name: input.candidateName ?? guessName(text),
      source: input.source,
    });
    return result;
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Unknown error.",
    };
  }
}

async function persistCv(args: {
  admin: SupabaseClient;
  jobId: string;
  filename: string;
  buffer: Buffer;
  contentType?: string;
  text: string;
  email: string;
  name: string | null;
  source: "upload" | "email";
}): Promise<IngestResult> {
  const { admin, jobId, filename, buffer, text, email, name, source } = args;

  const { data: existing } = await admin
    .from("candidates")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  // Returning vs true duplicate (spec 2.6): an email known from OTHER jobs
  // is a returning candidate (linked, not flagged); the same email applying
  // to THIS job twice is the real duplicate.
  let duplicate = false;
  let returning = false;
  let candidateId = existing?.id ?? null;
  if (existing) {
    const { data: priorApp } = await admin
      .from("applications")
      .select("id")
      .eq("candidate_id", existing.id)
      .eq("job_id", jobId)
      .maybeSingle();
    if (priorApp) duplicate = true;
    else returning = true;
  }
  if (!candidateId) {
    const inserted = await admin
      .from("candidates")
      .insert({ name, email, source })
      .select("id")
      .single();
    candidateId = inserted.data!.id;
  }

  const storagePath = `${jobId}/${randomUUID()}-${filename.replace(/[^\w.\-]+/g, "_")}`;
  const { error: storageErr } = await admin.storage
    .from("cvs")
    .upload(storagePath, buffer, {
      contentType: args.contentType || "application/octet-stream",
    });
  if (storageErr) throw new Error("Couldn't store the CV file.");

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
  if (appErr || !application) throw new Error("Couldn't save the application record.");

  await admin.from("cv_extractions").insert({
    application_id: application.id,
    raw_text: text,
  });

  return {
    status: "created",
    email,
    duplicate,
    returning,
    applicationId: application.id,
  };
}
