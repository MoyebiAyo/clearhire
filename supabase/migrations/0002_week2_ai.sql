-- ClearHire — Week 2 (AI pipeline) schema additions.
--
-- Documented schema extensions beyond the spec (deliberate, minimal):
--   * jobs.requirements_cache jsonb — cached structured JD requirements
--     derived once per job by the LLM (spec allows: "a preliminary LLM call
--     per job is fine; cache it on the job").
--   * cv_extractions.extract_error text — persisted per-CV failure reason;
--     rows with skills IS NULL + extract_error set are retried on re-run.
--
-- Also adds the UPDATE policies Week 2 needs (Week 1 only inserted rows).

alter table public.jobs
  add column if not exists requirements_cache jsonb;

alter table public.cv_extractions
  add column if not exists extract_error text;

comment on column public.jobs.requirements_cache is
  'Cached [{requirement, type: hard|nice-to-have}] derived from jd_text by the LLM;';
comment on column public.cv_extractions.extract_error is
  'Last extraction failure reason; cleared on success.';

-- UPDATE policy for cv_extractions (fill structured fields on retry/extract).
create policy "cv_extractions_update_own" on public.cv_extractions
  for update using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = cv_extractions.application_id and j.recruiter_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = cv_extractions.application_id and j.recruiter_id = auth.uid()
    )
  );

-- UPDATE policy for scores (re-scoring under new rubric weights, Week 3).
create policy "scores_update_own" on public.scores
  for update using (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = scores.application_id and j.recruiter_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = scores.application_id and j.recruiter_id = auth.uid()
    )
  );
