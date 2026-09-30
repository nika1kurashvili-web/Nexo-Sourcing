-- Reuses existing created_at. No existing request data or RLS is changed.
begin;

alter table public.sourcing_requests
  add column if not exists deadline_at timestamptz null;

create index if not exists sourcing_requests_deadline_at_idx
  on public.sourcing_requests (deadline_at)
  where deadline_at is not null;

commit;
