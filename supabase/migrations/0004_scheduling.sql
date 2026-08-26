-- ClearHire — Week 4 (scheduling + closing the loop) schema additions.
--
-- Documented schema extensions beyond the spec (deliberate, minimal):
--   * interviews.schedule_token — unguessable capability token for the
--     public candidate self-scheduling page.
--   * interviews.offered_slots — up to 3 offered ISO slots.
-- Reminder timing note: the spec writes reminder_jobs on interview
-- CONFIRMATION (2.4). Direct-booked interviews (recruiter sets the time
-- themselves) confirm at creation, so rows are written then; self-scheduling
-- interviews get their rows when the candidate picks a slot.

alter table public.interviews
  add column if not exists schedule_token text,
  add column if not exists offered_slots jsonb;

comment on column public.interviews.schedule_token is
  'Unguessable token authorizing the candidate scheduling page for this interview.';
comment on column public.interviews.offered_slots is
  'Up to 3 offered ISO 8601 slots the candidate can choose from.';

create unique index if not exists interviews_schedule_token_idx
  on public.interviews (schedule_token)
  where schedule_token is not null;

-- Templates: replace the blanket policy so shared defaults (recruiter_id
-- null, seeded below) are readable by every authenticated recruiter while
-- writes stay scoped to the owner. Saving edits to a shared default forks
-- an own copy in the API layer.
drop policy if exists "email_templates_all_own" on public.email_templates;

create policy "email_templates_select" on public.email_templates
  for select using (recruiter_id = auth.uid() or recruiter_id is null);
create policy "email_templates_insert_own" on public.email_templates
  for insert with check (recruiter_id = auth.uid());
create policy "email_templates_update_own" on public.email_templates
  for update using (recruiter_id = auth.uid()) with check (recruiter_id = auth.uid());
create policy "email_templates_delete_own" on public.email_templates
  for delete using (recruiter_id = auth.uid());

-- Seed shared default templates (invite/reminder/rejection × formal/casual/
-- technical) with {{merge_fields}}. Idempotent: only when no shared
-- templates exist yet.
insert into public.email_templates (recruiter_id, type, tone, subject, body)
select * from (values
  (null::uuid, 'invite', 'formal',
   'Interview Invitation — {{job_title}}',
   'Dear {{candidate_name}},

Thank you for your application for the {{job_title}} position. We were impressed by your experience and would like to invite you to an interview.

Proposed times:
{{proposed_times}}

Location: {{location_or_link}}

Kind regards,
{{recruiter_name}}'),
  (null::uuid, 'invite', 'casual',
   'Chat about {{job_title}}? 🎉',
   'Hi {{candidate_name}}!

Loved what we saw in your application for {{job_title}} — let''s talk.

Pick whichever works for you:
{{proposed_times}}

Where: {{location_or_link}}

Can''t wait to meet you,
{{recruiter_name}}'),
  (null::uuid, 'invite', 'technical',
   'Technical Interview — {{job_title}}',
   'Hi {{candidate_name}},

Great news — you''ve moved to the technical round for {{job_title}}.

Session times:
{{proposed_times}}

Format: {{location_or_link}} — hands-on, camera optional, IDE of your choice.

See you there,
{{recruiter_name}}'),
  (null::uuid, 'reminder', 'formal',
   'Reminder: Interview for {{job_title}}',
   'Dear {{candidate_name}},

A kind reminder that your interview for {{job_title}} is coming up on {{interview_time}}.

Location: {{location_or_link}}

We look forward to speaking with you.

Kind regards,
{{recruiter_name}}'),
  (null::uuid, 'reminder', 'casual',
   'See you soon! 👋',
   'Hey {{candidate_name}},

Quick heads-up — your {{job_title}} chat is on {{interview_time}}.

Where: {{location_or_link}}

See you then!
{{recruiter_name}}'),
  (null::uuid, 'reminder', 'technical',
   'Upcoming technical session — {{job_title}}',
   'Hi {{candidate_name}},

Your technical session for {{job_title}} is scheduled for {{interview_time}} at {{location_or_link}}.

Bring your usual setup; we''ll send anything else you need beforehand.

{{recruiter_name}}'),
  (null::uuid, 'rejection', 'formal',
   'Your application for {{job_title}}',
   'Dear {{candidate_name}},

Thank you for taking the time to apply for {{job_title}}. After careful consideration, we have decided not to move your application forward at this time.

We appreciated learning about your experience and encourage you to apply for future roles that match your strengths.

We wish you every success in your search.

Kind regards,
{{recruiter_name}}'),
  (null::uuid, 'rejection', 'casual',
   'About your {{job_title}} application',
   'Hi {{candidate_name}},

Thanks so much for applying for {{job_title}} — truly. This round was unusually competitive, and we''ve decided not to move forward this time.

We''d genuinely be happy to see you apply again for roles that fit what you''re great at.

Wishing you the best,
{{recruiter_name}}'),
  (null::uuid, 'rejection', 'technical',
   'Update on your {{job_title}} application',
   'Hi {{candidate_name}},

Thank you for the time you invested in the {{job_title}} process. We''ve decided not to proceed to the next stage this round.

The bar for this role''s specific requirements was high, and other candidates edged ahead on those particular areas — it is not a reflection of your overall ability.

Best of luck in your search,

{{recruiter_name}}')
) as t(recruiter_id, type, tone, subject, body)
where not exists (
  select 1 from public.email_templates where recruiter_id is null
);
