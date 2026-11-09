-- Completion date of an order (set by Nexo only; suppliers can see it but never change it). Safe to run more than once.
alter table public.sourcing_orders add column if not exists completion_date date;
