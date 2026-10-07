-- Product statistics for the platform owner: which steps companies reach (signed up, first
-- safety file, first upload, ...). One row per event with the organisation and event name only;
-- no personal details, page views or tracking cookies.
create table product_events (
  id         bigserial primary key,
  org_id     uuid references organisations (id) on delete cascade,
  event      text not null check (event ~ '^[a-z_]{2,40}$'),
  created_at timestamptz not null default now()
);
create index product_events_event_idx on product_events (event, created_at);
create index product_events_org_idx on product_events (org_id, event);
