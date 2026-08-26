-- Qualify interview columns so output names do not collide with PL/pgSQL
-- return-table variables.
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
  update public.interviews as i
    set scheduled_time = v_time
    where i.schedule_token = p_token
      and i.status = 'scheduled'
      and i.scheduled_time is null
      and i.offered_slots ? p_slot
      and v_time > now()
    returning i.* into v_interview;
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
