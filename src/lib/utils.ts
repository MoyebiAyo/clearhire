import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * PostgREST embed normalizer: many-to-one relations come back as OBJECTS,
 * one-to-many as arrays. This safely picks the single related row from
 * either shape.
 */
export function one<T>(rel: unknown): T | null {
  if (Array.isArray(rel)) return (rel[0] as T) ?? null;
  if (rel && typeof rel === "object") return rel as T;
  return null;
}
