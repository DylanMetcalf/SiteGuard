-- Guided set-up, a document store for every organisation (uploads, with versions), and
-- departments / operational areas inside a site.

-- Set-up answers live in organisations.onboarding; completion unlocks the app.
-- Existing organisations were set up before this existed, so they count as done.
alter table organisations
  add column onboarding              jsonb not null default '{}'::jsonb,
  add column onboarding_completed_at timestamptz;
update organisations set onboarding_completed_at = coalesce(created_at, now());

-- Departments and operational areas of a site (a workplace). Optional.
create table site_areas (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations (id) on delete cascade,
  workplace_id uuid not null references workplaces (id) on delete cascade,
  name         text not null check (length(name) between 1 and 120),
  kind         text not null default 'area' check (kind in ('department', 'area')),
  created_at   timestamptz not null default now(),
  unique (workplace_id, name)
);
create index site_areas_org_idx on site_areas (org_id);

-- An uploaded document that belongs to an organisation: a policy, procedure, template, certificate...
-- It is "received", never "approved": approval stays in the review workflows.
create table org_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations (id) on delete cascade,
  name          text not null check (length(name) between 1 and 200),
  description   text not null default '',
  doc_type      text not null check (doc_type in ('policy', 'procedure', 'template', 'certificate', 'report', 'induction', 'emergency',
                                                  'risk_assessment', 'method_statement', 'registration', 'insurance', 'training', 'equipment', 'other')),
  scope         text not null default 'company' check (scope in ('company', 'site', 'project', 'personnel', 'equipment')),
  workplace_id  uuid references workplaces (id) on delete set null,
  area_id       uuid references site_areas (id) on delete set null,
  site_id       uuid references sites (id) on delete set null,
  subject       text not null default '',  -- a person's or a piece of equipment's name, for personnel/equipment documents
  requirement   text not null default 'informational' check (requirement in ('mandatory', 'recommended', 'informational')),
  -- internal: only this organisation; restricted: only its owners and admins (e.g. medical records);
  -- contractors: also the contractors working on its sites (site rules, templates, induction packs).
  visibility    text not null default 'internal' check (visibility in ('internal', 'restricted', 'contractors')),
  issue_date    date,
  expiry_date   date,
  owner_name    text not null default '',
  current_file_id uuid references files (id) on delete set null,
  version       integer not null default 1,
  archived_at   timestamptz,
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index org_documents_org_idx on org_documents (org_id, archived_at, updated_at desc);
create index org_documents_workplace_idx on org_documents (workplace_id) where workplace_id is not null;

create table org_document_versions (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references org_documents (id) on delete cascade,
  version     integer not null,
  file_id     uuid not null references files (id) on delete cascade,
  note        text not null default '',
  uploaded_by uuid references users (id) on delete set null,
  uploaded_by_name text not null default '',
  created_at  timestamptz not null default now(),
  unique (document_id, version)
);
