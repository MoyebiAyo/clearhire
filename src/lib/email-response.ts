export function batchEmailIds(payload: unknown): ({ id?: string }[]) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: { id?: string }[] }).data;
  }
  return [];
}
