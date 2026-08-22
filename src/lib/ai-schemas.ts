import { z } from "zod";

/**
 * Validation + normalization for LLM responses. Models are asked for strict
 * JSON (and use JSON mode), but nothing is trusted until it passes these.
 */

const score = z.coerce.number().min(0).max(100);

const rawExtraction = z.object({
  skills: z.array(z.coerce.string()).default([]),
  experience_years: z.coerce.number().min(0).max(60),
  education: z
    .array(
      z.union([
        z.string(),
        z.object({
          degree: z.coerce.string().nullish(),
          institution: z.coerce.string().nullish(),
        }),
      ])
    )
    .default([]),
  certifications: z.array(z.coerce.string()).default([]),
  tools: z.array(z.coerce.string()).default([]),
});

export interface EducationEntry {
  degree: string | null;
  institution: string | null;
}

export interface ExtractionResult {
  skills: string[];
  experience_years: number;
  education: EducationEntry[];
  certifications: string[];
  tools: string[];
}

export function parseExtraction(raw: unknown): ExtractionResult {
  const v = rawExtraction.parse(raw);
  return {
    skills: v.skills.map((s) => s.trim()).filter(Boolean),
    experience_years: v.experience_years,
    education: v.education.map((e) =>
      typeof e === "string"
        ? { degree: e.trim() || null, institution: null }
        : {
            degree: e.degree?.trim() || null,
            institution: e.institution?.trim() || null,
          }
    ),
    certifications: v.certifications.map((s) => s.trim()).filter(Boolean),
    tools: v.tools.map((s) => s.trim()).filter(Boolean),
  };
}

const rawGaps = z.array(
  z.object({
    requirement: z.coerce.string().default(""),
    missing_skill: z.coerce.string().nullish(),
    severity: z.coerce.string().default("nice-to-have"),
  })
);

const rawScoring = z.object({
  skills_score: score,
  experience_score: score,
  certifications_score: score,
  tools_score: score,
  gaps: rawGaps.default([]),
  rationale: z.coerce.string().default(""),
});

export interface Gap {
  requirement: string;
  missing_skill: string | null;
  severity: "hard" | "nice-to-have";
}

export interface ScoringResult {
  skills_score: number;
  experience_score: number;
  certifications_score: number;
  tools_score: number;
  gaps: Gap[];
  rationale: string;
}

export function parseScoring(raw: unknown): ScoringResult {
  const v = rawScoring.parse(raw);
  return {
    ...v,
    gaps: v.gaps
      .filter((g) => g.requirement)
      .map((g) => ({
        requirement: g.requirement,
        missing_skill: g.missing_skill?.trim() || null,
        severity: g.severity.toLowerCase().startsWith("hard")
          ? ("hard" as const)
          : ("nice-to-have" as const),
      })),
  };
}

const rawRequirements = z.object({
  requirements: z
    .array(
      z.object({
        requirement: z.coerce.string(),
        type: z.coerce.string().default("nice-to-have"),
      })
    )
    .min(1),
});

export interface Requirement {
  requirement: string;
  type: "hard" | "nice-to-have";
}

export function parseRequirements(raw: unknown): Requirement[] {
  const v = rawRequirements.parse(raw);
  return v.requirements.map((r) => ({
    requirement: r.requirement,
    type: r.type.toLowerCase().startsWith("hard")
      ? ("hard" as const)
      : ("nice-to-have" as const),
  }));
}
