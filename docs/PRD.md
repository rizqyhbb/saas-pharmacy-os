# Product Requirements Document — Apotek OS

| | |
|---|---|
| **Status** | Draft v0.1 for owner review |
| **Date** | 6 October 2026 |
| **Owner** | rizqyhbb |
| **Market** | Indonesia |
| **Source research** | `research/apotek-pos-research-blueprint.md` (6 Oct 2026) |
| **Companion docs** | PRODUCT.md · DOMAIN-MODEL.md · ARCHITECTURE.md · USER-STORIES.md · roadmap.html · SUCCESS-CRITERIA.md · RISKS.md · DISCOVERY-INTERVIEW.md |

> **Domain caveat.** This is a product and software-design document, not legal or pharmacy-practice advice. Every regulatory statement below is drawn from the research blueprint as of 6 Oct 2026 and must be validated with a licensed Indonesian pharmacist (APJ) and current regulatory counsel before production use. Where a requirement depends on that validation it is tagged **[VALIDATE]**.

---

## 1. Summary

Apotek OS is a multi-tenant, offline-capable **pharmacy operating system with a POS counter** for Indonesian apotek. It models what a generic POS cannot: multi-unit products (box → strip → tablet), batch-level stock with expiry and FEFO allocation, prescription workflows with pharmacist sign-off, compounding (racikan), controlled-medicine traceability, and supplier procurement tied to accounts payable.

It is sold as SaaS to independent apotek and small chains. We build it on the stack already proven by `pos-local` (Bun + Elysia + Drizzle + Postgres; React + Vite + Dexie offline PWA), which de-risks the offline-first counter — the hardest infrastructure problem — before the pharmacy-specific domain work begins.

**MVP v1 is the lean core:** product/unit/batch/ledger, OTC counter, payment and cash shift, purchasing and goods receipt, owner reports, audit and roles. **Prescription, dispensing and compounding ship in v1.1**, but the data model, permissions and ledger are designed for them from day one so v1.1 is additive, not a rewrite.

---

## 2. Problem

### 2.1 What is broken today

Indonesian apotek sit between two worlds that existing tools serve unevenly:

1. **Generic retail POS** (Moka, Pawoon, spreadsheet-plus-cashier-app) handles barcode → cart → payment → receipt but has no concept of batches, expiry, unit conversion, prescriptions, or controlled stock. Pharmacies using them keep the real records on paper or in spreadsheets, so the POS and the truth drift apart.
2. **Incumbent pharmacy software** (Apotika, Farmadigi, Vmedis, Macha, Mitra Apotek Digital, GPOS Lite, etc.) covers the domain but is typically feature-menu-heavy, desktop-era in feel, and inconsistent on offline behaviour, explainable procurement, and owner-level insight.

### 2.2 Who feels it

| Person | Pain |
|---|---|
| **Owner** | Cannot answer "how much money is sitting in stock that will expire?", "which supplier is hurting me?", "what is my real margin?" without a weekend of spreadsheets. |
| **APJ / pharmacist** | Prescription work is recorded inconsistently; sign-off isn't enforced by the system; controlled-medicine reconciliation is manual and error-prone. |
| **Cashier** | A tool built for prescriptions slows down a simple vitamin sale; a tool built for retail can't handle "sell 6 tablets from a strip". |
| **Purchasing / warehouse** | Defecta (reorder list) is a notebook; goods receipt skips batch/expiry capture; invoices and payables live elsewhere. |

### 2.3 Why now

- **BPOM Regulation 5/2026** (effective 6 Apr 2026) replaced BPOM 24/2021 and sets current rules for medicine management in pharmacy facilities, including traceable prescription records (min. 5-year retention), returns, destruction, and controlled-medicine handling. Older guides and software still reference 24/2021. **[VALIDATE]**
- **SATUSEHAT**: Kemenkes lists apotek among facilities required to integrate with the national health-data platform under the electronic medical-record framework (Permenkes 24/2022). Interoperability (NRN lookup, `MedicationDispense`, KFA product codes) will become table stakes. **[VALIDATE]**
- Indonesian pharmacy platforms now market **offline POS, batch/FEFO, mobile stock opname and online prescription flows** as baseline. A new entrant must at least match that and win on clarity, traceability and owner insight.

---

## 3. Vision and positioning

> **A pharmacy operating system that makes every medicine traceable from purchase to patient, while making everyday checkout fast enough for a busy retail counter.**

### Six promises

1. **Fast at the counter** — OTC and simple sales feel like a modern retail POS.
2. **Safe for prescriptions** — the system guides, records and escalates; it never replaces the pharmacist's judgment.
3. **Accurate inventory** — batch, expiry, unit and cost remain explainable at any point.
4. **Operationally connected** — purchasing, receiving, stock opname, returns, shifts, cash and payables are one system, not five.
5. **Owner-friendly** — dashboard answers decisions ("Rp 14.7M at expiry risk"), not vanity counts.
6. **Compliance-ready** — audit trail, prescription history and controlled-stock ledger are first-class, with integrations to follow.

### Differentiators (what we bet on)

| # | Differentiator | Why it can win |
|---|---|---|
| 1 | **One traceability graph** — click any batch to see source, receipts, current location, which sales/dispenses consumed it, and any return/recall/destruction | Most competitors bury batch in a warehouse report |
| 2 | **Action-oriented owner dashboard** | Replaces 50 charts with "what needs me today" |
| 3 | **Pharmacist-safe workflow** — server-enforced role boundaries | Cashier cannot flip a prescription status |
| 4 | **Offline-first counter** with explicit sync states | Proven pattern from `pos-local` |
| 5 | **Explainable procurement** — every reorder suggestion shows its formula | No black-box "AI recommendation" |
| 6 | **Search that understands pharmacy** — brand, generic, strength, form, barcode, KFA, SKU | Daily-use speed advantage |

We do **not** try to win on number of menus.

---

## 4. Target customers and users

### 4.1 Customer segments (who buys)

| Segment | Description | Priority |
|---|---|---|
| **Independent apotek** | 1 location, owner often also the APJ or closely tied to one | **Beachhead** |
| **Small chain** | 2–10 branches, central purchasing desire, branch manager layer | Phase 2 target |
| **Apotek inside a clinic** | Shares premises with a klinik; needs tighter Rx flow | Opportunistic |

Not targeted at v1: hospital pharmacies (installatie farmasi), large chains with existing ERP.

### 4.2 Users (who uses it)

Nine roles; full definitions in `PRODUCT.md`.

| Role | Primary job in the product |
|---|---|
| Owner / Super Admin | Insight, configuration, money |
| Branch Manager | Branch operations and reports |
| **Pharmacist / APJ** | Prescription screening, dispensing approval, controlled-stock sign-off |
| Pharmacy Technician (TTK) | Prepare/pick, receive goods, inventory ops within limits |
| Cashier | OTC sale, payment, receipt; limited post-approval Rx checkout |
| Purchasing | Suppliers, PO, invoices, AP |
| Warehouse | Receive, move, count |
| Finance | Payments, AP/AR, expenses |
| Auditor (read-only) | Reports and audit trail, no mutation |

---

## 5. Goals and non-goals

### 5.1 Goals

**G1. Prove the core loop.** `sale → stock → batch → expiry → purchase → profit` works end-to-end, correctly, for a real pharmacy, on a real counter.

**G2. Make stock trustworthy.** Every quantity is derivable from the ledger; no screen can change stock without leaving an event.

**G3. Never stop the counter.** OTC sales, payment and receipt continue through an internet outage and reconcile without silent conflict.

**G4. Give the owner decisions, not charts.** Expiry-at-risk value, gross margin by SKU, stockouts and supplier performance visible without export.

**G5. Be additive to prescriptions.** v1.1 prescription/dispensing/compounding should need new modules and screens, not a re-architecture of inventory, permissions or audit.

**G6. Be sellable as SaaS.** Tenant isolation, onboarding, import, per-tenant configuration, and billing hooks exist before the second customer.

### 5.2 Non-goals

Explicitly **not** in v1 or v1.1, and several never:

- Full hospital EMR · doctor appointments · laboratory information system
- Diagnostic AI, autonomous prescription approval, automated clinical substitution, autonomous interaction decisions
- Full accounting ERP (we expose AP/AR and export hooks; we are not a general ledger product)
- Insurance / BPJS claims engine
- Social-commerce marketplace
- Authoring clinical content (interaction databases, dose tables) from model knowledge — only licensed data sources, if at all
- Heavy per-pharmacy configuration before the core workflow is stable

---

## 6. Scope by release

### 6.1 MVP v1 — "Lean core" (the first thing a pharmacy can run on)

| Area | Included |
|---|---|
| **Foundation** | Tenant/org/branch/workstation, users, 9 roles, server-side permissions, audit trail, CSV import/export, backups |
| **Product master** | Product, base unit + unit conversions, barcodes (multi), price per unit, sales-restriction class (OTC / OTC-limited / Rx-required / controlled flag), KFA code + BPOM NIE fields (stored, not synced) |
| **Inventory** | Batch + expiry, FEFO allocation (manual override with reason), immutable stock ledger, balances projection, stock opname with variance approval, expiry bands and blocked-for-sale states |
| **Counter** | Search/scan, cart, unit selection, discounts (permissioned), payment (cash, QRIS, transfer, card, split), receipt (print + share), void/refund, customer optional |
| **Shift** | Open/close shift, opening float, blind closing, variance, cash in/out |
| **Purchasing** | Suppliers, purchase order, goods receipt with mandatory batch/expiry, supplier invoice, AP with due dates and partial payment |
| **Owner reports** | Sales, gross margin, inventory value, expiry-at-risk, purchasing, shift, audit |
| **Offline** | OTC sale, payment, receipt, shift events queue locally; explicit sync status; idempotent replay |

Rx-restricted products **can be catalogued** in v1 and are **blocked at the OTC counter** with a clear message ("Requires prescription — available in Pharmacy module"). This keeps the catalogue honest without shipping the clinical workflow early.

### 6.2 v1.1 — "Prescription core"

Patient and prescriber records · prescription intake · screening checklist (administrative / pharmaceutical / clinical) · pharmacist approve / hold / contact-prescriber · dispensing with batch allocation · partial fill · etiket (label) · prescription archive with retention rules **[VALIDATE]** · basic compounding (racikan BOM, tuslah/embalase, ingredient batch consumption) · Rx checkout by cashier only after approval · prescription analytics (turnaround time).

### 6.3 Phase 2 — "Operations and control"

Defecta / reorder engine (explainable) · multi-branch transfers · customer returns with quarantine workflow · supplier returns · recall management · destruction workflow · controlled-medicine module (ledger, special permissions, export reports) · mobile stock opname · promotions and membership · online order queue + prescription upload · WhatsApp notifications · SATUSEHAT connector + KFA sync · accounting export.

### 6.4 Phase 3 — "Intelligence and ecosystem"

Advanced forecasting · centralised procurement · advanced multi-branch analytics · supplier recommendations · marketplace connectors · AI analytics assistant (anomaly detection, OCR for supplier invoices, natural-language reports) · expanded clinical documentation.

---

## 7. Functional requirements

IDs are stable. `USER-STORIES.md` maps stories to these IDs. Priority: **P0** = MVP v1 must-have · **P1** = v1.1 · **P2** = Phase 2 · **P3** = Phase 3.

### 7.1 Foundation (FND)

| ID | Requirement | Pri |
|---|---|---|
| FND-1 | Multi-tenant isolation: every row carries `tenant_id`; cross-tenant access is impossible through any API path | P0 |
| FND-2 | Hierarchy: Organization → Branch → Location (rack/storeroom) → Workstation | P0 |
| FND-3 | Nine roles with a permission matrix; permissions enforced on the API, not only the UI | P0 |
| FND-4 | Facility profile stores NIB, apotek permit, APJ identity and credential fields (not just a store name) | P0 |
| FND-5 | Audit event on every high-risk mutation (stock adjust, price change, void/refund, user/permission change, batch/expiry edit, supplier change, destruction, return-to-stock decision) capturing who / what / when / branch / entity / before / after / reason | P0 |
| FND-6 | Audit log is append-only to application code; no UI to edit or delete | P0 |
| FND-7 | CSV import for products, suppliers, opening stock (with batch + expiry); CSV export for all primary lists | P0 |
| FND-8 | Automated nightly backup with restore procedure documented and rehearsed | P0 |
| FND-9 | Tenant onboarding flow: create org, first branch, owner, import products | P0 |
| FND-10 | Billing/plan hooks (plan, seat/branch limits, status) without a payment processor | P1 |

### 7.2 Product master (PRD)

| ID | Requirement | Pri |
|---|---|---|
| PRD-1 | Product has a **base unit**; every quantity in the system is stored in base units | P0 |
| PRD-2 | Product defines N sale units with an integer or decimal multiplier to base (tablet=1, strip=10, box=100) and optional barcode and price per unit | P0 |
| PRD-3 | Multiple barcodes per product / per unit | P0 |
| PRD-4 | Identity fields: SKU, brand name, generic/active ingredient, strength, dosage form, route, package description, manufacturer, category | P0 |
| PRD-5 | External identifiers `kfa_code`, `bpom_nie` are separate columns and are never the primary key | P0 |
| PRD-6 | Sales-restriction class: `OTC`, `OTC_LIMITED`, `RX_REQUIRED`, plus `controlled_class` (narcotic / psychotropic / precursor / none) and flags for cold-chain, compounding-ingredient, blocked-for-sale, recalled | P0 |
| PRD-7 | Min / max / safety stock, reorder point, preferred supplier, storage location per product | P0 |
| PRD-8 | Search matches brand, generic, partial name, strength, form, barcode, SKU, KFA — ranked, typo-tolerant, under 150 ms p95 on a 20,000-SKU catalogue, available offline | P0 |
| PRD-9 | Price history retained; price changes audited | P0 |

### 7.3 Inventory (INV)

| ID | Requirement | Pri |
|---|---|---|
| INV-1 | `inventory_ledger` is the source of truth. Every stock change inserts an event (type, product, batch, location, signed base-unit delta, unit context, reference type/id, reason, actor, timestamp). Rows are never updated or deleted | P0 |
| INV-2 | A balances projection (per product / batch / location, with reserved vs available) is derived from the ledger and is rebuildable | P0 |
| INV-3 | Batch is a distinct entity: batch number, expiry, received date, supplier, purchase cost, location, status (`AVAILABLE`, `QUARANTINE`, `RECALLED`, `EXPIRED`, `DESTROYED`) | P0 |
| INV-4 | A batch can only be created by a goods-receipt or opening-balance event | P0 |
| INV-5 | Default allocation is **FEFO**. Authorised manual batch selection requires a reason and is audited | P0 |
| INV-6 | No ordinary sale from an expired, quarantined or recalled batch | P0 |
| INV-7 | Negative stock is rejected by default | P0 |
| INV-8 | Expiry and batch number cannot be edited from the product form; edits require a privileged action with audit | P0 |
| INV-9 | Configurable expiry bands (default: expired, <30, 30–60, 60–90, >90 days) with value at cost per band | P0 |
| INV-10 | Stock opname: create session (full or cycle), count by barcode/manual, variance report, approval, adjustment entries — never silent | P0 |
| INV-11 | Reservations (for prescriptions and later online orders) reduce *available* without reducing *on hand* | P1 |
| INV-12 | Inter-branch transfer with in-transit state | P2 |
| INV-13 | Customer return → quarantine → decision (restock / write-off / return to supplier / destroy) **[VALIDATE]** | P2 |
| INV-14 | Recall: block sale of a batch, locate stock, list affected receipts/sales/dispenses, quarantine, record resolution | P2 |
| INV-15 | Destruction workflow with product, batch, expiry, quantity, witness and documentation **[VALIDATE]** | P2 |

### 7.4 Counter / POS (POS)

| ID | Requirement | Pri |
|---|---|---|
| POS-1 | OTC happy path is `Scan/Search → Unit → Qty → (Customer) → Pay → Receipt`; no pharmacy-clinical step is forced | P0 |
| POS-2 | Unit selection per line with deterministic conversion; selling 6 tablets from a strip decrements 6 base units | P0 |
| POS-3 | Allocation is shown per line on demand (which batch, expiry) and recorded on commit | P0 |
| POS-4 | Rx-required and controlled products are blocked at the OTC counter with a clear explanation | P0 |
| POS-5 | Discounts (line and cart) gated by permission and optional max percent per role | P0 |
| POS-6 | Tax configurable per tenant/product (PPN etc.) **[VALIDATE]** | P0 |
| POS-7 | Payments: cash (with change due), QRIS, bank transfer, debit/credit card, split/mixed | P0 |
| POS-8 | A sale commit is atomic: ledger events + sale + payment + audit in one transaction; replay with the same idempotency key is a no-op | P0 |
| POS-9 | Receipt: print (thermal 58/80 mm) and share (WhatsApp/PDF text) | P0 |
| POS-10 | Void (mistake, before/after payment per policy) and refund (money back on completed sale) are distinct, permissioned and audited | P0 |
| POS-11 | Held carts / parked sales | P0 |
| POS-12 | Customer optional lookup; retail customer profile only (not patient) | P0 |
| POS-13 | Receivable (credit sale) for authorised customers | P2 |
| POS-14 | Rx checkout available to cashier only for prescriptions in `READY` state approved by a pharmacist | P1 |

### 7.5 Shift and cash (SHF)

| ID | Requirement | Pri |
|---|---|---|
| SHF-1 | Open shift: cashier, workstation, branch, opening float, timestamp | P0 |
| SHF-2 | No sale without an open shift on that workstation | P0 |
| SHF-3 | Cash in / cash out with reason | P0 |
| SHF-4 | **Blind close**: cashier enters counted cash without seeing expected; system computes variance (counted − expected) and shows Balanced / Short / Over | P0 |
| SHF-5 | Supervisor review of variance; shift report by payment method | P0 |

### 7.6 Procurement and AP (PRC)

| ID | Requirement | Pri |
|---|---|---|
| PRC-1 | Supplier profile: identity, type (PBF/vendor), contact, payment terms, lead time, minimum order | P0 |
| PRC-2 | Purchase order with items, units, expected prices; statuses draft → approved → sent → partially received → received → closed/cancelled | P0 |
| PRC-3 | Goods receipt against a PO (or ad hoc): per line ordered / received / damaged, **batch and expiry mandatory**, purchase price, discount, tax; partial and over-shipment handled | P0 |
| PRC-4 | Posting a receipt creates batches and ledger events and updates cost | P0 |
| PRC-5 | Supplier invoice with due date; invoice may arrive after receipt; discrepancy vs receipt flagged | P0 |
| PRC-6 | Accounts payable: outstanding, partial payment, payment history, aging | P0 |
| PRC-7 | Cost method: batch cost recorded; moving-average cost maintained for margin reporting | P0 |
| PRC-8 | Defecta list (manual in v1; items flagged below reorder point) | P0 |
| PRC-9 | Explainable reorder engine: suggestion shows available, reserved, avg daily sales, lead time, safety stock, ROP, recommended qty and the formula | P2 |
| PRC-10 | Supplier scorecard: fill rate, lead time, late-PO rate, price change, returns | P2 |
| PRC-11 | Supplier return linked to batch with approval | P2 |

### 7.7 Pharmacy / prescriptions (RX) — v1.1

| ID | Requirement | Pri |
|---|---|---|
| RX-1 | Person model: one `Person` may have a Customer profile and/or a Patient profile; patient data has stricter access control | P1 |
| RX-2 | Patient record: identity, DOB/age, sex, contact, allergies, relevant notes, pregnancy/breastfeeding flags, weight/height, consent and privacy flags | P1 |
| RX-3 | Prescriber record | P1 |
| RX-4 | Prescription keeps the **original prescribed text** and maps each item to an internal product separately | P1 |
| RX-5 | Prescription status is a single explicit state machine (see DOMAIN-MODEL.md); no stacks of booleans | P1 |
| RX-6 | Screening checklist across administrative, pharmaceutical, clinical dimensions; incomplete checklist blocks approval | P1 |
| RX-7 | Approve / Hold / Contact-prescriber is attributable to a pharmacist-role user and enforced server-side; cashiers cannot change status | P1 |
| RX-8 | Dispense: allocate batch (FEFO), pick, final check, price, pay, hand over; dispense event is immutable | P1 |
| RX-9 | Partial fill with remaining quantity tracked | P1 |
| RX-10 | Etiket generation (patient, drug, directions, date, pharmacy) | P1 |
| RX-11 | Prescription archive with search; retention at least 5 years per current framework **[VALIDATE]** | P1 |
| RX-12 | Patient medication history view for pharmacist | P1 |
| RX-13 | Compounding (racikan): BOM-like recipe, ingredient quantities in mg/g/ml/tablet, visible rounding rules, ingredient batch consumption, packaging components, tuslah and embalase fees, pharmacist review before completion | P1 |
| RX-14 | Duplicate / repeat / copy prescription handling | P1 |
| RX-15 | Controlled-medicine prescriptions: stricter authorisation, original/internal-electronic evidence, special ledger **[VALIDATE]** | P2 |
| RX-16 | Online prescription upload with protected storage and pharmacist review | P2 |

### 7.8 Reporting and dashboard (RPT)

| ID | Requirement | Pri |
|---|---|---|
| RPT-1 | Owner dashboard: sales today, gross profit, near-expiry value, stock alerts, AP outstanding, action queue — each tile drills down | P0 |
| RPT-2 | Sales: gross/net, transactions, basket size, by product/category/cashier/payment method, hour-of-day heatmap | P0 |
| RPT-3 | Profitability: revenue, COGS, gross profit and margin by SKU/category; discounts and write-offs shown | P0 |
| RPT-4 | Inventory: valuation, slow-moving, dead stock, stockout count, days of inventory | P0 |
| RPT-5 | Expiry: value at risk by band, by supplier, by product, recurring expiry SKUs | P0 |
| RPT-6 | Procurement: purchases by supplier, price trend, PO status, AP aging | P0 |
| RPT-7 | Shift and cashier variance report | P0 |
| RPT-8 | Audit report with filters | P0 |
| RPT-9 | Stock card (ledger by product/batch) and batch drill-down ("where did this batch go") | P0 |
| RPT-10 | Prescription register, turnaround time, interventions, compounding | P1 |
| RPT-11 | Controlled-medicine register and period reconciliation (opening + receipts − dispensing ± corrections = closing) with export **[VALIDATE]** | P2 |
| RPT-12 | Branch comparison | P2 |

### 7.9 Action Center and notifications (ACT)

| ID | Requirement | Pri |
|---|---|---|
| ACT-1 | Unified Action Center ranked Critical / High / Medium / Info, each item links to the object needing action; snoozable where appropriate | P0 |
| ACT-2 | In-app notifications; priority levels; digest option | P0 |
| ACT-3 | Email / WhatsApp / push | P2 |

### 7.10 Offline and sync (SYN)

| ID | Requirement | Pri |
|---|---|---|
| SYN-1 | Offline-safe: OTC sale, payment record, receipt print, shift events, product search | P0 |
| SYN-2 | Every offline transaction carries a client-generated deterministic ID and idempotency key | P0 |
| SYN-3 | Visible sync state per transaction: `pending` / `synced` / `conflict` / `failed` | P0 |
| SYN-4 | Conflict policy defined and tested for stock (e.g. two workstations sell the last unit offline) — resolved by explicit rule and surfaced to a human, never silently dropped | P0 |
| SYN-5 | Operations needing cloud verification show a clear "requires connection" state | P0 |
| SYN-6 | Retry queue with backoff; sync log retained | P0 |

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Counter speed** | OTC sale from search to receipt in ≤ 4 taps/scans for a single item; add-to-cart feedback < 100 ms on a mid-range Android phone and a low-spec POS terminal |
| **Availability** | Counter works with zero connectivity for at least an 8-hour shift |
| **Data integrity** | Automated tests for the integrity rules in blueprint §60 (stock ≥ 0, no sale from blocked batch, ledger ↔ balance reconcile, audit on sensitive mutation) run in CI |
| **Security** | Tenant isolation test suite; server-side authz on every route; passwords hashed; session expiry; role-change audit; secrets never in client |
| **Privacy** | Patient data segregated, access-logged, excluded from analytics exports and logs; consent flags honoured. UU PDP (Indonesian personal-data law) obligations reviewed by counsel **[VALIDATE]** |
| **Auditability** | Append-only audit and ledger; period-close prevents back-dated stock edits without privileged adjustment |
| **Backup / DR** | Daily backup, tested restore, documented RPO/RTO targets |
| **Localisation** | UI in Indonesian first (English secondary); Rupiah `Rp.` with dot thousands separators; WIB/WITA/WIT-aware dates |
| **Platform** | Installable PWA, phone-first (verify ~390 px) but desktop/tablet counter is the primary pharmacy setting; thermal printer support |
| **Accessibility** | WCAG 2.1 AA on admin surfaces |
| **Scale (v1 target)** | 50 tenants, 20,000 SKUs/tenant, 1,000 sales/day/branch, 5-year ledger retention without degraded counter performance |
| **Observability** | Structured logs without patient data, error tracking, sync-health dashboard, integration logs |

---

## 9. Constraints and assumptions

### Constraints

- Regulatory scope must not be asserted without a dated source; controlled-medicine and external-reporting behaviour requires APJ validation before production.
- Do not hard-code a "SIPNAP API" as a real-time integration unless an official supported API is confirmed; ship a ledger + export layer first.
- Tenant data of a live pharmacy is production data from day one; no staging-only shortcuts for destructive migrations.
- The user commits and deploys manually.

### Assumptions (each should be tested in discovery)

1. Beachhead customers are independent apotek where the owner is accessible and decision speed is high.
2. A pharmacy will migrate if opening stock (with batch/expiry) can be imported from CSV in under a day.
3. Many target pharmacies already own a thermal printer and a barcode scanner.
4. Price of entry competes with existing Indonesian pharmacy software; pricing is open (see §11).
5. Offline-first is a purchase driver, not just a nice-to-have.
6. A pharmacist advisor will be available for domain review before v1.1.

---

## 10. Dependencies

| Dependency | Needed for | Risk if missing |
|---|---|---|
| Licensed APJ / pharmacist reviewer | Validating v1.1 workflows, controlled-medicine rules, label formats | Building the wrong clinical workflow |
| Design-partner apotek | Real catalogue, real opening stock, real counter feedback | Product built in a vacuum |
| Regulatory counsel (light-touch) | Retention, UU PDP, tax, SIPNAP reporting | Compliance claims we can't back |
| Licensed drug data source (KFA via SATUSEHAT; any interaction data) | Phase 2+ | Temptation to invent clinical data — forbidden |
| Thermal printer / scanner support | Counter | Counter unusable |
| Payment (QRIS) provider | Phase 1 QRIS confirmation; MVP may record manual confirmation | Slower reconciliation |

---

## 11. Open decisions

Each needs the owner's call. A default is proposed so work isn't blocked.

| # | Decision | Proposed default | Needed by |
|---|---|---|---|
| D1 | Product name | **Apotek OS** (placeholder; landing page ships with it, renamed via `PRODUCT_NAME` in `apps/web/src/content/copy.ts`) | Before public launch |
| D2 | Pricing model | Per-branch monthly subscription with a free pilot for the design partner | Before 2nd customer |
| D3 | Design partner | One independent apotek with an APJ willing to give weekly feedback | Before M1 |
| D4 | UI language at launch | Indonesian primary, English secondary. **Landing page: decided 6 Oct 2026, Indonesian at `/` with an English toggle at `/en`.** App UI still open. | Before first UI build |
| D5 | Tax handling | Configurable, default off, finance review **[VALIDATE]** | Before POS-6 |
| D6 | QRIS in v1 | Record method + manual confirmation; no processor integration | Before M3 |
| D7 | Multi-tenancy strategy | Shared schema with `tenant_id` + Postgres RLS | Before M0 end |
| D8 | Hosting | Same pattern as pos-local (Fly.io + Supabase) unless data-residency advice says otherwise **[VALIDATE]** | Before first deploy |
| D9 | Controlled-medicine reporting at launch | Ledger + export only; no API | Phase 2 start |
| D10 | Landing/demo skill | **Decided 6 Oct 2026:** `taste` (`Leonxlnx/taste-skill`), installed project-level | Before marketing work |

---

## 12. Success at a glance

Full detail in `SUCCESS-CRITERIA.md`. Headline targets:

| Dimension | MVP v1 target |
|---|---|
| **Adoption** | Design partner runs **all** counter sales on the product for 30 consecutive days |
| **Correctness** | 0 unexplained stock differences between ledger-derived and physical count after first full opname |
| **Speed** | Median OTC sale ≤ 20 s door-to-receipt; p95 add-to-cart < 100 ms |
| **Resilience** | 0 lost sales across induced offline test (≥ 8 h) |
| **Owner value** | Owner can name expiry-at-risk value and top-5 margin SKUs from the dashboard in under 1 minute |
| **Trust** | 0 critical data-integrity or tenant-isolation defects open at launch |

---

## 13. Release plan summary

| Milestone | Outcome |
|---|---|
| **M0 Foundation** | Tenant, auth, roles, audit, product/unit/batch, ledger, CI integrity tests |
| **M1 Counter** | OTC POS, payment, receipt, shift, offline queue |
| **M2 Supply** | Supplier, PO, goods receipt, invoice, AP, opname, expiry |
| **M3 Insight + pilot** | Dashboard, reports, import, onboarding → **MVP v1 pilot launch** |
| **M4 Prescription core** | Patient, prescriber, Rx intake, screening, dispensing, etiket, archive |
| **M5 Compounding** | Racikan, tuslah/embalase, ingredient consumption → **v1.1** |
| **M6+ Phase 2** | Reorder engine, multi-branch, returns/recall/destruction, controlled module, online orders, SATUSEHAT/KFA |

Sequencing, dependencies and gates are in `roadmap.html`.

---

## 14. Risks (top five)

Full register in `RISKS.md`.

1. **Domain error in clinical workflow** → mitigated by APJ reviewer and "decision support only" rule.
2. **Regulatory drift / wrong compliance claim** → mitigated by dated sources, `[VALIDATE]` tags, export-first posture.
3. **Offline sync conflict on stock** → mitigated by ledger design, idempotency, explicit conflict surface, dedicated test suite.
4. **Scope creep toward ERP/EMR** → mitigated by the non-goals list and lean-core MVP.
5. **Migration friction from existing software** → mitigated by CSV import with batch/expiry and an onboarding target of one day.
