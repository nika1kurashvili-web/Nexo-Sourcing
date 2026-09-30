-- NEXO SOURCING v3
-- Adds package dimensions / weight and Storage access policies.
-- Safe for existing sourcing data.

alter table public.sourcing_request_items
  add column if not exists box_length_cm numeric(10,2),
  add column if not exists box_width_cm numeric(10,2),
  add column if not exists box_height_cm numeric(10,2),
  add column if not exists weight_kg numeric(10,3);

-- Storage bucket:
-- Create a PRIVATE bucket named "sourcing-files" from Supabase Dashboard → Storage.
-- Recommended bucket settings:
--   Public: OFF
--   Max file size: 10 MB
--   Allowed MIME types: image/*

drop policy if exists "sourcing_files_select" on storage.objects;
create policy "sourcing_files_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'sourcing-files'
  and public.sourcing_has_access(auth.uid())
);

drop policy if exists "sourcing_files_insert" on storage.objects;
create policy "sourcing_files_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'sourcing-files'
  and public.sourcing_has_access(auth.uid())
);

drop policy if exists "sourcing_files_update" on storage.objects;
create policy "sourcing_files_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'sourcing-files'
  and public.sourcing_has_access(auth.uid())
)
with check (
  bucket_id = 'sourcing-files'
  and public.sourcing_has_access(auth.uid())
);

drop policy if exists "sourcing_files_delete" on storage.objects;
create policy "sourcing_files_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'sourcing-files'
  and public.sourcing_has_access(auth.uid())
);
