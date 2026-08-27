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

const CV_HEADINGS = new Set([
  "about",
  "certifications",
  "contact",
  "education",
  "experience",
  "interests",
  "profile",
  "projects",
  "references",
  "skills",
  "summary",
  "tools",
]);

const ROLE_WORDS = new Set([
  "administrator",
  "analyst",
  "architect",
  "consultant",
  "coordinator",
  "developer",
  "director",
  "engineer",
  "founder",
  "manager",
  "officer",
  "recruiter",
  "specialist",
  "student",
  "teacher",
]);

/** Best-effort name guess from the CV header, not an AI extraction field. */
export function guessName(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);

  for (const line of lines) {
    if (line.length < 2 || line.length > 60) continue;
    if (line.includes("@") || /\d/.test(line)) continue;
    if (/[|,:;()/\\]/.test(line)) continue;

    const normalized = line.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    if (CV_HEADINGS.has(normalized)) continue;

    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;

    const lowerWords = words.map((word) => word.toLowerCase().replace(/[^a-z]/g, ""));
    if (lowerWords.some((word) => ROLE_WORDS.has(word))) continue;

    const nameLike = words.every((word) => /^[A-Z][a-zA-Z'.-]*$/.test(word));
    if (nameLike) return line.replace(/\s+/g, " ");
  }
  return null;
}

export function shouldReplaceCandidateName(current: string | null, text: string): boolean {
  if (!current) return true;
  const normalized = current.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (CV_HEADINGS.has(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.some((word) => ROLE_WORDS.has(word)) || !text.toLowerCase().includes(current.toLowerCase());
}
