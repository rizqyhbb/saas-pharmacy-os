import { afterAll, describe, expect, test } from "bun:test";
import { BATCH_STATUSES, LEDGER_EVENT_TYPES, ROLES } from "@apotek/domain";
import { connect } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

/** Guards the access model itself, so a new table can't quietly skip it. */
describe.skipIf(!sql)("schema guards", () => {
  const db = sql!;

  test("every table in schema app has row-level security and at least one policy", async () => {
    const rows = await db<{ table: string; rls: boolean; policies: number }[]>`
      select c.relname as table, c.relrowsecurity as rls,
        (select count(*)::int from pg_policies p where p.schemaname = 'app' and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r'
      order by 1
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.rls || r.policies === 0)).toEqual([]);
  });

  test("every tenant-owned table carries tenant_id", async () => {
    const rows = await db<{ table: string }[]>`
      select c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r' and c.relname <> 'tenants'
        and not exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'app' and col.table_name = c.relname and col.column_name = 'tenant_id'
        )
    `;
    expect([...rows]).toEqual([]);
  });

  test("the request role cannot bypass row-level security", async () => {
    const [role] = await db<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      select rolbypassrls, rolsuper from pg_roles where rolname = 'apotek_api'
    `;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  test("Data API roles cannot reach schema app", async () => {
    const rows = await db<{ role: string; usage: boolean }[]>`
      select r as role, has_schema_privilege(r, 'app', 'usage') as usage
      from unnest(array['anon', 'authenticated']) as r
    `;
    expect(rows.filter((r) => r.usage)).toEqual([]);
  });

  test("request code can't write balances or rewrite history", async () => {
    const rows = await db<{ table: string; privilege: string }[]>`
      select table_name as table, privilege_type as privilege
      from information_schema.role_table_grants
      where grantee = 'apotek_api' and table_schema = 'app'
        and (
          (table_name = 'inventory_balances' and privilege_type <> 'SELECT')
          or (table_name in ('inventory_ledger', 'audit_events') and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE'))
        )
    `;
    expect([...rows]).toEqual([]);
  });

  test("database enums match the domain package", async () => {
    const values = async (type: string) =>
      (
        await db<{ v: string }[]>`
          select e.enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'app' and t.typname = ${type} order by e.enumsortorder
        `
      ).map((r) => r.v);
    expect(await values("ledger_event_type")).toEqual([...LEDGER_EVENT_TYPES]);
    expect(await values("staff_role")).toEqual([...ROLES]);
    expect(await values("batch_status")).toEqual([...BATCH_STATUSES]);
  });
});
