import { z } from "zod";

export const RUBRIC_FIELDS = [
  {
    name: "weight_skills",
    label: "Skills",
    hint: "How much the candidate's skill match matters when CVs are scored.",
  },
  {
    name: "weight_experience",
    label: "Experience",
    hint: "Weight given to years and relevance of experience.",
  },
  {
    name: "weight_certifications",
    label: "Certifications",
    hint: "Weight given to relevant certifications.",
  },
  {
    name: "weight_tools",
    label: "Tools",
    hint: "Weight given to knowing the tools your team uses.",
  },
] as const;

export type RubricFieldName = (typeof RUBRIC_FIELDS)[number]["name"];

const weight = z
  .number({ invalid_type_error: "Enter a number" })
  .int("Whole numbers only")
  .min(0, "Weights can't be negative")
  .max(100, "Weights can't exceed 100");

export const jobSchema = z
  .object({
    title: z.string().trim().min(3, "Give the job a title (3+ characters)"),
    jd_text: z
      .string()
      .trim()
      .min(30, "Paste the full job description (30+ characters) — the AI reads it to derive requirements."),
    weight_skills: weight,
    weight_experience: weight,
    weight_certifications: weight,
    weight_tools: weight,
  })
  .refine(
    (v) =>
      v.weight_skills +
        v.weight_experience +
        v.weight_certifications +
        v.weight_tools ===
      100,
    { message: "The four weights must add up to exactly 100%." }
  );

export type JobInput = z.infer<typeof jobSchema>;

export const jobStatusSchema = z.enum(["open", "closed"]);
