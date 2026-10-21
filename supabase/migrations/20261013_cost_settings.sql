-- Numbers used by the Nexo-only landed-cost line on the Products page. Safe to run more than once.
create table if not exists public.sourcing_settings (
  key text primary key,
  value numeric not null check (value > 0 and value < 1000000),
  updated_at timestamptz not null default now()
);
alter table public.sourcing_settings enable row level security;
revoke all on public.sourcing_settings from public, anon, authenticated;
grant all on public.sourcing_settings to service_role;
insert into public.sourcing_settings (key, value) values
  ('markup', 1.03), ('cny_per_gel', 2.49), ('usd_gel', 2.65), ('usd_per_m3', 270), ('usd_per_kg', 1.1), ('customs', 0.18)
on conflict (key) do nothing;
