# ClearHire — 3-Minute Demo Script (Phase 8)

**Setup before the demo (5 min):** create a job with the JD below
(weights 40/30/15/15), upload all 10 CVs from `test-cvs/`, give CV 09 an
email when prompted, click **1. Extract skills**, then **2. Score blind**.
Have a second browser tab on the Pipeline page.

## The demo JD (paste into job creation)

> Senior Backend Engineer. Must have: 4+ years professional backend
> development; strong Python and/or Go; PostgreSQL or comparable relational
> database experience; experience designing and maintaining REST APIs;
> comfort with Docker. Nice to have: Kubernetes; AWS/GCP cloud experience;
> Terraform; a relevant certification (e.g. AWS SA, CKA).

## Minute-by-minute

1. **0:00 — Upload (job page).** Drag the 10 test CVs in. "Ten CVs, mixed
   PDF and DOCX, one with no email — ClearHire asks me inline rather than
   guessing. One is a returning candidate from another job, one is a true
   duplicate — both flagged, nothing silently merged."
2. **0:25 — Extract + blind score.** Click Extract (watch the progress bar
   and rotating status), then Score blind. "The AI never sees names or
   schools — here's the ranked shortlist with per-criterion sub-scores under
   MY rubric weights."
3. **0:55 — Reveal + gap analysis.** Cards are blinded. Reveal the top
   candidate — smooth blur lift. Open Details: gaps mapped to requirements,
   red for hard, grey for nice-to-have, plus the rationale. "The score was
   locked before I ever saw a name."
4. **1:20 — Schedule.** On the top candidate: Schedule interview → offer 3
   slots → the AI drafts the invite from my template → I edit one line →
   Send. Open the scheduling link (Copy link) → slots in the candidate's
   timezone → confirm → "You're all set!" + download the .ics. "Four
   reminders are armed automatically — 2 days, 1 day, 12 hours, 2 hours."
5. **2:00 — Fire a reminder live.** Back on the job page, the candidate's
   card now has **Fire reminder** (demo-safe fast-forward). Click it —
   "that just sent a real reminder email through the batch engine, exactly
   once, same code path the Cloudflare cron uses every 15 minutes."
6. **2:20 — Close the loop.** Scorecard on the interviewed candidate
   (rating 4, quick note) — "human score sits beside the AI's blind score,
   that's how the rubric gets audited." Reject another candidate — AI drafts
   a kind rejection referencing the process, I edit and send. "Nobody gets
   ghosted."
7. **2:45 — Pipeline + Analytics.** Flip to the Pipeline tab: drag a card
   across stages, show counts. Analytics: source split, drop-off funnel,
   time-to-hire. "The whole funnel, one screen."

**Never do live:** database edits (the Fire reminder button replaces that),
and never show raw provider errors (they're sanitized to human messages).

## Bonus: Gmail inbox intake (if the judge wants it)

> Requires: Settings → Gmail connected (Google shows an "unverified app"
> screen — Advanced → Go to ClearHire (unsafe); that's expected, see the
> explainer under the connect button).

1. From any other email account, send a message to the connected inbox with
   the subject `Application for <open job title>` and a CV PDF attached.
2. Two ways to pull it in:
   - **On the job page** (recommended): "Add CVs" card → **Pull now** —
     ingests only emails about that job, straight into its pipeline.
   - **Settings** → **Poll now** — global scan that routes each CV email to
     the best-matching open job.
3. The CV appears staged alongside uploads → Extract → Score as usual.
   Emails that match no job are preserved under "waiting for manual
   assignment" on Settings — nothing is ever dropped. Auto-poll runs every
   10 minutes via the Cloudflare worker.

## Minute 4 bonus: the Copilot + live exam
1. On the job page, click **Ask AI** → type "Who's below 60?" → a rejection
   card appears listing the matches → confirm → they're rejected AND emailed,
   then moved to the Rejected list (undoable in one click).
2. Type "Set up an exam for everyone above 70" → edit the AI's proposal
   (questions, minutes, CV/exam weights) → Generate & invite → questions are
   written from YOUR job description.
3. Open one of the invite links in another tab: full-screen, countdown,
   tab-switch = strike (3 = forfeited). Submit → the score blends into the
   shortlist automatically (Final = CV 70% + Exam 30% by default).
Everything the Copilot saw was blind — skills and scores, never names.

## Minute 5 bonus: talk to your shortlist (Voice Copilot)
> Chrome/Edge, allow the mic. The Deepgram key lives server-side; the
> browser talks through our worker proxy — nothing sensitive in devtools.

1. On the job page click **Ask AI** → tap the **Voice** orb. The copilot
   greets you by job title. Ask out loud: *"Which candidate is strongest
   and why?"* — it answers in ~1s from the BLIND shortlist (skills and
   scores, never names), and you can interrupt it mid-sentence (barge-in).
2. *"Who led a team?"* — it scans the raw CV text and cites the evidence.
3. *"Reject everyone below 60."* — it says it's preparing the proposal and
   the SAME red confirmation card appears in the chat thread as with typed
   commands. Nothing moves until a human clicks Confirm. Voice proposes,
   the card disposes.
4. Fallback guarantee: if the room is noisy, the typed chat does everything
   the voice does — same brain, same cards.
