-- M0 inventory spine: catalogue, batches, the append-only ledger and its balance
-- projection (docs/DOMAIN-MODEL.md §3-5, docs/ARCHITECTURE.md §6).
--
-- The rules below mirror packages/domain (units.ts, batch.ts, ledger.ts). The database
-- enforces them as well so that no code path, including a buggy one, can break them:
-- * L1  ledger rows are insert-only (trigger + no UPDATE/DELETE grant)
-- * L2  inventory_balances is written only by the ledger trigger, in the same
--       transaction as the ledger insert; app.balance_mismatches() checks it
-- * L3  available stock (on_hand - reserved) never goes below zero, except a SALE
--       flagged conflict_negative (an offline sale that synced after the stock was gone)
-- * L4  RESERVATION / RESERVATION_RELEASE move `reserved`, never `on_hand`
-- * L5  every row names the business document that caused it
-- * U1  every product has exactly one base unit (multiplier 1), checked at commit
-- * B1  a batch must arrive with an OPENING_BALANCE or PURCHASE_RECEIPT row, at commit
-- * B2  (tenant, product, batch_number, expiry_date) identifies a batch
-- * B3  batch_number and expiry_date cannot be edited
-- * T3  sale, dispense and compounding never draw from a batch that is not AVAILABLE
--       or is past expiry on the branch's local date
-- Every child row references its parent through (tenant_id, parent_id), so a row can
-- never point into another tenant.

create type app.sales_class as enum ('OTC', 'OTC_LIMITED', 'RX_REQUIRED');
create type app.controlled_class as enum ('NONE', 'NARCOTIC', 'PSYCHOTROPIC', 'PRECURSOR');
create type app.batch_status as enum ('AVAILABLE', 'QUARANTINE', 'RECALLED', 'EXPIRED', 'DESTROYED');
create type app.ledger_event_type as enum (
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'SALE',
  'RX_DISPENSE',
  'COMPOUND_CONSUMPTION',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CUSTOMER_RETURN',
  'SUPPLIER_RETURN',
  'STOCK_ADJUSTMENT',
  'WRITE_OFF_EXPIRED_DAMAGED',
  'DESTRUCTION',
  'RECALL_QUARANTINE',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'REPACK_CONVERSION'
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table app.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  sku text not null check (length(btrim(sku)) between 1 and 64),
  brand_name text not null check (length(btrim(brand_name)) between 1 and 160),
  generic_name text,
  strength text,
  dosage_form text,
  route text,
  manufacturer text,
  -- U3: external identifiers are attributes, never keys.
  kfa_code text,
  bpom_nie text,
  sales_class app.sales_class not null default 'OTC',
  controlled_class app.controlled_class not null default 'NONE',
  cold_chain boolean not null default false,
  tracks_batch boolean not null default true,
  blocked_for_sale boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sku)
);

create table app.product_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  product_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 40),
  multiplier_to_base numeric(18, 4) not null check (multiplier_to_base > 0),
  -- Whole rupiah. Null means the unit is not sold.
  sell_price bigint check (sell_price >= 0),
  is_default_sale boolean not null default false,
  is_default_purchase boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, product_id, id),
  unique (product_id, name),
  foreign key (tenant_id, product_id) references app.products (tenant_id, id) on delete cascade
);
-- U1, "at most one" half. The "at least one" half is the deferred trigger below.
create unique index product_units_one_base_unit on app.product_units (product_id) where multiplier_to_base = 1;

create table app.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  product_id uuid not null,
  unit_id uuid not null,
  code text not null check (code ~ '^\S{1,64}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  foreign key (tenant_id, product_id, unit_id) references app.product_units (tenant_id, product_id, id) on delete cascade
);

create function app.check_product_base_unit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product uuid;
  v_base_units int;
begin
  -- Separate branches: PL/pgSQL resolves record fields even in an untaken CASE arm.
  if tg_table_name = 'products' then
    v_product := new.id;
  elsif tg_op = 'DELETE' then
    v_product := old.product_id;
  else
    v_product := new.product_id;
  end if;
  if not exists (select 1 from app.products p where p.id = v_product) then
    return null; -- product deleted in the same transaction
  end if;
  select count(*) into v_base_units
  from app.product_units u
  where u.product_id = v_product and u.multiplier_to_base = 1;
  if v_base_units <> 1 then
    raise exception 'BASE_UNIT_REQUIRED: product % has % base units (multiplier 1), expected exactly 1', v_product, v_base_units
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

create constraint trigger products_base_unit
after insert on app.products
deferrable initially deferred
for each row execute function app.check_product_base_unit();

create constraint trigger product_units_base_unit
after insert or update or delete on app.product_units
deferrable initially deferred
for each row execute function app.check_product_base_unit();

-- ---------------------------------------------------------------------------
-- Batches
-- ---------------------------------------------------------------------------

create table app.batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  product_id uuid not null,
  batch_number text not null check (length(btrim(batch_number)) between 1 and 64),
  expiry_date date not null,
  status app.batch_status not null default 'AVAILABLE',
  received_at timestamptz not null default now(),
  purchase_cost_per_base numeric(18, 4) check (purchase_cost_per_base >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, product_id, id),
  unique (tenant_id, product_id, batch_number, expiry_date),
  foreign key (tenant_id, product_id) references app.products (tenant_id, id)
);

create function app.forbid_batch_identity_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.batch_number is distinct from old.batch_number
    or new.expiry_date is distinct from old.expiry_date
    or new.product_id is distinct from old.product_id
    or new.tenant_id is distinct from old.tenant_id then
    raise exception 'BATCH_IDENTITY_IMMUTABLE: batch number, expiry and product of batch % cannot be edited', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;

create trigger batches_identity_immutable
before update on app.batches
for each row execute function app.forbid_batch_identity_change();

-- ---------------------------------------------------------------------------
-- Ledger and balances
-- ---------------------------------------------------------------------------

create table app.inventory_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  batch_id uuid,
  qty_delta_base numeric(18, 4) not null check (qty_delta_base <> 0),
  -- Display only, e.g. {"unit": "strip", "qty": 2}. Never used for arithmetic.
  unit_context jsonb,
  event_type app.ledger_event_type not null,
  reference_type text not null check (length(btrim(reference_type)) > 0),
  reference_id text not null check (length(btrim(reference_id)) > 0),
  reason text,
  actor_staff_id uuid,
  conflict_negative boolean not null default false,
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, branch_id, location_id) references app.locations (tenant_id, branch_id, id),
  foreign key (tenant_id, product_id) references app.products (tenant_id, id),
  foreign key (tenant_id, product_id, batch_id) references app.batches (tenant_id, product_id, id),
  foreign key (tenant_id, actor_staff_id) references app.staff_members (tenant_id, id),
  -- packages/domain LEDGER_EVENT_EFFECTS: which direction each event may move.
  constraint inventory_ledger_sign check (
    case
      when event_type in ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'TRANSFER_IN', 'CUSTOMER_RETURN', 'RESERVATION')
        then qty_delta_base > 0
      when event_type in ('SALE', 'RX_DISPENSE', 'COMPOUND_CONSUMPTION', 'TRANSFER_OUT', 'SUPPLIER_RETURN',
                          'WRITE_OFF_EXPIRED_DAMAGED', 'DESTRUCTION', 'RESERVATION_RELEASE')
        then qty_delta_base < 0
      else true
    end
  ),
  constraint inventory_ledger_conflict_only_on_sale check (not conflict_negative or event_type = 'SALE')
);
create index inventory_ledger_stock_idx on app.inventory_ledger (tenant_id, location_id, product_id, batch_id);
create index inventory_ledger_reference_idx on app.inventory_ledger (tenant_id, reference_type, reference_id);
-- "Where did this batch go" (US-INV-9).
create index inventory_ledger_batch_idx on app.inventory_ledger (tenant_id, product_id, batch_id);

create trigger inventory_ledger_append_only
before update or delete on app.inventory_ledger
for each row execute function app.forbid_change();
create trigger inventory_ledger_no_truncate
before truncate on app.inventory_ledger
for each statement execute function app.forbid_change();

-- L2 granularity: one balance per (location, product, batch). batch_id is null only
-- for products that don't track batches.
create table app.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  batch_id uuid,
  on_hand numeric(18, 4) not null default 0,
  reserved numeric(18, 4) not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  constraint inventory_balances_key unique nulls not distinct (tenant_id, location_id, product_id, batch_id),
  foreign key (tenant_id, branch_id, location_id) references app.locations (tenant_id, branch_id, id),
  foreign key (tenant_id, product_id, batch_id) references app.batches (tenant_id, product_id, id)
);

-- Applies one ledger row to its balance inside the same transaction. Errors start
-- with the packages/domain LedgerError kind so the API can map them.
create function app.apply_ledger_event() returns trigger
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

create trigger inventory_ledger_apply
after insert on app.inventory_ledger
for each row execute function app.apply_ledger_event();

-- B1: a batch exists only because stock arrived (opening balance or goods receipt).
create function app.check_batch_has_origin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from app.inventory_ledger l
    where l.batch_id = new.id and l.event_type in ('OPENING_BALANCE', 'PURCHASE_RECEIPT')
  ) then
    raise exception 'BATCH_WITHOUT_ORIGIN: batch % has no opening balance or goods receipt', new.batch_number
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

create constraint trigger batches_have_origin
after insert on app.batches
deferrable initially deferred
for each row execute function app.check_batch_has_origin();

-- L2 check: every balance equals the sum of its ledger rows. Empty means healthy.
-- For the nightly reconciliation job and tests; not granted to request code.
create function app.balance_mismatches()
returns table (
  tenant_id uuid,
  location_id uuid,
  product_id uuid,
  batch_id uuid,
  ledger_on_hand numeric,
  ledger_reserved numeric,
  balance_on_hand numeric,
  balance_reserved numeric
)
language sql
stable
set search_path = ''
as $$
  with ledger as (
    select l.tenant_id, l.location_id, l.product_id, l.batch_id,
      coalesce(sum(l.qty_delta_base) filter (where l.event_type not in ('RESERVATION', 'RESERVATION_RELEASE')), 0) as on_hand,
      coalesce(sum(l.qty_delta_base) filter (where l.event_type in ('RESERVATION', 'RESERVATION_RELEASE')), 0) as reserved
    from app.inventory_ledger l
    group by 1, 2, 3, 4
  )
  select
    coalesce(l.tenant_id, b.tenant_id), coalesce(l.location_id, b.location_id),
    coalesce(l.product_id, b.product_id), coalesce(l.batch_id, b.batch_id),
    coalesce(l.on_hand, 0), coalesce(l.reserved, 0), coalesce(b.on_hand, 0), coalesce(b.reserved, 0)
  from ledger l
  full join app.inventory_balances b
    on b.tenant_id = l.tenant_id and b.location_id = l.location_id
   and b.product_id = l.product_id and b.batch_id is not distinct from l.batch_id
  where coalesce(l.on_hand, 0) <> coalesce(b.on_hand, 0)
     or coalesce(l.reserved, 0) <> coalesce(b.reserved, 0)
$$;
revoke all on function app.balance_mismatches() from public;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table app.products enable row level security;
alter table app.product_units enable row level security;
alter table app.product_barcodes enable row level security;
alter table app.batches enable row level security;
alter table app.inventory_ledger enable row level security;
alter table app.inventory_balances enable row level security;

create policy products_tenant on app.products for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy product_units_tenant on app.product_units for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy product_barcodes_tenant on app.product_barcodes for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy batches_tenant on app.batches for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy inventory_ledger_select on app.inventory_ledger for select to apotek_api
using (tenant_id = (select app.current_tenant_id()));
create policy inventory_ledger_insert on app.inventory_ledger for insert to apotek_api
with check (tenant_id = (select app.current_tenant_id()));
create policy inventory_balances_select on app.inventory_balances for select to apotek_api
using (tenant_id = (select app.current_tenant_id()));

grant select, insert, update (
  sku, brand_name, generic_name, strength, dosage_form, route, manufacturer, kfa_code, bpom_nie,
  sales_class, controlled_class, cold_chain, tracks_batch, blocked_for_sale, updated_at
) on app.products to apotek_api;
-- multiplier_to_base is fixed once created: history is stored in base units, but a
-- changed multiplier would silently change what "1 box" meant on old documents.
grant select, insert, delete, update (name, sell_price, is_default_sale, is_default_purchase) on app.product_units to apotek_api;
grant select, insert, delete on app.product_barcodes to apotek_api;
grant select, insert, update (status) on app.batches to apotek_api;
grant select, insert on app.inventory_ledger to apotek_api;
grant select on app.inventory_balances to apotek_api;
