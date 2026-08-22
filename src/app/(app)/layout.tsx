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

  if (!recruiter) {
    await supabase.from("recruiters").insert({ id: user.id });
  }

  return (
    <AppShell orgName={recruiter?.org_name ?? null} email={user.email ?? ""}>
      {children}
    </AppShell>
  );
}
