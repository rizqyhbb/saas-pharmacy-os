-- Completes the M0 schema: product planning fields (PRD-4, PRD-6, PRD-7), workstations
-- (FND-2), the privileged batch correction (INV-8), a rebuildable balance projection
-- (INV-2) and the nightly jobs: expiry materialisation (B4) and ledger reconciliation
-- (docs/ARCHITECTURE.md §6).

-- ---------------------------------------------------------------------------
-- Products: identity, flags and stock levels
-- ---------------------------------------------------------------------------

alter table app.products
  add column category text check (length(category) <= 80),
  add column package_description text check (length(package_description) <= 160),
  add column compounding_ingredient boolean not null default false,
  add column min_stock numeric(18, 4) check (min_stock >= 0),
  add column max_stock numeric(18, 4) check (max_stock >= 0),
  add column safety_stock numeric(18, 4) check (safety_stock >= 0),
  add column reorder_point numeric(18, 4) check (reorder_point >= 0),
  add column default_location_id uuid,
  add constraint products_stock_levels check (max_stock is null or min_stock is null or max_stock >= min_stock),
  add constraint products_default_location_fkey foreign key (tenant_id, default_location_id)
    references app.locations (tenant_id, id);

grant update (
  category, package_description, compounding_ingredient, min_stock, max_stock, safety_stock, reorder_point,
  default_location_id
) on app.products to apotek_api;

-- ---------------------------------------------------------------------------
-- Workstations: the counter PCs and tablets of a branch (FND-2). Offline sync and
-- shifts attach to them in M1.
-- ---------------------------------------------------------------------------

create table app.workstations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, name),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id)
);

alter table app.workstations enable row level security;
create policy workstations_tenant on app.workstations for all to apotek_api
using (tenant_id = (select app.current_tenant_id()))
with check (tenant_id = (select app.current_tenant_id()));
grant select, insert, update (name, active) on app.workstations to apotek_api;

-- ---------------------------------------------------------------------------
-- INV-8: batch number and expiry are corrected only through this function, which the
-- API calls after checking batch.correct and writes an audit event with a reason in the
-- same transaction. Request code has no UPDATE grant on those columns, and the trigger
-- refuses everyone else, including the table owner.
-- ---------------------------------------------------------------------------

create or replace function app.forbid_batch_identity_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.batch_number is distinct from old.batch_number or new.expiry_date is distinct from old.expiry_date)
    and coalesce(current_setting('app.batch_correction', true), '') = 'on'
    and new.product_id = old.product_id and new.tenant_id = old.tenant_id then
    return new;
  end if;
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

create function app.correct_batch(p_batch_id uuid, p_batch_number text, p_expiry_date date)
returns table (old_batch_number text, old_expiry_date date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old app.batches%rowtype;
begin
  -- SECURITY DEFINER bypasses row-level security, so check the tenant explicitly.
  select * into v_old from app.batches b
  where b.id = p_batch_id and b.tenant_id = (select app.current_tenant_id())
  for update;
  if not found then
    return;
  end if;
  perform set_config('app.batch_correction', 'on', true);
  update app.batches set batch_number = btrim(p_batch_number), expiry_date = p_expiry_date where id = p_batch_id;
  perform set_config('app.batch_correction', '', true);
  return query select v_old.batch_number, v_old.expiry_date;
end
$$;
revoke all on function app.correct_batch(uuid, text, date) from public;
grant execute on function app.correct_batch(uuid, text, date) to apotek_api;

-- ---------------------------------------------------------------------------
-- INV-2: rebuild a tenant's balances from its ledger (recovery). System only.
-- ---------------------------------------------------------------------------

create function app.rebuild_balances(p_tenant_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from app.inventory_balances where tenant_id = p_tenant_id;
  insert into app.inventory_balances (tenant_id, branch_id, location_id, product_id, batch_id, on_hand, reserved)
  select l.tenant_id, l.branch_id, l.location_id, l.product_id, l.batch_id,
    coalesce(sum(l.qty_delta_base) filter (where l.event_type not in ('RESERVATION', 'RESERVATION_RELEASE')), 0),
    coalesce(sum(l.qty_delta_base) filter (where l.event_type in ('RESERVATION', 'RESERVATION_RELEASE')), 0)
  from app.inventory_ledger l
  where l.tenant_id = p_tenant_id
  group by l.tenant_id, l.branch_id, l.location_id, l.product_id, l.batch_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;
revoke all on function app.rebuild_balances(uuid) from public;

-- ---------------------------------------------------------------------------
-- Nightly jobs
-- ---------------------------------------------------------------------------

-- A balance that disagrees with its ledger. Raised by the nightly check, resolved by a
-- person (Critical Action Center item in M1).
create table app.reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  location_id uuid not null,
  product_id uuid not null,
  batch_id uuid,
  ledger_on_hand numeric(18, 4) not null,
  ledger_reserved numeric(18, 4) not null,
  balance_on_hand numeric(18, 4) not null,
  balance_reserved numeric(18, 4) not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text check (length(resolution_note) <= 1000),
  foreign key (tenant_id, location_id) references app.locations (tenant_id, id),
  foreign key (tenant_id, product_id) references app.products (tenant_id, id),
  foreign key (tenant_id, resolved_by) references app.staff_members (tenant_id, id),
  check ((resolved_at is null) = (resolved_by is null))
);
create index reconciliation_issues_open_idx on app.reconciliation_issues (tenant_id) where resolved_at is null;

alter table app.reconciliation_issues enable row level security;
create policy reconciliation_issues_select on app.reconciliation_issues for select to apotek_api
using (tenant_id = (select app.current_tenant_id()));
create policy reconciliation_issues_resolve on app.reconciliation_issues for update to apotek_api
using (tenant_id = (select app.current_tenant_id()))
with check (tenant_id = (select app.current_tenant_id()));
grant select, update (resolved_at, resolved_by, resolution_note) on app.reconciliation_issues to apotek_api;

create function app.run_reconciliation() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into app.reconciliation_issues
    (tenant_id, location_id, product_id, batch_id, ledger_on_hand, ledger_reserved, balance_on_hand, balance_reserved)
  select m.tenant_id, m.location_id, m.product_id, m.batch_id, m.ledger_on_hand, m.ledger_reserved, m.balance_on_hand, m.balance_reserved
  from app.balance_mismatches() m
  where not exists (
    select 1 from app.reconciliation_issues r
    where r.tenant_id = m.tenant_id and r.location_id = m.location_id and r.product_id = m.product_id
      and r.batch_id is not distinct from m.batch_id and r.resolved_at is null
  );
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;
revoke all on function app.run_reconciliation() from public;

-- B4: AVAILABLE batches past expiry become EXPIRED, once the date has passed in every
-- branch of the tenant (Indonesia spans three time zones). Each change is audited as a
-- system action. Quarantined batches keep their status: a person is deciding on them.
create function app.expire_batches() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  with tenant_today as (
    select b.tenant_id, min((now() at time zone b.timezone)::date) as today
    from app.branches b group by b.tenant_id
  ),
  expired as (
    update app.batches bt
    set status = 'EXPIRED'
    from tenant_today tt
    where bt.tenant_id = tt.tenant_id and bt.status = 'AVAILABLE' and bt.expiry_date < tt.today
    returning bt.id, bt.tenant_id, bt.batch_number, bt.expiry_date
  )
  insert into app.audit_events (tenant_id, action, entity_type, entity_id, before, after, reason)
  select e.tenant_id, 'batch.status.change', 'batch', e.id::text,
    jsonb_build_object('status', 'AVAILABLE'),
    jsonb_build_object('status', 'EXPIRED', 'batchNumber', e.batch_number, 'expiryDate', e.expiry_date),
    'Kedaluwarsa, ditandai otomatis'
  from expired e;
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;
revoke all on function app.expire_batches() from public;

create function app.run_nightly() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object('expired', app.expire_batches(), 'reconciliation_issues', app.run_reconciliation());
end
$$;
revoke all on function app.run_nightly() from public;

-- 17:30 UTC = 00:30 WIB, after midnight in every Indonesian time zone.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('apotek-nightly', '30 17 * * *', 'select app.run_nightly()');
