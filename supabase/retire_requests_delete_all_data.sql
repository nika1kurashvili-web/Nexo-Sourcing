-- DELETES ALL DATA OF THE OLD "REQUESTS" FEATURE. THIS CANNOT BE UNDONE.
-- Keeps: companies, suppliers, products, orders, payments, users.
-- Run in the Supabase SQL Editor. Step 1 only counts; step 2 deletes.

-- STEP 1 (preview): how many rows will be deleted
select
  (select count(*) from public.sourcing_requests)               as requests,
  (select count(*) from public.sourcing_request_items)          as request_items,
  (select count(*) from public.sourcing_supplier_share_links)   as supplier_share_links,
  (select count(*) from public.sourcing_supplier_images)        as supplier_images,
  (select count(*) from public.sourcing_activity_log)           as activity_log;

-- STEP 2 (delete): select everything from "begin;" to "commit;" and run it.
begin;
delete from public.sourcing_supplier_images;
delete from public.sourcing_supplier_share_links;
delete from public.sourcing_activity_log;
-- Request items, their reference photos and anything else attached to a request go with the request
-- (these tables reference sourcing_requests with "on delete cascade").
delete from public.sourcing_requests;
-- If the next line shows a number other than 0, something still references requests: run "rollback;" instead of "commit;".
select count(*) as requests_left from public.sourcing_requests;
commit;
