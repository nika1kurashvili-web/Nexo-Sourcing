-- Run once in the Supabase SQL Editor before deploying the supplier portal.
-- Existing sourcing tables, status values, RLS, and Storage policies are unchanged.
begin;

create table public.sourcing_supplier_share_links (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sourcing_requests(id) on delete cascade,
  supplier_id uuid not null references public.sourcing_suppliers(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  check (active or revoked_at is not null),
  check (not active or revoked_at is null)
);
create unique index sourcing_supplier_one_active_link
  on public.sourcing_supplier_share_links(request_id, supplier_id) where active;
create index sourcing_supplier_links_supplier on public.sourcing_supplier_share_links(supplier_id);

alter table public.sourcing_supplier_share_links enable row level security;
revoke all on public.sourcing_supplier_share_links from anon, authenticated;
grant select (id, request_id, supplier_id, active, expires_at, created_by, created_at, revoked_at, last_accessed_at)
  on public.sourcing_supplier_share_links to authenticated;
grant insert on public.sourcing_supplier_share_links to authenticated;
grant update (active, revoked_at) on public.sourcing_supplier_share_links to authenticated;
grant all on public.sourcing_supplier_share_links to service_role;

create policy supplier_links_staff_read on public.sourcing_supplier_share_links for select to authenticated
using (exists (select 1 from public.sourcing_users where user_id = (select auth.uid()) and active));
create policy supplier_links_staff_create on public.sourcing_supplier_share_links for insert to authenticated
with check (
  created_by = (select auth.uid()) and active and revoked_at is null
  and exists (select 1 from public.sourcing_users where user_id = (select auth.uid()) and active)
  and exists (select 1 from public.sourcing_request_items i
    where i.request_id = sourcing_supplier_share_links.request_id
    and i.supplier_id = sourcing_supplier_share_links.supplier_id)
);
create policy supplier_links_staff_revoke on public.sourcing_supplier_share_links for update to authenticated
using (exists (select 1 from public.sourcing_users where user_id = (select auth.uid()) and active))
with check (not active and revoked_at is not null
  and exists (select 1 from public.sourcing_users where user_id = (select auth.uid()) and active));

-- Revocation is irreversible, even if a caller tries to reactivate a known hash.
create function public.sourcing_supplier_link_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (not old.active and new.active)
    or new.token_hash is distinct from old.token_hash
    or new.request_id is distinct from old.request_id
    or new.supplier_id is distinct from old.supplier_id
    or new.expires_at is distinct from old.expires_at
  then raise exception 'Share link identity and expiry are immutable'; end if;
  return new;
end;
$$;
create trigger sourcing_supplier_link_immutable before update on public.sourcing_supplier_share_links
for each row execute function public.sourcing_supplier_link_immutable();
revoke all on function public.sourcing_supplier_link_immutable() from public, anon, authenticated;

-- Supplier photos are separate from the read-only Nexo reference image.
create table public.sourcing_supplier_images (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sourcing_requests(id) on delete cascade,
  supplier_id uuid not null references public.sourcing_suppliers(id) on delete cascade,
  request_item_id uuid not null references public.sourcing_request_items(id) on delete cascade,
  share_link_id uuid references public.sourcing_supplier_share_links(id) on delete set null,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  ready boolean not null default false,
  created_at timestamptz not null default now()
);
create index sourcing_supplier_images_scope on public.sourcing_supplier_images(request_id, supplier_id, request_item_id);
create index sourcing_supplier_images_link on public.sourcing_supplier_images(share_link_id);
create index sourcing_supplier_images_item on public.sourcing_supplier_images(request_item_id);
alter table public.sourcing_supplier_images enable row level security;
revoke all on public.sourcing_supplier_images from anon, authenticated;
grant select on public.sourcing_supplier_images to authenticated;
grant all on public.sourcing_supplier_images to service_role;
create policy supplier_images_staff_read on public.sourcing_supplier_images for select to authenticated
using (exists (select 1 from public.sourcing_users where user_id = (select auth.uid()) and active));

-- Only the server service role may call this function. It rechecks the token
-- in the same transaction as mutations, locking against revocation/reassignment.
create function public.sourcing_supplier_mutate(p_hash text, p_item uuid, p_operation text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  share public.sourcing_supplier_share_links%rowtype;
  response public.sourcing_request_items%rowtype;
  image_id uuid;
  image_path text;
begin
  select * into share from public.sourcing_supplier_share_links
    where token_hash = p_hash and active and revoked_at is null
    and (expires_at is null or expires_at > clock_timestamp()) for share;
  if not found then raise exception 'Invalid supplier access'; end if;
  perform id from public.sourcing_request_items where id = p_item
    and request_id = share.request_id and supplier_id = share.supplier_id for update;
  if not found then raise exception 'Invalid supplier access'; end if;

  if p_operation = 'response' then
    if jsonb_typeof(p_payload) <> 'object' or exists (
      select 1 from jsonb_object_keys(p_payload) k where k not in
      ('china_price','currency','moq','lead_time_days','box_length_cm','box_width_cm','box_height_cm','weight_kg','supplier_comment','supplier_status')
    ) then raise exception 'Invalid response fields'; end if;
    if coalesce(p_payload->>'supplier_status','') not in ('waiting','answered','not_found')
      or coalesce(p_payload->>'currency','') not in ('USD','CNY','EUR','GEL')
      then raise exception 'Invalid response'; end if;
    -- Populate only the explicit response fields; never read private item columns.
    response := jsonb_populate_record(null::public.sourcing_request_items, p_payload);
    update public.sourcing_request_items set
      china_price = response.china_price, currency = response.currency, moq = response.moq,
      lead_time_days = response.lead_time_days, box_length_cm = response.box_length_cm,
      box_width_cm = response.box_width_cm, box_height_cm = response.box_height_cm,
      weight_kg = response.weight_kg, supplier_comment = response.supplier_comment,
      supplier_status = response.supplier_status
    where id = p_item and request_id = share.request_id and supplier_id = share.supplier_id;
  elsif p_operation = 'prepare_image' then
    if (select count(*) from public.sourcing_supplier_images
      where request_item_id = p_item and supplier_id = share.supplier_id and request_id = share.request_id
      and (ready or created_at > now() - interval '2 hours')) >= 20 then
      raise exception 'Image limit reached';
    end if;
    image_id := (p_payload->>'id')::uuid;
    image_path := 'requests/' || share.request_id || '/supplier/' || share.supplier_id || '/' || p_item || '/' || image_id;
    insert into public.sourcing_supplier_images
      (id, request_id, supplier_id, request_item_id, share_link_id, object_path, mime_type, byte_size)
    values (image_id, share.request_id, share.supplier_id, p_item, share.id, image_path, p_payload->>'mime_type', (p_payload->>'byte_size')::integer);
    return jsonb_build_object('id', image_id, 'path', image_path);
  elsif p_operation = 'finish_image' then
    update public.sourcing_supplier_images set ready = true
    where id = (p_payload->>'id')::uuid and request_item_id = p_item
      and request_id = share.request_id and supplier_id = share.supplier_id and share_link_id = share.id
      and not ready and created_at > now() - interval '2 hours';
    if not found then raise exception 'Invalid image'; end if;
  else raise exception 'Invalid operation'; end if;

  update public.sourcing_requests set updated_at = now() where id = share.request_id;
  -- The existing log schema uses a Nexo auth user; identify the actual supplier
  -- actor explicitly in action/details. Skip when the link creator was deleted.
  if share.created_by is not null then
    insert into public.sourcing_activity_log(request_id, request_item_id, user_id, action, details)
    values (share.request_id, p_item, share.created_by,
      case when p_operation = 'response' then 'supplier_item_updated' else 'supplier_image_uploaded' end,
      'Supplier response via share link ' || share.id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.sourcing_supplier_mutate(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sourcing_supplier_mutate(text, uuid, text, jsonb) to service_role;

-- Signed uploads need no anonymous Storage policies. Keep the bucket private.
update storage.buckets set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/*'] where id = 'sourcing-files';
commit;
