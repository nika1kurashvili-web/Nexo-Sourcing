-- Apply in the Supabase SQL Editor. No item-table migration is required.
-- Preserve existing policies; restrict this bucket even if another permissive
-- Storage policy exists. Existing sourcing_users RLS remains in force.
begin;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/*']
where id = 'sourcing-files';

drop policy if exists sourcing_files_active_member_guard on storage.objects;
create policy sourcing_files_active_member_guard
on storage.objects as restrictive for all to public
using (
  bucket_id <> 'sourcing-files' or exists (
    select 1 from public.sourcing_users
    where user_id = (select auth.uid()) and active = true
  )
)
with check (
  bucket_id <> 'sourcing-files' or exists (
    select 1 from public.sourcing_users
    where user_id = (select auth.uid()) and active = true
  )
);

drop policy if exists sourcing_files_image_read on storage.objects;
create policy sourcing_files_image_read
on storage.objects for select to authenticated
using (
  bucket_id = 'sourcing-files' and exists (
    select 1 from public.sourcing_users
    where user_id = (select auth.uid()) and active = true
  )
);

drop policy if exists sourcing_files_image_insert on storage.objects;
create policy sourcing_files_image_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sourcing-files'
  and (storage.foldername(name))[1] = 'requests'
  and exists (
    select 1 from public.sourcing_users
    where user_id = (select auth.uid()) and active = true
  )
  and exists (
    select 1 from public.sourcing_requests
    where id::text = (storage.foldername(name))[2]
  )
);

commit;
