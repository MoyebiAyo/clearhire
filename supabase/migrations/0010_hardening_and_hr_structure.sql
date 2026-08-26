-- Security hardening plus structured recruiter-authored evaluation data.

-- Gmail token helpers are server-only. SECURITY DEFINER must never remain
-- executable by browser roles.
revoke execute on function public.gmail_store_token(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.gmail_get_token(uuid, text)
  from public, anon, authenticated;
grant execute on function public.gmail_store_token(uuid, text, text, text)
  to service_role;
grant execute on function public.gmail_get_token(uuid, text)
  to service_role;

create unique index if not exists reminder_jobs_interview_offset_idx
  on public.reminder_jobs (interview_id, offset_label);

-- Recruiter-authored requirements and structured interview scorecards.
alter table public.jobs
  add column if not exists requirements jsonb not null default '[]'::jsonb,
  add column if not exists interview_scorecard_config jsonb not null default
    '[{"id":"technical","label":"Role competence","weight":40},{"id":"communication","label":"Communication","weight":30},{"id":"problem_solving","label":"Problem solving","weight":30}]'::jsonb;

alter table public.interview_scorecards
  add column if not exists criteria_scores jsonb,
  add column if not exists weighted_rating numeric check (weighted_rating between 1 and 5);

-- Candidate slot selection and reminder creation happen in one transaction.
create or replace function public.confirm_interview_slot(
  p_token text,
  p_slot text
) returns table(interview_id uuid, scheduled_time timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_interview public.interviews%rowtype;
  v_time timestamptz;
begin
  v_time := p_slot::timestamptz;
  update public.interviews
    set scheduled_time = v_time
    where schedule_token = p_token
      and status = 'scheduled'
      and scheduled_time is null
      and offered_slots ? p_slot
      and v_time > now()
    returning * into v_interview;
  if v_interview.id is null then return; end if;

  insert into public.reminder_jobs (interview_id, fire_at, offset_label, sent)
  values
    (v_interview.id, v_time - interval '48 hours', '2d', false),
    (v_interview.id, v_time - interval '24 hours', '1d', false),
    (v_interview.id, v_time - interval '12 hours', '12h', false),
    (v_interview.id, v_time - interval '2 hours', '2h', false)
  on conflict (interview_id, offset_label) do nothing;

  return query select v_interview.id, v_time;
end $$;
revoke execute on function public.confirm_interview_slot(text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_interview_slot(text, text) to service_role;

-- Atomic exam state transitions. Losing concurrent requests receive no row
-- and must return the result already stored by the winning request.
create or replace function public.start_exam_invite(p_invite uuid)
returns table(status text, started_at timestamptz)
language sql security definer set search_path = public as $$
  update public.exam_invites
  set status = 'in_progress', started_at = now()
  where id = p_invite and status = 'invited' and started_at is null
  returning status, started_at;
$$;

create or replace function public.record_exam_violation(p_invite uuid, p_max int)
returns table(status text, violations int)
language sql security definer set search_path = public as $$
  update public.exam_invites
  set violations = violations + 1,
      status = case when violations + 1 >= p_max then 'forfeited' else status end
  where id = p_invite and status = 'in_progress'
  returning status, violations;
$$;

create or replace function public.complete_exam_invite(
  p_invite uuid,
  p_status text,
  p_score numeric
) returns table(status text, score numeric, submitted_at timestamptz)
language sql security definer set search_path = public as $$
  update public.exam_invites
  set status = p_status, score = p_score, submitted_at = now()
  where id = p_invite
    and submitted_at is null
    and status in ('in_progress', 'forfeited')
    and p_status in ('submitted', 'forfeited')
  returning status, score, submitted_at;
$$;

revoke execute on function public.start_exam_invite(uuid) from public, anon, authenticated;
revoke execute on function public.record_exam_violation(uuid, int) from public, anon, authenticated;
revoke execute on function public.complete_exam_invite(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.start_exam_invite(uuid) to service_role;
grant execute on function public.record_exam_violation(uuid, int) to service_role;
grant execute on function public.complete_exam_invite(uuid, text, numeric) to service_role;

-- Closing an exam revokes every unfinished capability immediately.
create or replace function public.expire_closed_exam_invites()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    update public.exam_invites
      set status = case when status = 'in_progress' then 'forfeited' else 'expired' end
      where exam_id = new.id and status in ('invited', 'in_progress');
  end if;
  return new;
end $$;
drop trigger if exists on_exam_closed on public.exams;
create trigger on_exam_closed after update of status on public.exams
  for each row execute function public.expire_closed_exam_invites();
