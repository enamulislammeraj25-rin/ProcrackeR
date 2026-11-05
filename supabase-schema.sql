-- Run this once in Supabase: SQL Editor → New query → Run.
-- Each signed-in user can read and write only their own Tide progress row.

create table if not exists public.progress_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.progress_data enable row level security;

-- Remove old policy if you re-run this setup script.
drop policy if exists "Users can manage their own Tide data" on public.progress_data;

create policy "Users can manage their own Tide data"
on public.progress_data
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Enable Realtime for cross-device updates if it is not already enabled.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'progress_data'
  ) then
    alter publication supabase_realtime add table public.progress_data;
  end if;
end $$;
