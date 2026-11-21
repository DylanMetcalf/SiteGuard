-- Personal profile as part of sign-up: first and last name, why the person uses COMVERA (shapes their first screen; never a
-- permission), and when they accepted the terms. Existing users are marked complete so nobody is pushed through it again.
-- Rollback: these are additive columns; dropping them restores the previous schema (no other table depends on them).
alter table users
  add column first_name text not null default '' check (length(first_name) <= 100),
  add column last_name text not null default '' check (length(last_name) <= 100),
  add column purpose text not null default '' check (purpose in ('', 'site', 'contractors', 'documents', 'review', 'invited', 'clients')),
  add column profile_completed_at timestamptz,
  add column terms_accepted_at timestamptz,
  add column terms_version text not null default '';

update users set profile_completed_at = coalesce(created_at, now()) where profile_completed_at is null;
