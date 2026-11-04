-- A second sign-in step (authenticator app) for every user, not only platform admins.
-- The table is the same one the manager portal used; it is keyed by user, so it carries over unchanged.
alter table admin_mfa rename to user_mfa;

-- After a correct password, a user with a second step gets a short-lived, single-use ticket instead of a session.
create table login_challenges (
  token_hash text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  org_id     uuid references organisations (id) on delete set null,
  attempts   integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index login_challenges_user_idx on login_challenges (user_id);
