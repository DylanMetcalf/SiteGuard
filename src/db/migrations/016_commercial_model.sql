-- Who pays: contractors subscribe for their own safety files; a mine or site sponsors a
-- contractor only for the files on its own sites. Promo codes give free or discounted access
-- without changing public prices. Prices shown on the pricing page live in plan_settings.

-- An active grant (from a promo code, or an enterprise deal set by the platform admin) gives the
-- organisation a plan without a Stripe subscription. grant_until null = no end date.
alter table organisations
  add column grant_plan   text,
  add column grant_until  timestamptz,
  add column grant_source text;

-- A site sponsoring one contractor's file on that site.
create table sponsorships (
  id                uuid primary key default gen_random_uuid(),
  sponsor_org_id    uuid not null references organisations (id) on delete cascade,
  contractor_org_id uuid not null references organisations (id) on delete cascade,
  site_id           uuid not null unique references sites (id) on delete cascade,
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz,
  ended_at          timestamptz,
  ended_reason      text,
  created_at        timestamptz not null default now()
);
create index sponsorships_contractor_idx on sponsorships (contractor_org_id);

-- Every file a contractor already works on at a mine's site is sponsored by that mine.
insert into sponsorships (sponsor_org_id, contractor_org_id, site_id)
select s.org_id, c.linked_org_id, s.id
  from sites s
  join contractors c on c.id = s.contractor_id
  join organisations o on o.id = s.org_id
 where c.linked_org_id is not null and o.managed_by_org is null and s.status not in ('declined', 'invited')
on conflict do nothing;

create table promo_codes (
  id              uuid primary key default gen_random_uuid(),
  code            citext not null unique,
  description     text not null default '',
  plan            text not null,
  -- 100 = free. Anything less needs a matching Stripe coupon and applies at checkout.
  percent_off     integer not null default 100 check (percent_off between 1 and 100),
  -- How long the free access lasts after redeeming; null = no end date.
  duration_days   integer check (duration_days is null or duration_days > 0),
  org_kind        text check (org_kind in ('host', 'contractor')),
  -- Only this organisation may redeem it (e.g. an enterprise deal).
  org_id          uuid references organisations (id) on delete cascade,
  expires_at      timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemptions     integer not null default 0,
  stripe_coupon   text,
  active          boolean not null default true,
  created_by_name text not null default '',
  created_at      timestamptz not null default now()
);

create table promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references promo_codes (id) on delete cascade,
  org_id      uuid not null references organisations (id) on delete cascade,
  redeemed_by uuid references users (id) on delete set null,
  grant_until timestamptz,
  redeemed_at timestamptz not null default now(),
  unique (promo_id, org_id)
);

-- What the pricing page shows for each plan. Stripe prices stay in environment variables.
create table plan_settings (
  plan_id     text primary key,
  price_cents integer check (price_cents is null or price_cents >= 0),
  currency    text not null default 'ZAR',
  per         text not null default 'month',
  blurb       text,
  highlights  text[] not null default '{}',
  visible     boolean not null default true,
  updated_by_name text not null default '',
  updated_at  timestamptz not null default now()
);

-- Enquiries from the public contact page.
create table enquiries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       citext not null,
  phone       text not null default '',
  company     text not null default '',
  topic       text not null default 'general',
  message     text not null,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);
