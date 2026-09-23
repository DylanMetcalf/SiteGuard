-- Product gaps from the MVP audit: per-worker medical surveillance and
-- competency tracking, a legal appointments register, toolbox talk
-- attendance with signatures, and per-user dashboard preferences.

-- People who work for an organisation (usually a contractor's crew).
create table workers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations (id) on delete cascade,
  full_name     text not null check (length(full_name) between 1 and 200),
  employee_no   text not null default '',
  -- Only the last 4 digits of an ID/passport number are kept, for matching on site.
  id_last4      text not null default '' check (id_last4 ~ '^[0-9A-Za-z]{0,4}$'),
  occupation    text not null default '',
  phone         text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index workers_org_idx on workers (org_id);

-- Certificates held by an individual worker: medical fitness, induction, competency, training.
create table worker_certificates (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references workers (id) on delete cascade,
  kind            text not null check (kind in ('medical_fitness', 'induction', 'competency', 'training', 'other')),
  name            text not null,
  issuer          text not null default '',
  issued_on       date,
  expires_on      date,
  restrictions    text not null default '',
  file_id         uuid references files (id) on delete set null,
  created_by_name text not null,
  created_at      timestamptz not null default now()
);
create index worker_certificates_worker_idx on worker_certificates (worker_id);

-- Which workers a contractor has put on which site. The host sees these workers.
create table site_workers (
  site_id     uuid not null references sites (id) on delete cascade,
  worker_id   uuid not null references workers (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (site_id, worker_id)
);
create index site_workers_worker_idx on site_workers (worker_id);

-- Statutory appointments (e.g. OHS Act s16(1)/16(2), Construction Regulations 8(1)/8(7), MHSA appointments).
create table appointments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations (id) on delete cascade,
  site_id          uuid references sites (id) on delete cascade,
  appointee_name   text not null,
  worker_id        uuid references workers (id) on delete set null,
  appointment_type text not null,
  legal_reference  text not null default '',
  appointed_by     text not null default '',
  start_date       date not null,
  end_date         date,
  file_id          uuid references files (id) on delete set null,
  revoked_at       timestamptz,
  created_by_name  text not null,
  created_at       timestamptz not null default now()
);
create index appointments_org_idx on appointments (org_id);
create index appointments_site_idx on appointments (site_id);

create table toolbox_talks (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references sites (id) on delete cascade,
  org_id         uuid not null references organisations (id) on delete cascade,
  topic          text not null,
  content        text not null default '',
  presenter_name text not null,
  held_on        date not null,
  created_at     timestamptz not null default now()
);
create index toolbox_talks_site_idx on toolbox_talks (site_id, held_on desc);

create table toolbox_attendance (
  id            uuid primary key default gen_random_uuid(),
  talk_id       uuid not null references toolbox_talks (id) on delete cascade,
  worker_id     uuid references workers (id) on delete set null,
  attendee_name text not null,
  -- PNG data URL of the attendee's drawn signature.
  signature     text not null check (length(signature) <= 120000),
  signed_at     timestamptz not null default now()
);
create index toolbox_attendance_talk_idx on toolbox_attendance (talk_id);

create table user_prefs (
  user_id   uuid not null references users (id) on delete cascade,
  org_id    uuid not null references organisations (id) on delete cascade,
  dashboard jsonb not null default '{}'::jsonb,
  primary key (user_id, org_id)
);
