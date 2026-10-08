# Apotek OS

A multi-tenant **pharmacy operating system with POS** for Indonesian apotek.

> A pharmacy operating system that makes every medicine traceable from purchase to patient,
> while keeping everyday checkout fast enough for a busy retail counter.

Working product name: **Apotek OS** (placeholder, see `docs/PRD.md`).

**Status: M1 Counter in progress.** The backend foundation (M0), the counter backend (shifts,
sales, payments, receipts, void, refund) and the landing page exist; the counter app
(`apps/pos`) is next. There is no hosted environment yet: everything below
runs on your machine.

| Built | Where |
|---|---|
| Pure domain rules: quantities, units, FEFO, ledger, state machines, permission matrix | `packages/domain` |
| Database: tenancy, staff roles, audit, catalogue, batches, append-only stock ledger, all behind row-level security | `supabase/migrations` |
| Database access layer and integration tests (tenant isolation, ledger property tests) | `packages/db` |
| API: Supabase Auth tokens, nine-role permissions, catalogue, opening stock, CSV import/export, shifts and sales | `apps/api` |
| Design system "Klinik Tenang" | `packages/ui`, `DESIGN.md` |
| Landing page with an interactive demo (Indonesian and English) | `apps/web` |

---

## Getting started

### 1. Prerequisites

| Tool | Version used | Why |
|---|---|---|
| [pnpm](https://pnpm.io) | 10.x | workspace and dependencies |
| [Bun](https://bun.sh) | 1.3.9 | runs the API, the tests and scripts |
| Node.js | 24.x | Next.js (landing page) |
| [Docker](https://www.docker.com) | running | local Supabase |
| [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) | 2.109+ | local database and Auth |
| `jq` | any | only for the curl examples below |

### 2. Install and start the database

```bash
pnpm install
pnpm db:keys      # once: creates supabase/signing_keys.json (local JWT key, git-ignored)
pnpm db:start     # local Supabase in Docker; applies every migration
```

Local Supabase uses ports **5532x**, so it can run next to another Supabase project
(pos-local uses 5432x).

### 3. Start the API

```bash
cp apps/api/.env.example apps/api/.env
supabase status   # copy "Secret" (sb_secret_...) into SUPABASE_SECRET_KEY in apps/api/.env
pnpm --filter @apotek/api dev     # http://127.0.0.1:3101
```

`curl http://127.0.0.1:3101/health` should answer `{"status":"ok",...}`.

### 4. Load the demo apotek

With the database and API running:

```bash
pnpm seed:demo
```

This goes through the real API, so every rule and audit event applies. It is safe to run
twice and refuses to run against anything but localhost. It creates **Apotek Sehat Sentosa**
with three people, three products (paracetamol, vitamin C, amoxicillin) and opening stock,
including one paracetamol batch that is already expired.

### 5. The landing page (optional)

```bash
pnpm --filter @apotek/web dev     # http://127.0.0.1:3102 (Indonesian), /en (English)
```

---

## Demo accounts

All passwords are **`apotek123`**. Local only.

| Email | Role | Try |
|---|---|---|
| `pemilik@apotek.test` | OWNER | everything except clinical approval: staff, facility, prices, stock, audit log |
| `apoteker@apotek.test` | PHARMACIST (the APJ) | classify products, quarantine a batch |
| `kasir@apotek.test` | CASHIER | read products and stock; refused (403) on the audit log, and the refusal is itself audited |

New sign-ups and invitation emails land in the local mail catcher (Mailpit, below).

## Local URLs

| What | URL |
|---|---|
| API | http://127.0.0.1:3101 |
| Landing page and demo | http://127.0.0.1:3102 |
| Supabase API (Auth) | http://127.0.0.1:55321 |
| Supabase Studio (database browser; tables are in schema `app`) | http://127.0.0.1:55323 |
| Mailpit (local email) | http://127.0.0.1:55324 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:55322/postgres` |

---

## Try the API

There is no app UI for the backend yet, so these curl commands are the way to look around.
Sign in through Supabase Auth, then call the API with the access token.

```bash
PUBLISHABLE_KEY=$(supabase status -o json | jq -r .PUBLISHABLE_KEY)
signin() {
  curl -s "http://127.0.0.1:55321/auth/v1/token?grant_type=password" \
    -H "apikey: $PUBLISHABLE_KEY" -H "content-type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"apotek123\"}" | jq -r .access_token
}
TOKEN=$(signin pemilik@apotek.test)
API=http://127.0.0.1:3101
auth=(-H "authorization: Bearer $TOKEN")

# Who am I, and in which apotek
curl -s $API/me "${auth[@]}" | jq
TENANT=$(curl -s $API/me "${auth[@]}" | jq -r '.memberships[0].tenantId')

# Products (search by brand, generic name, SKU or exact barcode)
curl -s "$API/tenants/$TENANT/products?q=paracetamol" "${auth[@]}" | jq '.products[] | {sku, brandName, sellable}'

# Stock card: batches by expiry. PCT-24A11 still holds 30 tablets but is expired, so not sellable
PRODUCT=$(curl -s "$API/tenants/$TENANT/products?q=PCT-500" "${auth[@]}" | jq -r '.products[0].id')
curl -s "$API/tenants/$TENANT/products/$PRODUCT/stock" "${auth[@]}" | jq '.batches[] | {batchNumber, expiryDate, onHand, sellable}'

# Audit log (owner or auditor only)
curl -s "$API/tenants/$TENANT/audit-events?limit=10" "${auth[@]}" | jq '.events[] | {action, entityType, createdAt}'

# Same call as the cashier: 403, and the attempt shows up in the owner's audit log
curl -s "$API/tenants/$TENANT/audit-events" -H "authorization: Bearer $(signin kasir@apotek.test)"

# CSV: stock export, and the import templates
curl -s "$API/tenants/$TENANT/exports/stock.csv" "${auth[@]}"
curl -s "$API/tenants/$TENANT/imports/products/template.csv" "${auth[@]}"
```

Writes that create stock need an `Idempotency-Key` header with a UUID (sending the same
request twice records it once):

```bash
curl -s -X POST "$API/tenants/$TENANT/stock/opening-balances" "${auth[@]}" \
  -H "content-type: application/json" -H "idempotency-key: $(uuidgen)" \
  -d "{\"locationId\":\"$(curl -s $API/tenants/$TENANT/branches "${auth[@]}" | jq -r '.branches[0].locations[0].locationId')\",
       \"productId\":\"$PRODUCT\",
       \"lines\":[{\"unitId\":\"$(curl -s $API/tenants/$TENANT/products/$PRODUCT "${auth[@]}" | jq -r '.units[] | select(.name=="box") | .id')\",
                   \"qty\":\"1\",\"batchNumber\":\"PCT-NEW-1\",\"expiryDate\":\"2028-01-31\"}]}" | jq
```

### Ring up a sale

The demo has a counter workstation, **Kasir 1**. As the cashier: open a shift, sell 2 strips
of paracetamol for cash, and read the receipt. FEFO skips the expired batch and takes 14
tablets from the batch expiring soonest and 6 from the next one.

```bash
PUBLISHABLE_KEY=$(supabase status -o json 2>/dev/null | jq -r .PUBLISHABLE_KEY)
signin() {
  curl -s "http://127.0.0.1:55321/auth/v1/token?grant_type=password" \
    -H "apikey: $PUBLISHABLE_KEY" -H "content-type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"apotek123\"}" | jq -r .access_token
}
API=http://127.0.0.1:3101
CASHIER=(-H "authorization: Bearer $(signin kasir@apotek.test)")
TENANT=$(curl -s $API/me "${CASHIER[@]}" | jq -r '.memberships[0].tenantId')
BRANCH=$(curl -s $API/tenants/$TENANT/branches "${CASHIER[@]}" | jq '.branches[0]')
WORKSTATION=$(echo "$BRANCH" | jq -r '.workstations[] | select(.name=="Kasir 1") | .workstationId')
LOCATION=$(echo "$BRANCH" | jq -r '.locations[0].locationId')

# Open a shift with Rp 200.000 in the drawer (skip if Kasir 1 already has one)
SHIFT=$(curl -s $API/tenants/$TENANT/workstations/$WORKSTATION/shift "${CASHIER[@]}" | jq -r '.shift.shiftId // empty')
if [ -z "$SHIFT" ]; then
  SHIFT=$(uuidgen)
  curl -s -X POST $API/tenants/$TENANT/shifts "${CASHIER[@]}" -H "content-type: application/json" \
    -d "{\"shiftId\":\"$SHIFT\",\"workstationId\":\"$WORKSTATION\",\"openingFloat\":200000}" | jq '{status, openingFloat}'
fi

# Sell 2 strips of paracetamol, paid Rp 10.000 cash
PCT=$(curl -s "$API/tenants/$TENANT/products?q=PCT-500" "${CASHIER[@]}" | jq '.products[0]')
SALE=$(uuidgen)
curl -s -X POST $API/tenants/$TENANT/sales "${CASHIER[@]}" -H "content-type: application/json" -H "idempotency-key: $SALE" \
  -d "{\"saleId\":\"$SALE\",\"receiptNo\":\"K1-$(date +%H%M%S)\",\"workstationId\":\"$WORKSTATION\",\"shiftId\":\"$SHIFT\",
       \"locationId\":\"$LOCATION\",
       \"lines\":[{\"productId\":$(echo "$PCT" | jq .id),\"unitId\":$(echo "$PCT" | jq '.units[] | select(.name=="strip") | .id'),\"qty\":\"2\",\"unitPrice\":4500}],
       \"payments\":[{\"method\":\"CASH\",\"tendered\":10000}]}" | jq

# The receipt: which batches the 20 tablets came from (the expired one is skipped)
curl -s $API/tenants/$TENANT/sales/$SALE/receipt "${CASHIER[@]}" | jq '{receiptNo, total, changeDue, lines: [.lines[] | {product, unit, qty, batches}]}'
```

Closing the shift is blind: send only the counted cash, the verdict comes back after.

```bash
curl -s -X POST $API/tenants/$TENANT/shifts/$SHIFT/close "${CASHIER[@]}" -H "content-type: application/json" \
  -d '{"countedCash":209000}' | jq '{outcome, expected: .shift.expectedCash, variance: .shift.variance}'
```

The full route list is in `CLAUDE.md` (`apps/api`) and `apps/api/src/app.ts`.

### Nightly job

A pg_cron job runs at 00:30 WIB: it marks expired batches `EXPIRED` and records any
balance that disagrees with its ledger. To run it now:

```bash
psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -c "select app.run_nightly()"
```

---

## Tests

```bash
pnpm check        # typecheck + every test suite
```

| Suite | Needs the database | Covers |
|---|---|---|
| `packages/domain` | no | units, FEFO, ledger rules (property tests), state machines, permissions |
| `packages/db` | yes | tenant isolation across every table, ledger vs the domain model, catalogue and batch rules, nightly jobs |
| `apps/api` | yes | auth, every route for all nine roles, audit events, CSV |
| `packages/ui` | no | design tokens: dark-mode parity and WCAG AA contrast |
| `apps/web` | no | the landing-page demo engine |

Database suites skip with a warning when local Supabase isn't running, and fail in CI,
which starts Postgres with every migration (`.github/workflows/ci.yml`).

## Repository map

```
apps/
  api/          Elysia API (Bun)            src/routes/*, src/scope.ts (permissions, audit)
  web/          Next.js landing page + demo
packages/
  domain/       pure business rules, no I/O
  db/           database access inside row-level security + integration tests
  ui/           design system (tokens + primitives)
supabase/       config.toml, migrations/ (the schema is SQL, the source of truth)
scripts/        seed-demo.ts
docs/           product and engineering documents (below)
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `supabase start` fails about `signing_keys.json` | run `pnpm db:keys` |
| A port is taken | another Supabase project or app is using it; ports are in `supabase/config.toml` |
| API says `SUPABASE_SECRET_KEY is not set` | create `apps/api/.env` from `.env.example` (step 3) |
| Start from a clean database | `pnpm db:reset` (re-applies migrations, wipes data), then `pnpm seed:demo` |
| Landing page answers 404 on `/` | a long-running `next dev` went stale (for example after a `next build`); stop it and run `pnpm --filter @apotek/web dev` again |
| `supabase migration new` hangs | the CLI's telemetry can stall after the file is written; check `supabase/migrations/` and stop it |

---

## Documents

| # | Document | What it answers |
|---|---|---|
| 1 | [docs/PRD.md](docs/PRD.md) | What we are building, for whom, why, and what is out of scope |
| 2 | [docs/PRODUCT.md](docs/PRODUCT.md) | Who uses it, what the words mean (glossary), what we won't compromise on |
| 3 | [docs/DOMAIN-MODEL.md](docs/DOMAIN-MODEL.md) | Entities, state machines, the inventory ledger, units, batches |
| 4 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, module boundaries, multi-tenancy, offline/sync, security |
| 5 | [DESIGN.md](DESIGN.md) | The design system every screen uses |
| 6 | [docs/USER-STORIES.md](docs/USER-STORIES.md) | Epics, stories and acceptance criteria, by role |
| 7 | [docs/roadmap.html](docs/roadmap.html) | Phases and milestones (open in a browser) |
| 8 | [docs/SUCCESS-CRITERIA.md](docs/SUCCESS-CRITERIA.md) | Product, business and engineering gates |
| 9 | [docs/RISKS.md](docs/RISKS.md) | What could sink this, and the mitigation for each |
| 10 | [docs/DISCOVERY-INTERVIEW.md](docs/DISCOVERY-INTERVIEW.md) | Questions for a real pharmacist |

Source research: [research/apotek-pos-research-blueprint.md](research/apotek-pos-research-blueprint.md)
(prepared 6 October 2026; regulatory content has a shelf life).

## The one-paragraph version

An apotek is not a normal shop. The same product is bought by the box and sold by the
tablet. It exists in several batches, each with its own expiry date and its own cost. Some
items need a prescription, which means a patient, a prescriber, a clinical screening, and a
pharmacist's recorded decision before anything is handed over. Compounded prescriptions
consume measured quantities of several ingredients. Controlled medicines need stronger
authorisation and a reconcilable ledger. All of that has to stay traceable from purchase
order to patient, while the counter still has to ring up a bottle of vitamins in four
seconds.

MVP v1 is the **lean core**: product/unit/batch/ledger, OTC counter, payment and cash
shift, purchasing and goods receipt. Prescription, dispensing and compounding land in v1.1:
modelled from day one, shipped second.

**In scope, eventually:** POS, inventory with batch/expiry/FEFO, procurement and payables,
prescription and dispensing, compounding, controlled-medicine control and reporting,
multi-branch, analytics, audit trail, SATUSEHAT/KFA integration.
**Never:** hospital EMR, doctor appointments, lab systems, diagnostic AI, automated clinical
substitution, full accounting ERP, insurance claims engine.

Open decisions (product name, pricing, hosting region, staging) are in `docs/PRD.md` §11.

## Conventions

- Backend and frontend changes go in separate commits; every PR updates `CHANGELOG.md`.
- Schema changes: `supabase migration new <name>`, then `pnpm db:reset`; every table in
  `app` needs row-level security (a test enforces it).
- App screens are designed with the `impeccable` skill, the landing page with `taste`,
  both inside `DESIGN.md`. See `CLAUDE.md`.
