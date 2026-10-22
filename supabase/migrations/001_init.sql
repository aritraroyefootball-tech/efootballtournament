-- eFootball Arena: initial schema
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- Security model
-- --------------
-- Supabase is used as a plain Postgres database. The browser never talks to it:
-- every read/write goes through the Vercel functions in api/, which use the
-- service_role key (server-side only). Row Level Security is ENABLED on every
-- table below and NO policies are created, so the public anon key (and the
-- "authenticated" role) can neither read nor write anything. The service_role
-- bypasses RLS by design, which is why that key must never leave the server.

create extension if not exists pgcrypto;

-- ---------- admins ----------
create table admins (
  id                   uuid primary key default gen_random_uuid(),
  username             text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  password_hash        text not null,
  role                 text not null check (role in ('owner', 'admin')),
  active               boolean not null default true,
  must_change_password boolean not null default false,
  created_by           uuid references admins (id) on delete set null,
  created_at           timestamptz not null default now(),
  password_changed_at  timestamptz,
  last_login_at        timestamptz
);
-- At most ONE owner, ever. Also makes concurrent /api/setup calls safe.
create unique index admins_one_owner on admins (role) where role = 'owner';

-- ---------- sessions ----------
-- Only the SHA-256 hash of the session token is stored; the raw token lives in
-- an HttpOnly cookie in the admin's browser.
create table sessions (
  id           bigserial primary key,
  admin_id     uuid not null references admins (id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent   text
);
create index sessions_admin_idx on sessions (admin_id);

-- ---------- login_attempts (rate limiting) ----------
create table login_attempts (
  id       bigserial primary key,
  username text,
  ip       text,
  at       timestamptz not null default now(),
  success  boolean not null
);
create index login_attempts_username_at_idx on login_attempts (username, at);
create index login_attempts_ip_at_idx on login_attempts (ip, at);

-- ---------- tournament_state (single row) ----------
create table tournament_state (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null,
  rev        bigint not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references admins (id) on delete set null
);

-- ---------- audit_log (append-only) ----------
-- actor_id has no foreign key on purpose: log rows must outlive anything they mention.
create table audit_log (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  actor_id       uuid,
  actor_username text,
  action         text not null,
  summary        text,
  details        jsonb
);
create index audit_log_at_idx on audit_log (at desc);
create index audit_log_id_desc_idx on audit_log (id desc);

-- Rejects UPDATE, DELETE and TRUNCATE for every role, including service_role.
-- Note: the database owner (the "postgres" user in the SQL editor) could still
-- DROP this trigger; no in-database mechanism can stop the owner of the table.
create function audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update_delete
  before update or delete on audit_log
  for each row execute function audit_log_immutable();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_immutable();

-- ---------- state_snapshots (rollback points; latest 20 kept) ----------
create table state_snapshots (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  actor_username text,
  reason         text,
  data           jsonb not null
);

-- ---------- save_state: atomic compare-and-set + snapshot + audit ----------
-- Called by api/ via RPC. In ONE transaction it:
--   1. locks the state row and checks rev = p_base_rev (optimistic concurrency),
--   2. snapshots the old state,
--   3. writes the new state with a bumped rev,
--   4. appends the audit entry,
--   5. prunes snapshots to the latest 20.
-- Returns {"ok":true,"rev":<new>} or {"ok":false,"rev":<current>} on conflict.
create function save_state(
  p_base_rev       bigint,
  p_data           jsonb,
  p_actor_id       uuid,
  p_actor_username text,
  p_action         text,
  p_summary        text,
  p_details        jsonb,
  p_reason         text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_data jsonb;
  v_old_rev  bigint;
  v_new_rev  bigint;
  v_now_ms   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  select data, rev into v_old_data, v_old_rev from tournament_state where id = 1 for update;

  if not found then
    if p_base_rev <> 0 then
      return jsonb_build_object('ok', false, 'rev', 0);
    end if;
    v_new_rev := greatest(1, v_now_ms);
    insert into tournament_state (id, data, rev, updated_at, updated_by)
      values (1, p_data, v_new_rev, now(), p_actor_id)
      on conflict (id) do nothing;
    if not found then
      return jsonb_build_object('ok', false, 'rev', 0);
    end if;
  else
    if v_old_rev <> p_base_rev then
      return jsonb_build_object('ok', false, 'rev', v_old_rev);
    end if;
    insert into state_snapshots (actor_username, reason, data)
      values (p_actor_username, p_reason, v_old_data);
    v_new_rev := greatest(v_old_rev + 1, v_now_ms);
    update tournament_state
      set data = p_data, rev = v_new_rev, updated_at = now(), updated_by = p_actor_id
      where id = 1;
    delete from state_snapshots
      where id not in (select id from state_snapshots order by id desc limit 20);
  end if;

  insert into audit_log (actor_id, actor_username, action, summary, details)
    values (p_actor_id, p_actor_username, p_action, p_summary, p_details);

  return jsonb_build_object('ok', true, 'rev', v_new_rev);
end $$;

-- ---------- lock everything down ----------
-- RLS on, no policies: anon/authenticated get zero rows and cannot write.
alter table admins           enable row level security;
alter table sessions         enable row level security;
alter table login_attempts   enable row level security;
alter table tournament_state enable row level security;
alter table audit_log        enable row level security;
alter table state_snapshots  enable row level security;

-- Belt and braces: remove the default grants Supabase gives the public roles,
-- and make sure PostgREST cannot expose our functions to the anon key.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function save_state(bigint, jsonb, uuid, text, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function audit_log_immutable() from public, anon, authenticated;
grant execute on function save_state(bigint, jsonb, uuid, text, text, text, jsonb, text) to service_role;
