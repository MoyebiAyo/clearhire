"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Info, Link2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Unmatched {
  id: string;
  sender_email: string;
  subject: string | null;
  attachment_name: string | null;
}

export function GmailCard({
  connected,
  address,
  lastPolledAt,
  gmailConfigured,
  unmatched,
}: {
  connected: boolean;
  address: string | null;
  lastPolledAt: string | null;
  gmailConfigured: boolean;
  unmatched: Unmatched[];
}) {
  const router = useRouter();
  const [polling, setPolling] = useState(false);

  async function poll() {
    setPolling(true);
    try {
      const res = await fetch("/api/mailbox/poll", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Poll failed.");
        return;
      }
      const m = body as {
        scanned: number;
        ingested: number;
        unmatched: number;
        skipped: number;
      };
      toast.success(
        `Inbox scanned: ${m.scanned} message${m.scanned === 1 ? "" : "s"}`,
        {
          description: `${m.ingested} ingested · ${m.unmatched} unmatched · ${m.skipped} skipped`,
        }
      );
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setPolling(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="size-4 text-primary" aria-hidden /> Gmail inbox intake
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Emails with CV attachments become applications automatically — matched
          to open jobs by the subject line, with read-only access to your
          mailbox (never full access).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!gmailConfigured ? (
          <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="font-medium">Google OAuth isn't configured yet</p>
              <p className="text-muted-foreground">
                Set GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET (see RUNNING_NOTES for
                the 5-minute Google Cloud setup).
              </p>
            </div>
          </div>
        ) : connected ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="success">Connected</Badge>
              <span className="text-sm font-medium">{address}</span>
              {lastPolledAt && (
                <span className="text-xs text-muted-foreground">
                  Last polled {new Date(lastPolledAt).toLocaleString()}
                </span>
              )}
              <Button size="sm" variant="outline" onClick={poll} loading={polling}>
                <RefreshCw aria-hidden /> Poll now
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Auto-polls every 10 minutes once the Cloudflare worker is live.
            </p>
            {unmatched.length > 0 && (
              <div className="rounded-lg border border-border">
                <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  {unmatched.length} CV email{unmatched.length === 1 ? "" : "s"} waiting
                  for manual assignment (no open job matched):
                </p>
                <ul className="divide-y divide-border">
                  {unmatched.map((u) => (
                    <li key={u.id} className="px-3 py-2 text-sm">
                      <span className="font-medium">{u.sender_email}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {u.subject || "(no subject)"} · {u.attachment_name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <VerificationNote />
          </>
        ) : (
          <div className="space-y-3">
            <Button onClick={() => { window.location.href = "/api/gmail/connect"; }}>
              <Link2 aria-hidden /> Connect Gmail mailbox
            </Button>
            <VerificationNote />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Always-visible testing notice: Google's verification for this build is
 * still in progress (AI BuildFest 2026), so consent screens warn and some
 * inboxes spam-filter our sends — neither means anything is wrong.
 */
function VerificationNote() {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Info className="size-4 shrink-0 text-primary" aria-hidden />
        You may see security warnings — here&rsquo;s why
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">
            Google may say &ldquo;this app isn&rsquo;t verified.&rdquo;
          </span>{" "}
          That&rsquo;s expected — this integration is still in testing, and
          Google&rsquo;s domain verification for Gmail access is being completed
          as part of the AI BuildFest 2026 setup. The warning can be ignored.
        </li>
        <li>
          <span className="font-medium text-foreground">To continue:</span> on that
          screen choose <em>Advanced</em> &rarr; <em>Go to ClearHire (unsafe)</em>.
          The wording only means &ldquo;not yet verified&rdquo; — not that
          anything is wrong.
        </li>
        <li>
          <span className="font-medium text-foreground">Candidate emails:</span>{" "}
          invites and reminders are sent from our verified sender
          (<code className="rounded bg-muted px-1">clearhire@mousetech.app</code>),
          but while the product is in testing some inboxes may file them under
          spam — check there and mark &ldquo;not spam&rdquo; if one goes missing.
        </li>
        <li>
          <span className="font-medium text-foreground">Read-only access:</span>{" "}
          ClearHire reads messages to find CV attachments and manages its own
          labels — it can never send, edit, or delete your email.
        </li>
        <li>
          <span className="font-medium text-foreground">Your token stays encrypted:</span>{" "}
          the connection credential is encrypted at rest and never appears in
          your browser.
        </li>
      </ul>
    </div>
  );
}
