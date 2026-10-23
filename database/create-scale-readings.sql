-- Run this script in the Supabase SQL Editor.
-- Replace the two email placeholders below with the account emails before running.
-- Scale firmware writes through the authenticated server endpoint only.

create table if not exists public.scale_readings (
  event_id text primary key check (length(event_id) between 1 and 80),
  owner_id uuid not null references auth.users(id) on delete cascade,
  weight_grams numeric(6, 2) not null check (weight_grams between 0 and 500),
  created_at timestamptz not null default now()
);

create index if not exists scale_readings_owner_created_idx
  on public.scale_readings (owner_id, created_at desc);

create table if not exists public.scale_reading_access (
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (owner_id, user_id)
);

create index if not exists scale_reading_access_user_idx
  on public.scale_reading_access (user_id, owner_id);

alter table public.scale_readings enable row level security;
alter table public.scale_reading_access enable row level security;

revoke all on table public.scale_readings from anon, authenticated;
grant select on table public.scale_readings to authenticated;
grant select, insert, update, delete on table public.scale_readings to service_role;

revoke all on table public.scale_reading_access from anon, authenticated;
grant select on table public.scale_reading_access to authenticated;
grant select, insert, update, delete on table public.scale_reading_access to service_role;

drop policy if exists "Users can read their scale readings"
  on public.scale_readings;
drop policy if exists "Shared users can read scale readings"
  on public.scale_readings;
create policy "Shared users can read scale readings"
  on public.scale_readings for select to authenticated
  using (
    exists (
      select 1
      from public.scale_reading_access as access
      where access.owner_id = scale_readings.owner_id
        and access.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can read their scale access"
  on public.scale_reading_access;
create policy "Users can read their scale access"
  on public.scale_reading_access for select to authenticated
  using (user_id = (select auth.uid()));

-- Add the scale owner and second account to the read allowlist.
-- This block is safe to re-run after the emails are filled in.
do $$
declare
  scale_owner_email text := 'REPLACE_WITH_SCALE_OWNER_EMAIL';
  second_user_email text := 'REPLACE_WITH_SECOND_USER_EMAIL';
  scale_owner_id uuid;
  second_user_id uuid;
begin
  select id into scale_owner_id
  from auth.users
  where lower(email) = lower(scale_owner_email);

  select id into second_user_id
  from auth.users
  where lower(email) = lower(second_user_email);

  if scale_owner_id is null then
    raise exception 'Scale owner email was not found in Supabase Auth.';
  end if;

  if second_user_id is null then
    raise exception 'Second account email was not found in Supabase Auth. Sign in once first, then rerun this script.';
  end if;

  insert into public.scale_reading_access (owner_id, user_id)
  values
    (scale_owner_id, scale_owner_id),
    (scale_owner_id, second_user_id)
  on conflict (owner_id, user_id) do nothing;
end;
$$;
