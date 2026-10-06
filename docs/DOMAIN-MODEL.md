# Domain Model

Status: v0.1 · 6 Oct 2026 · Derived from `research/apotek-pos-research-blueprint.md` §§13–17, 41–43, 56, 60. This is a conceptual model; table-level schema comes with the first Drizzle migration.

## 1. Bounded contexts

```
Tenancy & Identity ──► Permissions ──► Audit
Catalogue (Product, Unit, Barcode, Regulatory profile, Price)
Inventory (Batch, Ledger, Balance, Reservation, Count, Adjustment)
Procurement (Supplier, PO, GoodsReceipt, SupplierInvoice, Payment)
Sales (Sale, Payment, Refund, Shift, CashMovement)
── v1.1 ──
Clinical (Person→Patient, Prescriber, Prescription, Review, Dispense, Compound, Label)
── phase 2 ──
Control (Controlled ledger, Recall, Destruction, Return/Quarantine)
Integrations (SATUSEHAT, KFA, SIPNAP export)
```

Dependency direction: Sales / Clinical / Procurement → Inventory (via service). Nothing else writes the ledger.

## 2. Person, Customer, Patient

```
Person
 ├── CustomerProfile   (retail: name, phone, membership, points)   ← low sensitivity
 └── PatientProfile    (clinical: DOB, sex, allergies, notes,      ← HIGH sensitivity
                         pregnancy/BF flags, weight/height,
                         consent, medication history)
```

- A customer is **not** automatically a patient. Creating a Patient profile is an explicit act by a pharmacist-capable role.
- Patient reads are access-logged. Patient fields never appear in logs, analytics, exports or demo data.
- Cashier role sees at most: name + "has active prescription" flag. Never allergies or history.

## 3. Product and units

```
Product
  id, tenant_id, sku, brand_name, generic_name?, strength?, dosage_form?, route?,
  manufacturer?, category_id, base_unit,
  kfa_code?, bpom_nie?,
  sales_class  ∈ OTC | OTC_LIMITED | RX_REQUIRED
  controlled_class ∈ NONE | NARCOTIC | PSYCHOTROPIC | PRECURSOR
  cold_chain, compounding_ingredient, blocked_for_sale, recalled
  min_stock, max_stock, safety_stock, reorder_point, preferred_supplier_id?, default_location_id?
  tracks_batch  (default true for medicines)

ProductUnit
  id, product_id, name, multiplier_to_base, barcode?, sell_price, is_default_sale, is_default_purchase

ProductBarcode (many per product/unit)
```

**Invariant U1** — every product has exactly one unit with `multiplier_to_base = 1` (the base unit).
**Invariant U2** — conversion is deterministic: `base_qty = unit_qty × multiplier_to_base`; no per-transaction rounding of base quantities.
**Invariant U3** — `kfa_code` and `bpom_nie` are attributes, never keys.

Example: base `tablet`; `strip = 10`; `box = 100`. Buy 5 box → +500 tablet. Sell 2 strip → −20 tablet. Dispense 6 tablet → −6.

## 4. Batch

```
Batch
  id, tenant_id, product_id, batch_number, expiry_date,
  received_at, supplier_id, goods_receipt_item_id,
  purchase_cost_per_base, status ∈ AVAILABLE | QUARANTINE | RECALLED | EXPIRED | DESTROYED
```

- **Invariant B1** — a batch is created only by a goods-receipt line or an opening-balance event (never from the product form).
- **Invariant B2** — `(tenant, product, batch_number, expiry_date)` identifies a batch; the same lot arriving again adds to it.
- **Invariant B3** — `expiry_date` and `batch_number` are immutable except through a privileged, audited correction.
- **Invariant B4** — `status ≠ AVAILABLE` ⇒ ordinary sale/dispense blocked. `EXPIRED` is computed (date < today) *and* materialised nightly so reports and queries agree.

## 5. Inventory ledger

Event types (enum): `OPENING_BALANCE`, `PURCHASE_RECEIPT`, `SALE`, `RX_DISPENSE`, `COMPOUND_CONSUMPTION`, `TRANSFER_OUT`, `TRANSFER_IN`, `CUSTOMER_RETURN`, `SUPPLIER_RETURN`, `STOCK_ADJUSTMENT`, `WRITE_OFF_EXPIRED_DAMAGED`, `DESTRUCTION`, `RECALL_QUARANTINE`, `RESERVATION`, `RESERVATION_RELEASE`, `REPACK_CONVERSION`.

Fields: `ledger_id, tenant_id, branch_id, location_id, product_id, batch_id, qty_delta_base, unit_context, event_type, reference_type, reference_id, reason, actor_id, created_at, idempotency_key`.

- **L1** insert-only; corrections are compensating events.
- **L2** `Σ qty_delta_base` per (product, batch, location) = `on_hand` in the balance projection, always.
- **L3** `on_hand ≥ 0` unless an explicitly flagged exceptional workflow (offline conflict) allows a visible negative.
- **L4** reservation events change `reserved`, not `on_hand`.
- **L5** every ledger row has a `reference_type/id` pointing to the business document that caused it.

### FEFO allocation (pure function, in `packages/domain`)

```
allocate(requested_base_qty, candidates: Batch[] with available>0 and status=AVAILABLE and expiry>=today)
  sort by expiry asc, then received_at asc
  take from each until satisfied
  → returns [{batch_id, qty}]  or  InsufficientStock{shortfall}
```

Manual override: caller supplies explicit `[{batch_id, qty}]`; requires permission and a reason; audited.

## 6. Procurement

```
Supplier  (id, name, type PBF|VENDOR, contact, npwp?, payment_terms_days, lead_time_days, min_order?, credit_limit?)
PurchaseOrder  status: DRAFT → APPROVED → SENT → PARTIALLY_RECEIVED → RECEIVED → CLOSED | CANCELLED
PurchaseOrderItem (product_id, unit, qty_ordered, expected_price)
GoodsReceipt  status: DRAFT → POSTED | REJECTED
GoodsReceiptItem (po_item_id?, product_id, unit, qty_received, qty_damaged,
                  batch_number*, expiry_date*, purchase_price, discount, tax)   * mandatory
SupplierInvoice (supplier_id, number, invoice_date, due_date, amount, status OPEN|PARTIAL|PAID)
SupplierPayment (invoice_id, amount, method, paid_at)
```

- **P1** posting a goods receipt creates batches + `PURCHASE_RECEIPT` ledger events atomically.
- **P2** short shipment leaves the PO `PARTIALLY_RECEIVED`; extra shipment requires an explicit over-receipt reason.
- **P3** invoice can arrive after receipt; a three-way check (PO ↔ receipt ↔ invoice) flags discrepancies.
- **P4** cost: batch cost stored; moving-average cost per product maintained for margin reports.

## 7. Sales, payment, shift

```
Shift  status: OPEN → CLOSING → CLOSED   (open_float, counted, expected, variance, reviewed_by)
Sale   status: COMPLETED | VOIDED   (+ refund records)
SaleItem (product_id, unit, qty_unit, qty_base, unit_price, discount, tax)
SaleItemBatchAllocation (sale_item_id, batch_id, qty_base)
Payment (sale_id, method CASH|QRIS|TRANSFER|CARD|…, amount, reference, status)
Refund  (sale_id, amount, reason, method, approved_by)
CashMovement (shift_id, type IN|OUT, amount, reason)
```

- **S1** a completed sale has payments summing to `total` (or an authorised receivable in Phase 2).
- **S2** no sale without an open shift on the workstation.
- **S3** void reverses ledger events with compensating `ADJUSTMENT` rows; refund returns money and does **not** by itself return stock (a customer *return* is a separate stock decision).
- **S4** sale commit is idempotent on `idempotency_key`.
- **S5** `RX_REQUIRED` or controlled products cannot be added at the OTC counter.

Shift expected cash = opening float + cash sales − cash refunds ± cash movements. Variance = counted − expected.

## 8. Prescription (v1.1)

```
Prescription
  id, number (RX-YYYYMMDD-NNNN), patient_id, prescriber_id, branch_id,
  source ∈ PHYSICAL | INTERNAL | SATUSEHAT | ONLINE_UPLOAD,
  received_at, prescription_date, status, original_document_id?,
  national_prescription_number?, reviewed_by?, reviewed_at?, notes?

PrescriptionItem
  id, prescription_id, product_id?,           ← mapped product (nullable until mapped)
  prescribed_text,                            ← original wording, never overwritten
  strength?, dosage_form?, dose?, frequency?, duration?, route?,
  quantity, quantity_unit, instructions, substitution_allowed?, compound_group_id?, status

PrescriptionReview   (prescription_id, reviewer_id, checklist jsonb, decision APPROVE|HOLD|CONTACT_PRESCRIBER, notes)
PrescriptionIntervention (prescription_id, by, type, description, outcome)
Dispense / DispenseItem / DispenseBatchAllocation
MedicationLabel (etiket)
CounselingRecord
```

### Prescription state machine

```
RECEIVED ──► SCREENING ──► (pharmacist decision)
                              │approve                     │hold / issue
                              ▼                            ▼
                        AVAILABILITY_CHECK           INTERVENTION_HOLD ──► (resolved) ──► SCREENING
                              ▼                            │cancel
                           PICKING                         ▼
                              ▼                        CANCELLED
                      [COMPOUNDING]  (only if compound items)
                              ▼
                         FINAL_CHECK  (pharmacist)
                              ▼
                           PAYMENT
                              ▼
                            READY
                              ▼
                  DISPENSED  |  PARTIALLY_DISPENSED ──► (remainder) READY | CLOSED
```

Allowed transitions are a table in `packages/domain`. Rules:

- **R1** `SCREENING → AVAILABILITY_CHECK` requires a `PrescriptionReview` with decision `APPROVE`, a complete checklist, and `reviewer.role ∈ {PHARMACIST, APJ}`.
- **R2** `FINAL_CHECK → PAYMENT` requires a pharmacist; compounding completion requires a pharmacist.
- **R3** `→ DISPENSED` requires `READY`, payment state valid, batch allocations recorded, and creates an immutable dispense event.
- **R4** Cashier may only trigger `PAYMENT` collection and `READY → DISPENSED` handover **after** pharmacist approval; the API rejects any other transition from a cashier.
- **R5** Every transition appends to `prescription_status_history`.
- **R6** Status is never edited directly; there is no `isApproved/isReady/isPaid` boolean.

Online/e-prescription path (Phase 2): `ONLINE_RECEIVED → VERIFY → SCREENING → PRICE_AVAILABILITY → ACCEPT → PREPARE → PICKUP/DELIVERY → DISPENSED`.

### Screening checklist (decision support, not decision-making)

| Dimension | Items |
|---|---|
| Administrative | patient name, age, sex, weight (where needed), prescriber identity, prescription date |
| Pharmaceutical | strength, dosage form, quantity, directions, stability/compatibility review needed? |
| Clinical | allergy info available, interaction review done, duplication review done, contraindication review done |

The checklist records **that a pharmacist reviewed each item**. The product does not compute interactions or allergies from its own knowledge. Any warning source is a licensed external dataset, introduced deliberately in a later phase.

## 9. Compounding / racikan (v1.1)

```
CompoundRecipe   (name, output_qty, output_unit, notes)           ← reusable template, optional
CompoundingSession (prescription_item_group_id, status DRAFT→VERIFIED→COMPLETED, pharmacist_id)
CompoundIngredient (session_id, product_id, qty_per_unit, qty_total, unit, batch allocations)
Packaging component (paper/sachet/bottle) and charges: tuslah, embalase
```

- **C1** BOM-like: output = N units (e.g. 10 sachets); ingredient total = per-unit × N, in explicit units (mg/g/ml/tablet).
- **C2** Ingredient consumption writes `COMPOUND_CONSUMPTION` ledger events per batch.
- **C3** Rounding rules are **configured and visible**; the pharmacist's intended quantity is never silently rounded away. Every calculation is explainable on screen.
- **C4** Pharmacist review required before completion; BUD recorded where configured.
- **C5** Output is a dispensed item, not a stockable product (unless the pharmacy explicitly configures stock compounding — out of scope for v1.1).

## 10. Control (Phase 2)

- **Controlled ledger:** a view over `inventory_ledger` filtered by `controlled_class ≠ NONE`, plus mandatory evidence refs. Period reconciliation: `opening + receipts − dispensing ± corrections = closing`; snapshots frozen per reporting period. **[VALIDATE]**
- **Return/quarantine:** `RETURN_RECEIVED → QUARANTINE → QA_DECISION → RESTOCK | WRITE_OFF | RETURN_SUPPLIER | DESTROY`. Never auto-restock. **[VALIDATE]**
- **Recall:** block batch, locate stock and affected documents, quarantine, task, resolution.
- **Destruction:** product, batch, expiry, qty, witness, documentation; ledger event `DESTRUCTION`. **[VALIDATE]**

## 11. Cross-cutting

### Audit event
`who, what, when, branch, entity_type, entity_id, before, after, reason, reference, ip/device` — append-only. Mandatory for: stock adjustment, price change, void/refund, user/permission change, batch/expiry correction, supplier change, prescription change/cancel, controlled dispense/adjust, destruction, return-to-stock decision, manual payment change.

### Permissions
Resource × action matrix per role, stored as data. Critical examples: `prescription.approve` (pharmacist/APJ only), `controlled.approve` (pharmacist/APJ), `stock.adjust` (manager/warehouse with approval), `sale.discount` (cashier up to limit), `batch.correct` (privileged), `audit.read` (owner/auditor).

### Sync job / integration event
`SyncJob(id, device, payload, idempotency_key, status pending|synced|conflict|failed, attempts, last_error)`; `IntegrationEvent(provider, direction, payload_ref, status, retries)`.

## 12. Integrity rules → automated tests

| # | Rule |
|---|---|
| T1 | Ledger sum per (product, batch, location) equals the balance projection |
| T2 | Available stock ≥ 0 except flagged offline-conflict rows |
| T3 | No sale/dispense allocates from an expired, quarantined, recalled or destroyed batch |
| T4 | No batch exists without a goods-receipt or opening-balance event |
| T5 | Unit conversion round-trips deterministically |
| T6 | FEFO allocation returns earliest-expiry-first and never exceeds available per batch |
| T7 | `DISPENSED` unreachable without an approved review by a pharmacist role |
| T8 | A completed sale's payments sum to total (or authorised receivable) |
| T9 | Every sensitive mutation emits an audit event |
| T10 | Replaying a write with the same idempotency key produces no second effect |
| T11 | Tenant A can never read/write tenant B |
| T12 | Controlled product cannot be sold at the OTC counter |

## 13. Edge cases to carry into design and tests

Inventory: same product across batches; same batch across locations; partial box/strip; expired batch still holds quantity; recall after sales; negative attempt; adjustment after period close; transfer in transit.
Prescription: partial fill; out-of-stock item; changed after screening; patient refuses an item; clarification pending; invalid/expired prescription; duplicate upload; repeat/copy; controlled; compound.
Payments: split, failure, underpayment, refund after settlement, offline conflict.
Procurement: partial/short/extra receipt; substitute product; price differs from PO; batch/expiry missing; late invoice.
Returns: sale return; supplier return; returned-medicine quarantine; approved return but no supplier credit.
Compliance: controlled mismatch; destruction witness; audit of deleted/changed records; period-report correction; integration outage.
