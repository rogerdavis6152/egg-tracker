-- Run this script in the Supabase SQL Editor.
-- Scale firmware writes through the authenticated server endpoint only.

create table if not exists public.scale_readings (
  event_id text primary key check (length(event_id) between 1 and 80),
  owner_id uuid not null references auth.users(id) on delete cascade,
  weight_grams numeric(6, 2) not null check (weight_grams between 0 and 500),
  created_at timestamptz not null default now()
);

create index if not exists scale_readings_owner_created_idx
  on public.scale_readings (owner_id, created_at desc);

alter table public.scale_readings enable row level security;

revoke all on table public.scale_readings from anon, authenticated;
grant select on table public.scale_readings to authenticated;
grant select, insert, update, delete on table public.scale_readings to service_role;

drop policy if exists "Users can read their scale readings"
  on public.scale_readings;
create policy "Users can read their scale readings"
  on public.scale_readings for select to authenticated
  using ((select auth.uid()) = owner_id);
