-- Contractor projects: a contractor builds a safety file for a client or site that
-- isn't on COMVERA. The client is a private record owned by the contractor (an
-- organisation nobody can sign in to, marked managed_by_org), and the project is an
-- ordinary safety file for that client, so every existing screen, export, share
-- link and permission rule applies unchanged. Deleting the contractor deletes its
-- client records and their projects.
alter table organisations add column managed_by_org uuid references organisations (id) on delete cascade;
create index organisations_managed_idx on organisations (managed_by_org) where managed_by_org is not null;
alter table sites add column client_contact text not null default '';
