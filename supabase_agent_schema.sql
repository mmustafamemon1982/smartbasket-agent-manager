-- SmartBasket BH Agent Manager database schema
-- Paste into Supabase SQL Editor and Run.

create extension if not exists pgcrypto;

create table if not exists public.store_rules (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  area text not null,
  is_available boolean not null default true,
  delivery_fee numeric(10,3) not null default 0,
  free_delivery_above numeric(10,3) not null default 0,
  minimum_order numeric(10,3) not null default 0,
  updated_at timestamptz not null default now(),
  unique(store, area)
);

create table if not exists public.price_sources (
  id uuid primary key default gen_random_uuid(),
  source_name text not null unique,
  source_type text not null default 'manual_feed',
  is_enabled boolean not null default true,
  trust_weight numeric(5,2) not null default 1.00,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.price_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  store text not null,
  item text not null,
  brand text not null default 'Generic',
  product text not null,
  size text not null,
  price numeric(10,3) not null,
  source text not null,
  source_url text,
  observed_at timestamptz not null default now(),
  raw_payload jsonb
);

create table if not exists public.prices (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  item text not null,
  brand text not null default 'Generic',
  product text not null,
  size text not null,
  price numeric(10,3) not null,
  match integer not null default 90,
  confidence text not null default 'Medium',
  source text not null default 'agent',
  source_url text,
  last_checked timestamptz not null default now(),
  is_active boolean not null default true,
  needs_review boolean not null default false,
  review_reason text,
  updated_at timestamptz not null default now(),
  unique(store, item, brand, product, size)
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  rows_seen integer not null default 0,
  rows_accepted integer not null default 0,
  rows_review integer not null default 0,
  error text
);

create table if not exists public.review_queue (
  id uuid primary key default gen_random_uuid(),
  price_id uuid references public.prices(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.prices enable row level security;
alter table public.store_rules enable row level security;
alter table public.price_sources enable row level security;
alter table public.price_observations enable row level security;
alter table public.agent_runs enable row level security;
alter table public.review_queue enable row level security;

drop policy if exists "Public can read active prices" on public.prices;
create policy "Public can read active prices"
on public.prices for select
using (is_active = true);

drop policy if exists "Public can read store rules" on public.store_rules;
create policy "Public can read store rules"
on public.store_rules for select
using (true);

insert into public.price_sources (source_name, source_type, is_enabled, trust_weight, notes)
values
('admin_seed', 'manual_feed', true, 1.00, 'Starter agent-managed seed rows'),
('lulu_connector', 'connector_placeholder', false, 1.00, 'Enable after approved source/API is ready'),
('carrefour_connector', 'connector_placeholder', false, 1.00, 'Enable after approved source/API is ready'),
('aljazira_connector', 'connector_placeholder', false, 1.00, 'Enable after approved source/API is ready')
on conflict (source_name) do nothing;

insert into public.store_rules
(store, area, is_available, delivery_fee, free_delivery_above, minimum_order)
values
('LuLu','Saar',true,1.000,15.000,5.000),
('Carrefour','Saar',true,1.200,18.000,5.000),
('Al Jazira','Saar',true,0.800,12.000,4.000),
('Talabat Mart','Saar',true,1.100,10.000,3.000),
('LuLu','Muharraq',true,1.000,15.000,5.000),
('Carrefour','Muharraq',true,1.200,18.000,5.000),
('Al Jazira','Muharraq',false,0.800,12.000,4.000),
('Talabat Mart','Muharraq',true,1.100,10.000,3.000)
on conflict (store, area) do update set
is_available=excluded.is_available,
delivery_fee=excluded.delivery_fee,
free_delivery_above=excluded.free_delivery_above,
minimum_order=excluded.minimum_order,
updated_at=now();
