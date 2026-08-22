// Row types mirroring supabase/migrations/0001_init.sql (spec Part 4).

export type JobStatus = "open" | "closed";

export type ApplicationStatus =
  | "applied"
  | "screened"
  | "shortlisted"
  | "interview_scheduled"
  | "interviewed"
  | "offer"
  | "rejected";

export interface Recruiter {
  id: string;
  org_name: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  recruiter_id: string;
  title: string;
  jd_text: string;
  weight_skills: number;
  weight_experience: number;
  weight_certifications: number;
  weight_tools: number;
  status: JobStatus;
  created_at: string;
  /** Only populated by the jobs list query (count per job). */
  application_count?: number;
}

export interface Candidate {
  id: string;
  name: string | null;
  email: string;
  source: "upload" | "email" | null;
  created_at: string;
}

export interface Application {
  id: string;
  candidate_id: string;
  job_id: string;
  cv_file_path: string | null;
  status: ApplicationStatus;
  applied_at: string;
  flagged_duplicate: boolean;
  /** Joined when listing applications for a job. */
  candidates?: Pick<Candidate, "name" | "email" | "source"> | null;
}

export interface CvExtraction {
  id: string;
  application_id: string;
  skills: string[] | null;
  experience_years: number | null;
  education: { degree: string; institution: string }[] | null;
  certifications: string[] | null;
  tools: string[] | null;
  raw_text: string | null;
  extracted_at: string;
}

/** Per-file result returned by POST /api/jobs/[id]/cvs. */
export interface CvUploadResult {
  filename: string;
  status: "created" | "needs_email" | "failed";
  email?: string;
  duplicate?: boolean;
  message?: string;
}
