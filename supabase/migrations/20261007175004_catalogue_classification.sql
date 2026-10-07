-- US-CAT-4: whether a product is OTC, OTC-limited, prescription-only or controlled is
-- a pharmacist's call. A product records who classified it and when; until then it
-- can't be sold or dispensed. Products created by staff without product.classify start
-- unclassified; the API sets the pair when a pharmacist (or owner) classifies.

alter table app.products
  add column classified_at timestamptz,
  add column classified_by uuid,
  add constraint products_classified_pair check ((classified_at is null) = (classified_by is null)),
  add constraint products_classified_by_fkey foreign key (tenant_id, classified_by)
    references app.staff_members (tenant_id, id);

grant update (classified_at, classified_by) on app.products to apotek_api;

-- Same function as before, plus the sellable-product check.
create or replace function app.apply_ledger_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tracks_batch boolean;
  v_batch app.batches%rowtype;
  v_branch_today date;
  v_balance app.inventory_balances%rowtype;
begin
  select p.tracks_batch into v_tracks_batch from app.products p where p.id = new.product_id;
  if v_tracks_batch and new.batch_id is null then
    raise exception 'BATCH_REQUIRED: product % tracks batches', new.product_id using errcode = 'check_violation';
  end if;
  if not v_tracks_batch and new.batch_id is not null then
    raise exception 'BATCH_NOT_TRACKED: product % does not track batches', new.product_id using errcode = 'check_violation';
  end if;

  -- A product leaves for a customer or patient only once a pharmacist has classified
  -- it and nobody has blocked it (US-CAT-4).
  if new.event_type in ('SALE', 'RX_DISPENSE') and exists (
    select 1 from app.products p
    where p.id = new.product_id and (p.classified_at is null or p.blocked_for_sale)
  ) then
    raise exception 'PRODUCT_NOT_SELLABLE: product % is unclassified or blocked for sale', new.product_id
      using errcode = 'check_violation';
  end if;

  -- T3: stock leaves for a patient or customer only from a sellable batch.
  if new.batch_id is not null and new.event_type in ('SALE', 'RX_DISPENSE', 'COMPOUND_CONSUMPTION') then
    select * into v_batch from app.batches b where b.id = new.batch_id;
    select (now() at time zone br.timezone)::date into v_branch_today from app.branches br where br.id = new.branch_id;
    if v_batch.status <> 'AVAILABLE' or v_batch.expiry_date < v_branch_today then
      raise exception 'BATCH_BLOCKED: batch % is % and expires %', v_batch.batch_number, v_batch.status, v_batch.expiry_date
        using errcode = 'check_violation';
    end if;
  end if;

  insert into app.inventory_balances (tenant_id, branch_id, location_id, product_id, batch_id)
  values (new.tenant_id, new.branch_id, new.location_id, new.product_id, new.batch_id)
  on conflict on constraint inventory_balances_key do nothing;

  select * into v_balance
  from app.inventory_balances b
  where b.tenant_id = new.tenant_id
    and b.location_id = new.location_id
    and b.product_id = new.product_id
    and b.batch_id is not distinct from new.batch_id
  for update;

  if new.event_type in ('RESERVATION', 'RESERVATION_RELEASE') then
    if v_balance.reserved + new.qty_delta_base < 0 then
      raise exception 'RELEASE_EXCEEDS_RESERVED: reserved %, release %', v_balance.reserved, -new.qty_delta_base
        using errcode = 'check_violation';
    end if;
    if v_balance.reserved + new.qty_delta_base > v_balance.on_hand then
      raise exception 'INSUFFICIENT_AVAILABLE: available %, requested %', v_balance.on_hand - v_balance.reserved, new.qty_delta_base
        using errcode = 'check_violation';
    end if;
    update app.inventory_balances b
    set reserved = b.reserved + new.qty_delta_base, updated_at = now()
    where b.tenant_id = v_balance.tenant_id and b.location_id = v_balance.location_id
      and b.product_id = v_balance.product_id and b.batch_id is not distinct from v_balance.batch_id;
  else
    if new.qty_delta_base < 0
      and v_balance.on_hand + new.qty_delta_base - v_balance.reserved < 0
      and not new.conflict_negative then
      raise exception 'INSUFFICIENT_AVAILABLE: available %, requested %', v_balance.on_hand - v_balance.reserved, -new.qty_delta_base
        using errcode = 'check_violation';
    end if;
    update app.inventory_balances b
    set on_hand = b.on_hand + new.qty_delta_base, updated_at = now()
    where b.tenant_id = v_balance.tenant_id and b.location_id = v_balance.location_id
      and b.product_id = v_balance.product_id and b.batch_id is not distinct from v_balance.batch_id;
  end if;

  return null;
end
$$;
