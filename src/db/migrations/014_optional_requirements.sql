-- Required vs optional requirements. An optional document that hasn't been handed in
-- (or has lapsed) doesn't count against readiness or Site Ready; once handed in it is
-- reviewed and shown like any other.
alter table requirements add column optional boolean not null default false;
