-- A site (workplace) that many contractors join with one site code. Each contractor
-- that joins gets its own safety file for the site: an ordinary `sites` row (one per
-- contractor) linked here, with the site's requirements copied in.
create table workplaces (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations (id) on delete cascade,
  name         text not null check (length(name) between 1 and 300),
  location     text not null default '',
  emergency    jsonb not null default '{}'::jsonb,
  -- The safety file requirements every contractor on this site must meet: [{category, name, source, why}].
  requirements jsonb not null default '[]'::jsonb,
  -- The site code is meant to be shared (printed, sent on WhatsApp), so it is kept readable
  -- for the site's admins; it only lets a contractor company ask to join, and can be replaced.
  join_code    text unique,
  join_open    boolean not null default true,
  created_by   uuid references users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index workplaces_org_idx on workplaces (org_id);

alter table sites add column workplace_id uuid references workplaces (id) on delete set null;
create index sites_workplace_idx on sites (workplace_id);
create unique index sites_one_file_per_contractor on sites (workplace_id, contractor_id) where workplace_id is not null;
