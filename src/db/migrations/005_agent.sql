-- The compliance agent's findings: one row per issue it has noticed for an
-- organisation. A finding stays open while the agent keeps seeing it and is
-- marked resolved the first run it no longer applies.
create table agent_findings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations (id) on delete cascade,
  site_id     uuid references sites (id) on delete cascade,
  key         text not null,
  severity    text not null check (severity in ('high', 'medium', 'low')),
  title       text not null,
  detail      text not null default '',
  action      jsonb not null default '{}'::jsonb,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  resolved_at timestamptz,
  unique (org_id, key)
);
create index agent_findings_open_idx on agent_findings (org_id) where resolved_at is null;

create table agent_runs (
  org_id      uuid primary key references organisations (id) on delete cascade,
  last_run_at timestamptz not null default now()
);
