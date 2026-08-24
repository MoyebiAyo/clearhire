export function examWindowState(
  availableFrom: string,
  availableUntil: string,
  now = Date.now()
): "scheduled" | "open" | "closed" {
  if (now < new Date(availableFrom).getTime()) return "scheduled";
  if (now > new Date(availableUntil).getTime()) return "closed";
  return "open";
}

export function examAttemptEndsAt(
  startedAt: string,
  durationMinutes: number,
  availableUntil: string | null
): number {
  const durationEnd = new Date(startedAt).getTime() + durationMinutes * 60_000;
  return availableUntil
    ? Math.min(durationEnd, new Date(availableUntil).getTime())
    : durationEnd;
}
