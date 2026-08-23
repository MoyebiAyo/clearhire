-- ClearHire — AI exam engine (post-Week 6 extension).
--
-- Documented schema extensions beyond the spec (deliberate, minimal):
--   * exams / exam_questions / exam_invites — AI-generated MCQ exams with
--     per-candidate unguessable tokens, server-side (in-code) grading, a
--     3-strike proctoring policy, and CV/exam weight blending onto the
--     existing blind score. correct_index never leaves the server.
--
-- Public candidate access mirrors interviews.schedule_token: the 32-hex
-- token IS the capability; the public exam page reads via the service role.

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null default 'active' check (status in ('draft','active','closed')),
  bank_size int not null default 40 check (bank_size between 10 and 100),
  questions_per_candidate int not null default 20 check (questions_per_candidate between 5 and 50),
  duration_minutes int not null default 30 check (duration_minutes between 5 and 180),
  start_deadline_hours int not null default 48 check (start_deadline_hours between 1 and 720),
  weight_cv numeric not null default 70 check (weight_cv between 0 and 100),
  weight_exam numeric not null default 30 check (weight_exam between 0 and 100),
  created_at timestamptz not null default now(),
  check (weight_cv + weight_exam = 100),
  check (questions_per_candidate <= bank_size)
);

comment on table public.exams is
  'One active exam per job (enforced in code). Weights blend CV + exam into the final score.';

create table public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  topic text not null default 'general',
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  question text not null,
  options jsonb not null,           -- array of exactly 4 strings
  correct_index int not null check (correct_index between 0 and 3),
  created_at timestamptz not null default now()
);

create index if not exists exam_questions_exam_idx on public.exam_questions (exam_id);

comment on column public.exam_questions.correct_index is
  'Server-only. Never serialized to any client payload — grading happens in code.';

create table public.exam_invites (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  token text not null,
  status text not null default 'invited'
    check (status in ('invited','in_progress','submitted','forfeited','expired')),
  started_at timestamptz,
  submitted_at timestamptz,
  score numeric check (score between 0 and 100),
  violations int not null default 0,
  created_at timestamptz not null default now(),
  unique (exam_id, application_id)
);

create unique index if not exists exam_invites_token_idx on public.exam_invites (token);

create index if not exists exam_invites_exam_idx on public.exam_invites (exam_id);
create index if not exists exam_invites_application_idx on public.exam_invites (application_id);

comment on table public.exam_invites is
  'Per-candidate exam session. violations counts proctoring strikes (3 = forfeited).';

-- RLS: everything scoped through exams → jobs.recruiter_id (established chain).

alter table public.exams enable row level security;
create policy "exams_all_own" on public.exams
  for all using (
    exists (
      select 1 from public.jobs j
      where j.id = exams.job_id and j.recruiter_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = exams.job_id and j.recruiter_id = auth.uid()
    )
  );

alter table public.exam_questions enable row level security;
create policy "exam_questions_all_own" on public.exam_questions
  for all using (
    exists (
      select 1 from public.exams e
      join public.jobs j on j.id = e.job_id
      where e.id = exam_questions.exam_id and j.recruiter_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.exams e
      join public.jobs j on j.id = e.job_id
      where e.id = exam_questions.exam_id and j.recruiter_id = auth.uid()
    )
  );

alter table public.exam_invites enable row level security;
create policy "exam_invites_all_own" on public.exam_invites
  for all using (
    exists (
      select 1 from public.exams e
      join public.jobs j on j.id = e.job_id
      where e.id = exam_invites.exam_id and j.recruiter_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.exams e
      join public.jobs j on j.id = e.job_id
      where e.id = exam_invites.exam_id and j.recruiter_id = auth.uid()
    )
  );

-- Templates: widen the type check to include exam_invite, then seed 3 tones.

alter table public.email_templates drop constraint if exists email_templates_type_check;
alter table public.email_templates add constraint email_templates_type_check
  check (type in ('invite','reminder','rejection','exam_invite'));

insert into public.email_templates (recruiter_id, type, tone, subject, body)
select * from (values
  (null::uuid, 'exam_invite', 'formal',
   'Skills Assessment Invitation — {{job_title}}',
   'Dear {{candidate_name}},

Thank you for your continued interest in the {{job_title}} position. As the next step, we would like to invite you to complete a short skills assessment.

Start your assessment here:
{{exam_url}}

Please note:
- The exam contains {{question_count}} multiple-choice questions.
- You will have {{duration_minutes}} minutes to complete it.
- You must begin before {{deadline}}.
- The exam runs in full screen; switching tabs or windows ends your attempt, so make sure you have an uninterrupted window of time.

We look forward to seeing your results.

Kind regards,
{{recruiter_name}}'),
  (null::uuid, 'exam_invite', 'casual',
   'Quick skills challenge for {{job_title}} 🚀',
   'Hi {{candidate_name}!

Great news — you have moved to the next stage for {{job_title}}! We would love to see how you tackle a short skills challenge.

Here is your personal link:
{{exam_url}}

The details:
- {{question_count}} multiple-choice questions
- {{duration_minutes}} minutes on the clock
- Start any time before {{deadline}}
- Heads-up: the exam runs in full screen, and switching tabs ends the attempt — so grab a coffee first ☕

Good luck!

{{recruiter_name}}'),
  (null::uuid, 'exam_invite', 'technical',
   'Technical Assessment — {{job_title}} ({{duration_minutes}} min)',
   'Hello {{candidate_name}},

Your application for {{job_title}} has advanced to the technical assessment stage.

Assessment URL: {{exam_url}}

Format:
- {{question_count}} multiple-choice questions drawn from the role''s core competencies
- Time limit: {{duration_minutes}} minutes, counted from when you start
- Window: begin before {{deadline}}
- Proctoring: full screen required; tab switches or window losses are recorded and, after three strikes, end the attempt

Technical notes: no external tools or resources are permitted. Your answers are graded automatically and immediately.

Regards,
{{recruiter_name}}')
) as t(recruiter_id, type, tone, subject, body)
where not exists (
  select 1 from public.email_templates
  where type = 'exam_invite' and recruiter_id is null
);
