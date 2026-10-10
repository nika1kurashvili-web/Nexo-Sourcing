-- Product codes (SKU), purchase orders with price approval, and payments.
-- Safe to run more than once. Requires 20261007_product_catalog.sql.

-- ---------------------------------------------------------------- product codes
create sequence if not exists public.sourcing_product_sku_seq;
alter table public.sourcing_products add column if not exists sku text;
update public.sourcing_products
  set sku = 'P' || lpad(nextval('public.sourcing_product_sku_seq')::text, 5, '0') where sku is null;
alter table public.sourcing_products
  alter column sku set default ('P' || lpad(nextval('public.sourcing_product_sku_seq')::text, 5, '0')),
  alter column sku set not null;
do $$ begin
  alter table public.sourcing_products add constraint sourcing_products_sku_length
    check (char_length(sku) between 1 and 60 and sku = btrim(sku));
exception when duplicate_object then null; end $$;
create unique index if not exists sourcing_products_supplier_sku
  on public.sourcing_products (supplier_id, lower(sku));
grant usage, select on sequence public.sourcing_product_sku_seq to service_role;

-- ---------------------------------------------------------------- orders
create sequence if not exists public.sourcing_order_seq;
grant usage, select on sequence public.sourcing_order_seq to service_role;

create table if not exists public.sourcing_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique default ('ORD-' || lpad(nextval('public.sourcing_order_seq')::text, 4, '0')),
  supplier_id uuid not null references public.sourcing_suppliers(id) on delete restrict,
  currency text not null default 'USD' check (currency in ('USD','CNY','EUR','GEL')),
  -- draft: only Nexo sees it. sent: supplier sees it and may propose prices.
  -- confirmed: prices approved and locked. cancelled: kept for history.
  status text not null default 'draft' check (status in ('draft','sent','confirmed','cancelled')),
  note text check (note is null or char_length(note) <= 5000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  confirmed_at timestamptz
);
create index if not exists sourcing_orders_supplier_idx on public.sourcing_orders (supplier_id, created_at desc);

create table if not exists public.sourcing_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sourcing_orders(id) on delete cascade,
  product_id uuid references public.sourcing_products(id) on delete set null,
  sku text,
  product_name text not null check (char_length(product_name) between 1 and 200),
  quantity numeric(14,2) not null check (quantity > 0 and quantity <= 9999999),
  -- unit_price is the price Nexo approved. proposed_price is a supplier suggestion
  -- that only counts after Nexo approves it.
  unit_price numeric(14,4) check (unit_price is null or (unit_price >= 0 and unit_price <= 9999999)),
  proposed_price numeric(14,4) check (proposed_price is null or (proposed_price >= 0 and proposed_price <= 9999999)),
  -- Set by the supplier when the product is ready (packed). Display only; changes no price.
  prepared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sourcing_order_items_order_idx on public.sourcing_order_items (order_id);
create unique index if not exists sourcing_order_items_product_once
  on public.sourcing_order_items (order_id, product_id) where product_id is not null;

create table if not exists public.sourcing_order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sourcing_orders(id) on delete cascade,
  paid_on date not null,
  amount numeric(14,2) not null check (amount > 0 and amount <= 999999999),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sourcing_order_payments_order_idx on public.sourcing_order_payments (order_id, paid_on);

alter table public.sourcing_orders enable row level security;
alter table public.sourcing_order_items enable row level security;
alter table public.sourcing_order_payments enable row level security;
revoke all on public.sourcing_orders, public.sourcing_order_items, public.sourcing_order_payments from public, anon, authenticated;
grant all on public.sourcing_orders, public.sourcing_order_items, public.sourcing_order_payments to service_role;

-- ---------------------------------------------------------------- supplier price proposals
-- The only thing a supplier can change on an order. Re-checks the catalog link in the same
-- transaction and only touches lines of that supplier's orders that are currently "sent".
create or replace function public.sourcing_order_supplier(p_hash text, p_operation text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  share public.sourcing_catalog_links%rowtype;
  line public.sourcing_order_items%rowtype;
  ord public.sourcing_orders%rowtype;
  new_price numeric;
begin
  select * into share from public.sourcing_catalog_links
    where token_hash = p_hash and active and revoked_at is null for share;
  if not found then raise exception 'Invalid supplier access'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid request'; end if;

  if p_operation in ('set_price', 'set_ready') then
    select * into line from public.sourcing_order_items where id = (p_payload->>'item_id')::uuid for update;
    if not found then raise exception 'Invalid supplier access'; end if;
    select * into ord from public.sourcing_orders where id = line.order_id for update;
    if ord.supplier_id <> share.supplier_id then raise exception 'Invalid supplier access'; end if;
  end if;

  if p_operation = 'set_ready' then
    -- Preparing goods happens after Nexo confirms, so both "sent" and "confirmed" are open.
    if ord.status not in ('sent', 'confirmed') then raise exception 'Order is locked'; end if;
    update public.sourcing_order_items
      set prepared_at = case when coalesce((p_payload->>'ready')::boolean, false) then coalesce(prepared_at, now()) else null end
      where id = line.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_operation = 'set_price' then
    if ord.status <> 'sent' then raise exception 'Order is locked'; end if;
    if jsonb_typeof(p_payload->'price') = 'null' or not (p_payload ? 'price') then
      new_price := null;
    else
      new_price := (p_payload->>'price')::numeric;
      if new_price < 0 or new_price > 9999999 then raise exception 'Invalid price'; end if;
    end if;
    -- A proposal equal to the approved price is not a proposal.
    if new_price is not null and line.unit_price is not null and new_price = line.unit_price then new_price := null; end if;
    update public.sourcing_order_items set proposed_price = new_price, updated_at = now() where id = line.id;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Invalid operation';
end $$;
revoke all on function public.sourcing_order_supplier(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sourcing_order_supplier(text, text, jsonb) to service_role;
