"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const REDIRECT_SECONDS = 3;

export function AuthConfirmed({ invalid }: { invalid: boolean }) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    if (invalid) return;
    const interval = setInterval(
      () => setSecondsLeft((s) => Math.max(0, s - 1)),
      1000
    );
    const timeout = setTimeout(
      () => router.replace("/dashboard"),
      REDIRECT_SECONDS * 1000
    );
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [invalid, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          {invalid ? (
            <>
              <span className="flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning">
                <TriangleAlert className="size-6" aria-hidden />
              </span>
              <div className="space-y-1">
                <h1 className="text-lg font-semibold">This link didn't work</h1>
                <p className="text-sm text-muted-foreground">
                  Confirmation links expire after a while and can only be used
                  once. Go back to sign in — if your email still needs
                  confirming, sign up again with the same address to get a
                  fresh link.
                </p>
              </div>
              <Link href="/login" className={cn(buttonVariants(), "mt-1")}>
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
                <CheckCircle2 className="size-6" aria-hidden />
              </span>
              <div className="space-y-1">
                <h1 className="text-lg font-semibold">Email confirmed 🎉</h1>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Your account is ready. Taking you to your dashboard in{" "}
                  {secondsLeft} second{secondsLeft === 1 ? "" : "s"}…
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.replace("/dashboard")}
                className={cn(buttonVariants(), "mt-1")}
              >
                Go to dashboard now
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
