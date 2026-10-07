# Architecture

Status: proposal v0.1 · 6 Oct 2026. Items needing the owner's decision are in `PRD.md` §11. Where this doc says "default", the owner can overrule it without changing the rest.

## 1. Principles

1. **Domain first, screens second.** Build entities → ledger → transaction engine → state machines → permissions → API → UI → reports → integrations.
2. **Ledger, not mutation.** Stock changes only by inserting `inventory_ledger` events. Balances are a projection.
3. **Explicit state machines.** Prescription, PO, goods receipt, return, recall, shift, and sync job statuses are single enum columns with a controlled transition table. No piles of booleans.
4. **Immutable sensitive history.** Ledger, audit events, prescription status transitions, dispense events, financial transactions are append-only.
5. **Server-side authorization** on every route; the UI only mirrors it.
6. **Separate internal identity from external identifiers.** `sku` ≠ `kfa_code` ≠ `bpom_nie`.
7. **Patient data is a separate, restricted domain.**
8. **Offline-safe by construction:** idempotency keys and deterministic IDs on every client-originated write.

## 2. Stack (proposed default: same as pos-local)

| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Bun** | Already running in prod for pos-local |
| API | **Elysia** + TypeBox | Typed validation, same patterns |
| Migrations | **Supabase CLI SQL migrations** (`supabase/migrations`) | RLS policies, triggers and SECURITY DEFINER functions are first-class in SQL. Decided 6 Oct 2026 |
| Queries | **postgres.js** in `packages/db`; Drizzle when the first CRUD module lands | Typed query builder once there is enough query surface to justify it |
| Database | **Postgres** (Supabase) | RLS for tenant isolation; Auth/Storage available |
| Frontend | **React + Vite + TypeScript + Tailwind** | Same; PWA |
| Local store | **Dexie (IndexedDB)** | Same offline model |
| Auth | **Supabase Auth** (decided 6 Oct 2026, A1) | Identity only. The API verifies access tokens against the project JWKS; roles come from `app.staff_members`, never token claims |
| Hosting | Fly.io (API) + Supabase (DB) + Vercel (web) | Same shape; see D8 for data-residency review |
| Printing | ESC/POS over Web Serial / Web USB / browser print fallback | Thermal receipts and etiket |
| Package manager | pnpm | Same |

Single-tenant `pos-local` code is **not imported**. Patterns are copied; there is no shared package in v1.

## 3. Repository layout (when code starts)

```
pos-pharmacy/
├── apps/
│   ├── api/                  Bun + Elysia
│   ├── pos/                  counter + back-office PWA (impeccable)
│   └── web/                  landing + demo (taste)
├── packages/
│   ├── domain/               pure TS: entities, state machines, unit math, FEFO, permissions
│   ├── db/                   request-scoped DB access (RLS context) + integration tests
│   ├── ui/                   design system (DESIGN.md)
│   └── contracts/            shared request/response types
├── supabase/                 config, SQL migrations (schema, RLS, triggers)
├── docs/  research/
```

`packages/domain` has **no** I/O imports. It is where FEFO allocation, unit conversion and state-transition tables live, so they can be exhaustively unit-tested.

## 4. Backend module boundaries

```
domain/
  tenancy/   identity/   permissions/   audit/
  products/  inventory/  procurement/   payments/
  cashier/   sales/      reports/       sync/
  -- v1.1 --
  patients/  prescriptions/  dispensing/  compounding/
  -- phase 2 --
  controlled/  returns/  recall/  destruction/  integrations/
```

Rules: modules talk through service interfaces; only `inventory/` writes the ledger; only `audit/` writes audit events (others call it); no module reads another module's tables directly.

## 5. Multi-tenancy

- **Shared schema, `tenant_id` on every row** (decision D7). Tables live in schema `app`, which is not exposed through the Supabase Data API; the Elysia API is the only way in.
- **Postgres Row-Level Security on every table.** The API connects as `postgres` but runs each request in one transaction that sets `app.user_id`, `app.tenant_id`, `app.staff_id` and does `SET LOCAL ROLE apotek_api`, a role without `BYPASSRLS` (`packages/db` `withContext`). Policies compare `tenant_id` with `app.current_tenant_id()`, which only returns the tenant when the user is an *active* staff member of it under that staff id, so a forged or stale context (an API bug, a removed employee) sees nothing.
- **Composite foreign keys** `(tenant_id, parent_id)` everywhere, so a row can never point into another tenant.
- Cross-tenant operations are a short list of `SECURITY DEFINER` functions (tenant registration, the ledger balance trigger).
- A **tenant-isolation test suite** runs in CI: for every table and endpoint, a user from tenant A cannot read or write tenant B.
- Branch scoping is a second layer: users carry allowed branch IDs; branch-level roles filter queries.
- Per-tenant config (units defaults, tax, expiry bands, discount limits) lives in a `tenant_settings` table.

## 6. Inventory ledger design

```
inventory_ledger(
  id, tenant_id, branch_id, location_id,
  product_id, batch_id,
  qty_delta_base,           -- signed integer/decimal in base units
  unit_context,             -- e.g. {unit:'strip', qty:2} for display only
  event_type,               -- enum, see DOMAIN-MODEL
  reference_type, reference_id,
  reason, actor_id, created_at,
  idempotency_key           -- unique per tenant
)
```

- Insert-only. Corrections are **new compensating events**. Enforced in Postgres: append-only triggers, no `UPDATE`/`DELETE` grant, sign rules as a check constraint.
- `inventory_balance(tenant, branch, location, product, batch, on_hand, reserved)` is maintained transactionally in the same commit as the ledger insert (an `AFTER INSERT` trigger, `app.apply_ledger_event`, the only writer; it also enforces L3/L4 and T3) and has a **rebuild-from-ledger** job (`app.rebuild_balances`) plus a nightly **reconciliation check** (pg_cron `apotek-nightly`, 00:30 WIB, also materialises expiry); a mismatch becomes a row in `app.reconciliation_issues`, the future Critical Action Center item.
- Allocation (FEFO) runs inside the sale/dispense transaction with row locks on candidate batch balances to prevent double-allocation.
- Period close: after close, back-dated events are rejected; fixes use privileged adjustments dated in the open period.

## 7. Transaction engine

A sale commit is one DB transaction:

1. validate shift open, permissions, product sale-restriction;
2. allocate batches (FEFO or authorised override);
3. insert `sale`, `sale_items`, `sale_item_batch_allocations`;
4. insert ledger events and update balances;
5. insert `payments`;
6. insert `audit_event` where applicable;
7. return receipt payload.

Idempotency: `POST /sales` requires `Idempotency-Key`; a repeat returns the original result.

Payment state is independent of stock posting: a reversed/failed payment produces compensating events, not edits.

## 8. State machines

Defined in `packages/domain` as transition tables, with API endpoints that request a transition (never set a status). Each transition records actor, time, reason into an append-only `*_status_history` table.

Prescription (v1.1): `RECEIVED → SCREENING → (AVAILABILITY | INTERVENTION/HOLD) → PICKING → [COMPOUNDING] → FINAL_CHECK → PAYMENT → READY → DISPENSED` with `CANCELLED` and `PARTIALLY_DISPENSED` branches. Full table in `DOMAIN-MODEL.md`.

## 9. Offline-first and sync

Pattern lifted from `pos-local` (write-to-backend-first with timeout, else queue) but upgraded for stock correctness:

```
POS UI → local domain layer (Dexie) → outbox queue → sync worker → API
                ▲                                               │
                └────────────── hydration (delta pull) ◄────────┘
```

- **Local cache:** products, units, barcodes, prices, batch balances for the workstation's branch, customers, shift state.
- **Outbox:** each sale/payment/shift event has a client UUID (deterministic transaction ID) and idempotency key. Replays are no-ops.
- **Conflict policy (stock):** the server is authoritative. If an offline sale references a batch that is now empty/blocked, the server re-allocates by FEFO from remaining batches; if total stock is insufficient the sale is **accepted but flagged** `CONFLICT_NEGATIVE` (the goods already left the shelf and the customer already paid) and surfaces as a Critical Action Center item for a human to reconcile. The sale is **never silently dropped**.
- **Conflict policy (price/product edits):** last-write-wins by server timestamp, audited.
- **Blocked offline:** prescription approval for controlled medicine, refunds above threshold, anything needing a fresh recall/status check show "requires connection". **[VALIDATE]**
- **Sync state** shown per transaction and as a global indicator (`pending / synced / conflict / failed`).
- **Safety:** local data encrypted-at-rest is not available in IndexedDB; therefore **patient data is never cached offline in v1.1** unless a security review approves a design. Counter-only data is cached.

## 10. Security and privacy

- Passwords hashed (argon2/bcrypt); short-lived access tokens + refresh; per-device session list.
- Roles resolved server-side from the DB per request (not trusted from the token). A deactivated staff member is locked out on their next request even though their token is still valid.
- Permission matrix is data (`role_permissions`) with a default seed and per-tenant overrides limited to non-critical actions.
- **Patient domain:** separate schema/tables; every read is access-logged; excluded from logs, analytics exports, error reports, and demo data.
- Prescription images/documents in private object storage with signed, short-lived URLs.
- Rate limiting; brute-force lockout; audit of failed privileged attempts.
- Secrets in environment only; never in the client bundle.
- Backups encrypted; restore rehearsed quarterly.
- UU PDP (personal-data law) and health-data handling reviewed by counsel before v1.1 patient features go live. **[VALIDATE]**

## 11. Search

PRD-8 requires <150 ms p95 on 20k SKUs offline. Approach: build a normalised search index in the browser (token + n-gram, with fields: brand, generic, strength, form, barcode, SKU, KFA), rebuilt from Dexie on hydration; barcode lookup is a direct index hit. Server-side Postgres `pg_trgm` for back-office search.

## 12. Reporting

- Read models are SQL views / materialised views refreshed on schedule for heavy dashboards; the counter never reads them.
- Every figure on the dashboard links to the underlying rows ("explain this number").
- Patient-level data is excluded from all aggregate reports in v1.

## 13. Integrations (phased)

| Integration | Phase | Approach |
|---|---|---|
| Thermal printer (ESC/POS) | M1 | Web Serial/USB; browser-print fallback |
| QRIS | M1 manual confirm; later processor | Record method + reference; no processor in v1 |
| SATUSEHAT / KFA | Phase 2 | Separate `integrations/` module with its own event log and retry; internal SKU never replaced by KFA |
| SIPNAP | Phase 2 | **Ledger + export first.** No API integration unless official support is confirmed |
| WhatsApp | Phase 2 | Provider abstraction; digest, not spam |
| Accounting | Phase 2 | Export (CSV/Journal) hooks |

## 14. Testing strategy (summary)

- **Pure-domain unit tests** for unit conversion, FEFO, state machines, rounding.
- **Property tests** for the ledger: any sequence of valid events keeps `balance == sum(ledger)` and `on_hand ≥ 0`.
- **Integrity-rule tests** from blueprint §60 as CI gates.
- **Tenant-isolation suite** across every route.
- **Offline simulation**: induced disconnects, duplicate replays, two-workstation last-unit race.
- **E2E (Playwright)** for counter happy path, shift blind close, goods receipt.
- **Mobile viewport** checks at ~390 px for owner/stock-count screens.

## 15. Deployment

- Environments: local → production. A staging environment is **recommended** here (unlike pos-local) because tenants hold live pharmacy data; decision to confirm.
- Migrations are forward-only; destructive migrations need a backup first; ledger/audit tables are never truncated.
- Backups: daily + pre-migration; documented restore.

## 16. Open architecture questions

| # | Question | Default |
|---|---|---|
| A1 | Supabase Auth vs app-managed auth | **Decided 6 Oct 2026: Supabase Auth.** Identity only; roles and tenant membership from the DB. Shared-device PIN switching at the counter is still open (M1) |
| A2 | Decimal quantities (ml, g, partial tablet) | Store base quantity as `numeric(18,4)` |
| A3 | Event sourcing vs ledger + projection | Ledger + transactional projection (simpler, enough) |
| A4 | Staging environment | Yes |
| A5 | Data residency / hosting region for health data | Singapore default; **[VALIDATE]** with counsel |
| A6 | Patient-data offline cache | Not in v1.1 |
