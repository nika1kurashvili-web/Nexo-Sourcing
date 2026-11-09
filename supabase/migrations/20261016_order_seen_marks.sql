-- "Seen" marks: when the supplier last opened an order, and when Nexo last changed something the supplier can see.
-- Safe to run more than once.
alter table public.sourcing_orders add column if not exists supplier_seen_at timestamptz;
alter table public.sourcing_orders add column if not exists staff_changed_at timestamptz;
