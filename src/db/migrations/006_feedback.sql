-- Problems and suggestions reported from inside the app ("Report a problem").
create table feedback (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organisations (id) on delete set null,
  user_id     uuid references users (id) on delete set null,
  kind        text not null check (kind in ('problem', 'idea')),
  message     text not null,
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
