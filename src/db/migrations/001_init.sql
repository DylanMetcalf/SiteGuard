-- SiteGuard core schema.
--
-- Tenancy model
-- -------------
-- Every organisation is a tenant. There are two kinds:
--   * host        — a mine / site owner that runs sites and needs safety files
--   * contractor  — a contractor company that submits safety files to hosts
--
-- A site belongs to exactly one host organisation (sites.org_id). The host keeps
-- its own directory of contractors (contractors.org_id = host). When a contractor
-- company accepts an invitation, that directory entry is linked to the
-- contractor's own organisation (contractors.linked_org_id). From then on,
-- members of the contractor organisation can see and act on the sites that
-- directory entry is assigned to — and nothing else the host owns.
--
-- Every access check in the API resolves to one of those two relationships.

create extension if not exists citext;

create table organisations (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (length(name) between 1 and 200),
  kind                   text not null check (kind in ('host', 'contractor')),
  reg_number             text not null default '',
  coid_number            text not null default '',
  vat_number             text not null default '',
  address                text not null default '',
  trade                  text not null default '',
  plan                   text not null,
  subscription_status    text not null default 'trialing'
                           check (subscription_status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'free')),
  trial_ends_at          timestamptz,
  seat_limit             integer not null default 5 check (seat_limit >= 1),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  current_period_end     timestamptz,
  settings               jsonb not null default '{}'::jsonb,
  is_demo                boolean not null default false,
  demo_group             uuid,
  created_at             timestamptz not null default now()
);
create index organisations_demo_group_idx on organisations (demo_group) where demo_group is not null;

create table users (
  id                  uuid primary key default gen_random_uuid(),
  email               citext not null unique,
  name                text not null check (length(name) between 1 and 200),
  password_hash       text,
  title               text not null default '',
  phone               text not null default '',
  email_verified_at   timestamptz,
  last_active_org_id  uuid references organisations (id) on delete set null,
  failed_login_count  integer not null default 0,
  locked_until        timestamptz,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now()
);

create table memberships (
  org_id     uuid not null references organisations (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'reviewer', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

-- Session tokens are random 32-byte values; only their SHA-256 is stored.
create table sessions (
  id            text primary key,
  user_id       uuid not null references users (id) on delete cascade,
  org_id        uuid references organisations (id) on delete set null,
  csrf_token    text not null,
  ip            text,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

-- Single-use tokens for email verification and password reset (hashed).
create table email_tokens (
  token_hash text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  purpose    text not null check (purpose in ('verify_email', 'reset_password')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index email_tokens_user_idx on email_tokens (user_id, purpose);

-- Invitations to join an organisation as a user (team invites).
create table user_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations (id) on delete cascade,
  email       citext not null,
  role        text not null check (role in ('owner', 'admin', 'reviewer', 'member')),
  token_hash  text not null unique,
  invited_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz
);
create index user_invites_org_idx on user_invites (org_id);

-- The host's contractor directory.
create table contractors (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations (id) on delete cascade,
  name                  text not null check (length(name) between 1 and 200),
  reg_number            text not null default '',
  coid_number           text not null default '',
  trade                 text not null default '',
  contact_name          text not null default '',
  contact_email         citext,
  linked_org_id         uuid references organisations (id) on delete set null,
  reliability           integer not null default 0,
  on_time_rate          integer not null default 0,
  first_time_right_rate integer not null default 0,
  created_at            timestamptz not null default now()
);
create index contractors_org_idx on contractors (org_id);
create index contractors_linked_idx on contractors (linked_org_id) where linked_org_id is not null;
create unique index contractors_one_link_per_host on contractors (org_id, linked_org_id) where linked_org_id is not null;

create table sites (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations (id) on delete cascade,
  name          text not null check (length(name) between 1 and 300),
  location      text not null default '',
  contractor_id uuid not null references contractors (id) on delete restrict,
  status        text not null default 'invited' check (status in ('invited', 'in_progress', 'declined', 'site_ready')),
  emergency     jsonb not null default '{}'::jsonb,
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index sites_org_idx on sites (org_id);
create index sites_contractor_idx on sites (contractor_id);

-- Invitation of a contractor (company) onto a site.
create table site_invitations (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references sites (id) on delete cascade,
  org_id        uuid not null references organisations (id) on delete cascade,
  contractor_id uuid not null references contractors (id) on delete cascade,
  email         citext,
  token_hash    text not null unique,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  sent_at       timestamptz not null default now(),
  responded_at  timestamptz,
  responded_by  uuid references users (id) on delete set null
);
create index site_invitations_site_idx on site_invitations (site_id);

create table requirements (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references sites (id) on delete cascade,
  category   text not null,
  name       text not null,
  source     text not null check (source in ('legal', 'client', 'site', 'project', 'company', 'best_practice', 'platform')),
  why        text not null default '',
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index requirements_site_idx on requirements (site_id, position);

create table files (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations (id) on delete cascade,
  storage_key  text not null unique,
  filename     text not null,
  content_type text not null,
  size_bytes   bigint not null,
  sha256       text not null,
  uploaded_by  uuid references users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index files_org_idx on files (org_id);

-- One live document per site requirement, or per contractor library slot.
create table documents (
  id              uuid primary key default gen_random_uuid(),
  requirement_id  uuid unique references requirements (id) on delete cascade,
  library_org_id  uuid references organisations (id) on delete cascade,
  library_type    text,
  status          text not null default 'missing'
                    check (status in ('missing', 'complete', 'expiring', 'awaiting_review', 'correction_required')),
  version         text,
  note            text not null default '',
  expiry_date     date,
  -- A file attached but not yet submitted (draft attachment).
  pending_file_id uuid references files (id) on delete set null,
  current_file_id uuid references files (id) on delete set null,
  updated_at      timestamptz not null default now(),
  check ((requirement_id is not null) <> (library_org_id is not null)),
  check ((library_org_id is null) = (library_type is null)),
  unique (library_org_id, library_type)
);

create table document_versions (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references documents (id) on delete cascade,
  version           text not null,
  file_id           uuid references files (id) on delete set null,
  note              text not null default '',
  expiry_date       date,
  ai_drafted        boolean not null default false,
  submitted_by      uuid references users (id) on delete set null,
  submitted_by_name text not null,
  submitted_at      timestamptz not null default now()
);
create index document_versions_doc_idx on document_versions (document_id, submitted_at);

create table reviews (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  author_id   uuid references users (id) on delete set null,
  author_name text not null,
  author_role text not null,
  kind        text not null check (kind in ('correction', 'approval', 'comment')),
  text        text not null,
  created_at  timestamptz not null default now()
);
create index reviews_doc_idx on reviews (document_id, created_at);

create table approvals (
  site_id           uuid primary key references sites (id) on delete cascade,
  approver_id       uuid references users (id) on delete set null,
  approver_name     text not null,
  approver_role     text not null,
  org_name          text not null,
  approved_on       date not null,
  version           text not null,
  verification_id   text not null unique,
  readiness_percent integer not null
);

create table incidents (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references sites (id) on delete cascade,
  type               text not null check (type in ('near_miss', 'first_aid', 'medical_treatment', 'lost_time', 'fatality', 'property_damage', 'environmental')),
  occurred_on        date not null,
  person             text not null default '',
  description        text not null,
  immediate_actions  text not null default '',
  reported_by        uuid references users (id) on delete set null,
  reported_by_name   text not null,
  reported_by_role   text not null,
  reported_by_org_id uuid references organisations (id) on delete set null,
  status             text not null default 'open' check (status in ('open', 'investigating', 'closed')),
  root_cause         text not null default '',
  corrective_actions text not null default '',
  closed_at          timestamptz,
  created_at         timestamptz not null default now()
);
create index incidents_site_idx on incidents (site_id, created_at desc);

create table permits (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references sites (id) on delete cascade,
  type              text not null check (type in ('hot_work', 'heights', 'confined_space', 'excavation', 'lifting', 'electrical_isolation')),
  location          text not null,
  description       text not null default '',
  precautions       text not null default '',
  issued_to         text not null default '',
  issued_by_name    text not null default '',
  requested_by_name text not null default '',
  valid_from        timestamptz,
  valid_to          timestamptz,
  status            text not null check (status in ('pending', 'active', 'closed')),
  closed_by_name    text,
  closed_at         timestamptz,
  close_notes       text not null default '',
  created_at        timestamptz not null default now()
);
create index permits_site_idx on permits (site_id, created_at desc);

-- Requests for a document / information / feedback, from host to contractor.
create table info_requests (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references sites (id) on delete cascade,
  type                  text not null check (type in ('document', 'information', 'feedback')),
  title                 text not null,
  message               text not null default '',
  due_date              date,
  requested_by          uuid references users (id) on delete set null,
  requested_by_name     text not null,
  requested_by_role     text not null,
  status                text not null default 'requested' check (status in ('requested', 'viewed', 'submitted', 'completed')),
  linked_requirement_id uuid references requirements (id) on delete set null,
  response              text,
  responded_at          timestamptz,
  created_at            timestamptz not null default now()
);
create index info_requests_site_idx on info_requests (site_id);

create table diary_entries (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references sites (id) on delete cascade,
  entry_date    date not null,
  author_id     uuid references users (id) on delete set null,
  author_name   text not null,
  crew          integer not null default 0 check (crew >= 0),
  weather       text not null default '',
  summary       text not null,
  incident      boolean not null default false,
  incident_note text not null default '',
  created_at    timestamptz not null default now()
);
create index diary_site_idx on diary_entries (site_id, entry_date desc);

create table inspections (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references sites (id) on delete cascade,
  title          text not null,
  type           text not null default 'Inspection',
  inspector_name text not null,
  inspected_on   date not null,
  status         text not null default 'open' check (status in ('open', 'closed')),
  external_ref   text not null default '',
  created_at     timestamptz not null default now()
);
create index inspections_site_idx on inspections (site_id);

create table defects (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections (id) on delete cascade,
  description   text not null,
  severity      text not null check (severity in ('high', 'medium', 'low')),
  status        text not null default 'assigned' check (status in ('open', 'assigned', 'resolved', 'verified')),
  assigned_to   text not null default '',
  due_date      date,
  closed_at     date,
  created_at    timestamptz not null default now()
);
create index defects_inspection_idx on defects (inspection_id);

-- Append-only audit trail. org_id is the organisation the actor acted for.
create table audit_events (
  id          bigserial primary key,
  org_id      uuid references organisations (id) on delete cascade,
  site_id     uuid references sites (id) on delete set null,
  actor_id    uuid references users (id) on delete set null,
  actor_name  text not null,
  actor_role  text not null,
  action      text not null,
  detail      text not null default '',
  created_at  timestamptz not null default now()
);
create index audit_org_idx on audit_events (org_id, created_at desc);
create index audit_site_idx on audit_events (site_id, created_at desc);

-- Expiring, revocable links for people outside the organisation.
create table share_links (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations (id) on delete cascade,
  site_id          uuid not null references sites (id) on delete cascade,
  kind             text not null check (kind in ('site_readiness', 'safety_file')),
  label            text not null default '',
  token_hash       text not null unique,
  created_by       uuid references users (id) on delete set null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  last_accessed_at timestamptz,
  access_count     integer not null default 0
);
create index share_links_org_idx on share_links (org_id);

-- Transactional outbox for email. A worker delivers pending rows.
create table email_outbox (
  id          bigserial primary key,
  org_id      uuid references organisations (id) on delete cascade,
  to_email    citext not null,
  subject     text not null,
  text_body   text not null,
  html_body   text not null,
  dedupe_key  text unique,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  send_after  timestamptz not null default now(),
  sent_at     timestamptz
);
create index email_outbox_pending_idx on email_outbox (send_after) where status = 'pending';

-- Stripe webhook idempotency.
create table stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

-- Per-organisation monthly AI usage (for plan limits).
create table ai_usage (
  org_id        uuid not null references organisations (id) on delete cascade,
  month         text not null,
  requests      integer not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (org_id, month)
);
