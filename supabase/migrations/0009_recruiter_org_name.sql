-- Keep the organization entered during signup on the recruiter profile used
-- by the authenticated application header and email signatures.
create or replace function public.handle_new_recruiter()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.recruiters (id, org_name)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data->>'org_name'), '')
  )
  on conflict (id) do update
    set org_name = coalesce(
      nullif(trim(excluded.org_name), ''),
      public.recruiters.org_name
    );
  return new;
end;
$$;
