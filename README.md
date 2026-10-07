# pos-pharmacy

Product documentation for a multi-tenant **pharmacy operating system with POS**, built for
Indonesian apotek.

> A pharmacy operating system that makes every medicine traceable from purchase to patient,
> while keeping everyday checkout fast enough for a busy retail counter.

**Status: M0 Foundation in progress.** Built: the pure domain core (`packages/domain`), the
database (Supabase, `supabase/migrations`: tenancy, roles, audit, catalogue, batches, ledger,
all behind row-level security) with its access layer and integration tests (`packages/db`),
an API that verifies Supabase Auth tokens and enforces the role matrix (`apps/api`), the
design system (`packages/ui`, see `DESIGN.md`) and the landing page with an interactive demo
(`apps/web`). See `CLAUDE.md` for detail.

```bash
pnpm install
pnpm db:keys && pnpm db:start   # local Supabase (Docker)
pnpm check                      # typecheck + every test suite
```

Working product name: **Apotek OS** (placeholder — see `docs/PRD.md`).

---

## Read in this order

| # | Document | What it answers |
|---|---|---|
| 1 | [docs/PRD.md](docs/PRD.md) | What are we building, for whom, why, and what is explicitly out of scope |
| 2 | [docs/PRODUCT.md](docs/PRODUCT.md) | Who uses it, what the words mean, what we refuse to compromise on |
| 3 | [docs/DOMAIN-MODEL.md](docs/DOMAIN-MODEL.md) | Entities, state machines, the inventory ledger, units, batches |
| 4 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, module boundaries, multi-tenancy, offline/sync, security |
| 5 | [docs/USER-STORIES.md](docs/USER-STORIES.md) | Epics → stories → acceptance criteria, by role |
| 6 | [docs/roadmap.html](docs/roadmap.html) | Phases, milestones, sequencing (open in a browser) |
| 7 | [docs/SUCCESS-CRITERIA.md](docs/SUCCESS-CRITERIA.md) | How we know it worked — product, business, and engineering gates |
| 8 | [docs/RISKS.md](docs/RISKS.md) | What could sink this, and the mitigation for each |
| 9 | [docs/DISCOVERY-INTERVIEW.md](docs/DISCOVERY-INTERVIEW.md) | Questions to put to a real pharmacist before coding deeply |

Source research: [research/apotek-pos-research-blueprint.md](research/apotek-pos-research-blueprint.md)
(prepared 6 October 2026 — regulatory content has a shelf life).

---

## The one-paragraph version

An apotek is not a normal shop. The same product is bought by the box and sold by the
tablet. It exists in several batches, each with its own expiry date and its own cost. Some
items need a prescription, which means a patient, a prescriber, a clinical screening, and a
pharmacist's recorded decision before anything is handed over. Compounded prescriptions
consume measured quantities of several ingredients. Controlled medicines need stronger
authorisation and a reconcilable ledger. All of that has to stay traceable from purchase
order to patient — while the counter still has to ring up a bottle of vitamins in four
seconds. Existing Indonesian pharmacy software covers this unevenly; generic POS software
doesn't attempt it.

MVP v1 is the **lean core**: product/unit/batch/ledger, OTC counter, payment and cash
shift, purchasing and goods receipt. Prescription, dispensing, and compounding land in
v1.1 — modelled from day one, shipped second.

---

## Scope boundary (short version)

**In, eventually:** POS, inventory with batch/expiry/FEFO, procurement and AP, prescription
and dispensing, compounding, controlled-medicine control and reporting, multi-branch,
analytics, audit trail, SATUSEHAT/KFA integration.

**Never:** hospital EMR, doctor appointments, lab information systems, diagnostic AI,
automated clinical substitution, full accounting ERP, insurance claims engine.

---

## Not yet decided

See the *Open decisions* section of `docs/PRD.md`. The big ones: product name, pricing
model, whether design partner #1 is a single apotek or a small chain, and whether
controlled-medicine reporting ships as export-only or waits for an official API.

---

## Conventions

- Never commit or push — the user does that manually.
- Backend and frontend changes go in separate commits.
- Every PR updates `CHANGELOG.md`.
- Admin/POS UI goes through the `impeccable` skill; landing page and demo go through
  `taste`. See `CLAUDE.md`.
