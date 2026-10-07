import { Elysia, t } from "elysia";
import { classifyDbError, membershipsForUser, registerTenant, type Sql } from "@apotek/db";
import type { VerifyToken } from "./auth";
import {
  addBarcodeRoute,
  barcodeBody,
  classifyBody,
  classifyProductRoute,
  createProductRoute,
  getProductRoute,
  listProductsRoute,
  priceBody,
  productBody,
  productPatchBody,
  productQuery,
  removeBarcodeRoute,
  setPriceRoute,
  updateProductRoute,
} from "./routes/catalogue";
import { auditQuery, changeRole, listAuditEvents, listLocations, listStaff, roleChangeBody } from "./routes/staff";
import { batchStatusBody, batchStatusRoute, openingBalanceBody, openingBalanceRoute, stockCardRoute } from "./routes/stock";
import type { Reply, TenantScope } from "./scope";

export interface AppDeps {
  db: Sql;
  verifyToken: VerifyToken;
}

const bearerToken = (header: string | undefined) => header?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
const name = t.String({ minLength: 1, maxLength: 120 });

/** Turns a handler's Reply into the response. */
async function send(set: { status?: number | string }, pending: Promise<Reply>) {
  const { status, body } = await pending;
  set.status = status;
  return body;
}

/**
 * Every privileged action is checked on the server against the role stored in the
 * database (CLAUDE.md "Authorization is server-side"). Tenant routes live under
 * /tenants/:tenantId; a tenant the caller doesn't belong to answers 404, so its
 * existence isn't revealed. Handlers live in ./routes and return a Reply.
 *
 * Built separately from `listen()` so tests drive it through `app.handle(request)`.
 */
export const createApp = ({ db, verifyToken }: AppDeps) =>
  new Elysia()
    .onError(({ error, code, set }) => {
      if (code === "VALIDATION" || code === "NOT_FOUND" || code === "PARSE") return;
      const failure = classifyDbError(error);
      if (failure?.kind === "RULE") {
        set.status = 422;
        return { error: failure.rule };
      }
      if (failure?.kind === "UNIQUE") {
        set.status = 409;
        return { error: "ALREADY_EXISTS", constraint: failure.constraint };
      }
      // Never echo internals: messages can contain row data.
      console.error("[api] unhandled error", code, error instanceof Error ? error.name : typeof error);
      set.status = 500;
      return { error: "INTERNAL" };
    })
    .get("/health", () => ({ status: "ok", service: "apotek-api" }))
    .resolve(async ({ headers, status }) => {
      const token = bearerToken(headers.authorization);
      const user = token ? await verifyToken(token) : null;
      if (!user) return status(401, { error: "UNAUTHENTICATED" });
      return { user };
    })
    .get("/me", async ({ user }) => {
      const memberships = await membershipsForUser(db, user.userId);
      return {
        userId: user.userId,
        email: user.email,
        memberships: memberships.map(({ tenantId, tenantName, staffId, displayName, role, allBranches, branchIds }) => ({
          tenantId,
          tenantName,
          staffId,
          displayName,
          role,
          allBranches,
          branchIds,
        })),
      };
    })
    .post("/tenants", async ({ user, body, status }) => status(201, await registerTenant(db, user.userId, body)), {
      body: t.Object({ tenantName: name, branchName: name, ownerDisplayName: name }),
    })
    .group("/tenants/:tenantId", (tenant) =>
      tenant
        .resolve(async ({ params, user, request, status }) => {
          const member = (await membershipsForUser(db, user.userId)).find((m) => m.tenantId === params.tenantId);
          if (!member) return status(404, { error: "TENANT_NOT_FOUND" });
          const scope: TenantScope = { db, user, member, request };
          return { scope };
        })
        // people and audit
        .get("/staff", ({ scope, set }) => send(set, listStaff(scope)))
        .patch("/staff/:staffId/role", ({ scope, set, params, body }) => send(set, changeRole(scope, params.staffId, body)), {
          body: roleChangeBody,
        })
        .get("/audit-events", ({ scope, set, query }) => send(set, listAuditEvents(scope, query)), { query: auditQuery })
        .get("/locations", ({ scope, set }) => send(set, listLocations(scope)))
        // catalogue
        .get("/products", ({ scope, set, query }) => send(set, listProductsRoute(scope, query)), { query: productQuery })
        .post("/products", ({ scope, set, body }) => send(set, createProductRoute(scope, body)), { body: productBody })
        .get("/products/:productId", ({ scope, set, params }) => send(set, getProductRoute(scope, params.productId)))
        .patch("/products/:productId", ({ scope, set, params, body }) => send(set, updateProductRoute(scope, params.productId, body)), {
          body: productPatchBody,
        })
        .put(
          "/products/:productId/classification",
          ({ scope, set, params, body }) => send(set, classifyProductRoute(scope, params.productId, body)),
          { body: classifyBody },
        )
        .put(
          "/products/:productId/units/:unitId/price",
          ({ scope, set, params, body }) => send(set, setPriceRoute(scope, params.productId, params.unitId, body)),
          { body: priceBody },
        )
        .post("/products/:productId/barcodes", ({ scope, set, params, body }) => send(set, addBarcodeRoute(scope, params.productId, body)), {
          body: barcodeBody,
        })
        .delete("/products/:productId/barcodes/:code", ({ scope, set, params }) =>
          send(set, removeBarcodeRoute(scope, params.productId, decodeURIComponent(params.code))),
        )
        // stock
        .get("/products/:productId/stock", ({ scope, set, params }) => send(set, stockCardRoute(scope, params.productId)))
        .post("/stock/opening-balances", ({ scope, set, body }) => send(set, openingBalanceRoute(scope, body)), {
          body: openingBalanceBody,
        })
        .put("/batches/:batchId/status", ({ scope, set, params, body }) => send(set, batchStatusRoute(scope, params.batchId, body)), {
          body: batchStatusBody,
        }),
    );
