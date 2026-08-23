-- ClearHire — Week 5 (reminder engine + Gmail intake) schema additions.
--
-- Documented schema extensions beyond the spec (deliberate, minimal):
--   * gmail_connections — one connected mailbox per recruiter; the refresh
--     token is stored ENCRYPTED (pgcrypto PGP symmetric) and only ever
--     decrypted server-side. Spec Part 7: minimum scope, tokens encrypted.
--   * processed_emails — per-message idempotency log so mailbox polling
--     never double-processes a message.
--   * unmatched_emails — CV emails that referenced no open job; flagged for
--     manual assignment instead of dropped (spec 2.1 fallback).

create extension if not exists pgcrypto;

create table public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references public.recruiters(id) on delete cascade,
  gmail_address text not null,
  encrypted_refresh_token bytea not null,
  connected_at timestamptz default now(),
  last_polled_at timestamptz,
  unique (recruiter_id)
);

create table public.processed_emails (
  message_id text primary key,
  recruiter_id uuid not null references public.recruiters(id) on delete cascade,
  action text not null, -- 'ingested' | 'unmatched' | 'skipped'
  detail jsonb,
  processed_at timestamptz default now()
);

create table public.unmatched_emails (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references public.recruiters(id) on delete cascade,
  sender_name text,
  sender_email text not null,
  subject text,
  snippet text,
  attachment_name text,
  storage_path text, -- the CV is preserved in the private cvs bucket
  received_at timestamptz,
  created_at timestamptz default now()
);

alter table public.gmail_connections enable row level security;
alter table public.processed_emails enable row level security;
alter table public.unmatched_emails enable row level security;

create policy "gmail_connections_all_own" on public.gmail_connections
  for all using (recruiter_id = auth.uid()) with check (recruiter_id = auth.uid());
create policy "processed_emails_own" on public.processed_emails
  for select using (recruiter_id = auth.uid());
create policy "processed_emails_insert_own" on public.processed_emails
  for insert with check (recruiter_id = auth.uid());
create policy "unmatched_emails_select_own" on public.unmatched_emails
  for select using (recruiter_id = auth.uid());
create policy "unmatched_emails_delete_own" on public.unmatched_emails
  for delete using (recruiter_id = auth.uid());

-- Token encrypt/decrypt RPCs. The key arrives from server env at call time
-- and is never persisted.
create or replace function public.gmail_store_token(
  p_recruiter uuid, p_address text, p_token text, p_key text
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into gmail_connections (recruiter_id, gmail_address, encrypted_refresh_token)
  values (p_recruiter, p_address, pgp_sym_encrypt(p_token, p_key))
  on conflict (recruiter_id) do update
    set gmail_address = excluded.gmail_address,
        encrypted_refresh_token = excluded.encrypted_refresh_token,
        connected_at = now();
end $$;

create or replace function public.gmail_get_token(
  p_recruiter uuid, p_key text
) returns text language sql security definer set search_path = public, extensions as $$
  select pgp_sym_decrypt(encrypted_refresh_token, p_key)
  from gmail_connections where recruiter_id = p_recruiter;
$$;
