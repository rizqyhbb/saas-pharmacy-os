import { afterAll, describe, expect, test } from "bun:test";
import { connect, createUser } from "@apotek/db/testing";
import { call, testApp, token } from "./support";

const sql = await connect();
afterAll(() => sql?.end());

describe.skipIf(!sql)("authentication", () => {
  const db = sql!;
  const app = testApp(db);

  test("no token, a malformed token or a forged signature is 401", async () => {
    expect((await call(app, "GET", "/me")).status).toBe(401);
    expect((await call(app, "GET", "/me", { bearer: "not-a-jwt" })).status).toBe(401);
    const real = await token(crypto.randomUUID());
    const [h, p] = real.split(".");
    const forged = `${h}.${p}.${"A".repeat(86)}`;
    expect((await call(app, "GET", "/me", { bearer: forged })).status).toBe(401);
  });

  test("wrong issuer, wrong audience, expired or non-user role is 401", async () => {
    const userId = await createUser(db);
    for (const bearer of [
      await token(userId, { issuer: "https://evil.example/auth/v1" }),
      await token(userId, { audience: "anon" }),
      await token(userId, { expiresIn: "-1m" }),
      await token(userId, { role: "service_role" }),
    ]) {
      expect((await call(app, "GET", "/me", { bearer })).status).toBe(401);
    }
  });

  test("a valid token reaches /me; a new user has no memberships yet", async () => {
    const userId = await createUser(db);
    const res = await call(app, "GET", "/me", { userId });
    expect(res).toEqual({ status: 200, body: { userId, email: `${userId}@test.apotek.local`, memberships: [] } });
  });
});
