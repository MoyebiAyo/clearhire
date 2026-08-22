"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Mode = "signin" | "signup";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsConfirmation(false);

    if (password.length < 6) {
      setError("Passwords need at least 6 characters.");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowserClient();

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message === "Invalid login credentials"
            ? "That email and password don't match. Double-check and try again."
            : error.message);
          return;
        }
        router.replace("/dashboard");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { org_name: orgName || null } },
        });
        if (error) {
          setError(error.message);
          return;
        }
        if (data.session) {
          router.replace("/dashboard");
          router.refresh();
        } else {
          // Email confirmation is enabled on the Supabase project.
          setNeedsConfirmation(true);
          if (orgName && data.user) {
            await supabase.from("recruiters").update({ org_name: orgName }).eq("id", data.user.id);
          }
        }
      }
    } catch {
      setError("Something went wrong on our side. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">
          {mode === "signin" ? "Welcome back" : "Create your workspace"}
        </CardTitle>
        <CardDescription>
          {mode === "signin"
            ? "Sign in to your recruiting workspace."
            : "Free and takes seconds — no credit card."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {needsConfirmation ? (
          <div className="rounded-lg border border-border bg-success-soft p-4 text-sm text-success">
            📬 Check <strong>{email}</strong> — we sent a confirmation link.
            Click it, then sign in here.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="orgName">Company / agency name</Label>
                <Input
                  id="orgName"
                  placeholder="Acme Hiring"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  autoComplete="organization"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              {mode === "signin" ? "Sign in" : "Create workspace"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              {mode === "signin" ? "New to ClearHire? " : "Already have an account? "}
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                }}
              >
                {mode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
