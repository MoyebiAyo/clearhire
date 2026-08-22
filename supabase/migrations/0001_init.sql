-- ClearHire — initial schema (spec Part 4), RLS, signup trigger, storage.
-- Run in the Supabase SQL editor (or via the CLI) on a fresh project.
--
-- Documented schema extensions beyond the spec (deliberate, minimal):
--   * applications.flagged_duplicate boolean — Week 1 duplicate guard flag
--     ("same candidate email applying twice is flagged, not duplicated").

create extension if not exists pgcrypto;

-- ══════════════════════════════════════════════════════════════════════════
-- Tables (spec Part 4 — names, types, defaults, enums exactly as specified)
-- ══════════════════════════════════════════════════════════════════════════

-- Recruiters/organizations (Supabase Auth handles users; this extends profile)
create table public.recruiters (
  id uuid primary key references auth.users(id) on delete cascade,
  org_name text,
  created_at timestamptz default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid references public.recruiters(id) on delete cascade,
  title text not null,
  jd_text text not null,
  weight_skills numeric default 40,
  weight_experience numeric default 30,
  weight_certifications numeric default 15,
  weight_tools numeric default 15,
  status text default 'open',
  created_at timestamptz default now(),
  constraint jobs_status_check check (status in ('open', 'closed')),
  constraint jobs_weights_range_check check (
    weight_skills between 0 and 100
    and weight_experience between 0 and 100
    and weight_certifications between 0 and 100
    and weight_tools between 0 and 100
  )
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  source text,
  created_at timestamptz default now(),
  unique (email),
  constraint candidates_source_check check (source in ('upload', 'email'))
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  cv_file_path text,
  status text default 'applied',
  applied_at timestamptz default now(),
  flagged_duplicate boolean default false,
  constraint applications_status_check check (
    status in (
      'applied', 'screened', 'shortlisted', 'interview_scheduled',
      'interviewed', 'offer', 'rejected'
    )
  )
);

create table public.cv_extractions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  skills jsonb,
  experience_years numeric,
  education jsonb,
  certifications jsonb,
  tools jsonb,
  raw_text text,
  extracted_at timestamptz default now()
);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  skills_score numeric,
  experience_score numeric,
  certifications_score numeric,
  tools_score numeric,
  total_score numeric,
  gaps jsonb,
  rationale text,
  scored_at timestamptz default now()
);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid references public.recruiters(id) on delete cascade,
  type text,
  tone text,
  subject text,
  body text,
  constraint email_templates_type_check check (type in ('invite', 'reminder', 'rejection')),
  constraint email_templates_tone_check check (tone in ('formal', 'casual', 'technical'))
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  scheduled_time timestamptz,
  interviewer text,
  location_or_link text,
  status text default 'scheduled',
  created_at timestamptz default now(),
  constraint interviews_status_check check (
    status in ('scheduled', 'completed', 'no_show', 'cancelled')
  )
);

create table public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid references public.interviews(id) on delete cascade,
  fire_at timestamptz not null,
  offset_label text,
  sent boolean default false,
  sent_at timestamptz,
  constraint reminder_jobs_offset_check check (offset_label in ('2d', '1d', '12h', '2h'))
);

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  type text,
  to_email text,
  subject text,
  sent_at timestamptz default now(),
  provider_message_id text
);

create table public.interview_scorecards (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid references public.interviews(id) on delete cascade,
  interviewer_rating numeric,
  interviewer_notes text,
  submitted_at timestamptz default now()
);

-- Helpful indexes for the access patterns used by the app
create index jobs_recruiter_idx on public.jobs (recruiter_id);
create index applications_job_idx on public.applications (job_id);
create index applications_candidate_idx on public.applications (candidate_id);
create index cv_extractions_application_idx on public.cv_extractions (application_id);
create index scores_application_idx on public.scores (application_id);
create index interviews_application_idx on public.interviews (application_id);
create index reminder_jobs_interview_idx on public.reminder_jobs (interview_id);
create index reminder_jobs_due_idx on public.reminder_jobs (sent, fire_at);

-- ══════════════════════════════════════════════════════════════════════════
-- Auto-create a recruiters row on signup
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.handle_new_recruiter()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.recruiters (id, org_name)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_recruiter();

-- ══════════════════════════════════════════════════════════════════════════
-- Row Level Security — every table, scoped to the authenticated recruiter.
-- Child tables scope through their ownership chain up to jobs.recruiter_id.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.recruiters enable row level security;
alter table public.jobs enable row level security;
alter table public.candidates enable row level security;
alter table public.applications enable row level security;
alter table public.cv_extractions enable row level security;
alter table public.scores enable row level security;
alter table public.email_templates enable row level security;
alter table public.interviews enable row level security;
alter table public.reminder_jobs enable row level security;
alter table public.email_log enable row level security;
alter table public.interview_scorecards enable row level security;

-- recruiters
create policy "recruiters_select_own" on public.recruiters
  for select using (id = auth.uid());
create policy "recruiters_insert_own" on public.recruiters
  for insert with check (id = auth.uid());
create policy "recruiters_update_own" on public.recruiters
  for update using (id = auth.uid());

-- jobs
create policy "jobs_select_own" on public.jobs
  for select using (recruiter_id = auth.uid());
create policy "jobs_insert_own" on public.jobs
  for insert with check (recruiter_id = auth.uid());
create policy "jobs_update_own" on public.jobs
  for update using (recruiter_id = auth.uid());
create policy "jobs_delete_own" on public.jobs
  for delete using (recruiter_id = auth.uid());

-- candidates: readable only when the recruiter has an application for them.
-- Inserts happen through authenticated server routes (a brand-new candidate
-- has no application yet, so insert is allowed for any authenticated user;
-- reads remain scoped). Documented trade-off.
create policy "candidates_select_own" on public.candidates
  for select using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.candidate_id = candidates.id and j.recruiter_id = auth.uid()
    )
  );
create policy "candidates_insert_authenticated" on public.candidates
  for insert to authenticated with check (true);

-- applications: scoped through their job
create policy "applications_select_own" on public.applications
  for select using (
    exists (
      select 1 from public.jobs j
      where j.id = applications.job_id and j.recruiter_id = auth.uid()
    )
  );
create policy "applications_insert_own" on public.applications
  for insert with check (
    exists (
      select 1 from public.jobs j
      where j.id = applications.job_id and j.recruiter_id = auth.uid()
    )
  );
create policy "applications_update_own" on public.applications
  for update using (
    exists (
      select 1 from public.jobs j
      where j.id = applications.job_id and j.recruiter_id = auth.uid()
    )
  );
create policy "applications_delete_own" on public.applications
  for delete using (
    exists (
      select 1 from public.jobs j
      where j.id = applications.job_id and j.recruiter_id = auth.uid()
    )
  );

-- cv_extractions / scores / email_log: scoped through application → job
create policy "cv_extractions_select_own" on public.cv_extractions
  for select using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = cv_extractions.application_id and j.recruiter_id = auth.uid()
    )
  );
create policy "cv_extractions_insert_own" on public.cv_extractions
  for insert with check (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = cv_extractions.application_id and j.recruiter_id = auth.uid()
    )
  );

create policy "scores_select_own" on public.scores
  for select using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = scores.application_id and j.recruiter_id = auth.uid()
    )
  );
create policy "scores_insert_own" on public.scores
  for insert with check (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = scores.application_id and j.recruiter_id = auth.uid()
    )
  );

create policy "email_log_select_own" on public.email_log
  for select using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = email_log.application_id and j.recruiter_id = auth.uid()
    )
  );
create policy "email_log_insert_own" on public.email_log
  for insert with check (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = email_log.application_id and j.recruiter_id = auth.uid()
    )
  );

-- email_templates: scoped directly to recruiter
create policy "email_templates_all_own" on public.email_templates
  for all using (recruiter_id = auth.uid())
  with check (recruiter_id = auth.uid());

-- interviews: scoped through application → job
create policy "interviews_select_own" on public.interviews
  for select using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = interviews.application_id and j.recruiter_id = auth.uid()
    )
  );
create policy "interviews_insert_own" on public.interviews
  for insert with check (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = interviews.application_id and j.recruiter_id = auth.uid()
    )
  );
create policy "interviews_update_own" on public.interviews
  for update using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = interviews.application_id and j.recruiter_id = auth.uid()
    )
  );

-- reminder_jobs: scoped through interview → application → job
create policy "reminder_jobs_select_own" on public.reminder_jobs
  for select using (
    exists (
      select 1 from public.interviews i
      join public.applications a on a.id = i.application_id
      join public.jobs j on j.id = a.job_id
      where i.id = reminder_jobs.interview_id and j.recruiter_id = auth.uid()
    )
  );
create policy "reminder_jobs_insert_own" on public.reminder_jobs
  for insert with check (
    exists (
      select 1 from public.interviews i
      join public.applications a on a.id = i.application_id
      join public.jobs j on j.id = a.job_id
      where i.id = reminder_jobs.interview_id and j.recruiter_id = auth.uid()
    )
  );
create policy "reminder_jobs_update_own" on public.reminder_jobs
  for update using (
    exists (
      select 1 from public.interviews i
      join public.applications a on a.id = i.application_id
      join public.jobs j on j.id = a.job_id
      where i.id = reminder_jobs.interview_id and j.recruiter_id = auth.uid()
    )
  );

-- interview_scorecards: scoped through interview → application → job
create policy "interview_scorecards_select_own" on public.interview_scorecards
  for select using (
    exists (
      select 1 from public.interviews i
      join public.applications a on a.id = i.application_id
      join public.jobs j on j.id = a.job_id
      where i.id = interview_scorecards.interview_id and j.recruiter_id = auth.uid()
    )
  );
create policy "interview_scorecards_insert_own" on public.interview_scorecards
  for insert with check (
    exists (
      select 1 from public.interviews i
      join public.applications a on a.id = i.application_id
      join public.jobs j on j.id = a.job_id
      where i.id = interview_scorecards.interview_id and j.recruiter_id = auth.uid()
    )
  );

-- ══════════════════════════════════════════════════════════════════════════
-- Storage: PRIVATE bucket for CVs. Spec Part 7: never public.
-- All object access goes through server code (service role) or signed URLs;
-- no direct browser storage access, so no storage.object policies are granted.
-- ══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do nothing;
