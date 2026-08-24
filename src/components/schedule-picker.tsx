"use client";

import { useState } from "react";
import { CalendarCheck, CalendarClock, CheckCircle2, MapPin, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function fmt(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(d),
    time: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d),
  };
}

/**
 * Candidate-facing self-scheduling — this page IS the company's brand
 * impression: calm, clear, one tap to confirm, .ics prominent.
 */
export function SchedulePicker({
  token,
  jobTitle,
  company,
  firstName,
  interviewer,
  location,
  slots,
  alreadyScheduled,
}: {
  token: string;
  jobTitle: string;
  company: string;
  firstName: string;
  interviewer: string | null;
  location: string | null;
  slots: string[];
  alreadyScheduled: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(alreadyScheduled);
  const [error, setError] = useState<string | null>(null);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function confirm() {
    if (!picked) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: picked }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.error === "already_scheduled") {
          setConfirmed(body.scheduled_time);
          return;
        }
        setError("That slot didn't work — please pick another one.");
        return;
      }
      setConfirmed(picked);
    } catch {
      setError("Network hiccup — try again in a moment.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-lg space-y-5">
        <div className="text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <CalendarClock className="size-6" aria-hidden />
          </span>
          <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight">
            {confirmed ? "You're all set!" : `Hi ${firstName} — pick a time`}
          </h1>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {confirmed
              ? "Your interview is confirmed — we've added it to your calendar."
              : `Interview for ${jobTitle} with ${company}`}
          </p>
        </div>

        {confirmed ? (
          <Card>
            <CardContent className="space-y-4 p-6 text-center">
              <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
              <div className="space-y-1">
                <p className="text-lg font-semibold">
                  {fmt(confirmed).date} · {fmt(confirmed).time}
                </p>
                <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                  <User className="size-3.5" aria-hidden />
                  {interviewer ?? "The team"}
                </p>
                {location && (
                  <p className="flex flex-wrap items-center justify-center gap-1.5 break-words text-sm text-muted-foreground">
                    <MapPin className="size-3.5" aria-hidden /> {location}
                  </p>
                )}
              </div>
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  window.location.href = `/api/schedule/${token}/ics`;
                }}
              >
                <CalendarCheck aria-hidden /> Add to calendar (.ics)
              </Button>
              <p className="text-xs text-muted-foreground">
                We'll send friendly reminders before the big day — 2 days, 1
                day, 12 hours and 2 hours out, so it never sneaks up on you.
              </p>
            </CardContent>
          </Card>
        ) : slots.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              All the offered times have passed. Reply to your invite email and
              we'll happily send new options.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-3 p-6">
              <p className="text-xs text-muted-foreground">
                Times shown in your timezone ({tz})
              </p>
              <div className="space-y-2">
                {slots.map((slot) => {
                  const f = fmt(slot);
                  const active = picked === slot;
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setPicked(slot)}
                      aria-pressed={active}
                      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary-soft"
                          : "border-border bg-card hover:border-primary/50 hover:bg-muted/60"
                      }`}
                    >
                      <span>
                        <span className="block font-medium">{f.date}</span>
                        <span className="block text-sm text-muted-foreground">{f.time}</span>
                      </span>
                      {active && <CheckCircle2 className="size-5 text-primary" aria-hidden />}
                    </button>
                  );
                })}
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button size="lg" className="w-full" disabled={!picked} loading={confirming} onClick={confirm}>
                Confirm this time
              </Button>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Powered by ClearHire — fair, transparent hiring.
        </p>
      </div>
    </main>
  );
}
