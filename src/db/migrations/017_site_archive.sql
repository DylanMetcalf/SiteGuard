-- Mines can archive a site they no longer use (hidden from lists, closed to new contractors;
-- every contractor's file and the audit trail stay as the record) and bring it back later.
alter table workplaces add column archived_at timestamptz;
