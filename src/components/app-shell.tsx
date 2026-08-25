"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BarChart3, Briefcase, KanbanSquare, LayoutDashboard, LogOut, Menu, Settings2, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Templates", icon: Settings2 },
];

export function AppShell({
  orgName,
  email,
  children,
}: {
  orgName: string | null;
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            CH
          </span>
          <span className="font-semibold tracking-tight">ClearHire</span>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            AI scores blind — you decide.
          </p>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-30 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
          <div className="flex items-center gap-3 md:hidden">
            <button
              type="button"
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {mobileNavOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
              CH
            </span>
            <span className="text-sm font-semibold">ClearHire</span>
          </div>
          <p className="hidden text-sm font-medium md:block">
            {orgName || "Your workspace"}
          </p>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={signOut}>
              <LogOut aria-hidden /> Sign out
            </Button>
          </div>
        </header>
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 md:hidden" role="presentation">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
              className="absolute inset-0 bg-foreground/30"
            />
            <nav aria-label="Mobile main navigation" className="relative h-full w-[min(18rem,85vw)] border-r border-border bg-card px-3 py-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between px-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace</span>
                <button type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              <div className="space-y-1">
                {NAV.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link key={href} href={href} onClick={() => setMobileNavOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                      <Icon className="size-4" aria-hidden />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </nav>
          </div>
        )}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
