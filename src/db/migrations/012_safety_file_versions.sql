-- Every time a safety file is compiled with different contents, COMVERA keeps
-- a revision: what was in it (document versions, expiries, statuses), when and
-- by whom. Compiling again with nothing changed does not create a new revision.
create table safety_file_versions (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references sites on delete cascade,
  number       integer not null,
  digest       text not null,
  contents     jsonb not null,
  generated_by text not null,
  created_at   timestamptz not null default now(),
  unique (site_id, number)
);
