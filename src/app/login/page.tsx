import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — teaches what ClearHire does before the first login. */}
      <section className="hidden flex-col justify-between bg-foreground p-10 text-white lg:flex">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold">
            CH
          </span>
          <span className="text-lg font-semibold tracking-tight">ClearHire</span>
        </div>
        <div className="max-w-md space-y-8">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Screen every CV fairly.
            <br />
            Keep the final call yours.
          </h1>
          <ul className="space-y-5 text-sm text-slate-300">
            <li className="flex gap-3">
              <span aria-hidden>📑</span>
              <span>
                <strong className="text-white">Bulk CV intake</strong> — drop in
                PDFs and DOCXs, or let a connected inbox collect them for you.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden>⚖️</span>
              <span>
                <strong className="text-white">Blind scoring</strong> — CVs are
                scored against your rubric without names or schools, so first
                impressions don't bias the shortlist.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden>🔔</span>
              <span>
                <strong className="text-white">Interviews that stick</strong> —
                self-scheduling, calendar files, and smart reminders that cut
                no-shows.
              </span>
            </li>
          </ul>
        </div>
        <p className="text-xs text-slate-400">
          The AI ranks and explains — you decide. That's the whole point.
        </p>
      </section>

      <section className="flex items-center justify-center p-6">
        <AuthForm />
      </section>
    </main>
  );
}
