import "server-only";

/**
 * Deterministic per-candidate exam mechanics.
 *
 * The same invite token always draws the same questions in the same option
 * order — computed from a seeded RNG, so a refresh or resume never reshuffles
 * and the server can verify answers without storing the draw. correct_index
 * never leaves the server; grading happens in code.
 */

export const MAX_STRIKES = 3;
/** Server-side slack over the duration before an attempt is forfeit. */
export const SUBMIT_GRACE_SECONDS = 10;

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Stable question draw for one candidate: N question ids from the bank. */
export function drawForCandidate(
  token: string,
  questionIds: string[],
  count: number
): string[] {
  return seededShuffle(questionIds, fnv1a(`draw:${token}`)).slice(
    0,
    Math.min(count, questionIds.length)
  );
}

/** Stable display order of the 4 options for one question. */
export function optionOrderFor(token: string, questionId: string): number[] {
  return seededShuffle([0, 1, 2, 3], fnv1a(`opts:${token}:${questionId}`));
}

export interface ExamConfig {
  questionsPerCandidate: number;
  durationMinutes: number;
  startDeadlineHours: number;
  weightCv: number;
  weightExam: number;
  availableFrom: string;
  availableUntil: string;
}

export function validateExamConfig(raw: {
  questionsPerCandidate?: number;
  minutes?: number;
  weightCv?: number;
  bankSize?: number;
  deadlineHours?: number;
  availableFrom?: string;
  availableUntil?: string;
}): { config?: ExamConfig & { bankSize: number }; error?: string } {
  const qpc = Math.round(raw.questionsPerCandidate ?? 20);
  const minutes = Math.round(raw.minutes ?? 30);
  const weightCv = Math.round(raw.weightCv ?? 70);
  const bankSize = Math.round(raw.bankSize ?? 40);
  const deadlineHours = Math.round(raw.deadlineHours ?? 48);
  const availableFrom = raw.availableFrom ?? new Date().toISOString();
  const availableUntil = raw.availableUntil ?? new Date(Date.now() + deadlineHours * 3600_000).toISOString();
  const weightExam = 100 - weightCv;

  if (qpc < 5 || qpc > 50) return { error: "Questions per candidate must be 5–50." };
  if (minutes < 5 || minutes > 180) return { error: "Duration must be 5–180 minutes." };
  if (bankSize < 10 || bankSize > 100) return { error: "Question bank must be 10–100 questions." };
  if (qpc > bankSize) return { error: "Questions per candidate can't exceed the bank size." };
  if (weightCv < 0 || weightCv > 100) return { error: "CV weight must be 0–100." };
  if (deadlineHours < 1 || deadlineHours > 720) return { error: "Start window must be 1–720 hours." };
  const from = new Date(availableFrom);
  const until = new Date(availableUntil);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime())) {
    return { error: "Enter valid exam availability dates." };
  }
  if (until <= from) return { error: "Exam end date must be after the start date." };

  return {
    config: {
      questionsPerCandidate: qpc,
      durationMinutes: minutes,
      startDeadlineHours: deadlineHours,
      weightCv,
      weightExam,
      bankSize,
      availableFrom: from.toISOString(),
      availableUntil: until.toISOString(),
    },
  };
}
