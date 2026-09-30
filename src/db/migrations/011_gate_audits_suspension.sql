-- Suspending a contractor company across all of a mine's sites.
alter table contractors add column suspended_at timestamptz;
alter table contractors add column suspended_reason text not null default '';
alter table contractors add column suspended_by_name text not null default '';

-- Gate clearance: each worker assigned to a site gets an unguessable token for its QR gate card.
alter table site_workers add column gate_token text unique;

-- Monthly contractor audits (a scored on-site checklist) and the findings they raise.
create table contractor_audits (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references sites (id) on delete cascade,  -- the contractor's file on the site
  org_id       uuid not null references organisations (id) on delete cascade, -- the mine
  audited_on   date not null default current_date,
  auditor_id   uuid references users (id) on delete set null,
  auditor_name text not null,
  items        jsonb not null,            -- [{text, result: 'yes'|'no'|'na', note}]
  score        integer not null check (score between 0 and 100),
  summary      text not null default '',
  created_at   timestamptz not null default now()
);
create index contractor_audits_site_idx on contractor_audits (site_id, audited_on desc);

create table audit_findings (
  id              uuid primary key default gen_random_uuid(),
  audit_id        uuid not null references contractor_audits (id) on delete cascade,
  site_id         uuid not null references sites (id) on delete cascade,
  text            text not null,
  due_on          date not null,
  status          text not null default 'open' check (status in ('open', 'responded', 'closed')),
  response        text not null default '',
  responded_by    text not null default '',
  responded_at    timestamptz,
  closed_by_name  text not null default '',
  closed_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index audit_findings_site_idx on audit_findings (site_id, status);
