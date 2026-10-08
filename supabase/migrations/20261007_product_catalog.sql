-- Run once in the Supabase SQL Editor (after 20260930_supplier_portal.sql and
-- 20261002_share_link_token.sql). Additive: creates the product catalog tables only.
-- Existing sourcing tables, policies and Storage settings are unchanged.
--
-- Security model: every catalog table is closed to anon/authenticated. Nexo staff
-- and suppliers both go through the server (service role), after the server checked
-- staff access or the supplier's catalog link token. Suppliers can only CREATE
-- products (marked pending) and REQUEST edits/deletions; nothing they request changes
-- or removes live data until staff approve it.
begin;

-- One permanent, revocable catalog link per supplier (separate from request links).
create table public.sourcing_catalog_links (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.sourcing_suppliers(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_encrypted text check (token_encrypted is null or token_encrypted ~ '^v1:[A-Za-z0-9_-]+$'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  check (active or revoked_at is not null),
  check (not active or revoked_at is null)
);
create unique index sourcing_catalog_one_active_link
  on public.sourcing_catalog_links(supplier_id) where active;

create table public.sourcing_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.sourcing_suppliers(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  specifications text check (specifications is null or char_length(specifications) <= 5000),
  price numeric(14,4) check (price is null or (price >= 0 and price <= 9999999)),
  currency text not null default 'USD' check (currency in ('USD','CNY','EUR','GEL')),
  moq numeric(14,2) check (moq is null or (moq >= 0 and moq <= 9999999)),
  lead_time_days integer check (lead_time_days is null or (lead_time_days >= 0 and lead_time_days <= 9999999)),
  box_length_cm numeric(14,2) check (box_length_cm is null or (box_length_cm >= 0 and box_length_cm <= 9999999)),
  box_width_cm numeric(14,2) check (box_width_cm is null or (box_width_cm >= 0 and box_width_cm <= 9999999)),
  box_height_cm numeric(14,2) check (box_height_cm is null or (box_height_cm >= 0 and box_height_cm <= 9999999)),
  weight_kg numeric(14,3) check (weight_kg is null or (weight_kg >= 0 and weight_kg <= 9999999)),
  qty_in_box integer check (qty_in_box is null or (qty_in_box >= 0 and qty_in_box <= 9999999)),
  -- Nexo-only: never selected by the supplier-facing server code.
  internal_note text check (internal_note is null or char_length(internal_note) <= 5000),
  status text not null default 'approved' check (status in ('pending','approved')),
  created_by_supplier boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sourcing_products_supplier on public.sourcing_products(supplier_id);
create index sourcing_products_status on public.sourcing_products(status);

create table public.sourcing_product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.sourcing_products(id) on delete cascade,
  supplier_id uuid not null references public.sourcing_suppliers(id) on delete cascade,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  ready boolean not null default false,
  approved boolean not null default true,
  uploaded_by_supplier boolean not null default false,
  created_at timestamptz not null default now()
);
create index sourcing_product_images_product on public.sourcing_product_images(product_id);

-- Supplier requests to edit or delete an existing product. Pending until staff decide.
create table public.sourcing_product_changes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.sourcing_products(id) on delete cascade,
  supplier_id uuid not null references public.sourcing_suppliers(id) on delete cascade,
  kind text not null check (kind in ('edit','delete')),
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  check ((kind = 'edit' and payload is not null) or kind = 'delete')
);
create unique index sourcing_product_one_pending_change
  on public.sourcing_product_changes(product_id) where status = 'pending';

alter table public.sourcing_catalog_links enable row level security;
alter table public.sourcing_products enable row level security;
alter table public.sourcing_product_images enable row level security;
alter table public.sourcing_product_changes enable row level security;
revoke all on public.sourcing_catalog_links, public.sourcing_products,
  public.sourcing_product_images, public.sourcing_product_changes from anon, authenticated;
grant all on public.sourcing_catalog_links, public.sourcing_products,
  public.sourcing_product_images, public.sourcing_product_changes to service_role;

-- Supplier operations. Re-checks the catalog link inside the same transaction, so a
-- revoked link cannot write. A supplier can only touch rows of its own supplier_id.
create function public.sourcing_catalog_mutate(p_hash text, p_operation text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  share public.sourcing_catalog_links%rowtype;
  prod public.sourcing_products%rowtype;
  rec public.sourcing_products%rowtype;
  fields jsonb;
  new_id uuid;
  image_id uuid;
  image_path text;
  removed jsonb := '[]'::jsonb;
  allowed constant text[] := array['name','description','specifications','price','currency',
    'moq','lead_time_days','box_length_cm','box_width_cm','box_height_cm','weight_kg','qty_in_box'];
begin
  select * into share from public.sourcing_catalog_links
    where token_hash = p_hash and active and revoked_at is null for share;
  if not found then raise exception 'Invalid supplier access'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid request'; end if;

  if p_operation = 'create_product' then
    if exists (select 1 from jsonb_object_keys(p_payload) k where k <> all (allowed)) then
      raise exception 'Invalid product fields';
    end if;
    if coalesce(btrim(p_payload->>'name'), '') = '' then raise exception 'Product name is required'; end if;
    if (select count(*) from public.sourcing_products
        where supplier_id = share.supplier_id and status = 'pending') >= 50 then
      raise exception 'Too many products are waiting for approval';
    end if;
    rec := jsonb_populate_record(null::public.sourcing_products, p_payload);
    insert into public.sourcing_products (supplier_id, name, description, specifications, price, currency,
      moq, lead_time_days, box_length_cm, box_width_cm, box_height_cm, weight_kg, qty_in_box, status, created_by_supplier)
    values (share.supplier_id, btrim(rec.name), rec.description, rec.specifications, rec.price,
      coalesce(rec.currency, 'USD'), rec.moq, rec.lead_time_days, rec.box_length_cm, rec.box_width_cm,
      rec.box_height_cm, rec.weight_kg, rec.qty_in_box, 'pending', true)
    returning id into new_id;
    return jsonb_build_object('id', new_id);

  elsif p_operation in ('request_edit', 'request_delete', 'cancel_change', 'prepare_image') then
    select * into prod from public.sourcing_products
      where id = (p_payload->>'product_id')::uuid and supplier_id = share.supplier_id for update;
    if not found then raise exception 'Invalid supplier access'; end if;

    if p_operation = 'request_edit' then
      fields := p_payload->'fields';
      if fields is null or jsonb_typeof(fields) <> 'object'
        or exists (select 1 from jsonb_object_keys(fields) k where k <> all (allowed)) then
        raise exception 'Invalid product fields';
      end if;
      if coalesce(btrim(fields->>'name'), '') = '' then raise exception 'Product name is required'; end if;
      perform jsonb_populate_record(null::public.sourcing_products, fields);
      insert into public.sourcing_product_changes (product_id, supplier_id, kind, payload)
      values (prod.id, share.supplier_id, 'edit', fields)
      on conflict (product_id) where status = 'pending'
      do update set kind = 'edit', payload = excluded.payload, created_at = now();
      return jsonb_build_object('ok', true);

    elsif p_operation = 'request_delete' then
      insert into public.sourcing_product_changes (product_id, supplier_id, kind, payload)
      values (prod.id, share.supplier_id, 'delete', null)
      on conflict (product_id) where status = 'pending'
      do update set kind = 'delete', payload = null, created_at = now();
      return jsonb_build_object('ok', true);

    elsif p_operation = 'cancel_change' then
      update public.sourcing_product_changes set status = 'cancelled', decided_at = now()
        where product_id = prod.id and supplier_id = share.supplier_id and status = 'pending';
      if not found then raise exception 'No pending request'; end if;
      if prod.status = 'approved' then
        with gone as (delete from public.sourcing_product_images
          where product_id = prod.id and uploaded_by_supplier and not approved returning object_path)
        select coalesce(jsonb_agg(object_path), '[]'::jsonb) into removed from gone;
      end if;
      return jsonb_build_object('ok', true, 'removed_paths', removed);

    else -- prepare_image
      if not (prod.status = 'pending' or exists (select 1 from public.sourcing_product_changes
          where product_id = prod.id and status = 'pending' and kind = 'edit')) then
        raise exception 'Photos can only be added to a new product or together with an edit request';
      end if;
      if (select count(*) from public.sourcing_product_images where product_id = prod.id
          and (ready or created_at > now() - interval '2 hours')) >= 10 then
        raise exception 'Image limit reached';
      end if;
      image_id := (p_payload->>'id')::uuid;
      image_path := 'catalog/' || share.supplier_id || '/' || prod.id || '/' || image_id;
      insert into public.sourcing_product_images (id, product_id, supplier_id, object_path, mime_type,
        byte_size, approved, uploaded_by_supplier)
      values (image_id, prod.id, share.supplier_id, image_path, p_payload->>'mime_type',
        (p_payload->>'byte_size')::integer, false, true);
      return jsonb_build_object('id', image_id, 'path', image_path);
    end if;

  elsif p_operation = 'finish_image' then
    update public.sourcing_product_images set ready = true
      where id = (p_payload->>'id')::uuid and supplier_id = share.supplier_id and uploaded_by_supplier
        and not ready and created_at > now() - interval '2 hours';
    if not found then raise exception 'Invalid image'; end if;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Invalid operation';
end;
$$;
revoke all on function public.sourcing_catalog_mutate(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sourcing_catalog_mutate(text, text, jsonb) to service_role;

-- Staff decisions on supplier submissions (called by the server after the staff check).
-- p_kind 'product' = a new supplier product; 'change' = a supplier edit/delete request.
-- Returns the Storage paths that must now be removed.
create function public.sourcing_catalog_decide(p_kind text, p_id uuid, p_decision text, p_user uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  prod public.sourcing_products%rowtype;
  chg public.sourcing_product_changes%rowtype;
  rec public.sourcing_products%rowtype;
  removed jsonb := '[]'::jsonb;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'Invalid decision'; end if;

  if p_kind = 'product' then
    select * into prod from public.sourcing_products where id = p_id and status = 'pending' for update;
    if not found then raise exception 'Nothing to decide'; end if;
    if p_decision = 'approve' then
      update public.sourcing_products set status = 'approved', approved_by = p_user,
        approved_at = now(), updated_at = now() where id = prod.id;
      update public.sourcing_product_images set approved = true where product_id = prod.id and ready;
      with gone as (delete from public.sourcing_product_images where product_id = prod.id and not ready
        returning object_path)
      select coalesce(jsonb_agg(object_path), '[]'::jsonb) into removed from gone;
    else
      select coalesce(jsonb_agg(object_path), '[]'::jsonb) into removed
        from public.sourcing_product_images where product_id = prod.id;
      delete from public.sourcing_products where id = prod.id;
    end if;

  elsif p_kind = 'change' then
    select * into chg from public.sourcing_product_changes where id = p_id and status = 'pending' for update;
    if not found then raise exception 'Nothing to decide'; end if;
    select * into prod from public.sourcing_products where id = chg.product_id for update;

    if chg.kind = 'delete' and p_decision = 'approve' then
      select coalesce(jsonb_agg(object_path), '[]'::jsonb) into removed
        from public.sourcing_product_images where product_id = prod.id;
      delete from public.sourcing_products where id = prod.id;
    elsif chg.kind = 'edit' and p_decision = 'approve' then
      rec := jsonb_populate_record(null::public.sourcing_products, chg.payload);
      update public.sourcing_products set name = btrim(rec.name), description = rec.description,
        specifications = rec.specifications, price = rec.price, currency = coalesce(rec.currency, currency),
        moq = rec.moq, lead_time_days = rec.lead_time_days, box_length_cm = rec.box_length_cm,
        box_width_cm = rec.box_width_cm, box_height_cm = rec.box_height_cm, weight_kg = rec.weight_kg,
        qty_in_box = rec.qty_in_box, updated_at = now()
      where id = prod.id;
      if prod.status = 'approved' then
        update public.sourcing_product_images set approved = true where product_id = prod.id and ready;
      end if;
      with gone as (delete from public.sourcing_product_images where product_id = prod.id and not ready
        returning object_path)
      select coalesce(jsonb_agg(object_path), '[]'::jsonb) into removed from gone;
      update public.sourcing_product_changes set status = 'approved', decided_at = now(), decided_by = p_user
        where id = chg.id;
    else -- rejected delete or edit request
      if prod.status = 'approved' then
        with gone as (delete from public.sourcing_product_images
          where product_id = prod.id and uploaded_by_supplier and not approved returning object_path)
        select coalesce(jsonb_agg(object_path), '[]'::jsonb) into removed from gone;
      end if;
      update public.sourcing_product_changes set status = 'rejected', decided_at = now(), decided_by = p_user
        where id = chg.id;
    end if;
  else
    raise exception 'Invalid decision target';
  end if;
  return jsonb_build_object('ok', true, 'removed_paths', removed);
end;
$$;
revoke all on function public.sourcing_catalog_decide(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.sourcing_catalog_decide(text, uuid, text, uuid) to service_role;

commit;

-- Verification (read-only):
-- select table_name from information_schema.tables where table_schema = 'public'
--   and table_name in ('sourcing_catalog_links','sourcing_products','sourcing_product_images','sourcing_product_changes');
