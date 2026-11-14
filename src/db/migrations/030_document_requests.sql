-- Document requests: replacement, signed-copy and "other" requests ride on COMVERA Exchange (one secure recipient model,
-- one review workflow). An item now says what kind of request it is, why, and which document/version it refers to.

alter table exchange_items
  add column kind          text not null default 'document' check (kind in ('document', 'replacement', 'signature', 'other')),
  add column reason        text not null default '' check (length(reason) <= 1000),
  add column due_date      date,
  -- The site requirement this answers (replacement / general request for a requirement). Linking never changes readiness rules.
  add column requirement_id uuid references requirements (id) on delete set null,
  -- The document being replaced or signed, as it was when the request was made. A later revision never inherits a signature.
  add column source_kind   text check (source_kind in ('requirement', 'org_document', 'certificate')),
  add column source_id     uuid,
  add column source_label  text not null default '',
  add column source_version text not null default '',
  add column source_file_id uuid references files (id) on delete set null,
  add column source_sha256 text not null default '',
  -- Expiry the recipient states for a requirement-linked document; filed with the new version.
  add column expiry_date   date;

-- Which email is the request's current one, so the screen can say honestly whether it was queued, delivered or failed.
alter table exchanges
  add column email_outbox_id bigint references email_outbox (id) on delete set null,
  add column reminded_at     timestamptz,
  add column remind_count    integer not null default 0;

-- The document version a submission created on the requirement (replacement history stays in document_versions).
alter table exchange_submissions
  add column document_version text not null default '';

create index exchange_items_requirement_idx on exchange_items (requirement_id) where requirement_id is not null;
create index exchange_items_source_idx on exchange_items (source_kind, source_id) where source_id is not null;
