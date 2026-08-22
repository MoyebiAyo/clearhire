"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { JobStatus } from "@/lib/types";

export function JobActions({
  jobId,
  status,
}: {
  jobId: string;
  status: JobStatus;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isOpen = status === "open";
  const next: JobStatus = isOpen ? "closed" : "open";

  async function onToggle() {
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't update the job.");
        return;
      }
      toast.success(next === "closed" ? "Job closed" : "Job reopened");
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      loading={loading}
      onClick={onToggle}
      title={
        isOpen
          ? "Closing stops new applications but keeps everything you've collected."
          : "Reopen to accept new applications again."
      }
    >
      {isOpen ? "Close job" : "Reopen job"}
    </Button>
  );
}
