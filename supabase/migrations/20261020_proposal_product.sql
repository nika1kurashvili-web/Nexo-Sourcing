-- A company suggestion that Nexo approved points at the product it created.
alter table public.sourcing_company_proposals add column if not exists product_id uuid references public.sourcing_products(id) on delete set null;
