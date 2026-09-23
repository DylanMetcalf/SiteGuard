-- Remembers which reminder items have already been sent, so a document
-- expiring in 30 days is mentioned once at 30 days, once at 7, and once when
-- it lapses — not every day.
create table reminder_log (
  key     text primary key,
  sent_at timestamptz not null default now()
);
