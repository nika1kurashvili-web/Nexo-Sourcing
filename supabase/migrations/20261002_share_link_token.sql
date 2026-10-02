-- Run once in the Supabase SQL Editor (after 20260930_supplier_portal.sql).
-- Additive: lets staff see an existing supplier share link again later.
-- Only an encrypted copy of the token is stored (encrypted by the server).
-- token_hash and all existing links, policies and grants are unchanged.
begin;

alter table public.sourcing_supplier_share_links
  add column if not exists token_encrypted text;

alter table public.sourcing_supplier_share_links
  drop constraint if exists sourcing_supplier_links_token_encrypted_format;
alter table public.sourcing_supplier_share_links
  add constraint sourcing_supplier_links_token_encrypted_format
  check (token_encrypted is null or token_encrypted ~ '^v1:[A-Za-z0-9_-]+$');

-- Intentionally NO select grant on token_encrypted for anon/authenticated: the
-- existing select grant is column-level, so browser/staff clients cannot read it.
-- Only the server (service_role) reads it, after checking staff access.

commit;

-- Verification (read-only):
-- select column_name from information_schema.columns
--   where table_name = 'sourcing_supplier_share_links' and column_name = 'token_encrypted';
