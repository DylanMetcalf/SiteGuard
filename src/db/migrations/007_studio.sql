-- Document Studio: professionally formatted documents generated for an
-- organisation (optionally for a site and requirement). Each revision is a
-- row; revisions share a document number.
create table generated_documents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations (id) on delete cascade,
  site_id         uuid references sites (id) on delete set null,
  requirement_id  uuid references requirements (id) on delete set null,
  blueprint       text not null,
  title           text not null,
  doc_number      text not null,
  revision        integer not null default 0 check (revision >= 0),
  revision_note   text not null default '',
  inputs          jsonb not null default '{}'::jsonb,
  content         jsonb not null,
  pdf_file_id     uuid references files (id) on delete set null,
  docx_file_id    uuid references files (id) on delete set null,
  ai              boolean not null default false,
  created_by      uuid references users (id) on delete set null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  review_due      date not null,
  superseded_at   timestamptz,
  unique (org_id, doc_number, revision)
);
create index generated_documents_org_idx on generated_documents (org_id, created_at desc);
