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
