# ClearHire — Running Notes (Week 1)

Feature-by-feature walkthrough of everything built this week: where it lives,
what it does, and how to test it. Read top-to-bottom as a tour of the app.

## Setup first

Follow [README.md](README.md): create the Supabase project, run
`supabase/migrations/0001_init.sql` in the SQL editor, set the three env vars
in `.env.local`, `npm install && npm run dev`.

---

## 1. Authentication

**Where:** `src/components/auth-form.tsx` (form), `src/app/login/page.tsx`
(page + brand panel), `src/middleware.ts` (session refresh + route guard),
`src/lib/supabase/{server,browser}.ts` (clients), `src/lib/supabase/admin.ts`
(service-role client, server-only).

**What it does:** Email/password signup and login via Supabase Auth. A
database trigger (`handle_new_recruiter` in the migration) auto-creates the
`recruiters` profile row on signup; if you typed a company name at signup it
lands in `recruiters.org_name`. Middleware keeps logged-out visitors on
`/login` and refreshes sessions on every request.

**How to test:**
1. Sign up with a company name → you land on the dashboard and the top bar
   shows your company.
2. Log out → any URL (e.g. `/jobs`) redirects to `/login`.
3. If "Confirm email" is ON in Supabase, you'll see a "check your email"
   state instead of instant access — that's expected.

## 2. App shell & dashboard

**Where:** `src/components/app-shell.tsx`, `src/app/(app)/layout.tsx`
(auth guard), `src/app/(app)/dashboard/page.tsx`.

**What it does:** Sidebar (Dashboard / Jobs) with active-state highlighting,
top bar with workspace name + sign out, and a dashboard with three stat
cards (open jobs, applications, candidates), recent jobs, and a teaching
empty state that explains the blind-scoring flow before you've built
anything.

**How to test:** Fresh account → dashboard shows the "Create your first job"
empty state with a CTA. After creating jobs, stats and the recent list fill
in (counts are RLS-scoped, so you only ever see your own).

## 3. Job creation with rubric validation

**Where:** `src/components/job-form.tsx` (client), `src/app/(app)/jobs/new/page.tsx`,
`src/app/api/jobs/route.ts` (POST/GET), `src/lib/validation.ts` (zod schema —
the same sum-to-100 rule enforced server-side).

**What it does:** Title + JD textarea + four weight inputs (Skills /
Experience / Certifications / Tools, defaults 40/30/15/15). The running total
renders as a live badge and progress bar — green at exactly 100%, amber
under, red over. Save is blocked client- AND server-side unless the sum is
exactly 100. Each field carries helper text explaining what it controls.

**How to test:** Try to save with weights summing to 90 → inline error, form
data preserved. Set them to 100 → redirects to the new job page with a
success toast.

## 4. Jobs list + close/reopen

**Where:** `src/app/(app)/jobs/page.tsx`, `src/components/job-actions.tsx`,
`src/app/api/jobs/[id]/route.ts` (PATCH).

**What it does:** List with title, application count, created date, open/closed
badge. Close/reopen button (with a tooltip explaining what closing means)
PATCHes the status; a closed job refuses new CV uploads (409 from the API,
friendly message in the uploader).

**How to test:** Create a second job from the Jobs page ("New job" button) →
both appear. Close one → badge flips, upload section on its detail page shows
"job is closed" and disables the dropzone. Reopen → uploads work again.

## 5. Bulk CV upload pipeline (the core of Week 1)

**Where:** `src/components/cv-uploader.tsx` (drag & drop UI, two-pass email
flow), `src/app/api/jobs/[id]/cvs/route.ts` (server pipeline),
`src/lib/cv/text.ts` (PDF/DOCX text extraction, email + name parsing),
`src/lib/supabase/admin.ts` (storage + cross-cutting writes).

**What it does, per file:**
1. Raw text extracted (unpdf for PDFs, mammoth for DOCX).
2. Email parsed from the text (`parseEmail`); if absent, the file is returned
   as `needs_email` — no record is created until you supply one inline.
3. Original file uploaded to the **private** `cvs` bucket at
   `{job_id}/{uuid}-{filename}`.
4. Candidate row created (`source = 'upload'`, name guessed from the top of
   the CV) — or, if the email already exists, the existing candidate is
   reused and the application is stamped `flagged_duplicate = true`.
5. Application row created (`status = 'applied'`, `cv_file_path` set).
6. A `cv_extractions` row stages the raw text now; Week 2's extract pass will
   fill the structured fields on this same row (idempotent via
   `skills IS NULL`).

One bad file never aborts the batch — every file gets its own result row:
green "Added" (with email, and a warning badge if it linked to an existing
candidate), amber "needs email" (with an inline input + save button), or red
"Failed" (with the reason).

**How to test (the Week 1 definition of done):**
1. Upload 10 mixed PDF/DOCX CVs against a job → 10 rows in the Candidates
   table on the job page; `candidates` and `applications` each have 10 rows;
   `cv_extractions.raw_text` is populated for all 10.
2. Include a CV with no email address → it comes back amber; type an email,
   click save → it turns green.
3. Upload a CV whose email you've used before (any job) → it's added but
   flagged "Possible duplicate" on the candidates table.
4. Drop a `.txt` or `.exe` file → client-side rejection toast, never sent.
5. Storage check: Supabase dashboard → Storage → `cvs` bucket → files exist,
   bucket is private; a raw URL like
   `https://<project>.supabase.co/storage/v1/object/public/cvs/...`
   returns 400/403 (public access doesn't exist for this bucket).

## 6. Security posture (spec Part 7)

- **RLS on all 11 tables** — policies in the migration scope every read to
  the owning recruiter, through the ownership chain
  (e.g. `reminder_jobs → interviews → applications → jobs.recruiter_id`).
- **Two-account test (definition of done):** create Recruiter A and
  Recruiter B. As B, open `/jobs/{A's job id}` → 404 (RLS hides it). B's jobs
  list never shows A's jobs. B's dashboard counts exclude A's applications.
- **Private storage:** CV files live only in the private `cvs` bucket and are
  written by the service-role client server-side. The browser never talks to
  storage directly.
- **Service-role key discipline:** `admin.ts` imports `server-only`, so any
  accidental import from a client component fails the build. The key itself
  is read from `SUPABASE_SERVICE_ROLE_KEY` and never has a `NEXT_PUBLIC_`
  prefix.

## Deliberate decisions & documented schema extensions

- `applications.flagged_duplicate boolean` — added to the spec schema for the
  Week 1 duplicate guard ("flagged, not duplicated silently").
- `cv_extractions` rows are created at upload time holding `raw_text`
  (structured fields null). This stages Week 2 cleanly without a second
  staging table; the schema itself is unchanged.
- `candidates` insert policy allows any authenticated user (a brand-new
  candidate has no application yet, so recruiter scoping is impossible at
  insert time). Reads stay scoped via the applications join. Writes happen
  only inside authenticated server routes. Noted as a trade-off in the
  migration.
- Env var names: the plan/spec say `SUPABASE_URL`/`SUPABASE_ANON_KEY`;
  Next.js requires the `NEXT_PUBLIC_` prefix for browser-visible values, so
  the repo uses `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- The uploader's second pass re-sends the original files with the supplied
  emails (stateless server, no temp storage). Extraction re-runs — fine at
  this scale.

## Week 2 hooks (what's ready to build on)

- `lib/ai.ts` will wrap Groq (OpenAI-compatible) — every call goes through
  it, temperature 0, JSON mode.
- `POST /api/jobs/[id]/extract` picks up `cv_extractions` rows where
  `skills IS NULL` and fills the structured fields.
- `POST /api/jobs/[id]/score` builds the blind payload from `cv_extractions`
  only (no name/school/email), computes `total_score` in code from the job's
  weights, and stores per-criterion sub-scores + `gaps` + `rationale`.
- The job detail page's Candidates table becomes the ranked shortlist with
  reveal-on-click.
