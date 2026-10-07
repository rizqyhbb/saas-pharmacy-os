-- M0 foundation: tenancy, identity, roles and audit.
--
-- Access model (docs/ARCHITECTURE.md §5, §10):
-- * Everything lives in schema `app`, which is NOT in the Data API's exposed schemas
--   (supabase/config.toml [api].schemas). Clients never talk to these tables directly;
--   the Elysia API is the only way in.
-- * The API connects as `postgres` (BYPASSRLS) but runs every request inside a
--   transaction that does `SET LOCAL ROLE apotek_api` and sets the request context
--   (app.user_id, app.tenant_id, app.staff_id). `apotek_api` has no BYPASSRLS, so the
--   row-level policies below always apply to request code.
-- * Roles come from app.staff_members, never from JWT claims.
-- * The few operations that must cross the tenant boundary (registering a new tenant,
--   maintaining balance projections) are SECURITY DEFINER functions in `app`, with an
--   empty search_path, granted to `apotek_api` only.

create schema app;
revoke all on schema app from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'apotek_api') then
    create role apotek_api nologin noinherit nobypassrls;
  end if;
end
$$;
grant apotek_api to postgres;
grant usage on schema app to apotek_api;

-- ---------------------------------------------------------------------------
-- Request context. Unset or empty means "none": policies then match no rows.
-- ---------------------------------------------------------------------------



create function app.current_user_id() returns uuid
language sql stable
set search_path = ''
as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app.current_staff_id() returns uuid
language sql stable
set search_path = ''
as $$ select nullif(current_setting('app.staff_id', true), '')::uuid $$;

-- Append-only guard for history tables (ledger, audit, status histories).
create function app.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% on %.% is not allowed: the table is append-only', tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end
$$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create type app.staff_role as enum (
  'OWNER',
  'BRANCH_MANAGER',
  'PHARMACIST',
  'TECHNICIAN',
  'CASHIER',
  'PURCHASING',
  'WAREHOUSE',
  'FINANCE',
  'AUDITOR'
);

create table app.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table app.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  -- "Today" for expiry and shifts is the branch's local date (packages/domain).
  timezone text not null default 'Asia/Jakarta',
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table app.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id)
);

-- One row per person per tenant. `user_id` is the Supabase Auth user.
create table app.staff_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  user_id uuid not null references auth.users (id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  role app.staff_role not null,
  -- Owner, finance and auditor usually work across branches; others are scoped.
  all_branches boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);

-- The tenant in context, but only if the signed-in user is an active staff member of
-- it under the staff id in context. A wrong or stale context (an API bug, a removed
-- employee) therefore matches no rows instead of opening another tenant.
-- SECURITY DEFINER so reading staff_members here doesn't recurse into its own policy.
create function app.current_tenant_id() returns uuid
language sql stable
security definer
set search_path = ''
as $$
  select sm.tenant_id
  from app.staff_members sm
  where sm.id = nullif(current_setting('app.staff_id', true), '')::uuid
    and sm.user_id = nullif(current_setting('app.user_id', true), '')::uuid
    and sm.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and sm.active
$$;

-- Every request resolves the caller's memberships by user_id, and the tenants policy uses it.
create index staff_members_user_id_idx on app.staff_members (user_id);

create table app.staff_branch_access (
  tenant_id uuid not null,
  staff_member_id uuid not null,
  branch_id uuid not null,
  primary key (staff_member_id, branch_id),
  foreign key (tenant_id, staff_member_id) references app.staff_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Audit (append-only). Mandatory for high-risk mutations (DOMAIN-MODEL.md §11).
-- ---------------------------------------------------------------------------

create table app.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  branch_id uuid,
  actor_user_id uuid,
  actor_staff_id uuid,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references app.branches (tenant_id, id)
);
create index audit_events_tenant_created_idx on app.audit_events (tenant_id, created_at desc);

create trigger audit_events_append_only
before update or delete on app.audit_events
for each row execute function app.forbid_change();
create trigger audit_events_no_truncate
before truncate on app.audit_events
for each statement execute function app.forbid_change();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.tenants enable row level security;
alter table app.branches enable row level security;
alter table app.locations enable row level security;
alter table app.staff_members enable row level security;
alter table app.staff_branch_access enable row level security;
alter table app.audit_events enable row level security;

-- A user can see the tenants they belong to (to pick one), and the current tenant.
create policy tenants_select on app.tenants for select to apotek_api
using (
  id = (select app.current_tenant_id())
  or id in (select sm.tenant_id from app.staff_members sm where sm.user_id = (select app.current_user_id()) and sm.active)
);
create policy tenants_update on app.tenants for update to apotek_api
using (id = (select app.current_tenant_id()))
with check (id = (select app.current_tenant_id()));

create policy branches_tenant on app.branches for all to apotek_api
using (tenant_id = (select app.current_tenant_id()))
with check (tenant_id = (select app.current_tenant_id()));

create policy locations_tenant on app.locations for all to apotek_api
using (tenant_id = (select app.current_tenant_id()))
with check (tenant_id = (select app.current_tenant_id()));

-- Staff rows are visible within the current tenant, and a user can always see
-- their own memberships (needed before a tenant is chosen).
create policy staff_members_select on app.staff_members for select to apotek_api
using (tenant_id = (select app.current_tenant_id()) or user_id = (select app.current_user_id()));
create policy staff_members_insert on app.staff_members for insert to apotek_api
with check (tenant_id = (select app.current_tenant_id()));
create policy staff_members_update on app.staff_members for update to apotek_api
using (tenant_id = (select app.current_tenant_id()))
with check (tenant_id = (select app.current_tenant_id()));

create policy staff_branch_access_select on app.staff_branch_access for select to apotek_api
using (
  tenant_id = (select app.current_tenant_id())
  or staff_member_id in (select sm.id from app.staff_members sm where sm.user_id = (select app.current_user_id()))
);
create policy staff_branch_access_insert on app.staff_branch_access for insert to apotek_api
with check (tenant_id = (select app.current_tenant_id()));
create policy staff_branch_access_delete on app.staff_branch_access for delete to apotek_api
using (tenant_id = (select app.current_tenant_id()));

create policy audit_events_select on app.audit_events for select to apotek_api
using (tenant_id = (select app.current_tenant_id()));
create policy audit_events_insert on app.audit_events for insert to apotek_api
with check (tenant_id = (select app.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- Grants: only what request code needs. No DELETE on history, no INSERT on tenants.
-- ---------------------------------------------------------------------------

grant select, update (name) on app.tenants to apotek_api;
grant select, insert, update (name, timezone) on app.branches to apotek_api;
grant select, insert, update (name) on app.locations to apotek_api;
grant select, insert, update (display_name, role, all_branches, active) on app.staff_members to apotek_api;
grant select, insert, delete on app.staff_branch_access to apotek_api;
grant select, insert on app.audit_events to apotek_api;

-- ---------------------------------------------------------------------------
-- Registration (US-FND-1): tenant, first branch, its main location and the owner,
-- atomically, for the signed-in user in app.user_id.
-- ---------------------------------------------------------------------------

create function app.register_tenant(
  p_tenant_name text,
  p_branch_name text,
  p_owner_display_name text,
  p_location_name text default 'Utama'
)
returns table (tenant_id uuid, branch_id uuid, location_id uuid, staff_member_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
  v_tenant uuid;
  v_branch uuid;
  v_location uuid;
  v_staff uuid;
begin
  if v_user is null then
    raise exception 'register_tenant needs a signed-in user (app.user_id)' using errcode = 'insufficient_privilege';
  end if;

  insert into app.tenants (name) values (btrim(p_tenant_name)) returning id into v_tenant;
  insert into app.branches (tenant_id, name) values (v_tenant, btrim(p_branch_name)) returning id into v_branch;
  insert into app.locations (tenant_id, branch_id, name)
    values (v_tenant, v_branch, btrim(p_location_name)) returning id into v_location;
  insert into app.staff_members (tenant_id, user_id, display_name, role, all_branches)
    values (v_tenant, v_user, btrim(p_owner_display_name), 'OWNER', true) returning id into v_staff;

  insert into app.audit_events (tenant_id, branch_id, actor_user_id, actor_staff_id, action, entity_type, entity_id, after)
  values (
    v_tenant, v_branch, v_user, v_staff, 'tenant.register', 'tenant', v_tenant::text,
    jsonb_build_object('tenant', btrim(p_tenant_name), 'branch', btrim(p_branch_name), 'owner', btrim(p_owner_display_name))
  );

  return query select v_tenant, v_branch, v_location, v_staff;
end
$$;

revoke all on function app.register_tenant(text, text, text, text) from public;
grant execute on function app.register_tenant(text, text, text, text) to apotek_api;
