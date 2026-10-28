-- Paystack (South Africa) alongside Stripe, a payment history for reconciliation, and a once-off safety file.
alter table organisations
  add column if not exists billing_provider text,
  add column if not exists paystack_customer_code text,
  add column if not exists paystack_subscription_code text,
  add column if not exists paystack_email_token text;

create index if not exists organisations_paystack_customer on organisations (paystack_customer_code) where paystack_customer_code is not null;
create index if not exists organisations_paystack_subscription on organisations (paystack_subscription_code) where paystack_subscription_code is not null;

-- One row per webhook body seen (sha256 of the raw body): a retried delivery is processed once.
create table if not exists paystack_events (
  id          text primary key,
  event       text not null,
  received_at timestamptz not null default now()
);

-- Paystack plan codes, one per COMVERA plan and price (a price change creates a new Paystack plan).
create table if not exists paystack_plans (
  plan_id      text not null,
  amount_cents integer not null,
  interval     text not null default 'monthly',
  plan_code    text not null unique,
  created_at   timestamptz not null default now(),
  primary key (plan_id, amount_cents, interval)
);

-- Every payment attempt and charge: what was expected, what the provider confirmed, and when.
create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organisations(id) on delete cascade,
  provider       text not null check (provider in ('paystack', 'stripe', 'manual')),
  reference      text not null unique,
  kind           text not null check (kind in ('subscription', 'renewal', 'once_off')),
  plan_id        text not null,
  amount_cents   integer not null check (amount_cents >= 0),
  currency       text not null default 'ZAR',
  status         text not null default 'pending' check (status in ('pending', 'success', 'failed', 'abandoned', 'refunded')),
  failure_reason text not null default '',
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);
create index if not exists payments_org on payments (org_id, created_at desc);
