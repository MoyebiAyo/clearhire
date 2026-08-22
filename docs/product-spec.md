# ClearHire — Product Documentation & Build Roadmap

AI Recruitment Assistant. Prepared for AI BuildFest 2026 — Track 1: AI for
Business & Productivity, Case Study 3 — AI HR & Recruitment Bot.
Handoff-ready for engineering / AI coding assistants.

> Build note: this repo implements the spec with Groq as the AI provider in
> place of the Anthropic Claude API named below (provider-agnostic layer in
> `lib/ai.ts` from Week 2). All prompts are used verbatim.

## Part 1 — Product Context

### 1.1 Problem Statement

Somewhere right now, a qualified candidate is being missed — not for lack of
merit, but because a recruiter facing 300 applications for one role never gets
past the first 40 before running out of hours in the day.

Recruitment at most growing companies runs on exhaustion. CVs pile in faster
than anyone can properly read them, screening quality quietly degrades as
fatigue sets in, and equally qualified candidates get treated inconsistently
depending on who reviewed them and how late in the day it was.

The damage compounds downstream. Once a shortlist exists, coordinating
interviews eats more hours — chasing availability, rewriting the same invite
email, forgetting reminders, absorbing no-shows that a timely nudge would have
prevented. And the candidates who don't make the cut are met with silence,
because closing the loop with a hundred rejected applicants is one more task
nobody has time for — quietly damaging how people talk about the company for
years.

### 1.2 Vision

Give recruiters back their time and give every candidate a fair, explainable
read — by automating the repetitive, error-prone parts of hiring (screening
consistency, scheduling, reminders, follow-through) while keeping the actual
hiring decision firmly with a human.

### 1.3 Competitive Landscape

- Sapia.ai — blind, chat-based screening with a strong bias-audit story.
- MeVitae / Pinpoint — anonymized CV screening inside an existing ATS.
- Workable / Eightfold.ai — broad ATS platforms with AI screening and
  scheduling built in.

Differentiation for an SME audience without a full ATS:

- Inbox-native intake — CVs arrive via a connected mailbox, not just a form.
- Blind-score-then-reveal on CVs specifically, with a fully visible and
  editable rubric.
- A deliberately tuned reminder cadence (2 days / 1 day / 12 hrs / 2 hrs) aimed
  at reducing no-shows, not a generic single reminder.

### 1.4 Users

- Primary: Recruiters and hiring teams at SMEs and agencies without a full
  enterprise ATS.
- Secondary: Candidates — who get faster, clearer, more respectful
  communication.

## Part 2 — Features & Acceptance Criteria

### 2.1 Job & CV Intake

- Recruiter creates a job: title, JD text, rubric weights (skills /
  experience / certifications / tools — must sum to 100%).
- Manual upload: bulk PDF/DOCX upload against a specific job.
- Email intake: a connected mailbox (Gmail OAuth) is scanned periodically;
  incoming emails with CV attachments are matched to the correct open job by
  subject line and/or body content; sender name/email/message captured
  automatically.

**Acceptance criteria:** Uploading 10 mixed PDF/DOCX CVs against a job
populates 10 candidate records with raw text extracted. An email sent to the
connected inbox with a CV attached, referencing a job title, creates a matching
candidate/application within one polling cycle.

### 2.2 CV Analysis & Ranking

- Each CV is parsed into structured JSON (skills, years of experience,
  education, certifications, tools).
- Blind-first scoring: the scoring pass never receives name, school, photo, or
  any other de-identifying field — only structured, job-relevant data.
- Score is a weighted sum against the recruiter's rubric; per-criterion
  sub-scores are stored, not just the total.
- Gap analysis: missing skills are listed against the specific JD requirement
  they map to, tagged hard-requirement vs nice-to-have.
- Identity is revealed only when the recruiter clicks "Reveal" on a candidate
  card — after the score is already locked in and stored.

**Acceptance criteria:** For a batch of 10 CVs against one JD, the system
produces a ranked list with per-criterion scores, a gap list per candidate,
and identities hidden until explicitly revealed.

### 2.3 Interview Scheduling

- "Send Interview Email" — recruiter selects a template (formal / casual /
  technical-round); system auto-fills candidate name, recruiter contact, and
  proposed time(s).
- Candidate self-scheduling: recruiter offers up to 3 time slots; candidate
  picks one via a unique link; both sides see the confirmed time.
- Confirmed interviews get a .ics calendar attachment on the confirmation
  email.

**Acceptance criteria:** Selecting a template + candidate + time and clicking
send results in an email logged in email_log and a row created in interviews.

### 2.4 Automated Reminders

- On interview confirmation, four rows are written to reminder_jobs:
  fire_at = interview_time minus 2 days, 1 day, 12 hours, 2 hours.
- A single scheduled job (Cloudflare Worker cron, every 15–30 min) checks for
  due, unsent reminders and sends them.
- Optional WhatsApp channel alongside email (stretch goal).

**Acceptance criteria:** Scheduling an interview 3 days out results in exactly
4 reminder rows; simulating time passing causes each to fire once, and only
once.

### 2.5 Closing the Loop

- Automated, personalized rejection email for candidates who don't proceed,
  drawing lightly on their gap analysis (kept respectful, not blunt).
- Post-interview scorecard: interviewer fills a short structured form; stored
  alongside the AI's original score for later comparison.

### 2.6 Pipeline & Insights

- Kanban view: Applied → Screened → Shortlisted → Interview Scheduled →
  Interviewed → Offer/Rejected.
- Duplicate detection: same candidate email applying twice is flagged, not
  duplicated silently.
- Lightweight analytics: time-to-hire, source split (email vs upload), stage
  drop-off.

## Part 3 — Architecture

### 3.1 Stack

| Layer | Choice |
|---|---|
| Frontend + app API routes | Next.js (App Router), hosted on Vercel |
| Database, Auth, File Storage | Supabase (Postgres + RLS + Storage buckets) |
| AI | LLM API — extraction, scoring, gap analysis, email drafting |
| Reminder / scheduling engine | Cloudflare Worker + Cron Trigger, polling Supabase |
| Mailbox intake | Gmail API (OAuth 2.0) |
| Outbound email | Resend (batch endpoint for bulk sends) |
| Optional | WhatsApp Business API for reminders |

### 3.2 System Flow

1. Recruiter creates a job in the Next.js app → written to Supabase.
2. CVs come in (upload or email-scraped) → raw text extracted → stored in
   Supabase Storage + cv_extractions.
3. Next.js API route calls the LLM: extraction pass → structured JSON stored.
4. Next.js API route calls the LLM again: scoring pass (blind, structured data
   only) → scores stored.
5. Recruiter reviews ranked, de-identified shortlist in the app → reveals
   identities → picks candidates.
6. Recruiter sends interview invite → interviews row created → 4 reminder_jobs
   rows created.
7. Cloudflare Worker cron polls reminder_jobs every 15–30 min → sends due
   reminders via Resend → marks sent.
8. Post-interview: scorecard filled → decision made → rejection emails
   auto-sent to the rest.

## Part 4 — Data Model

Full Postgres schema (Supabase). Row Level Security policies so a recruiter
only sees jobs / applications / etc. scoped to their own recruiter_id.

```sql
-- Recruiters/organizations (Supabase Auth handles users; this extends profile)
create table recruiters (
  id uuid primary key references auth.users(id),
  org_name text,
  created_at timestamptz default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid references recruiters(id),
  title text not null,
  jd_text text not null,
  weight_skills numeric default 40,
  weight_experience numeric default 30,
  weight_certifications numeric default 15,
  weight_tools numeric default 15,
  status text default 'open', -- open | closed
  created_at timestamptz default now()
);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  source text, -- 'upload' | 'email'
  created_at timestamptz default now(),
  unique (email) -- dedupe by email
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id),
  job_id uuid references jobs(id),
  cv_file_path text, -- Supabase Storage path
  status text default 'applied', -- applied|screened|shortlisted|interview_scheduled|interviewed|offer|rejected
  applied_at timestamptz default now()
);

create table cv_extractions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id),
  skills jsonb,
  experience_years numeric,
  education jsonb,
  certifications jsonb,
  tools jsonb,
  raw_text text,
  extracted_at timestamptz default now()
);

create table scores (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id),
  skills_score numeric,
  experience_score numeric,
  certifications_score numeric,
  tools_score numeric,
  total_score numeric,
  gaps jsonb, -- [{requirement, missing_skill, severity: 'hard'|'nice-to-have'}]
  rationale text,
  scored_at timestamptz default now()
);

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid references recruiters(id),
  type text, -- 'invite' | 'reminder' | 'rejection'
  tone text, -- 'formal' | 'casual' | 'technical'
  subject text,
  body text -- with {{merge_fields}}
);

create table interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id),
  scheduled_time timestamptz,
  interviewer text,
  location_or_link text,
  status text default 'scheduled', -- scheduled|completed|no_show|cancelled
  created_at timestamptz default now()
);

create table reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid references interviews(id),
  fire_at timestamptz not null,
  offset_label text, -- '2d'|'1d'|'12h'|'2h'
  sent boolean default false,
  sent_at timestamptz
);

create table email_log (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id),
  type text,
  to_email text,
  subject text,
  sent_at timestamptz default now(),
  provider_message_id text
);

create table interview_scorecards (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid references interviews(id),
  interviewer_rating numeric,
  interviewer_notes text,
  submitted_at timestamptz default now()
);
```

## Part 5 — API Surface (Next.js routes)

| Route | Method | Purpose |
|---|---|---|
| /api/jobs | POST / GET | create / list jobs |
| /api/jobs/[id]/cvs | POST | bulk CV upload against a job |
| /api/jobs/[id]/extract | POST | trigger extraction pass on pending CVs |
| /api/jobs/[id]/score | POST | trigger blind scoring pass |
| /api/applications/[id]/reveal | POST | reveal identity in UI (client-side gate, not a security boundary) |
| /api/interviews | POST | create interview + generate 4 reminder_jobs rows |
| /api/interviews/[id]/send-invite | POST | send templated invite via Resend, log to email_log |
| /api/mailbox/poll | POST (internal/cron) | Gmail API poll for new CV emails |
| /api/reminders/run | POST (called by Cloudflare Worker) | find due reminder_jobs, send via Resend batch, mark sent |
| /api/applications/[id]/reject | POST | send rejection email, update status |
| /api/interviews/[id]/scorecard | POST | submit interviewer scorecard |

## Part 6 — AI Prompt Design

Keep extraction and scoring as separate calls — this makes both more reliable
and gives clean intermediate data you can show as "evidence of testing" in the
hackathon submission.

**Extraction prompt (per CV, JSON-only output):**

```
Extract the following from this CV text as strict JSON only, no prose:
skills (array), experience_years (number),
education (array of {degree, institution}),
certifications (array), tools (array).
CV text: [raw_text]
```

**Scoring prompt (blind — no name/school passed in):**

```
Given this job's requirements: [JD structured requirements]
and this candidate's structured profile:
[skills, experience_years, certifications, tools — no identifying fields],
score the candidate 0–100 on each of: skills, experience,
certifications, tools. For each JD requirement not met, list it
with severity 'hard' or 'nice-to-have'.
Return strict JSON:
{skills_score, experience_score, certifications_score,
 tools_score, gaps: [...], rationale}
```

**Email draft prompt:**

```
Using this template: [template body with tone]
and these merge fields:
[candidate name, recruiter name, job title, proposed times],
produce a complete, ready-to-send email body.
```

## Part 7 — Security & Privacy Notes

- CVs contain personal data — store in a private Supabase Storage bucket,
  never public.
- Row Level Security on every table, scoped to recruiter_id.
- The "blind scoring" boundary must be enforced server-side (the scoring API
  call must never receive name/school fields), not just hidden in the UI.
- Gmail OAuth tokens stored encrypted; request minimum scope (read + label,
  not full mailbox access) where the API allows it.

## Part 8 — Environment Variables

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
RESEND_API_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
CLOUDFLARE_WORKER_SHARED_SECRET=
```

## Part 9 — Build Roadmap

- **Phase 0 — Foundations:** Supabase project + schema + RLS; Supabase Auth;
  scaffold Next.js on Vercel.
- **Phase 1 — Intake:** job creation form + rubric weights; manual CV bulk
  upload (PDF/DOCX → text extraction → Storage + applications row); Gmail
  OAuth flow + polling.
- **Phase 2 — AI Pipeline:** extraction API route; blind scoring route; gap
  analysis.
- **Phase 3 — Recruiter UI:** ranked shortlist (breakdown, gaps, blurred
  identity + Reveal); rubric weight editor.
- **Phase 4 — Scheduling:** interview creation + template picker + send-invite;
  candidate self-scheduling link; .ics generation.
- **Phase 5 — Reminder Engine:** 4 reminder_jobs per interview; Cloudflare
  Worker (built in isolation first); wire to /api/reminders/run.
- **Phase 6 — Closing the Loop:** rejection flow; post-interview scorecard.
- **Phase 7 — Pipeline & Polish:** Kanban; analytics; duplicate detection.
- **Phase 8 — Demo Prep:** seed JD + 8–10 varied CVs; rehearse 2–3 min demo;
  submission doc.
