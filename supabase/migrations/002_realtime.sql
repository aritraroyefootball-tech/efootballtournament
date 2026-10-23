-- eFootball Arena: live updates via Supabase Realtime
-- Run after 001_init.sql in the Supabase SQL editor. Safe to re-run.
--
-- Security model (changes to 001)
-- -------------------------------
-- The browser now LISTENS for changes to tournament_state over Supabase
-- Realtime, using the public anon (publishable) key. To make that work, anon
-- and authenticated get read access to that ONE table, limited to the columns
-- GET /api/state already returns publicly (id, data, rev, updated_at), so
-- nothing new is exposed. updated_by stays hidden.
--
-- They still can't write anything: there are no INSERT/UPDATE/DELETE policies
-- or grants, and every save still goes through POST /api/state (service_role).
--
-- admins, sessions, login_attempts, audit_log and state_snapshots are NOT
-- touched here and stay fully locked: RLS on, no policies, no grants for
-- anon/authenticated. Don't add any.

-- 1. Publish changes of tournament_state to Realtime.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournament_state'
  ) then
    alter publication supabase_realtime add table public.tournament_state;
  end if;
end $$;

-- 2. Read-only access for the public roles: one SELECT policy, public columns only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tournament_state' and policyname = 'tournament_state_public_read'
  ) then
    create policy tournament_state_public_read on public.tournament_state
      for select to anon, authenticated
      using (id = 1);
  end if;
end $$;

-- 001 revoked every table privilege from anon/authenticated. Grant back SELECT
-- on the public columns only. GRANT is idempotent, so re-running is fine.
grant select (id, data, rev, updated_at) on public.tournament_state to anon, authenticated;

-- RLS stays enabled (re-asserted in case it was turned off by hand).
alter table public.tournament_state enable row level security;
