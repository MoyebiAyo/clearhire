import { Settings2 } from "lucide-react";

import { GmailCard } from "@/components/gmail-card";
import { TemplateEditor } from "@/components/template-editor";
import { emailConfigured, emailFrom } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("email_templates")
    .select("id, type, tone, subject, body, recruiter_id")
    .order("type")
    .order("tone");

  const { data: gmail } = await supabase
    .from("gmail_connections")
    .select("gmail_address, last_polled_at")
    .maybeSingle();

  const { data: unmatched } = await supabase
    .from("unmatched_emails")
    .select("id, sender_email, subject, attachment_name")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings2 className="size-6 text-primary" aria-hidden /> Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mailbox intake and email templates.
        </p>
      </div>

      <GmailCard
        connected={Boolean(gmail)}
        address={gmail?.gmail_address ?? null}
        lastPolledAt={gmail?.last_polled_at ?? null}
        gmailConfigured={Boolean(process.env.GMAIL_CLIENT_ID)}
        unmatched={(unmatched ?? []).map((u) => ({
          id: u.id as string,
          sender_email: u.sender_email as string,
          subject: (u.subject as string | null) ?? null,
          attachment_name: (u.attachment_name as string | null) ?? null,
        }))}
      />

      <div>
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Email templates</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          The AI drafts from these — your tone, your words. Editing a shared
          default creates your own copy; the original stays for everyone else.
        </p>
      </div>

      {!emailConfigured() && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          RESEND_API_KEY isn't configured — invites and rejections will draft
          and preview fine, but sending is disabled until it's set.
        </p>
      )}

      <TemplateEditor
        templates={(templates ?? []).map((t) => ({
          ...t,
          shared: t.recruiter_id === null,
        }))}
        from={emailFrom()}
      />
    </div>
  );
}
