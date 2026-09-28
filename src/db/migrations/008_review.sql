-- Section-by-section review of Document Studio documents, comments with
-- highlighted quotes, review links for people without an account, and the
-- in-app notifications inbox.

-- A decision on one section. Keyed by the section's content hash, so an
-- approval carries over to later revisions until that section changes.
create table doc_section_reviews (
  id                    uuid primary key default gen_random_uuid(),
  generated_document_id uuid not null references generated_documents (id) on delete cascade,
  section_index         integer not null,
  section_hash          text not null,
  decision              text not null check (decision in ('approved', 'changes')),
  note                  text not null default '',
  reviewer_kind         text not null check (reviewer_kind in ('host', 'external')),
  reviewer_org_id       uuid references organisations (id) on delete set null,
  reviewer_user_id      uuid references users (id) on delete set null,
  reviewer_name         text not null,
  created_at            timestamptz not null default now()
);
create index doc_section_reviews_doc_idx on doc_section_reviews (generated_document_id);

create table doc_comments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations (id) on delete cascade, -- the document owner
  doc_number            text not null,
  generated_document_id uuid not null references generated_documents (id) on delete cascade,
  section_index         integer,
  section_heading       text not null default '',
  quote                 text not null default '',
  body                  text not null,
  author_kind           text not null check (author_kind in ('owner', 'host', 'external')),
  author_org_id         uuid references organisations (id) on delete set null,
  author_user_id        uuid references users (id) on delete set null,
  author_name           text not null,
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz,
  resolved_by_name      text
);
create index doc_comments_doc_idx on doc_comments (org_id, doc_number, created_at);

-- A link that lets someone without a SiteGuard account review one document
-- (always its latest revision). Only the token's hash is stored.
create table review_links (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations (id) on delete cascade,
  doc_number      text not null,
  token_hash      text not null unique,
  label           text not null default '',
  created_by      uuid references users (id) on delete set null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  last_used_at    timestamptz
);
create index review_links_doc_idx on review_links (org_id, doc_number);

create table notifications (
  id         bigserial primary key,
  user_id    uuid not null references users (id) on delete cascade,
  org_id     uuid not null references organisations (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  link       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_user_idx on notifications (user_id, org_id, created_at desc);
