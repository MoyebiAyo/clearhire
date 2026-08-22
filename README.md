# ClearHire

AI recruitment assistant — blind CV scoring, interview scheduling, automated
reminders, and respectful rejections. Built per [docs/product-spec.md](docs/product-spec.md)
(Week 1 of the 6-week plan: foundations + manual CV intake).

**Stack:** Next.js (App Router, TypeScript) · Supabase (Postgres + RLS +
Storage) · Tailwind CSS v4 · deploys to Vercel.

## Quick start

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Open **SQL Editor** → paste the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → Run.
   This creates all 11 tables, RLS policies, the signup trigger, and the
   private `cvs` storage bucket.
3. **Authentication → Providers → Email**: leave "Confirm email" ON for
   production, or turn it OFF for local development (instant signups).

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in from **Project Settings → API**:

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server only — never commit) |

### 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 → create an account → create a job → upload CVs.

### 4. Deploy to Vercel

```bash
npx vercel
```

Add the same three environment variables in the Vercel project settings
(Production + Preview), then deploy.

## What's built (Week 1)

- Recruiter auth (email/password, Supabase Auth, session middleware)
- Job creation with live rubric-weight validation (must sum to 100%)
- Jobs list with status + application counts, close/reopen
- Bulk PDF/DOCX CV upload: text extraction (unpdf/mammoth), private storage,
  candidate + application records, duplicate detection by email
- Per-file upload report with inline email entry for CVs without a parseable
  address
- RLS on every table; CVs stored in a private bucket

See [RUNNING_NOTES.md](RUNNING_NOTES.md) for a full feature walkthrough and
test plan.

## Project layout

```
src/
  app/            routes — pages under (app)/ require auth; /api/* are route handlers
  components/     ui/ primitives + feature components
  lib/            supabase clients, CV text extraction, validation, types
supabase/
  migrations/     SQL schema (spec Part 4)
docs/
  product-spec.md the product documentation (build context)
```

## Live deployment

- **App:** https://clearhire-rho.vercel.app
- **Supabase project ref:** `rzuhtwrrmzdqbjzhydzq` (linked; run `supabase db push` after adding migrations)
- **Repo:** https://github.com/MoyebiAyo/clearhire (pushes to `main` auto-deploy)
