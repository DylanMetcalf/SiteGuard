-- COMVERA Exchange: request or share specific documents with people who have no COMVERA workspace.
-- An exchange is a scoped transaction, not an account: the recipient proves control of an email
-- address with a one-time code and sees that one exchange, nothing else. No user, organisation or
-- trial is created for them.

-- A relationship: one organisation's record of another party it deals with. Not a permission.
-- On the mine side it is tied to the existing contractor directory entry.
create table relationships (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations (id) on delete cascade,
  counterparty_name   text not null check (length(counterparty_name) between 1 and 200),
  counterparty_kind   text not null default 'contractor' check (counterparty_kind in ('contractor', 'host', 'other')),
  contractor_id       uuid unique references contractors (id) on delete cascade,
  -- Set only when the other party's own workspace is confirmed (e.g. after a verified claim).
  counterparty_org_id uuid references organisations (id) on delete set null,
  created_at          timestamptz not null default now(),
  last_interaction_at timestamptz not null default now()
);
create index relationships_org_idx on relationships (org_id);

-- People known to an organisation through a relationship. A contact is not a user.
create table contacts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations (id) on delete cascade,
  relationship_id uuid not null references relationships (id) on delete cascade,
  name            text not null default '',
  email           citext not null,
  phone           text not null default '',
  role            text not null default '',
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  unique (relationship_id, email)
);
create index contacts_org_idx on contacts (org_id);

create sequence exchange_ref_seq start 1001;

create table exchanges (
  id                 uuid primary key default gen_random_uuid(),
  ref                integer not null unique default nextval('exchange_ref_seq'),
  direction          text not null check (direction in ('request', 'share')),
  sender_org_id      uuid not null references organisations (id) on delete cascade,
  relationship_id    uuid references relationships (id) on delete set null,
  contact_id         uuid references contacts (id) on delete set null,
  -- Snapshot of who it was sent to; the address that must verify.
  recipient_name     text not null default '',
  recipient_email    citext not null,
  recipient_org_name text not null default '',
  -- Set when a workspace explicitly claims this exchange after verification.
  recipient_org_id   uuid references organisations (id) on delete set null,
  site_id            uuid references sites (id) on delete set null,
  message            text not null default '',
  -- What the recipient wrote back when submitting.
  recipient_response text not null default '',
  deadline           date,
  allow_download     boolean not null default true,
  status             text not null default 'requested',
  link_token_hash    text not null unique,
  access_expires_at  timestamptz not null,
  revoked_at         timestamptz,
  opened_at          timestamptz,
  verified_at        timestamptz,
  submitted_at       timestamptz,
  completed_at       timestamptz,
  claimed_at         timestamptz,
  created_by         uuid references users (id) on delete set null,
  created_by_name    text not null default '',
  created_at         timestamptz not null default now()
);
create index exchanges_sender_idx on exchanges (sender_org_id, created_at desc);
create index exchanges_recipient_email_idx on exchanges (recipient_email);
create index exchanges_relationship_idx on exchanges (relationship_id);

-- One requested document (request) or one shared document (share).
create table exchange_items (
  id             uuid primary key default gen_random_uuid(),
  exchange_id    uuid not null references exchanges (id) on delete cascade,
  position       integer not null default 0,
  document_type  text not null check (length(document_type) between 1 and 200),
  person_name    text not null default '',
  worker_id      uuid references workers (id) on delete set null,
  note           text not null default '',
  -- request: requested → submitted → approved | rejected (replacement required)
  -- share:   shared
  status         text not null default 'requested' check (status in ('requested', 'submitted', 'approved', 'rejected', 'shared')),
  review_note    text not null default '',
  reviewed_by_name text not null default '',
  reviewed_at    timestamptz,
  -- Shares point at the sender's own file; revoking the exchange never touches it.
  file_id        uuid references files (id) on delete set null,
  downloaded_at  timestamptz
);
create index exchange_items_exchange_idx on exchange_items (exchange_id, position);

-- What the recipient uploaded for a requested item. The file belongs to the requesting
-- organisation (its own compliance copy) and is never changed; replacements add a version.
-- submitted_at is null while the upload is a draft the recipient hasn't sent yet.
create table exchange_submissions (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references exchange_items (id) on delete cascade,
  version      integer not null,
  file_id      uuid not null references files (id) on delete restrict,
  note         text not null default '',
  submitted_by_email citext not null,
  uploaded_at  timestamptz not null default now(),
  submitted_at timestamptz,
  unique (item_id, version)
);

-- One-time codes sent to the recipient's email.
create table exchange_codes (
  id          bigserial primary key,
  exchange_id uuid not null references exchanges (id) on delete cascade,
  code_hash   text not null,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index exchange_codes_exchange_idx on exchange_codes (exchange_id, created_at desc);

-- Short-lived sessions for one exchange (never a workspace session).
create table exchange_sessions (
  token_hash  text primary key,
  exchange_id uuid not null references exchanges (id) on delete cascade,
  email       citext not null,
  csrf_token  text not null,
  ip          text not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Marketing permission is separate from using an exchange and is never assumed.
create table marketing_consents (
  email      citext primary key,
  consented  boolean not null,
  source     text not null default '',
  updated_at timestamptz not null default now()
);
