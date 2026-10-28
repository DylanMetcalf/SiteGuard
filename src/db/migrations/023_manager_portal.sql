-- Manager portal: a second sign-in step for platform admins, a log of everything they do,
-- customer-granted support access, and a handled state for support items.

-- Authenticator-app (TOTP) enrolment for platform admins. The secret is encrypted when MFA_SECRET_KEY is set.
create table admin_mfa (
  user_id         uuid primary key references users (id) on delete cascade,
  secret          text not null,
  enabled_at      timestamptz,
  last_step       bigint not null default 0,
  recovery_hashes text[] not null default '{}',
  created_at      timestamptz not null default now()
);

-- When this session passed the second step. Admin routes need it recent.
alter table sessions add column mfa_verified_at timestamptz;

-- Everything a platform admin does, append-only, kept even if the admin account is later removed.
create table platform_actions (
  id            bigserial primary key,
  admin_user_id uuid references users (id) on delete set null,
  admin_email   text not null,
  action        text not null,
  org_id        uuid references organisations (id) on delete set null,
  detail        text not null default '',
  ip            text,
  created_at    timestamptz not null default now()
);
create index platform_actions_created_idx on platform_actions (created_at desc);
create index platform_actions_org_idx on platform_actions (org_id, created_at desc);
create function platform_actions_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('siteguard.purge', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'platform_actions is append-only (% refused)', tg_op;
end;
$$;
create trigger platform_actions_append_only before update or delete on platform_actions
  for each row execute function platform_actions_guard();

-- A customer admin lets COMVERA support look at their account for a limited time (read-only, no file contents).
create table support_access_grants (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations (id) on delete cascade,
  granted_by      uuid references users (id) on delete set null,
  granted_by_name text not null default '',
  reason          text not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);
create index support_access_org_idx on support_access_grants (org_id, expires_at desc);

alter table feedback add column handled_at timestamptz;
alter table feedback add column admin_note text not null default '';
alter table enquiries add column admin_note text not null default '';
