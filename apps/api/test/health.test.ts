import { expect, test } from "bun:test";
import type { Sql } from "@apotek/db";
import { testApp } from "./support";

test("GET /health needs no database and no token", async () => {
  const response = await testApp({} as Sql).handle(new Request("http://localhost/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", service: "apotek-api" });
});
