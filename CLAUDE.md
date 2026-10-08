# pos-pharmacy — agent context

A multi-tenant **pharmacy operating system with POS** for Indonesian apotek. Greenfield.
Sibling to `pos-local/` (coffee-shop POS) and `mana-app/` (customer PWA) under
`~/Documents/personal/pos/`.

**Status: M0 Foundation done (gate G0 met, except FND-8 backups which need hosting); M1 Counter in progress: backend done, `apps/pos` next.** Read `docs/PRD.md` first, then
`docs/DOMAIN-MODEL.md`, then `docs/ARCHITECTURE.md`.

Built so far:
- pnpm workspace (`apps/*`, `packages/*`), TypeScript 7 strict, Bun test runner, CI
  (`.github/workflows/ci.yml`: typecheck + test).
- `packages/domain` — pure, I/O-free: fixed-point quantities (`numeric(18,4)` as bigint
  ten-thousandths), unit conversion (U1/U2), batch sale-blocking (B4), FEFO allocation +
  manual-override validation, ledger event rules + reference append model (L1–L5,
  idempotency, offline-conflict negatives), rebuild/reconcile, state-machine tables for
  purchase order, goods receipt and shift. Property tests cover T1, T2, T5, T6, T10.
  `test/purity.test.ts` fails the build if `src/` imports anything non-relative or reads
  the clock/randomness.
- `supabase/` — local Supabase (ports 5532x so it runs beside pos-local's 5432x), Auth with
  ES256 signing keys, SQL migrations as the schema source of truth:
  tenancy/identity/audit, catalogue/batches/ledger/balances, product classification,
  M1 shifts/sales/payments/refunds (S1-S5 in the database),
  facility profile, workstations, batch correction (`app.correct_batch`), balance rebuild,
  and a nightly pg_cron job `apotek-nightly` (00:30 WIB: expire batches, raise
  `reconciliation_issues`). Everything is in schema `app`
  (not exposed to the Data API), RLS on every table, composite `(tenant_id, id)` foreign
  keys, append-only ledger and audit, balances written only by the ledger trigger, and
  U1/B1/B2/B3/T3/L1-L4 enforced in Postgres.
- `packages/db` — `withContext()` runs each request in one transaction as role
  `apotek_api` (no BYPASSRLS) with `app.user_id/tenant_id/staff_id` set;
  `app.current_tenant_id()` only resolves for an active staff member, so a forged context
  sees nothing. Integration suite: tenant isolation over every table (G0-1), ledger
  property test against the domain reference model (G0-2), catalogue/batch rules,
  registration and audit. Skips locally without a DB, fails in CI.
- `apps/api` — Elysia. Verifies Supabase access tokens via JWKS (`src/auth.ts`), resolves
  membership and role from the DB per request. Handlers live in `src/routes/*` and return a
  `Reply`; `src/scope.ts` has `authorize` (403 + `permission.denied` audit),
  `authorizeBranch` (branch-scoped staff), `inTenant` and `audit`. Routes: `GET /health`,
  `GET /me`, `POST /tenants`; under `/tenants/:tenantId`: staff list, invitations (existing
  accounts are linked, new ones get a Supabase invite via `src/auth-admin.ts` with the
  server-only `SUPABASE_SECRET_KEY`), role, active and branch changes, facility profile,
  audit log, branches/locations/workstations, batch correction, reconciliation issues,
  CSV import (products, opening stock; all-or-nothing with per-line problems, `?dryRun=true`)
  and export (products in the import format, stock) via `src/csv.ts`, products (create with units + barcodes, list/search, get, edit,
  classification, unit price, barcodes), `GET /products/:id/stock` (stock card),
  `POST /stock/opening-balances` (needs an `Idempotency-Key` UUID header) and
  `PUT /batches/:id/status`. Counter (M1, `src/routes/counter.ts`): `POST /shifts`,
  `GET /workstations/:id/shift`, cash movements, blind close, review, shift report,
  `POST /sales` (Idempotency-Key = client sale id; FEFO under `app.lock_stock` row locks;
  offline sales use `allocateForSync` and are kept with a flagged conflict), receipt,
  void (compensating ledger rows) and refund (no restock). Non-members get 404. A product created by someone without
  `product.classify` stays unclassified and the database refuses to sell it.
  Permission matrix: `packages/domain/src/permissions.ts`, tested for all nine roles on
  every privileged route (G0-4); each audited action has a test (G0-5).
- `packages/ui` (`@apotek/ui`) — the shared design system, documented in `DESIGN.md`:
  `tokens.css` (colour tokens as `light-dark()` pairs, radius, shadows, marketing type
  scale, as a Tailwind v4 theme; dark is opt-in per app via `data-theme` on `<html>`) and primitives (Button, Chip, Panel, Segmented, Switch, Tabs,
  Stepper, Wordmark). `test/tokens.test.ts` fails if a token lacks a dark value or a
  text pair drops below WCAG AA.
- `apps/web` — landing page + interactive demo (Next.js 16, Tailwind v4, design
  direction "Klinik Tenang" chosen 6 Oct 2026, built on `@apotek/ui`). Routes: `/`
  Indonesian, `/en` English, each with its own root layout so `<html lang>` is right.
  All copy lives in `src/content/copy.ts` (Indonesian defines the shape, English must
  match). The demo (`src/demo/`) is a pure reducer over the real `@apotek/domain` (FEFO,
  units, ledger, idempotent sync), unit-tested in `engine.test.ts`, rendered
  client-only. Always light (no dark mode on the frontstore). The hero stock card and the feature-grid visuals are computed by the
  same engine. Reveal animations are CSS scroll-driven, so no content is hidden waiting
  for JS. Photos are Unsplash stand-ins (`src/assets/photos/CREDITS.md`).
  Open TODO: `PILOT_CONTACT_HREF` in `copy.ts` is a placeholder.

Not started: `packages/contracts`, stock adjustment and opname, goods receipt, held carts, counter PIN switching, `apps/pos` (builds on `DESIGN.md` + `@apotek/ui`, via
`impeccable`), prescription state machine (v1.1, needs APJ review). No hosted Supabase
project yet (needs owner approval and the D8 hosting/region decision).

---

## What this product is

> A pharmacy operating system that makes every medicine traceable from purchase to
> patient, while keeping everyday checkout fast enough for a busy retail counter.

It is **not** a POS with pharmacy fields bolted on. An apotek has two operating worlds —
retail (OTC, fast checkout) and clinical (prescription, screening, dispensing,
compounding) — and the domain model has to serve both.

Working product name: **Apotek OS** (placeholder — see `docs/PRD.md` §"Open decisions").

## Relationship to pos-local

`pos-local/` is a **reference, not a dependency**. Copy patterns, never import code:

| Borrow from pos-local | Do NOT borrow |
|---|---|
| Offline write-then-queue strategy (`src/api/client.ts`, `syncWorker.ts`) | Its single-tenant assumption — this product is multi-tenant |
| Dexie local-cache + hydration shape | Its direct stock mutation — here stock only moves via ledger events |
| Bun + Elysia + Drizzle + Supabase deployment shape | Its two-role model (`admin`/`common`) — here there are nine roles |
| Inline-validation form pattern | Its order/shift domain vocabulary — pharmacy terms are different |

---

## Hard rules

- **Never `git commit` or `git push`** — the user commits manually.
- **Never deploy** without explicit user approval.
- **Patient data is not customer data.** Clinical identity (allergies, conditions,
  medication history) lives behind stricter access control and is never logged, never
  included in analytics exports, never sent to a third party. See
  `docs/DOMAIN-MODEL.md` §"Person, Customer, Patient".
- **Stock never changes by direct mutation.** Every quantity change is an
  `inventory_ledger` event. If you find yourself writing `UPDATE ... SET quantity = ...`
  outside the balance-cache projection, stop.
- **Authorization is server-side.** Hiding a menu item is not a permission. Every
  privileged action re-checks the actor's role on the API.
- **The system never makes a clinical decision.** It surfaces warnings, runs checklists,
  and records who decided. Approval, substitution, and dose changes are always
  attributable to a pharmacist/APJ.
- **Regulatory claims need a date and a source.** The research in
  `research/apotek-pos-research-blueprint.md` reflects 6 October 2026. Do not state a
  regulatory requirement in UI copy, docs, or code comments without citing which rule
  and when it was checked. Controlled-substance and reporting behaviour must be validated
  by a licensed APJ before production.
- **Never invent clinical content.** No interaction databases, no dose tables, no
  allergy cross-reference logic written from the model's own knowledge. Those come from
  a licensed data source or they don't ship.

---

## Design, UI & UX — which skill to use where

This repo has three distinct frontend surfaces, and they do not share a skill:

| Surface | Skill | Why |
|---|---|---|
| **Admin panel / POS / back office** — every internal screen: counter, prescription queue, inventory, procurement, dashboards, settings | **`impeccable`** (`/impeccable <command>`) | Dense operational UI used under time pressure by trained staff. Impeccable's audit/critique/harden/adapt loop is the right tool. Phone-first: verify at ~390px. |
| **Marketing / landing page** | **`taste`** | Public-facing, persuasion-led, needs aesthetic range rather than an operational audit. |
| **Interactive demo / sandbox** | **`taste`** | Same reasoning as the landing page — it is a sales surface, not an operational one. |

Rules:
- Do not hand-style any of these surfaces without the matching skill.
- **One design system for every surface.** `DESIGN.md` + `packages/ui` are the source of
  truth for colour, type, radius, elevation, icons, motion and the shared primitives.
  Both skills work inside it: `impeccable` for app screens, `taste` for landing/demo.
  Don't invent colours, radii, or fonts outside it; change `tokens.css` and
  `DESIGN.md` together when the system itself has to change.
- `taste` is installed project-level (`.claude/skills/`, from `Leonxlnx/taste-skill`,
  6 Oct 2026). Use `design-taste-frontend` for landing and demo work. Its rules that
  matter most here: zero em/en dashes in visible copy, hero headline max 2 lines, max one
  eyebrow per three sections, one accent colour, no invented customers or metrics.

---

## Domain terms

`docs/PRODUCT.md` → **Glossary** is authoritative. Read it before touching any
order/prescription/stock code or copy. Terms that are routinely misread:

- **Defecta** — the running list of items that need reordering. Not a defect report.
- **Tuslah** — the compounding service fee. **Embalase** — the packaging fee. Both are
  charges added to a compounded prescription, not product prices.
- **Etiket** — the dispensing label stuck on the medicine (patient name, directions,
  date). Not a price tag, not a barcode label.
- **Racikan** — a compounded preparation made from several ingredients. Modelled as a
  BOM, consumes ingredient batches.
- **Stock opname** — physical stock count. **FEFO** — First Expired First Out, the
  default batch-allocation policy (not FIFO).
- **Batch** ≠ **product**. A product has many batches; each batch has its own expiry and
  cost.
- **Void** (transaction removed as a mistake) ≠ **refund** (money returned on a completed
  sale) ≠ **return** (goods come back, which is a stock-quarantine decision, not a
  payment one).

Add new terms to the Glossary the first time they appear.

---

## Commit guidelines

Commits split by concern — backend and frontend are always separate commits.

```
feat(backend): …     fix(backend): …     chore(backend): …
feat(frontend): …    fix(frontend): …    chore(frontend): …
feat(docs): …
```

Subject ≤72 chars, imperative, no trailing period. Body when the *why* isn't obvious.

## PR guidelines

- Base branch is `main` unless stacked on a parent feature branch.
- Every PR updates `CHANGELOG.md` under `[UNRELEASED]`, one line + PR link.
- PR body: `## Summary` / `## Changelog entry` / `## Test plan`.

---

## Commands

```bash
pnpm install
pnpm db:keys                   # once: local JWT signing key (git-ignored)
pnpm db:start                  # local Supabase: API :55321, DB :55322, Studio :55323
pnpm db:reset                  # re-apply supabase/migrations from scratch
pnpm check                     # typecheck + test, every workspace (DB tests need db:start)
pnpm --filter @apotek/domain test
pnpm --filter @apotek/api dev  # :3101, needs apps/api/.env (see .env.example)
pnpm --filter @apotek/web dev  # :3102 landing + demo
pnpm --filter @apotek/ui test  # design tokens: dark parity + WCAG AA
```

New schema change: `supabase migration new <name>`, write SQL, `pnpm db:reset`, run
`supabase db advisors --local`, keep RLS + a policy on every `app` table (the schema guard
test fails otherwise). Request code only touches the DB through `withContext`.

Domain conventions: expected business outcomes (insufficient stock, illegal transition,
inexact conversion) return `Result`; malformed input throws. "Today" is always passed in
as a `YYYY-MM-DD` in the branch's timezone — the domain never reads a clock.

## Useful paths

```
DESIGN.md                 design system (tokens, primitives, patterns)
docs/PRD.md               product requirements — read first
docs/PRODUCT.md           users, glossary, principles
docs/DOMAIN-MODEL.md      entities, state machines, ledger, units, batches
docs/USER-STORIES.md      epics → stories with acceptance criteria
docs/ARCHITECTURE.md      stack, modules, multi-tenancy, offline/sync
docs/SUCCESS-CRITERIA.md  metrics, launch gates, definition of done
docs/RISKS.md             risk register + regulatory caveats
docs/DISCOVERY-INTERVIEW.md  questions to validate with a real pharmacist
docs/roadmap.html         phased roadmap (open in a browser)
research/apotek-pos-research-blueprint.md  source research, 6 Oct 2026
```
