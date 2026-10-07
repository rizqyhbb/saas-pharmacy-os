import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { ROLES, type Role } from "@apotek/domain";
import { withContext, type Sql } from "@apotek/db";
import { createUser } from "@apotek/db/testing";
import { createApp } from "../src/app";
import { supabaseVerifier } from "../src/auth";

export const SUPABASE_URL = "http://127.0.0.1:55321";
const ISSUER = `${SUPABASE_URL}/auth/v1`;

/** A signing key like Supabase's (ES256), so tests never need the auth server. */
const { privateKey, publicKey } = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256" };
export const testKeys = createLocalJWKSet({ keys: [jwk] });

export function token(userId: string, overrides: { issuer?: string; audience?: string; expiresIn?: string; role?: string } = {}) {
  return new SignJWT({ role: overrides.role ?? "authenticated", email: `${userId}@test.apotek.local` })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setSubject(userId)
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "5m")
    .sign(privateKey);
}

export function testApp(db: Sql) {
  return createApp({ db, verifyToken: supabaseVerifier({ supabaseUrl: SUPABASE_URL, keys: testKeys }) });
}

export async function call(
  app: ReturnType<typeof testApp>,
  method: string,
  path: string,
  opts: { userId?: string; bearer?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  const bearer = opts.bearer ?? (opts.userId ? await token(opts.userId) : undefined);
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const response = await app.handle(
    new Request(`http://localhost${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export type App = ReturnType<typeof testApp>;

export interface RoleTenant {
  tenantId: string;
  branchId: string;
  locationId: string;
  /** One staff member per role. Everyone except OWNER is scoped to the first branch. */
  staff: Record<Role, { userId: string; staffId: string }>;
}

/** Registers a tenant through the API, then adds one staff member for every role. */
export async function tenantWithEveryRole(app: App, db: Sql, tenantName = "Apotek Uji"): Promise<RoleTenant> {
  const ownerId = await createUser(db);
  const created = await call(app, "POST", "/tenants", {
    userId: ownerId,
    body: { tenantName, branchName: "Pusat", ownerDisplayName: "Pemilik" },
  });
  if (created.status !== 201) throw new Error(`registration failed: ${JSON.stringify(created)}`);
  const { tenantId, branchId, locationId, staffId } = created.body;
  const staff = { OWNER: { userId: ownerId, staffId } } as RoleTenant["staff"];
  const ctx = { userId: ownerId, tenantId, staffId };
  for (const role of ROLES.filter((r) => r !== "OWNER")) {
    const userId = await createUser(db);
    const memberId = await withContext(db, ctx, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into app.staff_members (tenant_id, user_id, display_name, role, all_branches)
        values (${tenantId}, ${userId}, ${role.toLowerCase()}, ${role}, ${role === "AUDITOR" || role === "FINANCE"}) returning id`;
      await tx`insert into app.staff_branch_access (tenant_id, staff_member_id, branch_id) values (${tenantId}, ${row!.id}, ${branchId})`;
      return row!.id;
    });
    staff[role] = { userId, staffId: memberId };
  }
  return { tenantId, branchId, locationId, staff };
}

/** Paracetamol 500 mg: tablet (base), strip 10, box 100, classified OTC by the owner. */
export const paracetamol = (sku = `PCT-${crypto.randomUUID().slice(0, 6)}`) => ({
  sku,
  brandName: "Paracetamol",
  genericName: "paracetamol",
  strength: "500 mg",
  dosageForm: "tablet",
  salesClass: "OTC",
  controlledClass: "NONE",
  units: [
    { name: "tablet", multiplierToBase: "1", sellPrice: 500 },
    { name: "strip", multiplierToBase: "10", sellPrice: 4500, isDefaultSale: true, barcodes: [`899${crypto.randomUUID().slice(0, 9)}`] },
    { name: "box", multiplierToBase: "100", sellPrice: 42000, isDefaultPurchase: true },
  ],
});
