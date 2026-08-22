import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/templates/[id] — edit an email template from the settings page.
 * Editing a shared default (recruiter_id null) FORKS the recruiter's own
 * copy with the new values; the shared original stays pristine for everyone.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const subject = (body?.subject as string | undefined)?.trim();
  const text = (body?.body as string | undefined)?.trim();
  if (!subject || !text) {
    return NextResponse.json({ error: "Subject and body are required." }, { status: 400 });
  }

  const { data: template } = await supabase
    .from("email_templates")
    .select("id, recruiter_id, type, tone, subject, body")
    .eq("id", id)
    .maybeSingle();
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  if (template.recruiter_id === null) {
    // Fork the shared default into the recruiter's own copy.
    const { data: fork, error } = await supabase
      .from("email_templates")
      .insert({
        recruiter_id: user.id,
        type: template.type,
        tone: template.tone,
        subject,
        body: text,
      })
      .select("id")
      .single();
    if (error || !fork) {
      return NextResponse.json({ error: error?.message ?? "Fork failed" }, { status: 500 });
    }
    return NextResponse.json({ template: fork, forked: true });
  }

  const { error } = await supabase
    .from("email_templates")
    .update({ subject, body: text })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template: { id }, forked: false });
}
