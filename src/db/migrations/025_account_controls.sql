-- Account controls for the platform owner: status (active / suspended / deactivated), a separate flag
-- for review, a classification for internal test accounts, a protected deletion workflow with a
-- permanent ledger, and a persistent state for the manual items on the setup checklist.

-- Status is access control; flag is a note for review that blocks nothing; class separates test from customers.
alter table organisations
  add column status            text not null default 'active' check (status in ('active', 'suspended', 'deactivated')),
  add column status_reason     text not null default '',
  add column status_changed_at timestamptz,
  add column status_changed_by text,
  add column flag_kind         text check (flag_kind in ('suspicious', 'suspected_bot', 'spam', 'duplicate', 'under_investigation')),
  add column flag_reason       text not null default '',
  add column flagged_at        timestamptz,
  add column account_class     text not null default 'customer' check (account_class in ('customer', 'internal_test', 'development'));

alter table users
  add column status            text not null default 'active' check (status in ('active', 'suspended', 'deactivated')),
  add column status_reason     text not null default '',
  add column status_changed_at timestamptz,
  add column status_changed_by text,
  add column flag_kind         text check (flag_kind in ('suspicious', 'suspected_bot', 'spam', 'duplicate', 'under_investigation')),
  add column flag_reason       text not null default '',
  add column flagged_at        timestamptz,
  add column account_class     text not null default 'customer' check (account_class in ('customer', 'internal_test', 'development'));

create index organisations_status_idx on organisations (status) where status <> 'active';
create index organisations_flag_idx on organisations (flag_kind) where flag_kind is not null;
create index users_status_idx on users (status) where status <> 'active';
create index users_flag_idx on users (flag_kind) where flag_kind is not null;

-- A request to permanently delete an organisation. It is scheduled, can be cancelled, and is carried
-- out only by the platform owner after the waiting period, with a fresh code, password and typed name.
-- No foreign key to organisations: the request must outlive the organisation.
create table deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  org_name      text not null,
  org_kind      text not null,
  reason        text not null,
  requested_by  text not null,
  requested_at  timestamptz not null default now(),
  scheduled_for timestamptz not null,
  status        text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'completed')),
  impact        jsonb not null default '{}'::jsonb,
  closed_by     text,
  closed_at     timestamptz
);
create unique index deletion_requests_one_open on deletion_requests (org_id) where status = 'scheduled';

-- What is kept after an organisation is deleted: who, when, why, how much was removed, and its payment
-- records (which tax and accounting rules usually require keeping). It holds no documents and no personal data
-- beyond the administrator's email.
create table deletion_ledger (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null,
  org_id        uuid not null,
  org_name      text not null,
  org_kind      text not null,
  deleted_at    timestamptz not null default now(),
  deleted_by    text not null,
  reason        text not null,
  removed       jsonb not null default '{}'::jsonb,
  payments      jsonb not null default '[]'::jsonb
);
create function deletion_ledger_guard() returns trigger language plpgsql as $$
begin
  raise exception 'deletion_ledger is append-only (% refused)', tg_op;
end;
$$;
create trigger deletion_ledger_append_only before update or delete on deletion_ledger
  for each row execute function deletion_ledger_guard();

-- Manual setup-checklist items the owner ticks off themselves (legal review, backup test, ...).
create table platform_checklist (
  item_id text primary key,
  done_by text not null,
  done_at timestamptz not null default now()
);
