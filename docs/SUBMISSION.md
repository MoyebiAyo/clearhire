# ClearHire — AI BuildFest 2026 Submission (Track 1, Case Study 3)

## Problem
Recruiters at SMEs face 300 applications and read 40. Screening quality
collapses with fatigue, scheduling eats the week, and rejected candidates
get silence — a broken first impression repeated at scale (spec 1.1).

## Workflow
CVs enter by drag-and-drop upload or a connected Gmail inbox (OAuth,
read+label scope, tokens encrypted with pgcrypto). Each CV is parsed by an
LLM into structured JSON, then scored 0–100 per criterion against the
recruiter's own rubric — **blind**: the scoring payload physically excludes
names, schools, and every identifying field, enforced server-side and
audit-logged. Recruiters review a ranked, de-identified shortlist, reveal
identities per candidate (scores locked first), schedule with
candidate self-service (timezone-aware, .ics attached), and four reminders
(2d/1d/12h/2h) fire exactly once via a Cloudflare Worker cron through
Resend. Rejections are AI-drafted from the gap analysis — respectful,
human-edited, always sent. Every email is logged. A Kanban pipeline and
plain-English analytics close the loop.

## Tools
Next.js 15 (App Router, TypeScript) on Vercel · Supabase (Postgres + RLS on
every table, Storage, pgcrypto) · Groq API `openai/gpt-oss-120b` /
`gpt-oss-20b` (temperature 0, JSON mode, exponential backoff) · Resend
(batch API, verified domain) · Cloudflare Workers (cron: 15-min reminders,
10-min mailbox poll) · Gmail API v1.

## Sample input → output (real data from the live app)

**Input:** a real uploaded CV (PDF/DOCX) → raw text extracted server-side.

**Extraction pass output** (candidate `me@ayodev.tech`):

```json
{
  "skills": [
    "Next.js",
    "React",
    "React Native",
    "Expo",
    "TypeScript",
    "JavaScript",
    "Node.js",
    "Django",
    "Supabase",
    "PostgreSQL",
    "Tailwind CSS",
    "HTML5",
    "REST APIs",
    "Paystack",
    "Flutterwave",
    "Git",
    "Vercel",
    "Cloudflare",
    "Postman",
    "Figma",
    "Resend",
    "Claude AI",
    "Graphic Design",
    "Brand & Visual Identity",
    "Video Editing",
    "Social Media Strategy",
    "Content & Brand Storytelling",
    "Community & Audience Growth",
    "Product Strategy",
    "Project & Client Management",
    "Stakeholder Management",
    "Teaching & Mentoring",
    "Cross-functional Team Leadership"
  ],
  "experience_years": 7,
  "certifications": [
    "OpenAi grant for Startup and founders",
    "Z.ai for startup grant",
    "Award of excellent service NCCF National Secretariate and NCCF Plateau State Chapter",
    "GitHub Student Developer Pack",
    "5.0-star client rating on Google and Fiverr for web design and development work"
  ],
  "tools": [
    "Git",
    "Vercel",
    "Cloudflare",
    "Postman",
    "Figma",
    "Resend",
    "Claude AI",
    "Photoshop",
    "Illustrator",
    "Premi
```

**Blind scoring pass output** (weighted total under the 40/30/15/15 rubric —
total computed in code, never by the model):

```json
{
  "gaps": [
    {
      "severity": "nice-to-have",
      "requirement": "Familiarity with Docker and containerized deployments",
      "missing_skill": null
    },
    {
      "severity": "nice-to-have",
      "requirement": "AWS Certified Developer or equivalent certification",
      "missing_skill": null
    }
  ],
  "rationale": "Candidate has 7 years experience, exceeds the 4\u2011year hard requirement, and demonstrates strong Node.js, TypeScript, PostgreSQL, REST API, Git, CI/CD and cloud hosting (Vercel/Cloudflare) skills. All hard requirements are met, yielding high skills and experience scores. The only unmet items are Docker experience and an AWS certification, both nice\u2011to\u2011have, which lower the certifications and tools scores. Overall fit is strong.",
  "total_score": 81,
  "skills_score": 90
}
```

## Evidence of testing
- **Blind-scoring audit:** every scoring call logs its exact outgoing
  payload (`[blind-audit]` lines) — four keys: skills, experience_years,
  certifications, tools. Nothing identifying is ever sent; verified by log
  inspection on live runs.
- **Exactly-once reminders (live test, 2026-08-23):** 4 synthetic past-due
  reminders + two CONCURRENT invocations of /api/reminders/run →
  run1 {claimed:4, sent:4}, run2 {claimed:0, "raced with another run"},
  third run {due:0}. DB: 4/4 sent once with sent_at; 4 email_log rows.
- **RLS isolation (live test):** Recruiter B reading/patching/deleting
  Recruiter A's job → 0 rows affected across all attempts.
- **Worker isolation-first:** deployed log-only, cron fires confirmed via
  `wrangler tail` (01:10 UTC) BEFORE secrets connected it to real data;
  first live run sent a real reminder (01:15 UTC).
- **Security checklist:** CVs in a private bucket (public:false verified;
  5-min signed URLs only) · RLS on all 15 tables · service-role key
  server-only (build fails on client import) · Gmail OAuth minimum scope,
  tokens encrypted at rest · AI error messages sanitized client-side.
- **All 11 spec Part 5 routes** implemented and exercised end-to-end.

## Expected business impact
A recruiter screening 300 CVs reviews a ranked, explainable shortlist in
minutes instead of hours; every candidate gets a fair, de-identified read
and a respectful close; no-shows drop through a proven reminder cadence.
The hiring decision stays exactly where it belongs — with the human.
