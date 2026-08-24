-- Recruiter-controlled exam availability window.
alter table public.exams
  add column if not exists available_from timestamptz,
  add column if not exists available_until timestamptz;

alter table public.exams
  add constraint exams_availability_order_check
  check (
    available_from is null
    or available_until is null
    or available_until > available_from
  );

update public.email_templates
set body = replace(
  replace(body, 'You must begin before {{deadline}}.', 'The assessment is available from {{available_from}} until {{available_until}}.'),
  'Start any time before {{deadline}}',
  'Available from {{available_from}} until {{available_until}}'
)
where type = 'exam_invite' and recruiter_id is null;

update public.email_templates
set body = replace(body, 'Window: begin before {{deadline}}', 'Window: {{available_from}} until {{available_until}}')
where type = 'exam_invite' and recruiter_id is null;

create index if not exists exams_availability_idx
  on public.exams (available_from, available_until);
