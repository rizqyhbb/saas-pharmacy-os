# Product

<!-- Mirrors the pos-local PRODUCT.md schema so the `impeccable` skill can read it. -->

## Platform

web

An installable, offline-capable PWA. The counter is a **desktop/tablet-first** surface (pharmacies run a PC or tablet with a thermal printer and barcode scanner); the owner and stock-count surfaces are **phone-first**. Every admin screen must still work at ~390 px.

## Users

- **Owner / Super Admin:** often outside opening hours, on a phone. Wants decisions: what's selling, what's profitable, what's about to expire, where cash is stuck, which supplier is a problem.
- **Branch Manager:** runs a branch day: sales, stock, staff, shift variance, purchase approvals.
- **Pharmacist / APJ:** the only role that can approve a prescription, sign off compounding, or approve controlled-medicine transactions. Works at the dispensing bench with the patient and prescription visible. Interrupted constantly.
- **Pharmacy Technician (TTK):** picks and prepares, receives goods, counts stock, drafts transactions. Cannot approve.
- **Cashier:** rings up OTC fast; checks out prescriptions only *after* a pharmacist has approved them.
- **Purchasing:** suppliers, defecta, purchase orders, supplier invoices, payables.
- **Warehouse:** receive, move, count, capture batch and expiry.
- **Finance:** payments, AP/AR, expenses, financial reports.
- **Auditor (read-only):** reports and audit trail; mutates nothing.

## Product Purpose

A multi-tenant operating system for Indonesian apotek. It records every sale, every batch received, every unit that leaves the shelf and why, every prescription from intake to hand-over, and every rupiah owed to suppliers. It works well if the counter stays fast, the stock is explainable down to the batch, and a pharmacist can prove who decided what.

## Positioning

- **Not a POS with pharmacy fields.** A pharmacy operating system with a fast POS inside it.
- **Traceability as the spine.** Any batch can be followed from supplier to patient.
- **Offline is normal.** The counter keeps selling when the internet doesn't.
- **Decision-support, never decision-maker.** The system warns and records; the pharmacist decides.
- **Explainable.** Every reorder suggestion, margin and stock figure shows how it was computed.

## Operating Context

- Live pharmacies. Production is the shop floor; there is no "test the dispensing flow on prod".
- Mixed hardware: old PCs, tablets, phones, 58/80 mm thermal printers, USB barcode scanners.
- Unreliable connectivity at some sites; power cuts happen.
- Busy retail counter with a clinical bench behind it; two tempos in one room.
- Receipts and some documents are shared over WhatsApp.
- Regulation changes (BPOM 5/2026 replaced 24/2021 in April 2026). Compliance behaviour must be configurable and traceable to a dated source.

## Capabilities and Constraints

- **Language:** Indonesian primary, English secondary. Money is Rupiah, id-ID format, `Rp.` prefix, dot thousands separators.
- **Roles:** nine, enforced on the server. Hidden menus are not permissions.
- **Validation:** inline as the user types, error under each field, submit disabled until valid (shared rule across the `pos/` projects).
- **Offline:** OTC sale, payment, receipt, shift events and product search work offline. Anything needing cloud verification says so.
- **Patient data:** separate domain from retail customers; access-logged; never in logs or analytics exports.
- **No invented clinical content.** No dose tables, interaction rules or allergy logic authored from model knowledge.
- **Regulatory claims are dated and sourced** or tagged `[VALIDATE]`.

## Glossary

Meanings **in this product**. Use these words exactly in UI, code and comments.

### Stock and products
- **Product:** a sellable thing with identity (brand, generic, strength, form). Not a physical lot.
- **Base unit:** the smallest unit stock is stored in (e.g. tablet, ml, gram, piece). Every quantity in the ledger is in base units.
- **Sale unit:** a unit a product is sold or bought in, with a multiplier to base (tablet = 1, strip = 10, box = 100).
- **Batch (lot):** a specific received lot of a product with its own batch number, expiry date and cost. A product has many batches.
- **Expiry / ED:** the batch's expiry date. Batches past it are blocked from sale.
- **FEFO:** First Expired, First Out. The default batch-allocation rule. Not FIFO.
- **Inventory ledger:** the append-only record of every stock movement. The source of truth for stock.
- **Balance:** the current quantity derived from the ledger (on hand, reserved, available).
- **Reserved:** stock set aside (e.g. for an approved prescription) but not yet gone. Reduces *available*, not *on hand*.
- **Quarantine:** a batch or quantity held out of sale pending a decision (return received, suspected recall, temperature excursion).
- **Stock opname:** a physical stock count compared against the system. Variances need approval before an adjustment is posted.
- **Defecta:** the running list of items that need reordering. Not a defect report.
- **ROP (reorder point), safety stock, MOQ:** standard replenishment terms; shown with their formula wherever used.
- **Cold chain:** products requiring temperature-controlled storage/transport.
- **KFA code:** national pharmaceutical product reference (via SATUSEHAT). **BPOM NIE:** the registration number of a medicine. Both stored separately from the internal SKU.

### Regulation-sensitive classes
- **OTC (bebas / bebas terbatas):** sold without a prescription.
- **Rx-required (obat keras):** needs a prescription; blocked at the OTC counter.
- **Controlled medicine:** narcotics, psychotropics and pharmaceutical precursors. Strictest authorisation, ledger and reporting. **[VALIDATE]**
- **APJ (Apoteker Penanggung Jawab):** the pharmacist legally in charge of the apotek.
- **TTK (Tenaga Teknis Kefarmasian):** pharmacy technician. Supports, but cannot approve.

### Prescriptions and dispensing (v1.1)
- **Prescription (resep) / Rx:** an order from a prescriber for a patient. Keeps the original prescribed text separate from the product it maps to.
- **Screening / assessment:** the pharmacist's review across three dimensions: administrative, pharmaceutical, clinical.
- **Intervention:** a documented pharmacist action when a problem is found (hold, contact prescriber, change agreed).
- **Dispense:** the act of handing a prescribed medicine to the patient. Recorded as an immutable event with batch allocation.
- **Partial fill:** dispensing less than prescribed (stock short or patient declines); remainder tracked.
- **Etiket:** the dispensing label (patient, drug, directions, date). Not a price tag, not a barcode label.
- **Racikan (compounding):** a preparation made from several ingredients. Modelled like a BOM; consumes ingredient batches.
- **Tuslah:** compounding service fee. **Embalase:** packaging/handling fee. Both are charges on a compounded Rx, not product prices.
- **BUD (beyond-use date):** the date a compounded preparation should no longer be used.
- **Copy resep:** a copy of a prescription issued for a repeat or partial fill.
- **NRN (National Prescription Number):** SATUSEHAT's identifier for an electronic prescription. Phase 2.

### People
- **Person:** an individual. May have a **Customer** profile (retail, loyalty) and/or a **Patient** profile (clinical, restricted). One does not imply the other.
- **Prescriber:** the doctor (or authorised professional) who issued a prescription.
- **Staff member:** a person's membership in one apotek, with exactly one role and the branches they may work in. One person can be a staff member of several apotek (an APJ who also works elsewhere). Deactivating a staff member locks them out of that apotek on their next request.
- **Facility profile:** the apotek's legal identity: legal name, **NIB** (Nomor Induk Berusaha, the business identification number), pharmacy permit, the **APJ** (Apoteker Penanggung Jawab, the pharmacist legally responsible for the apotek) and their registration and practice-permit numbers, address, operating hours. Which fields are mandatory is still **[VALIDATE]** (research blueprint §4.3, checked 6 Oct 2026).
- **Classified product:** a product whose sales class and controlled class were set by someone allowed to (pharmacist or owner). Unclassified products can't be sold or dispensed.

### Money and cash
- **Sale:** a completed counter transaction. Net of refunds; excludes voids.
- **Void:** cancels a transaction as a mistake. Stops counting in sales. Reverses its ledger events.
- **Refund:** returns money on a completed sale, with reason. Sale stays; reports show net.
- **Return (customer):** goods come back. A *stock* decision (quarantine → restock/write-off/destroy), separate from the refund of money.
- **Supplier return:** goods sent back to a supplier against a batch, with approval.
- **Shift:** a cashier's cash session on one workstation (open float → sales → blind close).
- **Offline conflict:** an offline sale that reaches the server after the stock it sold is gone. The sale is kept (the goods left, the customer paid); the shortfall is booked as a flagged negative and a person reconciles it. Never silently dropped.
- **Blind close:** the cashier counts cash without seeing the expected amount; the system then computes **variance** = counted − expected (Balanced / Short / Over).
- **COGS / HPP:** cost of goods sold from batch cost (moving-average maintained for reporting).
- **Gross profit:** sales − COGS. Not net profit.
- **AP (hutang):** money owed to suppliers. **AR (piutang):** money owed by customers.
- **PBF:** pharmaceutical wholesaler, the usual supplier type.

### Control
- **Audit event:** an append-only record of a sensitive action (who, what, when, branch, entity, before, after, reason).
- **Recall:** a product or batch withdrawn by authority or manufacturer; blocks sale and triggers a task.
- **Destruction:** documented disposal of stock (product, batch, expiry, quantity, witness).

## Brand Commitments

Product name is a placeholder (**Apotek OS**). Visual identity is not yet chosen; it will be set through the `impeccable` skill for the admin/POS surfaces and through `taste` for the landing page and demo. Until `DESIGN.md` exists, no one invents colours, radii or fonts. Tone: calm, precise, clinical-adjacent but not cold; never playful with medicine.

## Evidence on Hand

- `research/apotek-pos-research-blueprint.md` (6 Oct 2026): domain research, regulatory baseline, competitor benchmark, edge cases.
- `pos-local/` (sibling): working reference for offline-first POS, shift/drawer reconciliation, role gating.
- There is **no** customer data, no pharmacist interview yet, and no design partner confirmed. None should be invented. See `DISCOVERY-INTERVIEW.md`.

## Product Principles

1. **The counter is never slowed by the pharmacy.** A vitamin sale takes seconds; clinical steps appear only when the product demands them.
2. **Stock is a ledger, not a number.** If it can't be explained from events, it isn't trustworthy.
3. **The system advises; the pharmacist decides.** Every clinical decision is attributable to a person with the right role.
4. **Never lose a sale.** Offline is a normal condition with explicit sync state.
5. **Explain every number.** Margins, reorder suggestions, stock levels show their working.
6. **Patient data is not customer data.** Separate, restricted, logged.
7. **Surface what needs action.** Owner dashboard ranks decisions, not vanity metrics.
8. **Additive by design.** Prescriptions, controlled medicine and integrations extend the core; they never force a rewrite.
