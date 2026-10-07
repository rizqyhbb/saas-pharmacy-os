import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Sql } from "@apotek/db";
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
