# Nexo Sourcing v2

## Supplier Portal

Deployment, required SQL/environment setup, link controls, security boundaries, and verification are documented in [docs/supplier-portal.md](docs/supplier-portal.md).

## Request dates and deadlines

Run `supabase/migrations/20260930_request_deadlines.sql` in Supabase SQL Editor to add the optional request-level `deadline_at` column and its index. This additive migration can safely be rerun and reuses the existing `created_at` column without changing existing request data or RLS. No new environment variables are needed.

Created dates appear on the requests list, request detail, and dashboard recent requests. Deadlines can be set on creation, changed in the request detail card, or cleared by leaving the field blank and selecting **Save Deadline**. All date entry/display uses **Asia/Tbilisi** time; deadlines are stored as timezone-aware instants. Active requests show **Due today** until the selected time passes, then **Overdue**. Approved, rejected, and cancelled requests have neutral deadline displays. Dashboard **Upcoming Deadlines** shows up to five future active requests, nearest first. Badges reflect the time when the page is loaded/refreshed; no notifications are sent.

The supplier portal shows the request's created date and deadline (read-only) to the assigned supplier. Deadline changes appear in the internal activity log. Before the SQL is applied, existing requests remain viewable and requests without deadlines can still be created; deadline controls display a setup notice.

Verification: `npm run test:requests`, `npm run test:security`, `npx tsc --noEmit`, and `npm run build`.

ეს არის მარტივი Sourcing CRM, რომელიც მუშაობს იმავე Supabase პროექტზე, სადაც Orders Nexo გაქვთ,
მაგრამ იყენებს მხოლოდ `sourcing_*` ცხრილებს.

## Supabase-ში უკვე უნდა არსებობდეს
- sourcing_users
- sourcing_companies
- sourcing_suppliers
- sourcing_requests
- sourcing_request_items
- sourcing_activity_log

თქვენი login მომხმარებელი უნდა იყოს `sourcing_users` ცხრილში `active = true`.

## ლოკალურად გაშვება
1. ამოარქივეთ ZIP.
2. გაუშვით `npm install`
3. `.env.example` დააკოპირეთ `.env.local` სახელით.
4. ჩაწერეთ არსებული Supabase პროექტის:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. გაუშვით `npm run dev`

## Vercel
Vercel Project Settings → Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

შემდეგ Deploy.

## ფუნქციები
- Email/password Login
- sourcing_users-ით წვდომის კონტროლი
- Dashboard
- Companies
- Suppliers
- Requests
- ერთ Request-ში ბევრი ნივთი
- Supplier status
- China Price / Client Price
- MOQ
- წარმოების ვადა
- Supplier/Internal/Client comments
- Activity Log
- მობილურზე ადაპტირებული მარტივი UI

## პირველი ვერსია განზრახ მარტივია
- ერთ ნივთზე ერთი აქტიური Supplier
- პირადი ფოტოები Supabase Storage-ში; ძველი URL-ების მხარდაჭერა
- Supplier portal არის (იხ. docs/supplier-portal.md)
- Client quote portal ჯერ არ არის
- WhatsApp / WeChat ავტომატიზაცია ჯერ არ არის


## Request item images and packaging

Both item forms support optional decimal packaging dimensions and weight, pricing, lead time, and all comments. Images upload directly with the signed-in user's public Supabase client to the private sourcing-files bucket. The object path is saved in image_url when the item is saved; existing HTTP/HTTPS URLs still display directly. Private previews use one-hour signed URLs. Refresh the page to renew an expired preview.

Apply supabase/migrations/20260930_sourcing_image_limits.sql in the Supabase SQL Editor to enforce the private bucket, 10 MiB (10 × 1024 × 1024 bytes) limit, image MIME types, and active sourcing_users access. The bucket and packaging columns already exist, so no table changes are needed. This migration does not require the sourcing_has_access helper used by the older v3 migration. It preserves existing policies and adds a restrictive membership guard for this bucket.

Uploads are recorded as item_image_uploaded after the image path is successfully saved to an item. Removing or replacing a reference image deletes its Storage object when the item is saved; abandoning an unsaved form can leave an unused upload, which may be cleaned up separately.

Verification with configured Supabase credentials: create an item with decimals, comments, and an image; refresh; edit and refresh again; check item_created, item_updated, and item_image_uploaded in the log. Check a legacy external URL, empty packaging values, upload rejection above 10 MiB/non-image files, and denied Storage access for inactive/non-members.
