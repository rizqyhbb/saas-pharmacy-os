# User Stories

Status: v0.1 · 6 Oct 2026 · Maps to requirement IDs in `PRD.md` §7.

**Format:** `US-<epic>-<n>` · *As a `<role>`, I want `<capability>`, so that `<outcome>`.* Acceptance criteria are Given / When / Then.
**Release tags:** `[v1]` MVP lean core · `[v1.1]` prescription core · `[P2]` Phase 2 · `[P3]` Phase 3.
**Size:** S ≤ 1 day · M ≈ 2–3 days · L ≈ 1 week · XL > 1 week (agent-assisted estimates, rough).
Items tagged **[VALIDATE]** depend on pharmacist/regulatory confirmation.

## Epic index

| Epic | Name | Release |
|---|---|---|
| FND | Tenancy, identity, permissions, audit | v1 |
| CAT | Product catalogue and units | v1 |
| INV | Inventory, batch, expiry, ledger | v1 |
| POS | Counter and payment | v1 |
| SHF | Shift and cash | v1 |
| PRC | Procurement, receiving, AP | v1 |
| RPT | Dashboard, reports, Action Center | v1 |
| SYN | Offline and sync | v1 |
| ONB | Onboarding and import | v1 |
| RX | Patients, prescriptions, dispensing | v1.1 |
| CMP | Compounding | v1.1 |
| P2 | Operations and control | P2 |

---

## FND — Tenancy, identity, permissions, audit

**US-FND-1 [v1] [M]** — *As an owner, I want to create my pharmacy account with a first branch, so that I can start using the system.* (FND-2, FND-9)
- Given I have no account, when I register with business name, my details and a branch, then a tenant, organisation, branch and owner user exist and I'm signed in.
- Given I enter an invalid email or weak password, when I type, then the error shows under the field and submit stays disabled.

**US-FND-2 [v1] [S]** — *As an owner, I want to record my apotek's facility profile (NIB, permit, APJ name and credential), so that the system reflects who is legally responsible.* (FND-4)
- Given I'm on facility settings, when I save APJ details, then they appear on receipts/labels where configured and in the audit trail.
- Given a field is a regulated identifier, when I leave it blank, then I'm told it's recommended but may continue **[VALIDATE]** which are mandatory.

**US-FND-3 [v1] [L]** — *As an owner, I want to invite staff and assign one of nine roles, so that each person only does what they should.* (FND-3)
- Given I'm an owner, when I invite a user with role Cashier, then they can sign in and see only cashier functions.
- Given a user lacks a permission, when they call the API directly for that action, then it returns 403 and an audit event records the attempt.
- Given I change someone's role, when saved, then an audit event records before/after.

**US-FND-4 [v1] [M]** — *As an auditor, I want a filterable, read-only audit log, so that I can answer who did what and when.* (FND-5, FND-6, RPT-8)
- Given any high-risk mutation occurs (stock adjust, price change, void/refund, role change, batch/expiry correction), then an audit event with who/what/when/branch/entity/before/after/reason exists.
- Given I filter by user, entity or date, then I see matching events and cannot edit or delete any.

**US-FND-5 [v1] [L]** — *As a security-minded owner, I want tenants strictly isolated, so that no other pharmacy can ever see my data.* (FND-1)
- Given users in tenant A and B, when A requests any B resource by ID on any endpoint, then the response is 404/403 and no B data leaks.
- The isolation suite runs in CI and blocks release on failure.

**US-FND-6 [v1] [S]** — *As an owner, I want automatic daily backups with a documented restore, so that I can recover from disaster.* (FND-8)
- Given the nightly job runs, then a backup exists and its age is visible to the operator.
- Given a restore drill is performed quarterly, then it completes within the target RTO and is logged.

---

## CAT — Product catalogue and units

**US-CAT-1 [v1] [M]** — *As a purchasing/inventory user, I want to create a product with brand, generic name, strength, dosage form and base unit, so that it is identified precisely.* (PRD-1, PRD-4)
- Given I fill required fields, when I save, then the product exists with exactly one base unit (multiplier 1).
- Given I type an invalid value, then I see an inline error and cannot submit.

**US-CAT-2 [v1] [M]** — *As an inventory user, I want to define sale/purchase units with conversions (tablet / strip / box), so that I can buy by the box and sell by the tablet.* (PRD-2)
- Given base unit tablet, strip = 10, box = 100, when I sell 2 strip, then 20 base units are deducted.
- Given I define a non-positive multiplier, then it's rejected inline.

**US-CAT-3 [v1] [S]** — *As a cashier, I want several barcodes to map to one product/unit, so that every packaging variant scans.* (PRD-3)
- Given a product with two barcodes, when I scan either, then it resolves to the same product and the right unit.
- Given a barcode is already used elsewhere in the tenant, when I try to reuse it, then I'm warned and prevented.

**US-CAT-4 [v1] [S]** — *As a pharmacist, I want to classify a product (OTC / OTC-limited / Rx-required / controlled class / cold chain), so that restricted items are protected.* (PRD-6)
- Given a product is Rx-required, when a cashier adds it at the OTC counter, then it's blocked with "Requires prescription".
- Given the class changes, then an audit event records it.

**US-CAT-5 [v1] [S]** — *As an inventory user, I want KFA code and BPOM NIE stored separately from the SKU, so that future integration doesn't break identity.* (PRD-5)
- Given I add a KFA code, then SKU and product ID are unchanged and the code is searchable.

**US-CAT-6 [v1] [L]** — *As a cashier, I want search that understands brand, generic, strength, form, barcode and SKU even with typos and offline, so that I find items instantly.* (PRD-8)
- Given 20,000 products cached, when I type "parasetamol 500", then paracetamol 500 mg results appear in < 150 ms p95 with the device offline.
- Given I scan a barcode, then the exact item is selected without a results list.

**US-CAT-7 [v1] [S]** — *As an owner, I want price changes recorded with history, so that I can see what changed and who changed it.* (PRD-9)
- Given I change a unit price, then the previous price and my identity are retained in history and audit.

---

## INV — Inventory, batch, expiry, ledger

**US-INV-1 [v1] [L]** — *As a warehouse user, I want every stock movement recorded as an immutable ledger event, so that stock is always explainable.* (INV-1, INV-2)
- Given any sale, receipt, adjustment or void, then exactly one or more ledger events exist referencing the document.
- Given I attempt to edit or delete a ledger row via any path, then it is impossible.
- Given I rebuild balances from the ledger, then they equal the live projection.

**US-INV-2 [v1] [M]** — *As an inventory user, I want stock tracked per batch with batch number and expiry, so that I can control expiry.* (INV-3, INV-4)
- Given I try to create a batch outside a receipt or opening balance, then it is refused.
- Given the same batch number and expiry is received again, then quantity adds to the existing batch.

**US-INV-3 [v1] [M]** — *As a cashier, I want sales to pick the earliest-expiring batch automatically, so that old stock moves first without my effort.* (INV-5)
- Given batches A (exp 2027-02, 20) and B (exp 2028-01, 100), when I sell 30 base units, then 20 come from A and 10 from B, both recorded.
- Given I'm authorised and choose a batch manually, then I must give a reason and it's audited.

**US-INV-4 [v1] [S]** — *As an owner, I want expired or quarantined batches blocked from sale, so that we never hand out unsafe stock.* (INV-6)
- Given a batch's expiry is yesterday, when a sale would allocate from it, then it is skipped; if nothing else is available the sale fails with a clear message.

**US-INV-5 [v1] [M]** — *As a manager, I want an expiry dashboard with value at cost by band, so that I know the money at risk.* (INV-9, RPT-5)
- Given batches in each band, then I see expired / <30 / 30–60 / 60–90 / >90 values and can drill to batches.

**US-INV-6 [v1] [L]** — *As a warehouse user, I want to run a stock opname by scanning, review variances and approve, so that counts correct the system transparently.* (INV-10)
- Given a count session, when I scan items, then counts accumulate per batch/location.
- Given variances exist, when a manager approves, then adjustment ledger events post with reason and approver; unapproved variances post nothing.
- Given I'm offline, then counting continues and syncs later.

**US-INV-7 [v1] [S]** — *As a manager, I want negative stock rejected by default, so that errors surface instead of hiding.* (INV-7)
- Given available is 3, when a sale of 5 is attempted online, then it's refused with the shortfall shown.

**US-INV-8 [v1] [S]** — *As an auditor, I want expiry and batch number uneditable from ordinary forms, so that records can't be quietly changed.* (INV-8)
- Given I open a product form, then batch/expiry are not editable; a privileged correction requires a reason and writes an audit event.

**US-INV-9 [v1] [M]** — *As an owner, I want a stock card per product and a batch drill-down ("where did this batch go"), so that I can trace any medicine.* (RPT-9)
- Given a batch, then I see its receipt, supplier, cost, each sale/dispense/adjustment that touched it, and remaining quantity.

---

## POS — Counter and payment

**US-POS-1 [v1] [L]** — *As a cashier, I want to scan or search, set quantity and unit, and pay in a few taps, so that a simple OTC sale is fast.* (POS-1, POS-2)
- Given an open shift, when I scan an item, pick qty 1 and pay cash, then a receipt is produced and stock decreases — in ≤ 4 interactions for a single item.
- Given I choose unit strip for a tablet-based product, then the line shows strip and base quantity deducts correctly.

**US-POS-2 [v1] [M]** — *As a cashier, I want to see an item's stock and nearest expiry before adding it, so that I can answer customers.* (POS-3)
- Given a product, then I can view available quantity and the batch that will be used.

**US-POS-3 [v1] [S]** — *As a cashier, I want a clear block on prescription-only products, so that I never sell them over the counter.* (POS-4, S5)
- Given an Rx-required product, when I add it, then it is refused with a message pointing to the Pharmacy module; nothing enters the cart.

**US-POS-4 [v1] [M]** — *As a manager, I want discounts gated by permission and limits, so that margin leakage is controlled.* (POS-5)
- Given a cashier limit of 10 %, when they try 15 %, then it needs manager approval and is audited.

**US-POS-5 [v1] [M]** — *As a cashier, I want to take cash (with change due), QRIS, transfer, card and split payments, so that customers can pay their way.* (POS-7)
- Given total Rp. 87.500 and cash Rp. 100.000, then change due Rp. 12.500 is shown.
- Given a split of cash and QRIS summing to total, then the sale completes; if short, completion is disabled with the shortfall shown.

**US-POS-6 [v1] [L]** — *As a cashier, I want a sale to commit atomically and be safe to retry, so that a double-tap or reconnect never double-charges or double-deducts.* (POS-8)
- Given the same idempotency key is sent twice, then only one sale and one set of ledger events exist and the second call returns the original result.

**US-POS-7 [v1] [M]** — *As a cashier, I want to print a thermal receipt and share it over WhatsApp, so that customers get proof of purchase.* (POS-9)
- Given a completed sale, then a 58/80 mm receipt prints with pharmacy details; a share action produces text/PDF.

**US-POS-8 [v1] [M]** — *As a cashier/manager, I want void and refund to be different, permissioned actions, so that mistakes and returns are handled correctly.* (POS-10)
- Given a mistaken sale, when voided, then it stops counting in sales and its ledger events are compensated.
- Given a completed sale, when a manager refunds with a reason, then the sale stays, reports show net, and **stock is not auto-restocked**.

**US-POS-9 [v1] [S]** — *As a cashier, I want to park a cart and resume it, so that I can serve the next customer.* (POS-11)

**US-POS-10 [v1] [S]** — *As a cashier, I want to optionally attach a retail customer, so that history and membership work later.* (POS-12)
- Given I attach a customer, then I see name/phone only — never clinical data.

---

## SHF — Shift and cash

**US-SHF-1 [v1] [M]** — *As a cashier, I want to open a shift with an opening float, so that sales are tied to my drawer.* (SHF-1, SHF-2)
- Given no open shift, when I try to sell, then I'm asked to open one.

**US-SHF-2 [v1] [S]** — *As a cashier, I want to record cash in/out with a reason, so that drawer movements are explainable.* (SHF-3)

**US-SHF-3 [v1] [M]** — *As a cashier, I want a blind close, so that I count honestly and the system reveals variance only after.* (SHF-4)
- Given I'm closing, then I enter counted cash without seeing expected; after submit I see Balanced / Short Rp X / Over Rp X.

**US-SHF-4 [v1] [S]** — *As a manager, I want to review and sign off shift variance, so that discrepancies are owned.* (SHF-5)

---

## PRC — Procurement, receiving, AP

**US-PRC-1 [v1] [S]** — *As purchasing, I want a supplier profile with terms and lead time, so that orders and payables use correct data.* (PRC-1)

**US-PRC-2 [v1] [M]** — *As purchasing, I want to create and approve purchase orders, so that buying is controlled.* (PRC-2)
- Given a draft PO, when a manager approves, then status becomes APPROVED and it can be sent.

**US-PRC-3 [v1] [L]** — *As warehouse, I want to receive goods against a PO with mandatory batch and expiry per line, so that every batch is traceable.* (PRC-3, PRC-4)
- Given I leave batch or expiry blank, then I cannot post the line.
- Given I receive fewer than ordered, then the PO becomes PARTIALLY_RECEIVED.
- Given I post the receipt, then batches and ledger events are created atomically and cost updates.

**US-PRC-4 [v1] [M]** — *As finance, I want to record a supplier invoice with due date and see payables, so that I pay on time.* (PRC-5, PRC-6)
- Given an invoice differs from the receipt, then a discrepancy is flagged.
- Given a partial payment, then outstanding reduces and history is kept.

**US-PRC-5 [v1] [S]** — *As purchasing, I want products below their reorder point listed in a defecta view, so that I know what to buy.* (PRC-8)

**US-PRC-6 [P2] [L]** — *As purchasing, I want explainable reorder suggestions, so that I trust and can adjust them.* (PRC-9)
- Given a suggestion, then it shows available, reserved, avg daily sales, lead time, safety stock, ROP, qty and the formula; I can override.

**US-PRC-7 [P2] [M]** — *As an owner, I want a supplier scorecard, so that I know who is hurting me.* (PRC-10)

---

## RPT — Dashboard, reports, Action Center

**US-RPT-1 [v1] [L]** — *As an owner, I want a dashboard answering "what needs me today", so that I act instead of browse.* (RPT-1, ACT-1)
- Given data exists, then I see sales today, gross profit, near-expiry value, stock alerts, AP outstanding and an action queue; every tile drills down.

**US-RPT-2 [v1] [M]** — *As an owner, I want sales and margin by SKU/category/cashier/payment method, so that I understand profitability.* (RPT-2, RPT-3)
- Given a period, then I see revenue, COGS, gross profit and margin %, with discounts and write-offs visible; any figure explains its derivation.

**US-RPT-3 [v1] [M]** — *As an owner, I want inventory valuation, slow-moving and dead-stock reports, so that I see tied-up capital.* (RPT-4)

**US-RPT-4 [v1] [S]** — *As finance, I want AP aging and purchasing reports, so that I manage cash.* (RPT-6)

**US-RPT-5 [v1] [M]** — *As a manager, I want the Action Center ranked Critical/High/Medium/Info with direct links, so that I resolve the right things first.* (ACT-1, ACT-2)
- Given a ledger/balance mismatch, then a Critical item appears linking to the product.
- Given I snooze a Medium item, then it returns after the snooze period.

---

## SYN — Offline and sync

**US-SYN-1 [v1] [XL]** — *As a cashier, I want to keep selling when the internet drops, so that customers aren't turned away.* (SYN-1, SYN-2)
- Given the device is offline for 8 hours, when I ring OTC sales with payments and print receipts, then all are stored locally with deterministic IDs.
- Given connectivity returns, then they sync with no duplicate and no loss.

**US-SYN-2 [v1] [M]** — *As a cashier, I want to see sync status per transaction and globally, so that I know what's safe.* (SYN-3)
- Given pending transactions, then the indicator shows the count and each has pending/synced/conflict/failed state.

**US-SYN-3 [v1] [L]** — *As a manager, I want stock conflicts from offline sales surfaced to me, so that nothing is silently lost.* (SYN-4)
- Given two workstations each sell the last unit offline, when both sync, then both sales are kept, one is flagged CONFLICT_NEGATIVE, and a Critical Action Center item asks a human to reconcile.

**US-SYN-4 [v1] [S]** — *As a user, I want features needing the server to say "requires connection", so that I'm not confused.* (SYN-5)

---

## ONB — Onboarding and import

**US-ONB-1 [v1] [L]** — *As an owner migrating from another system, I want to import products, suppliers and opening stock with batch and expiry from CSV, so that I can switch in under a day.* (FND-7)
- Given a CSV with errors, then I get a per-row report, nothing is half-imported, and I can fix and retry.
- Given opening stock with batch and expiry, then batches and `OPENING_BALANCE` ledger events are created.

**US-ONB-2 [v1] [S]** — *As an owner, I want to export lists to CSV, so that I'm never locked in.*

---

## RX — Patients, prescriptions, dispensing (v1.1)

**US-RX-1 [v1.1] [M]** — *As a pharmacist, I want to create a patient profile separate from a retail customer, so that clinical data stays restricted.* (RX-1, RX-2)
- Given a customer exists, when I create a patient profile, then it is linked via Person; cashiers still see only name + "active prescription" flag.
- Given anyone opens a patient record, then an access-log entry is written.

**US-RX-2 [v1.1] [S]** — *As a pharmacist, I want prescriber records, so that prescriptions link to the issuer.* (RX-3)

**US-RX-3 [v1.1] [L]** — *As a TTK/pharmacist, I want to enter a prescription keeping the original wording and mapping each item to a product, so that nothing is lost in translation.* (RX-4)
- Given I type "Amox 500 3×1 x5 hari", then that text is stored verbatim; mapping to a product is a separate field and may remain unmapped.

**US-RX-4 [v1.1] [L]** — *As a pharmacist, I want a screening checklist (administrative, pharmaceutical, clinical) and an explicit decision, so that review is complete and attributable.* (RX-6, RX-7)
- Given the checklist is incomplete, when I try to approve, then approval is disabled.
- Given I approve/hold/contact-prescriber, then my identity, time and notes are recorded.
- Given a cashier or TTK calls the approve endpoint, then it returns 403 and an audit event is written.

**US-RX-5 [v1.1] [L]** — *As a pharmacist, I want interventions documented, so that clinical actions are on record.*

**US-RX-6 [v1.1] [L]** — *As a TTK, I want FEFO batch allocation and a pick list, so that I prepare the right stock.* (RX-8)
- Given an approved prescription, then batches are suggested FEFO and reserved; picking confirms.

**US-RX-7 [v1.1] [M]** — *As a pharmacist, I want a final check before payment/hand-over, so that errors are caught.* (RX-8)

**US-RX-8 [v1.1] [M]** — *As a cashier, I want to collect payment and hand over only prescriptions in READY, so that I can't bypass approval.* (POS-14, R4)
- Given a prescription not READY, then checkout is unavailable.

**US-RX-9 [v1.1] [M]** — *As a pharmacist, I want partial fill with remainder tracked, so that stock shortages or patient refusals are handled.* (RX-9)

**US-RX-10 [v1.1] [M]** — *As a TTK, I want to print an etiket (patient, drug, directions, date, pharmacy), so that every dispensed item is labelled.* (RX-10)

**US-RX-11 [v1.1] [M]** — *As an APJ, I want a searchable prescription archive with retention, so that I can retrieve records for the required period.* (RX-11) **[VALIDATE]** retention.

**US-RX-12 [v1.1] [M]** — *As a pharmacist, I want a patient's medication history while screening, so that I can spot duplication or patterns.* (RX-12)

**US-RX-13 [v1.1] [S]** — *As a pharmacist, I want duplicate/repeat/copy prescriptions flagged, so that I don't dispense twice by mistake.* (RX-14)

---

## CMP — Compounding (v1.1)

**US-CMP-1 [v1.1] [XL]** — *As a pharmacist, I want to build a racikan from ingredients with explainable quantities, so that preparation is accurate and traceable.* (RX-13)
- Given "Puyer × 10: paracetamol ½ tab, CTM ¼ tab, DMP ¼ tab per sachet", then totals are 5, 2.5 and 2.5 tablets with the calculation shown.
- Given rounding is configured, then the rounding is visible and never silently alters the intended quantity.
- Given completion, then ingredients consume FEFO batches via `COMPOUND_CONSUMPTION` events.

**US-CMP-2 [v1.1] [M]** — *As a pharmacist, I want tuslah and embalase charged and packaging deducted, so that price and stock are right.*

**US-CMP-3 [v1.1] [S]** — *As a pharmacist, I want to review and verify a compound before completion, so that nothing leaves unchecked.*

---

## P2 — Operations and control (summarised)

| ID | Story | Req |
|---|---|---|
| US-P2-1 | Branch-to-branch transfer with in-transit state | INV-12 |
| US-P2-2 | Customer return → quarantine → decision **[VALIDATE]** | INV-13 |
| US-P2-3 | Recall: block batch, find affected stock/documents, resolve | INV-14 |
| US-P2-4 | Destruction with witness and documentation **[VALIDATE]** | INV-15 |
| US-P2-5 | Controlled-medicine register, special permissions, period reconciliation and export **[VALIDATE]** | RPT-11, RX-15 |
| US-P2-6 | Online prescription upload and order queue | RX-16 |
| US-P2-7 | SATUSEHAT connector (NRN lookup, MedicationDispense) and KFA sync **[VALIDATE]** | — |
| US-P2-8 | Mobile stock opname | INV-10 |
| US-P2-9 | WhatsApp / email notifications | ACT-3 |
| US-P2-10 | Promotions and membership | — |

---

## Definition of Done (all stories)

- Acceptance criteria demonstrably met.
- Permission enforced server-side with a test.
- Audit event emitted where applicable, with a test.
- Inline validation on every input; submit disabled until valid.
- Works at ~390 px (admin/owner screens) and at counter resolution.
- Offline behaviour specified and tested where the story touches the counter.
- No patient data in logs or analytics.
- `CHANGELOG.md` updated.
