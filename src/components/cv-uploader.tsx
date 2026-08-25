"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileUp,
  Inbox,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CvUploadResult } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

const MAX_FILE_MB = 15;

function isSupported(file: File) {
  return /\.(pdf|docx)$/i.test(file.name);
}

export function CvUploader({
  jobId,
  jobStatus,
  jobTitle,
  gmail,
}: {
  jobId: string;
  jobStatus: "open" | "closed";
  jobTitle: string;
  gmail: { connected: boolean; address: string | null };
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [results, setResults] = useState<CvUploadResult[]>([]);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});

  const needsEmail = results.filter((r) => r.status === "needs_email");
  const pendingFiles = needsEmail
    .map((r) => files.find((f) => f.name === r.filename))
    .filter((f): f is File => Boolean(f));

  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = [];
    let rejected = 0;
    for (const file of Array.from(incoming)) {
      if (!isSupported(file)) {
        rejected++;
        continue;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        toast.error(`"${file.name}" is over ${MAX_FILE_MB} MB — skip it or compress it.`);
        continue;
      }
      accepted.push(file);
    }
    if (rejected > 0) {
      toast.error(
        `${rejected} file${rejected === 1 ? "" : "s"} skipped — only PDF and DOCX are supported.`
      );
    }
    if (accepted.length > 0) {
      setFiles((prev) => {
        const names = new Set(prev.map((f) => f.name));
        return [...prev, ...accepted.filter((f) => !names.has(f.name))];
      });
    }
  }

  async function postFiles(postFiles: File[], emails?: Record<string, string>) {
    const form = new FormData();
    postFiles.forEach((f) => form.append("files", f));
    if (emails) form.append("emails", JSON.stringify(emails));

    const res = await fetch(`/api/jobs/${jobId}/cvs`, { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error ?? "Upload failed. Please try again.");
      return;
    }
    return body.results as CvUploadResult[];
  }

  async function onUpload() {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const res = await postFiles(files);
      if (!res) return;
      setResults(res);
      setEmailDrafts({});

      const created = res.filter((r) => r.status === "created");
      const failed = res.filter((r) => r.status === "failed");
      const pending = res.filter((r) => r.status === "needs_email");

      if (created.length > 0) {
        toast.success(
          `${created.length} CV${created.length === 1 ? "" : "s"} added`,
          { description: "Raw text extracted and stored, ready for scoring." }
        );
        setFiles((prev) => prev.filter((f) => !created.some((c) => c.filename === f.name)));
        router.refresh();
      }
      if (pending.length > 0) {
        toast.warning(`${pending.length} CV${pending.length === 1 ? "" : "s"} need an email`, {
          description: "We couldn't find an email address in the document — add one below.",
        });
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} file${failed.length === 1 ? "" : "s"} failed`, {
          description: failed[0]?.message,
        });
      }
    } catch {
      toast.error("Network error during upload — your files are still listed, try again.");
    } finally {
      setUploading(false);
    }
  }

  /** Per-job inbox pull: scan the connected Gmail for CV emails whose
   * subject matches this job and ingest them alongside uploads. Idempotent
   * server-side — pulling twice never duplicates a candidate. */
  async function pullFromGmail() {
    setPulling(true);
    try {
      const res = await fetch("/api/mailbox/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Pull failed. Please try again.");
        return;
      }
      const m = body as {
        ingested: number;
        scanned: number;
        skipped: number;
        errors: string[];
      };
      if (m.errors?.length > 0) {
        toast.error("Gmail pull failed", { description: m.errors[0] });
        return;
      }
      if (m.ingested > 0) {
        toast.success(`${m.ingested} CV${m.ingested === 1 ? "" : "s"} pulled from Gmail`, {
          description: "Staged with your uploads below — ready to extract.",
        });
        router.refresh();
      } else {
        toast.info("No new CV emails for this job", {
          description: `${m.scanned} recent message${m.scanned === 1 ? "" : "s"} with attachments checked — emails already processed are skipped.`,
        });
      }
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setPulling(false);
    }
  }

  async function onSaveWithEmails() {
    const emails: Record<string, string> = {};
    let invalid = false;
    for (const r of needsEmail) {
      const value = (emailDrafts[r.filename] ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) invalid = true;
      emails[r.filename] = value;
    }
    if (invalid) {
      toast.error("Enter a valid email for every CV before saving.");
      return;
    }

    setUploading(true);
    try {
      const res = await postFiles(pendingFiles, emails);
      if (!res) return;
      const created = res.filter((r) => r.status === "created");
      setResults((prev) => prev.filter((r) => r.status !== "needs_email").concat(res));
      if (created.length > 0) {
        toast.success(`${created.length} more CV${created.length === 1 ? "" : "s"} added`);
        setFiles((prev) => prev.filter((f) => !created.some((c) => c.filename === f.name)));
        router.refresh();
      }
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setUploading(false);
    }
  }

  const closed = jobStatus === "closed";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add CVs</CardTitle>
        <p className="text-sm text-muted-foreground">
          Drop PDF or DOCX files or pull them from your connected Gmail — we
          extract the text, file them privately, and match candidates by
          email. Duplicates get flagged, never silently merged.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload CV files"
          onClick={() => !closed && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !closed) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!closed) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!closed) addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors sm:px-6 sm:py-10",
            dragging
              ? "border-primary bg-primary-soft"
              : "border-border hover:border-primary/50 hover:bg-muted/50",
            closed && "pointer-events-none opacity-50"
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
            <UploadCloud className="size-5" aria-hidden />
          </span>
          {closed ? (
            <p className="text-sm font-medium text-muted-foreground">
              This job is closed — reopen it to accept more CVs.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">
                Drag &amp; drop CVs here, or{" "}
                <span className="text-primary underline underline-offset-4">browse</span>
              </p>
              <p className="text-xs text-muted-foreground">
                PDF or DOCX, up to {MAX_FILE_MB} MB each · bulk upload welcome
              </p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx"
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="flex items-center gap-3" aria-hidden>
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {gmail.connected ? (
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3",
              closed && "opacity-50"
            )}
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Inbox className="size-4 shrink-0 text-primary" aria-hidden />
                Pull from Gmail
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Scans {gmail.address ?? "your connected inbox"} for CV emails
                mentioning &ldquo;{jobTitle}&rdquo; — they join this job
                alongside uploads, and re-pulling never duplicates anyone.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={pullFromGmail}
              loading={pulling}
              disabled={closed}
            >
              Pull now
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <Inbox className="size-4 text-primary" aria-hidden />
              Pull CVs from Gmail
            </span>
            <p className="mt-1">
              Candidates email their CVs? Connect your inbox in{" "}
              <Link
                href="/settings"
                className="font-medium text-primary underline underline-offset-4"
              >
                Settings
              </Link>{" "}
              and pull them straight into this job — no forwarding, no downloads.
            </p>
          </div>
        )}

        {files.length > 0 && (
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="break-words">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((prev) => prev.filter((f) => f.name !== file.name))}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Button className="w-full sm:w-auto" onClick={onUpload} loading={uploading} disabled={closed}>
              Upload {files.length} file{files.length === 1 ? "" : "s"}
            </Button>
              <Button
                variant="ghost"
                className="w-full sm:w-auto"
              onClick={() => {
                setFiles([]);
                setResults([]);
              }}
            >
              Clear all
            </Button>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-2" aria-live="polite">
            {results.map((r) => (
              <div
                key={r.filename}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm",
                  r.status === "created" && "border-success/30 bg-success-soft/50",
                  r.status === "failed" && "border-destructive/30 bg-destructive-soft/50",
                  r.status === "needs_email" && "border-warning/40 bg-warning-soft/50"
                )}
              >
                <span className="min-w-0 flex-1 break-words font-medium">{r.filename}</span>
                {r.status === "created" && (
                  <>
                    <Badge variant="success">
                      <CheckCircle2 aria-hidden /> Added
                    </Badge>
                    <span className="max-w-full break-all text-xs text-muted-foreground">{r.email}</span>
                    {r.duplicate && (
                      <Badge variant="warning" className="whitespace-normal">Duplicate — already applied to this job</Badge>
                    )}
                    {r.returning && (
                      <Badge variant="default" className="whitespace-normal">Returning candidate — linked</Badge>
                    )}
                  </>
                )}
                {r.status === "failed" && (
                  <>
                    <Badge variant="destructive">
                      <TriangleAlert aria-hidden /> Failed
                    </Badge>
                    <span className="break-words text-xs text-muted-foreground">{r.message}</span>
                  </>
                )}
                {r.status === "needs_email" && (
                  <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <Input
                      type="email"
                      placeholder="candidate@email.com"
                      className="h-8 w-full sm:w-60"
                      value={emailDrafts[r.filename] ?? ""}
                      onChange={(e) =>
                        setEmailDrafts((d) => ({ ...d, [r.filename]: e.target.value }))
                      }
                      aria-label={`Email address for ${r.filename}`}
                    />
                  </span>
                )}
              </div>
            ))}

            {needsEmail.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button className="w-full sm:w-auto" onClick={onSaveWithEmails} loading={uploading}>
                  Save {needsEmail.length} CV{needsEmail.length === 1 ? "" : "s"} with these
                  emails
                </Button>
                <p className="text-xs text-muted-foreground">
                  No email found in the document — candidates need one so invites
                  and reminders can reach them.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
