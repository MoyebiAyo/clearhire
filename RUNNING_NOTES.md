# ClearHire — Running Notes (Week 1 + Week 2 + Week 3)

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

---

# Week 2 — AI Pipeline (extraction + blind scoring)

## Setup

Set `GROQ_API_KEY` in `.env.local` (free key from
[console.groq.com](https://console.groq.com)) and on Vercel. Optional:
`FALLBACK_AI_BASE_URL` / `FALLBACK_AI_API_KEY` for any OpenAI-compatible
fallback, `AI_MODEL` to override the default `llama-3.3-70b-versatile`,
`AI_DEBUG=true` for full prompt/response logging.

## What was built

### lib/ai.ts — the one AI doorway

Every AI call in the app goes through `chatJSON()`: OpenAI-compatible
`/chat/completions` against Groq's base URL, **temperature 0**, **JSON mode**
(`response_format: json_object`), 45s timeout, one retry per provider, then
automatic failover to `FALLBACK_AI_*` if configured. `mapWithConcurrency()`
caps batches at 4 in flight (free-tier rate-limit safety). Marked
`server-only` — importing it from client code fails the build. No new
dependencies: plain `fetch`.

### POST /api/jobs/[id]/extract — the extraction pass

- Finds applications on the job whose `cv_extractions` row has
  `skills IS NULL` (never extracted, or previously failed — **idempotent**).
- Calls the LLM with the spec's extraction prompt **verbatim**.
- Response validated by zod (`parseExtraction`): arrays coerced, education
  normalized to `{degree, institution}`, junk filtered.
- Success → updates the same `cv_extractions` row (structured fields +
  `extract_error = null`). Failure after retry → `extract_error` persisted,
  skills stays NULL so re-runs retry it. One bad CV never aborts the batch.

### POST /api/jobs/[id]/score — the blind scoring pass

- **Requirements derivation:** one preliminary LLM call turns `jd_text` into
  `[{requirement, type: hard|nice-to-have}]`, cached in
  `jobs.requirements_cache` (schema extension, migration 0002) — derived once
  per job, reused for every candidate.
- **Blind boundary:** the scoring payload is built server-side from
  `cv_extractions` ONLY — `skills, experience_years, certifications, tools`.
  Name, email, education/school are never included (education is stored by
  extraction but deliberately excluded from scoring input).
- **Audit:** every scoring call logs
  `[blind-audit] job=… app=… payload={…}` — inspect these lines (local
  terminal or Vercel logs) to prove the outgoing payload contains no
  identifying fields. This is the hackathon "evidence of testing" artifact.
- Spec scoring prompt **verbatim**; response validated (0–100 scores, gaps
  with hard/nice-to-have severity, rationale).
- **`total_score` is computed in code** — weighted sum of sub-scores under
  the job's rubric. The model never does arithmetic.
- Idempotent: only applications with extraction done and no `scores` row run.

### Migration 0002

`jobs.requirements_cache jsonb`, `cv_extractions.extract_error text`, plus
the UPDATE policies on `cv_extractions`/`scores` that Week 2+ needs
(documented extensions, commented in the SQL).

### UI — AI pipeline card + ranked results

- Job page now has an **AI pipeline** card: "1. Extract skills (N pending)"
  and "2. Score blind (N ready)" buttons with spinners, disabled states,
  tooltips explaining each step, per-run toasts (extracted count / scored
  count / failures with reason), and auto-refresh. Shows a friendly
  configuration warning when `GROQ_API_KEY` is missing.
- Candidates table is now the **ranked debug view**: scored candidates
  sorted by total score with rank numbers, the weighted total, per-criterion
  sub-scores (S/E/C/T), gap badges (red = hard requirement missing, grey =
  nice-to-have, hover for the missing skill), an expandable "Why this
  score" rationale, duplicate/extract-failed flags, and an "identities
  visible — blinding arrives in Week 3" banner. Unscored rows sort last.

## How to test (Week 2 definition of done)

1. `GROQ_API_KEY` set → open a job with uploaded CVs.
2. Click **1. Extract skills** → toast reports N extracted; Supabase →
   `cv_extractions` now has structured fields filled.
3. Click **2. Score blind** → toast reports N scored; table re-sorts by
   Score with sub-scores, gap badges, and rationales. 10 CVs → 10 ranked
   rows.
4. **Blind audit:** check the terminal (dev) or Vercel → Logs for
   `[blind-audit]` lines — payload shows only skills/years/certs/tools.
5. **Idempotency:** click Extract or Score again → "Nothing to do" toast,
   zero new rows, no duplicate scoring.
6. Optional: `AI_DEBUG=true` for full prompts/responses during debugging.

---

# Week 3 — Recruiter UI (shortlist, reveal, rubric editor)

## What was built

### Ranked shortlist — `src/components/shortlist.tsx` (the money screen)

Replaces the Week 2 debug table. Ranked cards, one per candidate:

- **Rank chip (#N)** — stable per page load, assigned by total score;
  unscored candidates get trailing numbers.
- **Blurred identity with blur-lift reveal** — the real name/email render
  under a 6px blur with `select-none` and `aria-hidden` until Reveal is
  clicked; the blur transitions away over 500ms. Unrevealed cards show
  "Candidate #N". Reveal persists via `applications.revealed_at`
  (migration 0003) — refresh-safe.
- **Score panel** — big weighted total + four sub-scores with mini progress
  bars, each tooltip'd with its rubric weight. Bar color reflects the score.
- **Gap badges** — red for hard requirements not met, grey for nice-to-have,
  hover shows the missing skill; "+N more" collapses long lists. Cards with
  no gaps show a green "Meets all requirements".
- **Sort/filter** — dropdown (Total / Skills / Experience / Certifications /
  Tools) and a "Missing hard requirement (N)" toggle chip.
- **Detail drawer** — slide-over with full sub-score bars + weights, every
  gap mapped to its requirement (with missing skill), rationale, source,
  applied date — and identity + "Download CV" only after reveal.

### Reveal — `POST /api/applications/[id]/reveal`

Sets `revealed_at` (idempotent — returns existing value if already set).
Presentation gate per spec Part 5, not a security boundary: identity is only
ever served to the authenticated, RLS-authorized recruiter. Optimistic UI
update + background persist; toast if the persist fails.

### CV downloads — `GET /api/applications/[id]/cv`

RLS-checked lookup, then a **5-minute signed URL** minted server-side from
the private `cvs` bucket via the service-role client. No public URLs exist;
the bucket stays private.

### Rubric editor — `src/components/rubric-editor.tsx` + extended `PATCH /api/jobs/[id]`

- Same live sum-to-100 validation as job creation, forgiving (cancel
  restores originals, errors never wipe input).
- **Weights-only change → totals recomputed in code** from the stored blind
  sub-scores. No LLM call, blind boundary untouched. Toast reports how many
  totals were recomputed.
- **JD change (opt-in, behind an explicit warning) → requirements cache
  cleared + scores rows deleted**, so "Score blind" re-runs under the new
  requirements (needs the new `scores_delete_own` policy, migration 0003).

### Job stage — `src/components/job-stage.tsx`

Owns the pipeline run state shared by the controls and the shortlist: while
extract/score is in flight, the shortlist dims and shows skeleton cards with
a live status line — the "skeleton loaders with live progress" requirement.

## How to test (Week 3 definition of done)

1. Open a scored job → ranked cards with sub-scores, weights, gap badges,
   rationale in the drawer. Names blurred, "Candidate #N" shown.
2. Click **Reveal** → blur lifts smoothly, "CV" button appears; reload the
   page → still revealed (persisted).
3. Sort by each criterion; toggle "Missing hard requirement" → only flagged
   candidates remain.
4. **Edit rubric & JD** → change weights to sum 100 → Save → toast says
   totals recomputed; totals on cards change without any AI call.
5. Edit the JD → Save → warning shown; scores cleared; "2. Score blind"
   becomes ready again; re-run → fresh scores under new requirements.
6. Reveal a candidate → Details → **Download CV** → file opens from a
   `sig=...` URL; the bare bucket URL still 403s.
7. Empty states: job with no CVs teaches the flow; CVs-but-unscored prompts
   to run the pipeline.

## Week 3 decisions

- `revealed_at` on `applications` (documented schema extension, migration
  0003) + `scores_delete_own` policy.
- Rubric re-score is code-only by design: uniform weight changes can't bias
  anything, and the blind payload is never re-sent. Only a JD change
  triggers a true AI re-score, and that clears scores for the whole job
  uniformly — never per-candidate post-reveal.
- Unrevealed identity data is served to the client under a blur (spec's
  "client-side gate" posture, stated in-UI microcopy too).

---

# Week 4 — Scheduling + Closing the Loop

## What was built

### Email foundation — `src/lib/email.ts`
- Resend via REST (no SDK): `sendEmail()` + `logEmail()` (every send writes
  email_log with the provider message id) + `renderTemplate()` for
  {{merge_fields}} + `buildIcs()` for valid VEVENT calendar files.
- `EMAIL_FROM` env (default: Resend's test sender). Without RESEND_API_KEY,
  sends fail softly with explanatory messages in the UI.
- 9 shared default templates (invite/reminder/rejection × formal/casual/
  technical) seeded by migration 0004; editable at **Settings → Templates**
  — editing a shared default FORKS your own copy (shared originals stay
  pristine for all recruiters).

### Interview creation + invite
- `POST /api/interviews` — interviewer, location, up to 3 offered slots
  (self-scheduling) OR a direct time. Creates an unguessable 32-hex
  `schedule_token` (documented schema extension). Direct bookings write the
  4 reminder rows immediately (spec 2.4: reminder rows attach to a CONFIRMED
  interview time; self-scheduling interviews get theirs on candidate pick).
- `POST /api/interviews/[id]/send-invite` — two-phase: `dry_run` drafts via
  the spec's email prompt (small fast model `gpt-oss-20b`; falls back to the
  raw template if drafting fails), then with a body sends via Resend +
  email_log. The invite embeds the candidate's personal scheduling link.
- Shortlist cards (revealed, scored) gain a **Schedule interview** flow:
  details → AI-drafted preview (fully editable) → Send.

### Candidate self-scheduling — `/schedule/[token]` (public)
- Token-authorized page: offered slots as cards rendered in the CANDIDATE'S
  OWN timezone, one-tap select, confirm.
- `POST /api/schedule/[token]` validates the slot, sets scheduled_time,
  writes exactly 4 reminder_jobs rows (2d/1d/12h/2h before), and emails a
  confirmation with the .ics attached (non-blocking on email failure).
- Confirmation screen with a prominent "Add to calendar (.ics)" button
  (`GET /api/schedule/[token]/ics`), plus the reminder-cadence microcopy.
- Recruiter side: "Copy link" button hands out the scheduling URL manually.

### Closing the loop
- `POST /api/applications/[id]/reject` — dry_run drafts a kind, personalized
  rejection (light on nice-to-have gaps only, never blunt, never fabricates,
  never mentions AI); with a body it sends + logs + sets status 'rejected'.
  If email fails, status still updates and the UI explains what happened.
- `POST /api/interviews/[id]/scorecard` — 1–5 rating + notes stored in
  interview_scorecards, advances the application to 'interviewed'.
- Card badges: Rejected / Interview date / "Invite sent — awaiting pick" /
  Scorecard ★n. The drawer shows an **AI blind score vs human rating**
  comparison block with notes.

## How to test (Week 4 definition of done)
1. Reveal a scored candidate → **Schedule interview** → offer 3 slots →
   Draft invite → edit → Send → check `interviews` + `email_log` rows
   (Supabase table editor) and the invite in the sending inbox.
2. Open the scheduling link (from the email, or "Copy link") → slot cards in
   your timezone → Confirm → confirmation screen + .ics download; Supabase
   shows scheduled_time set + exactly 4 reminder_jobs at −2d/−1d/−12h/−2h.
3. Direct-book an interview 3 days out → 4 reminder rows appear instantly.
4. Reveal another candidate → **Reject** → Draft → edit → Send and reject →
   status badge 'Rejected', email_log row, respectful email delivered.
5. Submit a **Scorecard** (1–5 + notes) → card shows ★n, drawer shows the
   AI-vs-human comparison.
6. Settings → Templates: edit a shared default → saved as your own copy.

## Week 4 decisions & notes
- Reminder rows attach to confirmation time (spec 2.4 wording), which for
  direct bookings equals creation time.
- Resend test sender (onboarding@resend.dev) only delivers to the account
  owner's email until a domain is verified — flows degrade gracefully and
  say so. Set `RESEND_API_KEY` + `EMAIL_FROM` (and verify a domain for real
  candidate sends).
- Interviews embed `interview_scorecards` via PostgREST nesting; everything
  recruiter-side is RLS-scoped; the public schedule endpoints authorize
  solely by the unguessable token (service-role lookups).

---

# Week 5 — Reminder Engine + Gmail Inbox Intake

## Track A — Reminder engine (VERIFIED LIVE)

### POST /api/reminders/run — exactly-once semantics
- Auth: `x-worker-secret` timing-safe compared against
  CLOUDFLARE_WORKER_SHARED_SECRET (401 without).
- Flow: query due+unsent rows joined through interviews (status must be
  'scheduled' — cancelled/completed skipped and counted as skippedCancelled)
  → **CLAIM atomically** (`UPDATE … WHERE sent = false RETURNING id`) →
  compose from the recruiter's reminder template (own copy else shared
  formal default) → **Resend BATCH** endpoint → email_log each send.
  If the batch fails, claimed rows are UNCLAIMED so the next run retries —
  sent-once-or-retry, never silently lost, never duplicated.
- **Verified live (2026-08-23):** 4 synthetic past-due reminders, two
  CONCURRENT invocations → run1 {claimed:4, sent:4}, run2 {claimed:0,
  "raced with another run"}, third run {due:0}. DB: 4/4 sent with sent_at,
  4 email_log rows. (Found + fixed two bugs during verification: a duplicate
  column in the embed select, and the embed key being `interviews` —
  relation name — not `interview`. Also learned Resend 422s reserved
  domains like example.com — use real-looking addresses in tests.)

### Cloudflare Worker (`worker/`) — LIVE since 2026-08-23
- `worker/src/index.ts`: MODE unset/log-only = logs every cron fire, touches
  nothing. MODE=live + APP_URL + SHARED_SECRET secrets = 15-min cron →
  /api/reminders/run, 10-min cron → /api/mailbox/poll, both with the
  shared-secret header.
- Deploy steps (needs one-time `wrangler login`):
  `cd worker && wrangler deploy` (isolation) → `wrangler tail` to confirm
  cron fires → `wrangler secret put APP_URL` (https://clearhire-rho.vercel.app),
  `wrangler secret put SHARED_SECRET` (value in .env.local
  CLOUDFLARE_WORKER_SHARED_SECRET), `wrangler secret put MODE` = live →
  `wrangler deploy`.

## Track B — Gmail intake (built; needs Google OAuth client creds)

### OAuth, minimum scope
- `/api/gmail/connect` → Google consent with **gmail.readonly +
  gmail.labels only**; `/api/gmail/callback` exchanges for a refresh token
  stored **encrypted** (pgcrypto PGP sym, key from GMAIL_ENCRYPTION_KEY env)
  via `gmail_store_token`; plaintext never touches the DB or client.
  Encryption key + worker secret generated and set on Vercel + .env.local.
- Setup needed once (RUNNING_NOTES below has the console steps): create
  GMAIL_CLIENT_ID/SECRET with redirect URI
  `https://clearhire-rho.vercel.app/api/gmail/callback`.

### POST /api/mailbox/poll — idempotent, matching, never drops
- Worker-secret OR recruiter session. Per connection: refresh-token →
  access token → recent `has:attachment` messages → skip already-processed
  (processed_emails log) → extract first PDF/DOCX attachment → match to an
  OPEN job (exact title → normalized title → ≥50% title-word overlap) →
  ingest via the shared pipeline (`lib/intake.ts`: text → private bucket →
  candidate (duplicate-flagged) → application → staged cv_extractions).
- Unmatched: CV preserved in the bucket + row in `unmatched_emails`
  (surfaced in Settings) — flagged for manual assignment, never dropped.
- Settings page: Gmail card (connect / status / last polled / Poll now /
  unmatched list). Until the worker is live, polls run on demand from there.

## Definition of done status
- ✅ 4 reminder rows on scheduling (Week 4) + fired once-and-only-once
  under concurrent double-invoke (live-tested this week)
- ⏳ Worker isolation deploy + cron confirmation → blocked on
  `wrangler login` (one command, then I finish it)
- ⏳ Email→application within one polling cycle → blocked on Google OAuth
  client credentials (GMAIL_CLIENT_ID/SECRET)
- ✅ Tokens encrypted at rest; OAuth scope is read+label only

## Worker deployment record (2026-08-23)
- workers.dev subdomain registered (clearhire-scheduler.workers.dev) via API.
- Isolation deploy confirmed via `wrangler tail`: cron fired 01:10 UTC,
  handler logged `[clearhire][isolation]`, touched nothing.
- Secrets set (APP_URL, SHARED_SECRET, MODE=live). Live evidence from tail:
  01:15 reminders → HTTP 200 {due:1, claimed:1, sent:1} (a real reminder
  fired end-to-end); 01:20 mailbox → HTTP 200 {connections:0} (correct —
  no Gmail connected yet). Crons: */15 reminders, */10 mailbox poll.

---

# Week 6 — Pipeline, Analytics, Demo Prep (final week)

## What was built

### Kanban pipeline — `/pipeline` (nav: Pipeline)
- All-jobs board + per-job filter. Columns: Applied → Screened →
  Shortlisted → Interview Scheduled → Interviewed → Offer/Rejected
  (combined final column, badges distinguish). Column counts, hover a
  column title for a stage explanation.
- Native drag-and-drop (drop-zone highlight, dragged card dims) PLUS a
  per-card stage dropdown — the accessible path. Optimistic updates with
  rollback + toast on failure.
- Moving to Rejected opens the Week 4 rejection drafting flow (dialog).
- Statuses now advance automatically where it makes sense: scoring →
  'screened', scheduling → 'interview_scheduled', scorecard →
  'interviewed' (each sets the new applications.status_changed_at).

### Duplicate resolution (spec 2.6 UI)
- The "Duplicate — applied to this job" badge on shortlist cards is now a
  button opening a decision dialog: **Use this application** (merges:
  removes the earlier same-candidate-same-job applications, cascades their
  interviews/reminders, this one becomes canonical) or **Keep both**
  (dismisses the flag). Nothing merges silently.

### Analytics — `/analytics` (nav: Analytics)
- Source split (email vs upload), stage drop-off funnel (highest stage
  reached per application, cumulative %), time-to-hire per job + averaged
  (applied_at → status_changed_at on offer). Pure CSS bars; each chart ends
  with a computed plain-English takeaway line.

### Demo tooling (Phase 8)
- **Fire reminder** button on scheduled candidates' shortlist cards:
  session-auth'd POST /api/demo/reminder arms the earliest unsent future
  reminder (fire_at → now) and runs the exact same engine
  (lib/reminders-runner.ts) the worker cron uses — demo-safe, zero
  database surgery. (The runner was refactored out of the route into
  lib/reminders-runner.ts, shared with /api/reminders/run.)
- `docs/DEMO.md` — the minute-by-minute 3-minute script + the demo JD.
- `docs/SUBMISSION.md` — problem, workflow, tools, REAL sample I/O (a real
  CV's extraction + scoring JSON pulled from the live DB), and the testing
  evidence (blind-audit, exactly-once concurrency test, RLS isolation,
  worker isolation-first record, security checklist).

### Hardening pass (verified 2026-08-23)
- cvs bucket public:false ✓ · invalid-key reads blocked on all 14 tables ✓
  (RLS enabled by migrations 0001-0006 on every table) · blind scoring
  server-enforced + audit-logged ✓ · Gmail tokens pgcrypto-encrypted,
  scope read+label ✓ · all 11 spec Part 5 routes live (plus apps/[id],
  resolve-duplicate, demo/reminder, templates/[id], gmail connect/callback)
  ✓ · service-role key server-only (build-time guard) ✓.

## Migration 0006
applications.status_changed_at (documented extension) — powers
time-to-hire; set by every status-changing flow.

## Definition of done checks (run before the demo)
1. Follow docs/DEMO.md setup (JD + 10 test CVs) → run the script top to
   bottom without touching the database.
2. Pipeline: drag a card between stages; drop one on Offer/Rejected;
   counts update; analytics reflect the moves.
3. Duplicate badge → resolve both ways on a throwaway pair.
4. Fire reminder sends a real email once.

## Gmail intake — "0 mail scanned" diagnosis (final)
- DB check: connection exists, `last_polled_at` fresh → auth + token refresh work server-side.
- Direct Gmail API probe (curl + stored refresh token): profile returns `moyebiayodelesegun@gmail.com` (33k msgs), but `has:attachment newer_than:7d` = **0 messages, including self-sent**. The inbox simply had no CV email — the poller reported truthfully. No bug.
- Fixed a real cosmetic bug found along the way: OAuth flow requests only Gmail scopes → no `id_token` → `gmail_address` stored as "(unknown)". Callback now fetches the address from Gmail's `/users/me/profile` (works under `gmail.readonly`); existing row backfilled.
- Correct test (must be INCOMING mail): send FROM a different account (e.g. me@ayodev.tech) TO the connected Gmail, subject "Application for Senior Backend Engineer" (open job exists), test CV PDF attached → Settings → Poll now.

## Per-job Gmail pull + connect explainer (post-Week 6)
- Extracted the poll logic into `src/lib/mailbox.ts` (`pollConnection`) shared by
  the global poll (cron / Settings) and the new POST `/api/mailbox/pull`
  (session-auth, `{jobId}`). Scoped pulls match subject → that job only
  (any status — explicit intent), leave all other emails untouched for the
  global poll (never marked processed), and are idempotent via processed_emails.
- Job page now reads the recruiter's gmail_connections row and renders a
  "Pull from Gmail" row inside the "Add CVs" card (or a Settings nudge when
  not connected). Pulled CVs join the same staging list as uploads.
- Connect button now has a 4-point explainer: why Google shows "unverified",
  Advanced → continue, read-only scope, encrypted token.
- Verified live post-deploy: worker-secret poll returns `{connections:1,
  scanned:0, errors:[]}` (refactor intact); `/api/mailbox/pull` returns 401
  unauthenticated.

## AI Chat Assistant + AI-Powered Exam Engine (post-Week 6, approved plan)
Three workstreams, all live-verified:

**A. Rejected bucket** — rejected applications leave the ranked shortlist into a
collapsible "Rejected (N)" section with per-card Undo (reverts to screened/applied,
scores untouched; `POST /api/applications/[id]/undo-rejection`). Pipeline kanban
stays the full oversight view.

**B. Exam engine** — migration 0007: `exams` / `exam_questions` / `exam_invites`
(RLS via exams→jobs chain; anon reads verified blocked), exam_invite templates ×3
tones. `sendEmailBatch` chunks 10/call @500ms. Setup: POST create (draft, one
active exam/job) → /generate?limit=25 chunked bank building from JD +
requirements_cache (difficulty calibrated to JD seniority) → /activate invites
(deterministic selection in code) + batch emails. Candidate side /exam/[token]:
briefing → fullscreen timed run → seeded per-candidate draw + option shuffle
(stable across refreshes; correct_index NEVER sent to client) → server-side
grading in code (text-match against options[correct_index]); 3-strike proctoring
(tab switch/blur/fullscreen exit/copy/screenshot key), tab close = immediate
forfeit via sendBeacon, overtime = forfeited-but-graded, idempotent submit,
late-answers-after-strike-3 still graded. Blended finals: final = CV×wCv +
Exam×wExam (weights printed inline; exam bar on cards; rank by final; absent
exam = CV-only, no silent zeros).
Live DoD (throwaway exam on the closed job, deleted after, zero residue):
409 before start ✓ stable draw ✓ no correct_index leak ✓ all-correct = 100 ✓
idempotent resubmit ✓ strikes 1/2/3 → forfeited ✓ questions blocked after
forfeit ✓ 404 bad token ✓ page 200 ✓ late-empty-answers forfeit score 0 ✓.

**C. Copilot** — slide-over drawer on the job page ("Ask AI"). JSON-action
protocol over chatJSON (temp 0, backoff) rather than native tool calling
(gpt-oss-120b tool-call reliability issues documented in the wild). Blind
context server-enforced (identity only for revealed; [blind-audit] logged);
model PROPOSES criteria, code resolves ids deterministically — reject_preview
and exam_setup return confirmation cards, cv_scan composes cited evidence
answers in code from raw_text (≤12 CVs × 2600 chars). Executors:
POST /api/applications/reject-bulk (status flip first, then throttled batch
emails, per-candidate logging, failures retryable) and the exam setup flow.

## Backup Groq key — automatic takeover
`GROQ_FALLBACK_API_KEY` added to the provider chain (src/lib/ai.ts): same Groq
model/prompts, second free-tier key. When the primary key's quota/rate limit
exhausts (429s surviving all 4 backoff attempts) or its auth fails (401 →
instant failover), the chain moves to `groq-backup` automatically — no code
or deploy needed at failure time. Verified: backup key live-valid (JSON mode),
and a scratch replica of the chain with a dead primary key failed over and
answered via the backup. Rotate both keys post-hackathon (pasted in chat).

## Exam-generation "network error" — root cause + fix
Symptom: Copilot exam setup failed with a generic network error. Root cause:
Groq's free tier counts PROMPT + max_tokens against an ~8k tokens-per-minute
ceiling; the generate route requested max_tokens 8000 + JD prompt → instantly
rejected ("Request too large… TPM: Limit 8000") on BOTH keys, and the route
let the error escape as an HTML 500 (client JSON parse → "network error").
Fixes: chunks 25→12 questions with max_tokens 4200 (live-timed: 12 questions,
4.7s, 1.9k tokens — far under the ceiling); route returns a clean JSON error
(aiUserMessage) instead of 500 HTML; cv_scan corpus trimmed 12×2600→8×2200
chars, maxTokens 1200 (same trap). Not a Vercel/timeout issue.

## Lengthy CVs — full-text handling (user-flagged)
"2 pages full" CVs (6–14k chars) were being cut in two places. Fixed:
- Extract: MAX_RAW_CHARS 10k → 14k (~2–3 dense pages; still ~3.5k tokens, under
  the per-request ceiling).
- Copilot cv_scan: was 8 CVs × first 2200 chars (page-2 leadership evidence
  lost). Now scans FULL stored text, packed into ≤24k-char requests (~6k
  tokens each), up to 3 sequential rank-ordered calls; the shared backoff
  absorbs rolling 429s. Answers state coverage honestly ("scanned the top N
  by score of M") when the bank of CVs exceeds the token budget.

## Rotating status lines — first-run fix + timing expectation (user-flagged)
The Week 2 rotating copy ("grab a coffee…", "scoring blind…") only rendered
when the shortlist already had scored candidates — invisible on the very
first Extract/Score run (exactly the demo path). Moved the rotating line +
progress bar INTO the AI pipeline card under the buttons (where the click
happened), shown on every run, with a caption: "This can take up to 3
minutes depending on how many documents you uploaded — everything is saved
as it goes, so it's safe to wait." The shortlist now shows skeletons while
busy regardless of scoredCount; static empty cards step aside during a run.
Lines rotate every 2.8s with the fade-swap animation.

## Role requirements: dropped from create form → review-after-create (user decision)
The create-job form no longer asks for structured requirements — JD only
(removes the "type it twice" friction). Scoring semantics unchanged: authored
requirements if present, else AI-derived requirements_cache from the JD.
New flow: the job page's "How this job is scored" card shows the effective
criteria with provenance ("Set by you" / "Derived by the AI") and a hint
before the first score run; "Edit scoring setup" (was "Edit rubric & JD")
gains an editable criteria list (Mandatory/Preferred rows). PATCH
/api/jobs/[id] mode 4: { requirements } — validated via the shared
requirementsSchema; a change clears existing scores (same as a JD change),
empty array = back to AI derivation.

## Vercel deploy fix: remotion/ excluded from builds
The Remotion demo-film project (remotion/) was being uploaded and
type-checked by Vercel, failing on `Cannot find module 'remotion'` (package
only installed locally). Fixed via tsconfig exclude + .vercelignore — the
folder never uploads; Remotion keeps building with its own tooling locally.

## Resend batch sender: 429/Retry-After aware (rate-limit hardening)
Free-tier reality: 10 req/s per team (batch call = 1 request) but 100
emails/day — the daily cap is the demo-day risk when judges test
back-to-back on the shared sender. sendEmailBatch now retries transient
failures (429, 408, 5xx, network) up to 3 attempts per 10-email chunk,
honoring Retry-After (capped 8s; windows >30s such as exhausted daily
quota fail fast), with a 35s retry budget to stay inside the 60s
serverless window. Deterministic 400/422 keeps the per-email fallback.
Claim-first flows unchanged: rejections/invites never half-complete on
email failure; failures stay visible in email_log + retryable.

## Voice Copilot: Deepgram Voice Agent + BYO-Groq brain (talk to your shortlist)
The job-page Copilot now has a Voice mode (mic button next to the input).
Same blind brain as typed chat — spoken answers in ~1s, barge-in supported,
and every action still lands as a click-to-confirm card (voice NEVER
executes anything).

Architecture (all keys stay server-side):
- STT Nova-3 + TTS Flux `flux-kit-en` + think = Groq `openai/gpt-oss-120b`,
  all inside one Deepgram Voice Agent session
  (`wss://agent.deepgram.com/v1/agent/converse`).
- The browser never sees the Deepgram key: it connects to our Cloudflare
  Worker (`/ws/agent?ticket=…`), which verifies an HMAC voice ticket
  (60-min TTL, job-bound) and proxies raw frames to Deepgram with the key
  in the subprotocol. Grant-JWT tokens were rejected on the agent WS for
  this account — the worker proxy with the raw key is the workaround.
- The think step calls back to `/api/voice/llm` (OpenAI-compatible) with
  the voice ticket as bearer; that route swaps in the real Groq key,
  force-pins the model, caps 300 tokens, streams SSE through. Deepgram
  never holds any ClearHire key.
- `/api/voice/session` mints ticket + blind prompt (spoken rules: 1–3
  sentences, never speak emails, propose-only) + 3 client-side functions
  (propose_rejection, propose_exam, scan_cv_evidence). FunctionCallRequest
  is resolved by `/api/jobs/[id]/voice/function` (shared resolvers from
  `lib/copilot-brain.ts`) → `{speak, action}`; the action card renders in
  the SAME chat thread as typed commands.
- Mic: AudioWorklet (`public/voice-worklet.js`) Float32→Int16 @16kHz;
  playback queue stops instantly on UserStartedSpeaking (barge-in);
  KeepAlive every 8s while silent.

Worker-proxy gotchas (cost a day, worth recording):
- Cloudflare Workers deliver inbound WebSocket binary messages as **Blob**;
  forwarding a Blob raw makes the runtime stringify it ("[object Blob]"),
  and Deepgram kills the session with UNPARSABLE_CLIENT_MESSAGE. Every
  frame is normalized to string | Uint8Array before forwarding.
- Outbound WS from a Worker must be `fetch("https://…", {Upgrade:
  "websocket"})` — `wss://` in fetch hangs.
- Deepgram drops the session after ~10s without audio; the mic-less E2E
  pumps low-level noise frames (pure zeros don't count).
- Managed `think.provider.type: "groq"` only knows models on Deepgram's
  list — `openai/gpt-oss-120b` needs the BYO `think.endpoint` (our proxy).

E2E: `node scripts/test-voice-agent.mjs` — 20 checks, mic-less: signup →
job + 2 CVs → blind score (95 vs 18) → session mint + guards → real WS →
"strongest candidate?" (blind answer + TTS bytes) → "reject everyone below
60" (FunctionCallRequest → real resolver → spoken proposal). Cleans up its
temp account.

Costs: Deepgram BYO-LLM ≈ $0.05–0.065/connection-minute (free credits
cover the fest many times over); Groq tokens negligible.
ROTATE POST-HACKATHON: DEEPGRAM_API_KEY + both Groq keys (they live only
in Vercel/Worker env, never in the bundle).

### Browser-only voice bugs the mic-less E2E couldn't see (both fixed)
1. **Middleware ate the worklet.** The auth middleware's matcher excluded
   `_next` and images but not `public/*.js`, so `audioWorklet.addModule
   ("/voice-worklet.js")` chased a 307 to /login (even WITH a session
   cookie) and voice never started. Static asset extensions (js/css/map/
   fonts) are now excluded from the matcher.
2. **Inverted decimation stretched the mic.** The worklet emitted ~ratio
   samples per INPUT sample instead of one per ratio inputs — Deepgram
   got 48kHz audio 9x too fast at 1/3 pitch and could transcribe nothing
   (agent stays silent; greeting still plays). Now: one output per ratio
   inputs, verified in Node (3s 48kHz → 3.000s 16kHz, pitch preserved).

### "Failed to think" — Groq rate limits under barge-in bursts (fixed)
Root cause found by bursting the prod proxy: 6 concurrent think calls → 2
429s → 502 → Deepgram's "Failed to think. Please check your agent.think
settings." Barge-in cancels a turn and starts a new one while the typed
Copilot shares the same GROQ_API_KEY — bursts are normal voice-session
behavior. Two fixes in /api/voice/llm: (1) fail over instantly through the
same key chain as lib/ai.ts (GROQ_FALLBACK_API_KEY, _KEY_2) on any
non-OK/Network error, failing fast on 400/422; (2) AbortSignal.any ties the
Groq request to the incoming request, so a canceled think call no longer
leaves a phantom call burning the rate limit for 45s. Verified: 8/8
parallel calls 200 post-deploy (was 4/6).
3. **TTS was scheduled into silence.** `playAudioChunk` created buffer
   sources and `start()`-ed them but never `connect()`-ed them to
   `ctx.destination` — Web Audio nodes are inaudible until connected.
   Text transcripts worked, so the session LOOKED alive; only the
   speaker path was dead. Fixed + a `ctx.resume()` guard for autoplay
   suspension.

New guard: `scripts/test-voice-browser.mjs` — a real headless-Chromium
voice test (Chrome fake mic, audio-node instrumentation before app code,
drives the actual UI). Asserts TTS buffer sources are connected to the
destination and started, and binary TTS frames flowed. This is the tool
that would have caught all three browser-only bugs above.

### Think-call token diet (Groq TPM math)
Probed the keys directly: openai/gpt-oss-120b allows only 8,000
tokens/min PER KEY, and Deepgram re-sends the whole system prompt on
every think call — a big shortlist made each turn cost 2-4k tokens.
Voice now caps context detail at the top 12 candidates (rest summarized
as one aggregate line; function resolvers still act on everyone) and
trims the JD excerpt. /api/voice/llm also waits out 429 Retry-After
windows up to 2s once per key (Groq's token bucket usually resets in
<1s) and returns 499 immediately when Deepgram cancels a think call
(barge-in) instead of fanning the canceled request out to the other
keys. Ceiling now: 3 keys x 8k TPM = 24k tokens/min for the whole app;
if a demo still exhausts it, next lever = pin voice to its own model
(e.g. llama-3.3-70b-versatile) for a separate bucket.
