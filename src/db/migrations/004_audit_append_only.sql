-- The audit trail is append-only at the database level: no application code
-- path (or bug, or injected query) can edit or remove history. The only
-- exception is deliberate removal of a whole tenant — e.g. purging an expired
-- demo sandbox — which must opt in for the current transaction with
--   set local siteguard.purge = 'on';
create function audit_events_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('siteguard.purge', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'audit_events is append-only (% refused)', tg_op;
end;
$$;

create trigger audit_events_append_only
  before update or delete on audit_events
  for each row execute function audit_events_guard();
