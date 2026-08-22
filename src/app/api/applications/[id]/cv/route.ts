import "server-only";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — deliberately short-lived.

/**
 * GET /api/applications/[id]/cv — mint a short-lived signed URL for the
 * stored CV in the PRIVATE `cvs` bucket. The bucket is never public; this
 * authenticated, RLS-checked endpoint is the only way to a CV file.
 */
export async function GET(
  _request: Request,
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

  // RLS: only the owning recruiter's application row is visible here.
  const { data: app } = await supabase
    .from("applications")
    .select("id, cv_file_path")
    .eq("id", id)
    .maybeSingle();

  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!app.cv_file_path) {
    return NextResponse.json({ error: "No CV file stored" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("cvs")
    .createSignedUrl(app.cv_file_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "Couldn't create a download link. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: data.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
}
