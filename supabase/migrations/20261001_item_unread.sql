-- Fix two-way item unread tracking using the four existing timestamp columns.
-- Run after the supplier portal migration. No data backfill or RLS changes.
begin;

create or replace function public.sourcing_supplier_mutate(p_hash text, p_item uuid, p_operation text, p_payload jsonb)
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

  -- A lock wait must not allow a token that has expired in the meantime.
  if share.expires_at is not null and share.expires_at <= clock_timestamp() then
    raise exception 'Invalid supplier access';
  end if;

  if p_operation = 'seen' then
    if jsonb_typeof(p_payload) <> 'object' or not (p_payload ? 'seenThrough')
      or jsonb_typeof(p_payload->'seenThrough') <> 'string'
      or exists (select 1 from jsonb_object_keys(p_payload) k where k <> 'seenThrough')
    then raise exception 'Invalid seen timestamp'; end if;
    update public.sourcing_request_items
      set supplier_seen_at = greatest(supplier_seen_at, (p_payload->>'seenThrough')::timestamptz)
      where id = p_item and request_id = share.request_id and supplier_id = share.supplier_id
        and nexo_changed_at = (p_payload->>'seenThrough')::timestamptz;
    if not found then return jsonb_build_object('ok', false, 'stale', true); end if;
    -- Reading an item does not change it or generate an activity/update event.
    return jsonb_build_object('ok', true);
  elsif p_operation = 'response' then
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

  -- Both response saves (including comment-only/identical saves) and completed
  -- image uploads are supplier updates. Prepare/seen operations return earlier.
  update public.sourcing_request_items set supplier_changed_at = greatest(
    clock_timestamp(), coalesce(supplier_changed_at, '-infinity'::timestamptz) + interval '1 microsecond'
  ) where id = p_item and request_id = share.request_id and supplier_id = share.supplier_id;

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

-- Stamp Nexo edits in the same write as the visible change, with a strictly
-- increasing DB timestamp. Supplier RPCs have no auth.uid() and cannot echo an
-- unread event back to the supplier. Seen/private-only edits are excluded.
create or replace function public.sourcing_track_nexo_item_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.sourcing_users where user_id = auth.uid() and active) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.nexo_changed_at := clock_timestamp();
  elsif row(new.product_name, new.quantity, new.unit, new.specifications, new.image_url,
    new.supplier_id, new.supplier_status, new.china_price, new.currency, new.moq,
    new.lead_time_days, new.box_length_cm, new.box_width_cm, new.box_height_cm,
    new.weight_kg, new.supplier_comment)
    is distinct from
    row(old.product_name, old.quantity, old.unit, old.specifications, old.image_url,
    old.supplier_id, old.supplier_status, old.china_price, old.currency, old.moq,
    old.lead_time_days, old.box_length_cm, old.box_width_cm, old.box_height_cm,
    old.weight_kg, old.supplier_comment)
    or new.nexo_changed_at is distinct from old.nexo_changed_at then
    new.nexo_changed_at := greatest(clock_timestamp(),
      coalesce(old.nexo_changed_at, '-infinity'::timestamptz) + interval '1 microsecond');
  end if;
  return new;
end;
$$;
revoke all on function public.sourcing_track_nexo_item_change() from public, anon, authenticated;
drop trigger if exists sourcing_track_nexo_item_change on public.sourcing_request_items;
create trigger sourcing_track_nexo_item_change before insert or update on public.sourcing_request_items
for each row execute function public.sourcing_track_nexo_item_change();

-- Gallery-only additions/removals/reordering must notify the supplier as well.
-- An AFTER trigger runs atomically with each successful gallery change.
create or replace function public.sourcing_track_nexo_reference_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.sourcing_users where user_id = auth.uid() and active) then return null; end if;
  if tg_op = 'UPDATE' then
    if row(new.request_item_id, new.object_path, new.sort_order)
      is not distinct from row(old.request_item_id, old.object_path, old.sort_order) then return null; end if;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    update public.sourcing_request_items set nexo_changed_at = greatest(clock_timestamp(),
      coalesce(nexo_changed_at, '-infinity'::timestamptz) + interval '1 microsecond')
    where id = old.request_item_id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    update public.sourcing_request_items set nexo_changed_at = greatest(clock_timestamp(),
      coalesce(nexo_changed_at, '-infinity'::timestamptz) + interval '1 microsecond')
    where id = new.request_item_id;
  end if;
  return null;
end;
$$;
revoke all on function public.sourcing_track_nexo_reference_change() from public, anon, authenticated;
drop trigger if exists sourcing_track_nexo_reference_change on public.sourcing_request_item_images;
create trigger sourcing_track_nexo_reference_change after insert or update or delete on public.sourcing_request_item_images
for each row execute function public.sourcing_track_nexo_reference_change();

commit;
