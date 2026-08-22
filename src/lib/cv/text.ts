import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export class UnsupportedFileTypeError extends Error {
  constructor(filename: string) {
    super(
      `"${filename}" isn't a PDF or DOCX — only those file types are supported.`
    );
    this.name = "UnsupportedFileTypeError";
  }
}

/**
 * Extract raw text from a CV file (PDF via unpdf, DOCX via mammoth).
 * Throws UnsupportedFileTypeError for anything else.
 */
export async function extractCvText(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim();
  }

  if (lower.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }

  throw new UnsupportedFileTypeError(filename);
}

const EMAIL_RE =
  /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/i;

/** Best-effort email parse from CV text; null when none is found. */
export function parseEmail(text: string): string | null {
  const match = text.match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Best-effort name guess: the first short line near the top of the CV that
 * looks like a human name (no digits, no @, title-cased-ish). Null if nothing
 * plausible is found — the email remains the source of truth.
 */
export function guessName(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const line of lines) {
    if (line.length < 2 || line.length > 60) continue;
    if (line.includes("@") || /\d/.test(line)) continue;
    // 1–4 words, mostly letters/apostrophes/hyphens/periods
    const words = line.split(/\s+/);
    if (words.length < 1 || words.length > 4) continue;
    const nameLike = words.every((w) => /^[A-Z][a-zA-Z'.-]*$/.test(w));
    if (nameLike) return line;
  }
  return null;
}
