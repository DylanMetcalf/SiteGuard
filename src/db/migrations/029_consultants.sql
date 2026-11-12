-- Safety consultants: one organisation that looks after several client companies.
-- A consultant is an ordinary contractor organisation with is_consultant set. Each client company is its own
-- organisation (its own documents, workers and sites), linked to the consultant by billing_parent_id and covered
-- by the consultant's plan while it stays inside the plan's client limit (see lib/consultants.ts; computed live,
-- never stored). registration_key is the company registration number with punctuation removed and is unique among
-- clients, so one company cannot be added twice or swapped between consultants to get round the limit.
alter table organisations
  add column if not exists is_consultant boolean not null default false,
  add column if not exists billing_parent_id uuid references organisations (id) on delete set null,
  add column if not exists registration_key text,
  add column if not exists client_archived_at timestamptz;

create unique index if not exists organisations_client_registration_key
  on organisations (registration_key) where registration_key is not null;
create index if not exists organisations_billing_parent_idx
  on organisations (billing_parent_id) where billing_parent_id is not null;

alter table organisations
  add constraint organisations_consultant_not_client check (billing_parent_id is null or not is_consultant);

-- A consultant's own staff get access to a client company only for as long as they are staff of the consultant:
-- those memberships are marked, so removing or demoting the person withdraws them, and they do not use the
-- client's seats.
alter table memberships add column if not exists via_consultant boolean not null default false;
