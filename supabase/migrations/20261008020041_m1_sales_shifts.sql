-- M1 counter: cashier shifts, cash movements, sales with their batch allocations and
-- payments, refunds and voids (docs/DOMAIN-MODEL.md §7, PRD POS-*, SHF-*, SYN-*).
--
-- Rules the database holds, whatever the code path:
-- * S1  a sale's payments sum to its total (checked at commit)
-- * S2  a sale belongs to an OPEN shift of the same workstation
-- * S3  a void compensates stock with new ledger rows; nothing is edited
-- * S4  a sale is idempotent on its client-generated id and idempotency key
-- * S5  RX_REQUIRED and controlled products can't be SOLD (ledger trigger below)
-- * shift status only moves OPEN -> CLOSING -> CLOSED (packages/domain shiftMachine),
--   one open shift per workstation, every transition recorded
-- Money is whole rupiah (bigint). Sale lines, allocations, payments, refunds, cash
-- movements and status history are append-only.

create type app.shift_status as enum ('OPEN', 'CLOSING', 'CLOSED');
create type app.sale_status as enum ('COMPLETED', 'VOIDED');
create type app.payment_method as enum ('CASH', 'QRIS', 'TRANSFER', 'CARD');
create type app.cash_movement_type as enum ('IN', 'OUT');

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------

create table app.shifts (
  -- Client-generated, so a shift opened offline keeps its id (SYN-2).
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  workstation_id uuid not null,
  cashier_staff_id uuid not null,
  status app.shift_status not null default 'OPEN',
  opening_float bigint not null check (opening_float >= 0),
  opened_at timestamptz not null default now(),
  closing_started_at timestamptz,
  counted_cash bigint check (counted_cash >= 0),
  expected_cash bigint,
  variance bigint,
  closed_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 1000),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id),
  foreign key (tenant_id, workstation_id) references app.workstations (tenant_id, id),
  foreign key (tenant_id, cashier_staff_id) references app.staff_members (tenant_id, id),
  foreign key (tenant_id, reviewed_by) references app.staff_members (tenant_id, id),
  check ((status = 'CLOSED') = (closed_at is not null)),
  check (status <> 'CLOSED' or (counted_cash is not null and expected_cash is not null and variance = counted_cash - expected_cash))
);
create unique index shifts_one_open_per_workstation on app.shifts (workstation_id) where status <> 'CLOSED';
create index shifts_tenant_opened_idx on app.shifts (tenant_id, opened_at desc);

create table app.shift_status_history (
  id uuid primary key default gen_random_uuid(),
  -- Transitions in one transaction share now(); seq keeps their order.
  seq bigint generated always as identity,
  tenant_id uuid not null,
  shift_id uuid not null,
  from_status app.shift_status,
  to_status app.shift_status not null,
  actor_staff_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, shift_id) references app.shifts (tenant_id, id)
);

create function app.guard_shift_transition() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'OPEN' then
      raise exception 'ILLEGAL_TRANSITION: a shift starts OPEN' using errcode = 'check_violation';
    end if;
    insert into app.shift_status_history (tenant_id, shift_id, from_status, to_status, actor_staff_id)
    values (new.tenant_id, new.id, null, 'OPEN', new.cashier_staff_id);
    return new;
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'OPEN' and new.status = 'CLOSING') or (old.status = 'CLOSING' and new.status = 'CLOSED')) then
      raise exception 'ILLEGAL_TRANSITION: shift % cannot go from % to %', old.id, old.status, new.status using errcode = 'check_violation';
    end if;
    insert into app.shift_status_history (tenant_id, shift_id, from_status, to_status, actor_staff_id)
    values (new.tenant_id, new.id, old.status, new.status, nullif(current_setting('app.staff_id', true), '')::uuid);
  end if;
  return new;
end
$$;

create trigger shifts_transition_insert after insert on app.shifts for each row execute function app.guard_shift_transition();
create trigger shifts_transition_update before update on app.shifts for each row execute function app.guard_shift_transition();

create table app.cash_movements (
  id uuid primary key,
  tenant_id uuid not null,
  shift_id uuid not null,
  type app.cash_movement_type not null,
  amount bigint not null check (amount > 0),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  actor_staff_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, shift_id) references app.shifts (tenant_id, id),
  foreign key (tenant_id, actor_staff_id) references app.staff_members (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------

create table app.sales (
  -- Client-generated (SYN-2): the device names the sale, so a replay is recognisable.
  id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  location_id uuid not null,
  workstation_id uuid not null,
  shift_id uuid not null,
  cashier_staff_id uuid not null,
  -- Printed on the receipt; made by the device so it works offline.
  receipt_no text not null check (receipt_no ~ '^[A-Za-z0-9-]{3,40}$'),
  status app.sale_status not null default 'COMPLETED',
  subtotal bigint not null check (subtotal >= 0),
  discount_total bigint not null check (discount_total >= 0),
  total bigint not null check (total = subtotal - discount_total and total >= 0),
  change_due bigint not null default 0 check (change_due >= 0),
  -- When the device recorded it (may be hours before it synced).
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  offline boolean not null default false,
  -- Some line went below zero under the offline-conflict rule: a person must reconcile.
  has_conflict boolean not null default false,
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (length(void_reason) <= 500),
  unique (tenant_id, id),
  unique (tenant_id, receipt_no),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, branch_id, location_id) references app.locations (tenant_id, branch_id, id),
  foreign key (tenant_id, workstation_id) references app.workstations (tenant_id, id),
  foreign key (tenant_id, shift_id) references app.shifts (tenant_id, id),
  foreign key (tenant_id, cashier_staff_id) references app.staff_members (tenant_id, id),
  foreign key (tenant_id, voided_by) references app.staff_members (tenant_id, id),
  check ((status = 'VOIDED') = (voided_at is not null and voided_by is not null and void_reason is not null))
);
create index sales_tenant_occurred_idx on app.sales (tenant_id, occurred_at desc);
create index sales_shift_idx on app.sales (tenant_id, shift_id);

-- S2: only into an OPEN shift on the same workstation and branch.
create function app.check_sale_shift() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift app.shifts%rowtype;
begin
  select * into v_shift from app.shifts s where s.id = new.shift_id and s.tenant_id = new.tenant_id;
  if v_shift.status is distinct from 'OPEN' or v_shift.workstation_id <> new.workstation_id or v_shift.branch_id <> new.branch_id then
    raise exception 'SHIFT_NOT_OPEN: sale % needs an open shift on its workstation', new.id using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger sales_need_open_shift before insert on app.sales for each row execute function app.check_sale_shift();

-- Only the void fields of a sale ever change, and only COMPLETED -> VOIDED.
create function app.guard_sale_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'COMPLETED' or new.status <> 'VOIDED' then
    raise exception 'ILLEGAL_TRANSITION: sale % cannot go from % to %', old.id, old.status, new.status using errcode = 'check_violation';
  end if;
  if (new.id, new.tenant_id, new.total, new.subtotal, new.discount_total, new.shift_id, new.receipt_no, new.occurred_at)
     is distinct from (old.id, old.tenant_id, old.total, old.subtotal, old.discount_total, old.shift_id, old.receipt_no, old.occurred_at) then
    raise exception 'SALE_IMMUTABLE: only the void fields of a sale change' using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;
create trigger sales_guard_update before update on app.sales for each row execute function app.guard_sale_update();

create table app.sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  line_no int not null check (line_no between 1 and 500),
  product_id uuid not null,
  unit_id uuid not null,
  unit_name text not null,
  qty_unit numeric(18, 4) not null check (qty_unit > 0),
  qty_base numeric(18, 4) not null check (qty_base > 0),
  unit_price bigint not null check (unit_price >= 0),
  discount bigint not null default 0 check (discount >= 0),
  line_total bigint not null check (line_total >= 0),
  unique (tenant_id, id),
  unique (sale_id, line_no),
  foreign key (tenant_id, sale_id) references app.sales (tenant_id, id),
  foreign key (tenant_id, product_id, unit_id) references app.product_units (tenant_id, product_id, id)
);

create table app.sale_item_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_item_id uuid not null,
  batch_id uuid,
  qty_base numeric(18, 4) not null check (qty_base > 0),
  conflict boolean not null default false,
  foreign key (tenant_id, sale_item_id) references app.sale_items (tenant_id, id),
  foreign key (tenant_id, batch_id) references app.batches (tenant_id, id)
);

create table app.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  method app.payment_method not null,
  tendered bigint not null check (tendered >= 0),
  amount bigint not null check (amount >= 0 and amount <= tendered),
  reference text check (length(reference) <= 120),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id) references app.sales (tenant_id, id)
);

-- S1, at commit so the sale and its payments can be inserted in any order.
create function app.check_sale_paid() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid bigint;
begin
  select coalesce(sum(p.amount), 0) into v_paid from app.payments p where p.sale_id = new.id;
  if v_paid <> new.total then
    raise exception 'PAYMENTS_DO_NOT_MATCH_TOTAL: sale % total %, paid %', new.id, new.total, v_paid using errcode = 'check_violation';
  end if;
  return null;
end
$$;
create constraint trigger sales_paid_in_full after insert on app.sales
deferrable initially deferred for each row execute function app.check_sale_paid();

-- US-POS-8: money back on a completed sale. Does not restock (a return is a separate,
-- stock-quarantine decision).
create table app.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  shift_id uuid not null,
  method app.payment_method not null,
  amount bigint not null check (amount > 0),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  approved_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id) references app.sales (tenant_id, id),
  foreign key (tenant_id, shift_id) references app.shifts (tenant_id, id),
  foreign key (tenant_id, approved_by) references app.staff_members (tenant_id, id)
);

create function app.check_refund() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale app.sales%rowtype;
  v_refunded bigint;
begin
  select * into v_sale from app.sales s where s.id = new.sale_id;
  if v_sale.status <> 'COMPLETED' then
    raise exception 'SALE_NOT_COMPLETED: a voided sale cannot be refunded' using errcode = 'check_violation';
  end if;
  select coalesce(sum(r.amount), 0) into v_refunded from app.refunds r where r.sale_id = new.sale_id;
  if v_refunded + new.amount > v_sale.total then
    raise exception 'REFUND_EXCEEDS_SALE: refunded % of %, asked %', v_refunded, v_sale.total, new.amount using errcode = 'check_violation';
  end if;
  if not exists (select 1 from app.shifts s where s.id = new.shift_id and s.status = 'OPEN') then
    raise exception 'SHIFT_NOT_OPEN: a refund is paid from an open shift' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger refunds_check before insert on app.refunds for each row execute function app.check_refund();

-- Append-only history.
create trigger sale_items_append_only before update or delete on app.sale_items for each row execute function app.forbid_change();
create trigger sale_item_allocations_append_only before update or delete on app.sale_item_allocations for each row execute function app.forbid_change();
create trigger payments_append_only before update or delete on app.payments for each row execute function app.forbid_change();
create trigger refunds_append_only before update or delete on app.refunds for each row execute function app.forbid_change();
create trigger cash_movements_append_only before update or delete on app.cash_movements for each row execute function app.forbid_change();
create trigger shift_status_history_append_only before update or delete on app.shift_status_history for each row execute function app.forbid_change();
create trigger sales_no_delete before delete on app.sales for each row execute function app.forbid_change();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table app.shifts enable row level security;
alter table app.shift_status_history enable row level security;
alter table app.cash_movements enable row level security;
alter table app.sales enable row level security;
alter table app.sale_items enable row level security;
alter table app.sale_item_allocations enable row level security;
alter table app.payments enable row level security;
alter table app.refunds enable row level security;

create policy shifts_tenant on app.shifts for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy shift_status_history_select on app.shift_status_history for select to apotek_api
using (tenant_id = (select app.current_tenant_id()));
create policy cash_movements_tenant on app.cash_movements for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy sales_tenant on app.sales for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy sale_items_tenant on app.sale_items for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy sale_item_allocations_tenant on app.sale_item_allocations for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy payments_tenant on app.payments for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));
create policy refunds_tenant on app.refunds for all to apotek_api
using (tenant_id = (select app.current_tenant_id())) with check (tenant_id = (select app.current_tenant_id()));

grant select, insert, update (status, closing_started_at, counted_cash, expected_cash, variance, closed_at,
  reviewed_by, reviewed_at, review_note) on app.shifts to apotek_api;
grant select on app.shift_status_history to apotek_api;
grant select, insert on app.cash_movements to apotek_api;
grant select, insert, update (status, voided_at, voided_by, void_reason) on app.sales to apotek_api;
grant select, insert on app.sale_items to apotek_api;
grant select, insert on app.sale_item_allocations to apotek_api;
grant select, insert on app.payments to apotek_api;
grant select, insert on app.refunds to apotek_api;

-- Locks a product's balances at a location for the selling transaction, so two
-- counters can't allocate the same last units (docs/ARCHITECTURE.md §6). Locking needs
-- UPDATE privilege, which request code must not have on balances; this function holds
-- it instead and only ever returns the caller's own tenant.
create function app.lock_stock(p_location_id uuid, p_product_id uuid)
returns table (batch_id uuid, expiry_date date, received_at timestamptz, status app.batch_status, on_hand numeric, reserved numeric)
language sql
volatile
security definer
set search_path = ''
as $$
  select bal.batch_id, b.expiry_date, b.received_at, b.status, bal.on_hand, bal.reserved
  from app.inventory_balances bal
  left join app.batches b on b.id = bal.batch_id
  where bal.tenant_id = (select app.current_tenant_id())
    and bal.location_id = p_location_id and bal.product_id = p_product_id
  for update of bal
$$;
revoke all on function app.lock_stock(uuid, uuid) from public;
grant execute on function app.lock_stock(uuid, uuid) to apotek_api;

-- ---------------------------------------------------------------------------
-- Ledger trigger: adds S5 and lets a flagged offline-conflict row through T3.
-- ---------------------------------------------------------------------------

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

  -- S5: prescription-only and controlled products never go through the OTC counter;
  -- they leave as RX_DISPENSE through the prescription flow (v1.1).
  if new.event_type = 'SALE' and exists (
    select 1 from app.products p
    where p.id = new.product_id and (p.sales_class = 'RX_REQUIRED' or p.controlled_class <> 'NONE')
  ) then
    raise exception 'RX_REQUIRED: product % needs a prescription', new.product_id using errcode = 'check_violation';
  end if;

  -- T3: stock leaves for a patient or customer only from a sellable batch. A flagged
  -- offline-conflict row is the exception: the goods already left, a person reconciles.
  if new.batch_id is not null and not new.conflict_negative
    and new.event_type in ('SALE', 'RX_DISPENSE', 'COMPOUND_CONSUMPTION') then
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
