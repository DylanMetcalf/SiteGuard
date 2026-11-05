-- Email confirmation before using the app applies to people who sign up from now on. Everyone who already had an
-- account keeps working as before (their address is NOT marked confirmed: actions that need a confirmed address,
-- such as inviting a contractor by email, still ask them to confirm).
alter table users add column verify_required boolean not null default true;
update users set verify_required = false;
