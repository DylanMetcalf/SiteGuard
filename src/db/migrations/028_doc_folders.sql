-- Folders in Document Studio. A folder belongs to one organisation and can be tied to a site (a mine's own site,
-- or a contractor's safety file at a site) or to a contractor in the mine's directory. Folders hold uploaded
-- documents only; deleting a folder never deletes documents (they move out of it).
create table doc_folders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations (id) on delete cascade,
  name          text not null check (length(name) between 1 and 120),
  workplace_id  uuid references workplaces (id) on delete set null,
  site_id       uuid references sites (id) on delete set null,
  contractor_id uuid references contractors (id) on delete set null,
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index doc_folders_name_unique on doc_folders (org_id, lower(name));
alter table org_documents add column folder_id uuid references doc_folders (id) on delete set null;
create index org_documents_folder_idx on org_documents (folder_id) where folder_id is not null;
