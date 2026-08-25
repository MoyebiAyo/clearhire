import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // The signup trigger normally creates this row; upsert-style safety net for
  // users who signed up before the trigger existed.
  const { data: recruiter } = await supabase
    .from("recruiters")
    .select("org_name")
    .eq("id", user.id)
    .maybeSingle();

  const metadataOrgName =
    typeof user.user_metadata?.org_name === "string"
      ? user.user_metadata.org_name.trim()
      : "";
  const orgName = recruiter?.org_name?.trim() || metadataOrgName || null;

  if (!recruiter) {
    await supabase.from("recruiters").insert({ id: user.id, org_name: orgName });
  } else if (!recruiter.org_name?.trim() && orgName) {
    // Backfill profiles created before signup organization names were persisted.
    await supabase.from("recruiters").update({ org_name: orgName }).eq("id", user.id);
  }

  return (
    <AppShell orgName={orgName} email={user.email ?? ""}>
      {children}
    </AppShell>
  );
}
