import { Elysia, t } from "elysia";
import { classifyDbError, membershipsForUser, registerTenant, type Sql } from "@apotek/db";
import type { AuthAdmin } from "./auth-admin";
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
import {
  activeBody,
  auditQuery,
  branchesBody,
  changeRole,
  facilityBody,
  invitationBody,
  inviteStaff,
  listAuditEvents,
  listStaff,
  readFacility,
  roleChangeBody,
  setActive,
  setBranches,
  writeFacility,
} from "./routes/staff";
import {
  batchStatusBody,
  batchStatusRoute,
  correctBatchRoute,
  correctionBody,
  openingBalanceBody,
  openingBalanceRoute,
  stockCardRoute,
} from "./routes/stock";
import {
  branchBody,
  branchPatchBody,
  createBranchRoute,
  createLocationRoute,
  createWorkstationRoute,
  issuesQuery,
  listBranchesRoute,
  listIssuesRoute,
  nameBody,
  renameLocationRoute,
  resolveBody,
  resolveIssueRoute,
  updateBranchRoute,
  updateWorkstationRoute,
  workstationPatchBody,
} from "./routes/organisation";
import type { Reply, TenantScope } from "./scope";
import {
  exportProductsRoute,
  exportStockRoute,
  importOpeningStockRoute,
  importProductsRoute,
  templateRoute,
} from "./routes/transfer";

export interface AppDeps {
  db: Sql;
  verifyToken: VerifyToken;
  authAdmin: AuthAdmin;
}

const bearerToken = (header: string | undefined) => header?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
const name = t.String({ minLength: 1, maxLength: 120 });

/** Turns a handler's Reply into the response; a ready Response (a CSV file) passes through. */
async function send(set: { status?: number | string }, pending: Promise<Reply | Response>) {
  const result = await pending;
  if (result instanceof Response) return result;
  set.status = result.status;
  return result.body;
}

const dryRunQuery = t.Object({ dryRun: t.Optional(t.String()) });

/**
 * Every privileged action is checked on the server against the role stored in the
 * database (CLAUDE.md "Authorization is server-side"). Tenant routes live under
 * /tenants/:tenantId; a tenant the caller doesn't belong to answers 404, so its
 * existence isn't revealed. Handlers live in ./routes and return a Reply.
 *
 * Built separately from `listen()` so tests drive it through `app.handle(request)`.
 */
export const createApp = ({ db, verifyToken, authAdmin }: AppDeps) =>
  // "typebox": strip unknown fields with TypeBox itself. The default (exact-mirror)
  // can't handle the nullable unions in our bodies and warns on every request.
  new Elysia({ normalize: "typebox" })
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
      if (failure?.kind === "CHECK" || failure?.kind === "FOREIGN_KEY") {
        // A value the schema refuses (min stock above max) or a reference to something
        // outside this tenant: the request is wrong, say which rule without row data.
        set.status = 422;
        return { error: failure.kind === "CHECK" ? "INVALID_VALUE" : "INVALID_REFERENCE", constraint: failure.constraint };
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
        .post("/staff/invitations", ({ scope, set, body }) => send(set, inviteStaff(scope, authAdmin, body)), { body: invitationBody })
        .patch("/staff/:staffId/active", ({ scope, set, params, body }) => send(set, setActive(scope, params.staffId, body)), {
          body: activeBody,
        })
        .put("/staff/:staffId/branches", ({ scope, set, params, body }) => send(set, setBranches(scope, params.staffId, body)), {
          body: branchesBody,
        })
        .get("/facility", ({ scope, set }) => send(set, readFacility(scope)))
        .put("/facility", ({ scope, set, body }) => send(set, writeFacility(scope, body)), { body: facilityBody })
        .get("/audit-events", ({ scope, set, query }) => send(set, listAuditEvents(scope, query)), { query: auditQuery })
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
        })
        .put("/batches/:batchId/correction", ({ scope, set, params, body }) => send(set, correctBatchRoute(scope, params.batchId, body)), {
          body: correctionBody,
        })
        .get("/reconciliation-issues", ({ scope, set, query }) => send(set, listIssuesRoute(scope, query)), { query: issuesQuery })
        .post(
          "/reconciliation-issues/:issueId/resolution",
          ({ scope, set, params, body }) => send(set, resolveIssueRoute(scope, params.issueId, body)),
          { body: resolveBody },
        )
        // CSV import and export (FND-7)
        .post("/imports/products", ({ scope, set, body, query }) => send(set, importProductsRoute(scope, body, query.dryRun === "true")), {
          parse: "text",
          query: dryRunQuery,
        })
        .post(
          "/imports/opening-stock",
          ({ scope, set, body, query }) => send(set, importOpeningStockRoute(scope, body, query.dryRun === "true")),
          { parse: "text", query: dryRunQuery },
        )
        .get("/imports/products/template.csv", () => templateRoute("products"))
        .get("/imports/opening-stock/template.csv", () => templateRoute("opening-stock"))
        .get("/exports/products.csv", ({ scope, set }) => send(set, exportProductsRoute(scope)))
        .get("/exports/stock.csv", ({ scope, set }) => send(set, exportStockRoute(scope)))
        // organisation (FND-2)
        .get("/branches", ({ scope, set }) => send(set, listBranchesRoute(scope)))
        .post("/branches", ({ scope, set, body }) => send(set, createBranchRoute(scope, body)), { body: branchBody })
        .patch("/branches/:branchId", ({ scope, set, params, body }) => send(set, updateBranchRoute(scope, params.branchId, body)), {
          body: branchPatchBody,
        })
        .post("/branches/:branchId/locations", ({ scope, set, params, body }) => send(set, createLocationRoute(scope, params.branchId, body)), {
          body: nameBody,
        })
        .patch("/locations/:locationId", ({ scope, set, params, body }) => send(set, renameLocationRoute(scope, params.locationId, body)), {
          body: nameBody,
        })
        .post(
          "/branches/:branchId/workstations",
          ({ scope, set, params, body }) => send(set, createWorkstationRoute(scope, params.branchId, body)),
          { body: nameBody },
        )
        .patch(
          "/workstations/:workstationId",
          ({ scope, set, params, body }) => send(set, updateWorkstationRoute(scope, params.workstationId, body)),
          { body: workstationPatchBody },
        ),
    );
