-- Short join codes for site invitations, so a contractor can connect to a
-- site by typing a code given on site instead of waiting for an email.
-- Only a hash is stored; a new code replaces the old one.
alter table site_invitations add column join_code_hash text unique;
alter table site_invitations add column join_code_expires_at timestamptz;
