-- Run this script in the Supabase SQL Editor.
-- It leaves the existing eggs.color text column and all egg records unchanged.

create table if not exists public.flock_egg_colors (
  flock_id uuid not null references public.flocks(id) on delete cascade,
  color text not null check (length(trim(color)) between 1 and 40),
  primary key (flock_id, color)
);

alter table public.flock_egg_colors enable row level security;

revoke all on table public.flock_egg_colors from anon, authenticated;
grant select, insert, update, delete on table public.flock_egg_colors to authenticated;

drop policy if exists "Signed-in users can read flock egg colors"
  on public.flock_egg_colors;
create policy "Signed-in users can read flock egg colors"
  on public.flock_egg_colors for select to authenticated
  using (true);

drop policy if exists "Signed-in users can add flock egg colors"
  on public.flock_egg_colors;
create policy "Signed-in users can add flock egg colors"
  on public.flock_egg_colors for insert to authenticated
  with check (true);

drop policy if exists "Signed-in users can update flock egg colors"
  on public.flock_egg_colors;
create policy "Signed-in users can update flock egg colors"
  on public.flock_egg_colors for update to authenticated
  using (true)
  with check (true);

drop policy if exists "Signed-in users can remove flock egg colors"
  on public.flock_egg_colors;
create policy "Signed-in users can remove flock egg colors"
  on public.flock_egg_colors for delete to authenticated
  using (true);

-- Seed the current flocks once. Re-running the script does not overwrite
-- any choices that have since been customized in the app.
insert into public.flock_egg_colors (flock_id, color)
select flocks.id, allowed.color
from public.flocks as flocks
cross join lateral unnest(
  case
    when lower(flocks.name) like '%cinnamon%' then array['Brown']
    when lower(flocks.name) like '%leghorn%' then array['White', 'Cream', 'Blue']
    else array['Brown', 'Dark Brown', 'Light Brown', 'White', 'Cream', 'Blue', 'Green', 'Other']
  end
) as allowed(color)
on conflict (flock_id, color) do nothing;
