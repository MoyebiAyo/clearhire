-- ClearHire — Week 3 (recruiter UI) schema additions.
--
-- Documented schema extensions beyond the spec (deliberate, minimal):
--   * applications.revealed_at timestamptz — persists a recruiter's identity
--     reveal so it stays revealed. Presentation gate only (spec Part 5:
--     "reveal identity in UI — client-side gate, not a security boundary").
--   * scores DELETE policy — needed when a JD change invalidates scores and
--     the job is re-scored from scratch (Week 3 rubric/JD editor).

alter table public.applications
  add column if not exists revealed_at timestamptz;

comment on column public.applications.revealed_at is
  'When the recruiter revealed this identity; scores were locked before this timestamp.';

create policy "scores_delete_own" on public.scores
  for delete using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = scores.application_id and j.recruiter_id = auth.uid()
    )
  );
