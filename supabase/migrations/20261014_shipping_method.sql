-- Shipping method per product (land / air) and a second set of cost numbers for air. Safe to run more than once.
-- Requires 20261013_cost_settings.sql.
alter table public.sourcing_products add column if not exists shipping_method text not null default 'land';
do $$ begin
  alter table public.sourcing_products add constraint sourcing_products_shipping_method_check
    check (shipping_method in ('land', 'air'));
exception when duplicate_object then null; end $$;

-- Air numbers start as a copy of the land numbers; change them on the Products page.
insert into public.sourcing_settings (key, value)
  select 'air_' || key, value from public.sourcing_settings
  where key in ('markup', 'cny_per_gel', 'usd_gel', 'usd_per_m3', 'usd_per_kg', 'customs')
on conflict (key) do nothing;
