# Supplier portal deployment and security

## Deployment

1. Run the **entire** file [`supabase/migrations/20260930_supplier_portal.sql`](../supabase/migrations/20260930_supplier_portal.sql) in your existing Supabase project's SQL Editor. Run this migration once. It uses a transaction and does not alter existing item columns, status values, or sourcing-table RLS policies.
2. In the **same** Supabase project as `NEXT_PUBLIC_SUPABASE_URL`, go to **Project Settings → API Keys → Legacy anon, service_role API keys** and copy the `service_role` key privately. Add it in **Vercel → Project → Settings → Environment Variables** as `SUPABASE_SERVICE_ROLE_KEY`, for **Production** (and Preview only if needed). Never use a `NEXT_PUBLIC_` prefix. Keep the existing public URL and publishable/anon key unchanged. Supabase also supports newer server secret keys in **API Keys**; this server-only client can use one under the same environment variable name ([API key documentation](https://supabase.com/docs/guides/getting-started/api-keys)).
3. Redeploy the application to `https://sourcing.nexo.ge`. The custom domain and existing authentication setup do not need changes.
4. Sign in as an active `sourcing_users` member, open a request, assign an item to a supplier, and create a link in **Supplier Share Links**. Open the copied link in a signed-out/private browser to verify the live deployment.

Run the SQL once, before using the feature. It is additive and transaction-wrapped: it creates the two new tables, their indexes/policies/functions, and sets the existing private bucket's upload limits. It neither deletes sourcing data nor alters existing item/status columns. It is intentionally **not** a repeatable migration; if the portal tables already exist, do not rerun it. It has been tested against a representative local schema, not applied to or verified against the live production database.

Production smoke test: **Create Share Link → Copy/Open Link in a private browser → save a supplier response → upload and view a supplier image → verify the response/image in the internal request → Revoke Link → reload the old URL and confirm the generic invalid state**. Also test an item reassignment and a replacement link. Adding/changing the Vercel environment variable requires a **redeploy**; an already-built deployment does not pick it up automatically.

The SQL creates two tables: share links and separate supplier image records. Supplier images need a separate record so uploads cannot replace the read-only Nexo reference image. Existing items are unchanged. The migration explicitly keeps `sourcing-files` private with a 10 MiB limit and image MIME types; it creates **no anonymous Storage policies**. Existing authenticated Storage policies must already support Nexo image reads/uploads.

## Create, copy, open, revoke

- Each row represents a supplier assigned to this request, with the current assigned-item count. Existing active links remain revocable even if no items are assigned.
- Choose an expiry of 7, 30, or 90 days and select **Create Share Link**. There is at most one active link per request/supplier pair. An expired link is retired automatically before replacement.
- **Copy Link**, **Open**, and a selectable URL appear immediately after creation. Copy/save the URL before refreshing or leaving: only its SHA-256 hash is stored, so an existing URL cannot be retrieved later. No raw token is saved to local storage or activity logs.
- **Revoke** asks for confirmation and permanently disables access. Request items and images are not deleted. Create a new link to get a new random token; the old link is never reactivated.
- Share links are bearer credentials. Anyone receiving a forwarded link can respond for that supplier until expiry/revocation.

## Authorization and data boundaries

The server-only Supabase client is isolated in `lib/supabase/admin.ts`, marked `server-only`, uses no user cookies, and disables caching/session persistence. This is necessary because the privileged key bypasses RLS and must never be used in browser code ([Supabase guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)). Existing Nexo actions continue using their original authenticated client and RLS.

Every public page/API call validates a 64-character hexadecimal token, hashes it, and resolves exactly one active, unrevoked, unexpired link. Tokens contain 32 cryptographically random bytes (256 bits). Items and supplier-image records are always filtered by **both request_id and supplier_id**, plus the item/image ID where appropriate. Client-supplied request and supplier IDs are never used as authorization.

Public item queries list only supplier-safe columns. They do not select client prices, internal/client comments, company information, or activity logs. The only request metadata returned is its reference number; the supplier lookup returns only its name. A valid link with no assigned items receives only the empty-state message. Item/image IDs are used only to address scoped mutations/downloads.

The supplier response allow-list accepts price, currency, MOQ, lead time, dimensions, weight, supplier comment and the existing `waiting`, `answered`, `not_found` statuses. Numeric values are finite/nonnegative, lead time is an integer, and comments are length-limited. Unknown fields are rejected. The database mutation function repeats token and item-scope checks **within the transaction**, taking locks so a concurrent revocation/reassignment cannot bypass checks made earlier in the HTTP request. Only `service_role` can execute this function; anonymous and authenticated browser clients cannot.

Requests dynamically query current assignments. Subsequent reads/downloads/saves are denied after reassignment or revocation. Already downloaded content cannot be recalled, but open portal pages refresh/check access every 30 seconds and on focus. Responses use `no-store`, `no-referrer`, `noindex` and frame protection. Keep token-bearing URLs out of analytics/error logging; standard hosting/browser history may still contain visited URLs.

## Images

Nexo's `image_url` remains read-only in the supplier portal. Existing HTTP/HTTPS reference URLs remain directly viewable; those external resources retain their original hosting/access rules.

Supplier uploads use a server-created random object path tied to the link's request, supplier, and item. A signed upload capability writes only that new object, with overwrite disabled. It cannot list or read files. The file transfers directly to Supabase, avoiding Vercel's request-body limit for 10 MB images ([signed-upload API](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)).

The server validates the uploaded file's size and signature before attaching it. Supported formats are JPEG, PNG, WebP and GIF; SVG/HTML is not served by the portal. Up to 20 ready/recently pending uploads per item/supplier are allowed. Supplier photos appear separately in the internal request item card.

Private downloads are proxied through an endpoint that validates token and current assignment on every request. Very short-lived Supabase signed download URLs stay on the server. The browser receives image bytes, never a reusable Storage download URL. This prevents a previously issued download URL from continuing to bypass revocation. Pending signed upload capabilities may remain valid at Storage for up to two hours, but after revocation they cannot be finalized, read through the portal, or attached to an item.

Abandoned/rejected uploads and deleted-item Storage objects are not automatically garbage-collected. Pending image rows older than two hours are excluded from the upload quota. Periodic maintenance may delete unreferenced objects after verifying they are not used by an item or a ready supplier-image row. Do not delete Nexo reference images based only on their path prefix.

Supplier response/image saves log `supplier_item_updated` and `supplier_image_uploaded`. Link creation/revocation log `supplier_link_created` and `supplier_link_revoked`. The existing activity schema stores a Nexo user ID, so supplier events use the link creator as the associated user and explicitly identify the supplier action in action/details; if that auth user has been deleted, the supplier event log is skipped. Activity logs are never available in the public portal.

## Verification

Run `npm run test:security`, `npx tsc --noEmit`, and `npm run build`.

Security tests run the actual migration in an isolated PostgreSQL-compatible PGlite instance with representative existing tables and enum values. Actual server read/mutation/image handlers run against that database, with Supabase transport/Storage simulated. Tests cover scoped reads and updates, forbidden fields, malformed values, expiry/revocation, reassignment/new assignment, SQL permission/RLS checks, privileged RPC denial, image upload/finalization, and protected image downloads. They never contact the production database.

After deployment, also verify with your real Supabase policies and Storage: signed-out supplier access, an image larger than Vercel's request-body limit but under 10 MB, revocation during an upload, and an item reassigned while its portal is open. Automated local tests do not prove the production project's existing RLS, triggers or Storage configuration.
