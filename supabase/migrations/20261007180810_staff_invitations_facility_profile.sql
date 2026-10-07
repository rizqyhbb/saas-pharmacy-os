-- Staff invitations (US-FND-3) and the facility profile (US-FND-2, PRD FND-4).

-- Looks up an existing Supabase Auth account by email, so an owner can add someone who
-- already uses the product elsewhere (a pharmacist working at two apotek) without a
-- second invitation. Only the API calls it, after checking staff.manage.
create function app.auth_user_id_by_email(p_email text) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.deleted_at is null
  limit 1
$$;
revoke all on function app.auth_user_id_by_email(text) from public;
grant execute on function app.auth_user_id_by_email(text) to apotek_api;

-- Which fields a facility record must carry comes from research/apotek-pos-research-blueprint.md
-- §4.3 (Permenkes 17/2024, Standard Usaha Apotek, checked 6 Oct 2026): business identity
-- (NIB), pharmacy permit, the APJ and their credentials, operating hours. Which of these
-- are mandatory, and how they print on receipts and etiket, needs APJ validation
-- [VALIDATE], so every column is optional for now.
create table app.facility_profiles (
  tenant_id uuid primary key references app.tenants (id),
  legal_name text check (length(legal_name) <= 160),
  nib text check (length(nib) <= 32),
  pharmacy_permit_number text check (length(pharmacy_permit_number) <= 64),
  pharmacy_permit_valid_until date,
  apj_staff_id uuid,
  apj_name text check (length(apj_name) <= 120),
  apj_registration_number text check (length(apj_registration_number) <= 64),
  apj_practice_permit_number text check (length(apj_practice_permit_number) <= 64),
  apj_practice_permit_valid_until date,
  address text check (length(address) <= 500),
  phone text check (length(phone) <= 32),
  operating_hours text check (length(operating_hours) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  foreign key (tenant_id, apj_staff_id) references app.staff_members (tenant_id, id),
  foreign key (tenant_id, updated_by) references app.staff_members (tenant_id, id)
);

alter table app.facility_profiles enable row level security;
create policy facility_profiles_tenant on app.facility_profiles for all to apotek_api
using (tenant_id = (select app.current_tenant_id()))
with check (tenant_id = (select app.current_tenant_id()));
grant select, insert, update on app.facility_profiles to apotek_api;
