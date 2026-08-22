import { Settings2 } from "lucide-react";

import { TemplateEditor } from "@/components/template-editor";
import { emailConfigured, emailFrom } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Email templates" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("email_templates")
    .select("id, type, tone, subject, body, recruiter_id")
    .order("type")
    .order("tone");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings2 className="size-6 text-primary" aria-hidden /> Email templates
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
