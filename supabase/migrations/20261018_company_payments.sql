-- Payments of company orders: when, how and how much the company paid. Both Nexo and the company can record
-- a payment; a payment recorded by the company stays "pending" until Nexo confirms it and only confirmed
-- payments count towards the balance. Safe to run more than once. Requires 20261017_company_portal.sql.
create table if not exists public.sourcing_company_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sourcing_company_orders(id) on delete cascade,
  paid_on date not null,
  amount numeric(14,2) not null check (amount > 0 and amount <= 999999999),
  currency text not null default 'GEL' check (currency in ('USD','CNY','EUR','GEL')),
  method text not null default 'transfer' check (method in ('cash','transfer','card','other')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'confirmed' check (status in ('pending','confirmed')),
  entered_by text not null default 'staff' check (entered_by in ('staff','company')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists sourcing_company_payments_order on public.sourcing_company_payments(order_id, paid_on);

alter table public.sourcing_company_payments enable row level security;
revoke all on public.sourcing_company_payments from anon, authenticated;
grant all on public.sourcing_company_payments to service_role;
