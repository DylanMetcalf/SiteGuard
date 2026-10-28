-- Site templates: a mine's own forms for a requirement (PDF, Word, Excel, image). The contractor
-- downloads, completes and uploads it as the document for that requirement. A template applies to
-- every contractor file at a workplace, or to one contractor file. Replacing one keeps the old
-- version (superseded_at) so what a contractor was given can always be traced.
create table if not exists requirement_templates (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade,
  workplace_id     uuid references workplaces(id) on delete cascade,
  site_id          uuid references sites(id) on delete cascade,
  requirement_name text not null,
  title            text not null,
  description      text not null default '',
  file_id          uuid not null references files(id),
  version          integer not null default 1,
  created_by       uuid references users(id) on delete set null,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  superseded_at    timestamptz,
  archived_at      timestamptz,
  check ((workplace_id is null) <> (site_id is null))
);
create index if not exists requirement_templates_workplace on requirement_templates (workplace_id) where workplace_id is not null;
create index if not exists requirement_templates_site on requirement_templates (site_id) where site_id is not null;
-- One current template per requirement and scope.
create unique index if not exists requirement_templates_current
  on requirement_templates (coalesce(workplace_id, site_id), lower(requirement_name))
  where superseded_at is null and archived_at is null;
