-- Supplier can tick a product as prepared. Safe to run more than once.
alter table public.sourcing_order_items add column if not exists prepared_at timestamptz;

create or replace function public.sourcing_order_supplier(p_hash text, p_operation text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  share public.sourcing_catalog_links%rowtype;
  line public.sourcing_order_items%rowtype;
  ord public.sourcing_orders%rowtype;
  new_price numeric;
begin
  select * into share from public.sourcing_catalog_links
    where token_hash = p_hash and active and revoked_at is null for share;
  if not found then raise exception 'Invalid supplier access'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid request'; end if;

  if p_operation in ('set_price', 'set_ready') then
    select * into line from public.sourcing_order_items where id = (p_payload->>'item_id')::uuid for update;
    if not found then raise exception 'Invalid supplier access'; end if;
    select * into ord from public.sourcing_orders where id = line.order_id for update;
    if ord.supplier_id <> share.supplier_id then raise exception 'Invalid supplier access'; end if;
  end if;

  if p_operation = 'set_ready' then
    -- Preparing goods happens after Nexo confirms, so both "sent" and "confirmed" are open.
    if ord.status not in ('sent', 'confirmed') then raise exception 'Order is locked'; end if;
    update public.sourcing_order_items
      set prepared_at = case when coalesce((p_payload->>'ready')::boolean, false) then coalesce(prepared_at, now()) else null end
      where id = line.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_operation = 'set_price' then
    if ord.status <> 'sent' then raise exception 'Order is locked'; end if;
    if jsonb_typeof(p_payload->'price') = 'null' or not (p_payload ? 'price') then
      new_price := null;
    else
      new_price := (p_payload->>'price')::numeric;
      if new_price < 0 or new_price > 9999999 then raise exception 'Invalid price'; end if;
    end if;
    -- A proposal equal to the approved price is not a proposal.
    if new_price is not null and line.unit_price is not null and new_price = line.unit_price then new_price := null; end if;
    update public.sourcing_order_items set proposed_price = new_price, updated_at = now() where id = line.id;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Invalid operation';
end $$;

revoke all on function public.sourcing_order_supplier(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sourcing_order_supplier(text, text, jsonb) to service_role;
