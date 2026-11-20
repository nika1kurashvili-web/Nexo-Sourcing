-- Nexo marks company order lines as prepared; the company sees the mark in its portal.
alter table public.sourcing_company_order_items add column if not exists prepared_at timestamptz;
