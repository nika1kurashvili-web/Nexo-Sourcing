-- Company (client) portal: each company gets a private link, sees only the products marked for it
-- (with Nexo's sell price, never the supplier or the supplier's price), can send orders to Nexo
-- and suggest new products for Nexo to review. Safe to run more than once.
-- Requires the existing public.sourcing_companies and public.sourcing_products tables.

create sequence if not exists public.sourcing_company_order_seq start 1;

-- One permanent, revocable link per company.
create table if not exists public.sourcing_company_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.sourcing_companies(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_encrypted text check (token_encrypted is null or token_encrypted ~ '^v1:[A-Za-z0-9_-]+$'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  check (active or revoked_at is not null),
  check (not active or revoked_at is null)
);
create unique index if not exists sourcing_company_one_active_link
  on public.sourcing_company_links(company_id) where active;

-- Which products a company can see, and the price Nexo sells them to that company for.
create table if not exists public.sourcing_company_products (
  product_id uuid not null references public.sourcing_products(id) on delete cascade,
  company_id uuid not null references public.sourcing_companies(id) on delete cascade,
  sell_price numeric(14,4) check (sell_price is null or (sell_price >= 0 and sell_price <= 9999999)),
  currency text not null default 'GEL' check (currency in ('USD','CNY','EUR','GEL')),
  created_at timestamptz not null default now(),
  primary key (product_id, company_id)
);
create index if not exists sourcing_company_products_company on public.sourcing_company_products(company_id);

-- Orders sent by companies to Nexo.
create table if not exists public.sourcing_company_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.sourcing_companies(id) on delete cascade,
  order_no text not null unique default ('CO-' || lpad(nextval('public.sourcing_company_order_seq')::text, 4, '0')),
  status text not null default 'new' check (status in ('new','accepted','cancelled')),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists sourcing_company_orders_company on public.sourcing_company_orders(company_id, created_at desc);

create table if not exists public.sourcing_company_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sourcing_company_orders(id) on delete cascade,
  product_id uuid references public.sourcing_products(id) on delete set null,
  sku text,
  product_name text not null,
  quantity numeric(14,2) not null check (quantity > 0 and quantity <= 9999999),
  unit_price numeric(14,4) check (unit_price is null or (unit_price >= 0 and unit_price <= 9999999)),
  currency text not null default 'GEL' check (currency in ('USD','CNY','EUR','GEL')),
  created_at timestamptz not null default now()
);
create index if not exists sourcing_company_order_items_order on public.sourcing_company_order_items(order_id);

-- New product suggestions from companies (Nexo reviews them; nothing goes into the catalog automatically).
create table if not exists public.sourcing_company_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.sourcing_companies(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (description is null or char_length(description) <= 3000),
  link text check (link is null or char_length(link) <= 1000),
  quantity numeric(14,2) check (quantity is null or (quantity > 0 and quantity <= 9999999)),
  status text not null default 'new' check (status in ('new','handled')),
  created_at timestamptz not null default now()
);
create index if not exists sourcing_company_proposals_company on public.sourcing_company_proposals(company_id, created_at desc);

create table if not exists public.sourcing_company_proposal_images (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.sourcing_company_proposals(id) on delete cascade,
  object_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/gif')),
  created_at timestamptz not null default now()
);
create index if not exists sourcing_company_proposal_images_proposal on public.sourcing_company_proposal_images(proposal_id);

-- Closed to browser clients: only the server (service role) reads and writes these tables.
alter table public.sourcing_company_links enable row level security;
alter table public.sourcing_company_products enable row level security;
alter table public.sourcing_company_orders enable row level security;
alter table public.sourcing_company_order_items enable row level security;
alter table public.sourcing_company_proposals enable row level security;
alter table public.sourcing_company_proposal_images enable row level security;
revoke all on public.sourcing_company_links, public.sourcing_company_products, public.sourcing_company_orders,
  public.sourcing_company_order_items, public.sourcing_company_proposals, public.sourcing_company_proposal_images from anon, authenticated;
grant all on public.sourcing_company_links, public.sourcing_company_products, public.sourcing_company_orders,
  public.sourcing_company_order_items, public.sourcing_company_proposals, public.sourcing_company_proposal_images to service_role;
grant usage, select on sequence public.sourcing_company_order_seq to service_role;
