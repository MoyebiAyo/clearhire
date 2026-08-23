-- ClearHire — Week 6 (pipeline/analytics) schema additions.
--
-- Documented schema extension beyond the spec (deliberate, minimal):
--   * applications.status_changed_at — when the current status was set;
--     enables time-to-hire (applied_at → offer) for the analytics page.

alter table public.applications
  add column if not exists status_changed_at timestamptz;

comment on column public.applications.status_changed_at is
  'When the current status was set (set by every status-changing flow).';
