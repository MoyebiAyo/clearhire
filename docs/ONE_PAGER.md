# ClearHire — AI Recruitment Assistant

**Screen every CV fairly. Keep the final call yours.**
AI BuildFest 2026 · Track 1 · Case Study 3 · Live: https://clearhire-rho.vercel.app

## The Problem

A single open role attracts hundreds of CVs — and a human screen gives each one seconds. Under that pressure, hiring runs on shortcuts: recognizable names, fancy schools, a photo, a gut feel. Great candidates are filtered out before their skills are ever read, and the ones who make it through wait days for any update. The new wave of "AI hiring tools" answers this with a black box — they auto-score, auto-reject, and can't explain themselves, swapping human bias for algorithmic bias nobody can audit. Meanwhile the recruiter's week disappears into copy-paste: downloading attachments, re-typing requirements, chasing interview slots, and sending the same three emails over and over.

Hiring needs help that is fast, fair, and accountable — not a robot that quietly decides people's careers.

## The Solution — ClearHire

ClearHire is an AI recruitment assistant that runs the entire funnel — intake, screening, ranking, skills exams, scheduling, candidate communication — under one non-negotiable rule: **the AI ranks, the recruiter decides.**

- **Blind by default.** The AI never sees names, schools, or photos — only merit: skills, experience, certifications, tools. Identities stay sealed until scores are locked in.
- **Explainable, always.** Every score shows its working — per-criterion bars, requirement gaps, and a written rationale. Totals are computed in code from the recruiter's own rubric, never by the model.
- **AI proposes, you dispose.** The built-in Copilot drafts actions — *"reject everyone below 60"*, *"set up an exam for everyone above 70"* — but nothing executes until the recruiter confirms on screen.

## What it does, end to end

1. **Intake** — bulk-upload PDFs/DOCXs, or connect Gmail: candidates' CV emails are pulled in automatically every 10 minutes (or on demand per job); unmatched CVs are preserved for manual assignment, never dropped.
2. **Screen** — AI extracts structured data and scores each CV 0–100 against the job's rubric, tells true duplicates from returning candidates, and explains every gap.
3. **Decide** — a ranked shortlist, Copilot Q&A over the whole pipeline (*"Who held leadership roles?"* answers with quoted CV evidence), one-click mass actions, one-click undo.
4. **Verify** — AI-generated exams written from the job description: proctored (full-screen, 3-strike anti-tab-switching, copy/screenshot detection), uniquely drawn per candidate, graded in code, and blended into the final score (CV + exam weighting set by the recruiter).
5. **Close the loop** — candidates self-schedule interviews from a personal link, receive calendar invites and smart reminders, and get kind, specific rejection emails — sent at scale, so nobody is ghosted.

## Under the hood

Next.js 15 + TypeScript on Vercel · Supabase Postgres with row-level security on every table · Groq open-source LLMs (deterministic JSON mode, automatic key failover) · Resend email · Cloudflare Workers cron (inbox polling + reminders) · Gmail OAuth with encrypted read-only tokens · private CV storage with expiring links.

## Why it wins

Fair by construction (blind payloads, audited logs), transparent by design (every number explainable), safe by default (human confirmation on every mass action, fully isolated data) — and it turns a recruiter's week of screening into minutes, **without giving the machine the final say.**
