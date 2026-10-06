# APOTEK / PHARMACY POS — Research & Product Blueprint

**Prepared:** 6 October 2026  
**Market focus:** Indonesia  
**Audience:** Product owner, designer, Claude Code / engineering agent, pharmacist/domain reviewer  
**Purpose:** Turn pharmacy/apotek research into a practical feature scope and technical blueprint for a modern POS + pharmacy management system.

> **Important domain note:** This is a product-research and software-design document, not legal advice or pharmacy practice guidance. Before production use, validate controlled-drug, dispensing, prescription, SATUSEHAT, tax, and reporting behavior with a licensed Indonesian pharmacist/APJ and current regulatory counsel.

---

## 1. Executive Summary

An Indonesian **apotek is not a normal retail shop**. A generic POS can handle barcode → cart → payment → receipt, but an apotek system has to model medication-specific realities:

- a product may exist in multiple **batches**, each with its own expiry date;
- the same item can be purchased in a **box** but sold by **strip, tablet, capsule, bottle, tube, or other unit**;
- some items require a **prescription** or tighter controls;
- prescription transactions involve **patient + prescriber + dosage + administration instructions + clinical screening + dispensing**;
- compounded prescriptions can consume several ingredients in measured quantities and produce a new dispensed item;
- stock must remain traceable through **purchasing → receiving → storage → sale/dispensing → return → destruction**;
- controlled medicines require stronger authorization, documentation, and auditability;
- pharmacies operate both **clinical/service workflows** and **retail/business workflows**;
- Indonesian pharmacies are part of the health-facility ecosystem and need to account for **electronic medical records and SATUSEHAT interoperability**.

Current Indonesian sources reinforce this shape. Permenkes 73/2016 defines pharmacy-service standards around two major areas: management of pharmaceutical supplies/medical goods and clinical pharmacy services. Its management flow covers planning, procurement, receiving, storage, destruction, control, recording and reporting; clinical services include prescription assessment, dispensing, drug information, counseling, home pharmacy care, therapy monitoring, and adverse-effect monitoring. citeturn382335search9turn382335search0

As of 2026, BPOM Regulation No. 5/2026 is the current regulation for management of medicines and medicinal ingredients in pharmacy-service facilities, replacing BPOM 24/2021. The current regulation explicitly covers procurement, receiving, storage, compounding, handover/dispensing, returns, destruction, and reporting; it also has a specific section for narcotics, psychotropics, and pharmaceutical precursors. citeturn554246search0turn159056search1

The product therefore should be designed as a **pharmacy operating system with POS**, not as a POS with a few pharmacy fields bolted on.

---

# 2. Product Vision

## Proposed positioning

> **A pharmacy operating system that makes every medicine traceable from purchase to patient, while making everyday checkout fast enough for a busy retail counter.**

The core promise should be:

1. **Fast at the counter** — OTC and simple sales should feel like a modern retail POS.
2. **Safe for prescriptions** — the system guides, records, and escalates; it does not replace the pharmacist's clinical judgment.
3. **Accurate inventory** — batch, expiry, units, locations, costs, and stock movement remain explainable.
4. **Operationally useful** — purchasing, defecta/reorder, receiving, stock opname, returns, shifts, cash, and payables are connected.
5. **Owner-friendly** — the owner can understand sales, margin, working capital, expiry risk, procurement efficiency, and staff activity from a dashboard.
6. **Compliance-ready** — controlled transactions, audit trails, prescription history, reporting, and future integrations are first-class concerns.

---

# 3. Domain Research: What an Apotek Actually Does

## 3.1 Two operating worlds coexist

### A. Retail / commercial

- OTC purchase
- vitamins / supplements
- personal care / health products
- medical devices
- quick checkout
- promotions
- customer/member pricing
- cash / QRIS / transfer / card
- refunds/returns where permissible
- receipts
- end-of-shift reconciliation

### B. Pharmaceutical / clinical

- receive prescription
- identify patient
- identify prescriber
- assess prescription
- check availability
- check dosage/form/strength and relevant clinical factors
- pharmacist intervention if needed
- prepare/dispense
- compound when applicable
- label
- counsel
- record medication history / service notes
- retain prescription/documentation
- monitor/referral/follow-up where relevant

This dual nature is the central product-design constraint.

---

# 4. Regulatory / Standards Baseline for Indonesia

## 4.1 Permenkes 73/2016 — Pharmacy Service Standards

The regulation is listed by Kemenkes as **currently applicable**. It establishes the standards of pharmaceutical services in pharmacies. citeturn281468search0turn281468search2

The standard covers:

### Pharmaceutical-stock management

- planning
- procurement
- receiving
- storage
- destruction
- control
- recording and reporting

### Clinical pharmacy services

- prescription assessment
- dispensing
- drug information service
- counseling
- home pharmacy care
- therapy monitoring
- adverse drug-effect monitoring

Source: Permenkes 73/2016, as indexed by Kemenkes and reproduced in the regulation text. citeturn382335search9

**Software implication:** do not treat prescription dispensing as just another sales transaction. It needs its own workflow and evidence trail.

---

## 4.2 Permenkes 9/2017 — Apotek

Permenkes 9/2017 on Apotek remains listed as applicable and was amended by Permenkes 26/2018. citeturn197636search0turn197636search1

The system should support the facility's organizational data and responsible-person model, including APJ / pharmacist-related information.

---

## 4.3 Permenkes 17/2024 — updated risk-based health-business standard

The 2024 regulation's annex contains the **Standard Usaha Apotek** for KBLI 47721. It defines an apotek as a pharmaceutical-service facility where pharmacy practice is performed by a pharmacist and identifies the pharmacist in charge/APJ and supporting pharmacy personnel. citeturn518447search40

For product scope, this means the tenant/facility record should not merely be `store_name`; it should also be able to represent:

- NIB / business identity
- pharmacy permit / facility identity
- APJ pharmacist
- pharmacist/TTK users
- branch/facility information
- operating hours
- practice/credential information where needed

---

## 4.4 KBLI 47721

OSS's current KBLI 2025 lists **47721 — Perdagangan Eceran Sediaan Farmasi untuk Manusia di Apotek**. The scope includes finished pharmaceutical forms and health-related goods such as medicines, vitamins/supplements, and certain health supplies. citeturn518447search0

**Product implication:** product master data should support much more than `medicine_name + price`.

---

# 5. Critical 2026 Regulatory Change: BPOM 5/2026

This is important for implementation because many older pharmacy articles/software guides still reference BPOM 24/2021.

BPOM Regulation **No. 5/2026**, effective 6 April 2026, replaced BPOM 24/2021. The current regulation covers management of medicines and medicinal ingredients in pharmacy-service facilities and explicitly includes:

- procurement
- receiving
- storage
- compounding
- dispensing/handover
- returns
- destruction
- reporting

It also contains a specific section on management of narcotics, psychotropics, and pharmaceutical precursors. citeturn554246search0turn554246search3turn159056search1

### Especially important software rules from the current regulation

The current regulation's annex includes requirements such as:

- prescriptions and written requests must be traceable;
- prescription/request records are retained for at least 5 years;
- destruction of prescriptions requires appropriate documentation and a destruction record/reporting process;
- returned medicines need documented handling and stock-card traceability;
- destruction records need product identity, strength/form, package contents, quantity, batch number, expiry, and documentation;
- cold-chain products need special handling and validated temperature-preserving transport when applicable;
- controlled medicines require special screening/documentation;
- current provisions say narcotic/psychotropic prescriptions must be original manual prescriptions or electronic prescriptions using the pharmacy's **internal electronic system** and may not be faxed/copied; precursors also require an original, complete prescription. citeturn159056search1

**Software implication:** the system should have a general traceability engine, not only a generic inventory table.

---

# 6. SATUSEHAT / Electronic Medical Record

Kemenkes states that all listed health facilities, including **apotek**, are required to integrate with SATUSEHAT under the current medical-record framework. citeturn281468search11

Permenkes 24/2022 on Medical Records is still listed as applicable and explicitly includes apotek among facilities required to conduct electronic medical records. The regulation emphasizes security, confidentiality, integrity, and availability of medical-record data. citeturn119123search0turn119123search1

SATUSEHAT's pharmacy interoperability flow includes:

1. pharmacy retrieves prescription information using the National Prescription Number (NRN);
2. pharmacy obtains the prescription items;
3. pharmacy creates an encounter;
4. pharmacy sends medication-dispense data;
5. pharmacy updates the encounter.

The medication data uses `Medication`, `MedicationRequest`, and `MedicationDispense`, with KFA as standardized pharmacy/medical-product reference data. citeturn779944search0turn829051search4

### KFA

SATUSEHAT describes KFA as the master data for medicines, pharmaceutical products, and medical devices. Its APIs support product lookup, and product references can be sourced using identifiers such as KFA code, BPOM NIE, or LKPP-related data. citeturn829051search0turn829051search1

**Architecture recommendation:** make `kfa_code` and other external identifiers part of the product model from day one. Do not hard-wire your internal SKU to KFA.

---

# 7. Controlled Medicines / SIPNAP

Kemenkes operates SIPNAP, the **Sistem Informasi Pelaporan Penggunaan Sediaan Jadi Narkotika & Psikotropika Nasional**, for service units including pharmacies, clinics, and hospitals. citeturn197636search2

The current BPOM 5/2026 regulation still requires reporting of narcotics, psychotropics, and pharmaceutical precursors according to applicable laws. citeturn159056search1

### Product recommendation

Do not hard-code “SIPNAP API integration” as a guaranteed real-time API unless an official supported integration is confirmed.

Instead build:

- controlled-medication classification
- controlled stock ledger
- special transaction permissions
- controlled prescription evidence
- controlled adjustment workflow
- controlled destruction workflow
- reporting/export layer
- report-period snapshots
- reconciliation between opening balance + receipts - dispensing/usage ± corrections = closing balance

Then add official API integration when/if supported.

---

# 8. End-to-End Pharmacy Workflow

## 8.1 Daily opening

**Actor:** cashier / pharmacist / shift lead

1. Sign in.
2. Select branch and workstation.
3. Open shift.
4. Record opening cash float.
5. Check critical alerts:
   - expired stock
   - near-expiry stock
   - stockouts
   - controlled-stock discrepancies
   - pending purchase orders
   - failed integrations/sync
   - pending online orders
   - pending prescription queue
6. Continue to POS.

### UI recommendation

The opening screen should be operational, not financial-noise-heavy:

> **Today needs attention**
> 8 near-expiry • 3 low-stock • 1 controlled-stock discrepancy • 4 prescriptions waiting

---

## 8.2 OTC sale

Fastest path:

`Search / Scan → Select unit → Qty → Customer (optional) → Payment → Receipt → Stock deduction`

Requirements:

- barcode scan
- search by brand/generic/SKU
- unit conversion
- price selection
- discount controls
- customer/member optional
- payment methods
- digital/printed receipt
- stock deduction
- audit event

Do not force the cashier through the prescription workflow for a simple OTC item.

---

# 9. Prescription Workflow

## Recommended workflow state machine

```text
RECEIVED
  ↓
SCREENING
  ↓
┌─────────────────────┐
│ pharmacist accepts? │
└─────────────────────┘
   ↓ yes        ↓ no / issue
AVAILABILITY     INTERVENTION / HOLD
   ↓             ↓
PICKING       RESOLUTION
   ↓             ↓
COMPOUNDING? ←───┘
   ↓
FINAL CHECK
   ↓
PAYMENT
   ↓
READY / HANDOVER
   ↓
DISPENSED
```

For online/e-prescription flows add:

```text
ONLINE_RECEIVED → VERIFY → SCREENING → PRICE/AVAILABILITY → ACCEPT → PREPARE → PICKUP/DELIVERY → DISPENSED
```

---

# 10. Prescription Screening

Permenkes 73/2016 describes prescription assessment in administrative, pharmaceutical, and clinical dimensions. The administrative layer includes patient and prescriber details and prescription date; pharmaceutical assessment includes dosage form/strength, stability, and compatibility; clinical consideration includes indication/dose, directions/duration, duplication/polypharmacy, adverse reactions/allergy, contraindications, and interactions. citeturn423312search2turn423312search61

## Product behavior

The application should provide a **screening checklist**, not silently make clinical decisions.

Example:

```text
Prescription #RX-20261006-0192

Administrative
[x] Patient name
[x] Patient age
[x] Sex
[x] Weight
[x] Prescriber identity
[x] Prescription date

Pharmaceutical
[x] Strength
[x] Dosage form
[x] Quantity
[x] Directions
[ ] Compatibility review needed

Clinical
[ ] Allergy information available
[ ] Interaction review completed
[ ] Duplication review completed
[ ] Contraindication review completed

Pharmacist decision
[ Approve ] [ Hold ] [ Contact prescriber ]
```

The “decision” must be attributable to a pharmacist/authorized role.

---

# 11. Patient Record

A patient/customer model should be richer than a retail customer profile.

### Minimum patient data

- patient ID
- name
- date of birth / age
- sex
- phone
- address
- optional email
- allergies
- relevant conditions/notes where appropriately permitted
- pregnancy/breastfeeding flags where appropriate
- weight/height where clinically needed
- emergency/contact details where relevant
- consent/privacy flags
- preferred communication

### Medication history

- date
- prescription number
- prescriber
- drug
- strength
- dosage
- directions
- quantity
- dispensing status
- pharmacist notes
- counseling notes where appropriate
- intervention notes

The 2016 technical materials include a patient-medication-record form containing patient identity, date, doctor, medicine/dose/directions, and pharmacist-service notes. citeturn423312search60

---

# 12. Dispensing / Fulfillment

Once the pharmacist approves a prescription:

1. reserve/allocate stock;
2. select batch(es), preferably FEFO for expiring medicines;
3. pick items;
4. perform compounding if applicable;
5. create labels/etiket;
6. perform final check;
7. calculate price;
8. collect payment where appropriate;
9. hand over to patient;
10. record dispense;
11. optionally send SATUSEHAT `MedicationDispense`.

### Important UX rule

Cashier should not be able to bypass pharmacist approval simply by changing a status.

Use server-side permission checks.

---

# 13. Compounding / Racikan

Compounding is one of the strongest reasons an apotek cannot use a generic POS.

The current BPOM 5/2026 framework explicitly includes **peracikan** in medicine management. citeturn159056search1

## Model a prescription compound as a BOM-like structure

Example:

```text
Compound prescription:
Puyer Batuk Anak × 10 sachets

Ingredients:
- Paracetamol 500 mg → 1/2 tablet × 10
- CTM 4 mg → 1/4 tablet × 10
- Dextromethorphan → 1/4 tablet × 10

Output:
10 sachets

Packaging:
- paper / sachet
- label

Service charges:
- compounding/tuslah
- packaging/embalase
```

### Required behaviors

- calculate ingredient quantities
- deduct ingredients from stock
- preserve ingredient batches used
- track exact quantities
- support mg/g/ml/tablet/etc.
- round only using configured, visible rules
- support packaging components
- generate etiket
- generate copy resep when needed
- allow pharmacist review before completion

### Never silently round away the pharmacist's intended quantity.

Every calculation should be explainable.

---

# 14. Product / Medication Master Data

A robust medicine product should have at least:

## Identity

- internal product ID
- SKU
- barcode(s)
- generic/active ingredient
- brand/trade name
- strength
- dosage form
- route
- package description
- manufacturer
- category/class
- product image (optional)
- KFA code
- BPOM NIE

## Regulatory / dispensing attributes

- drug class / sales restriction
- prescription-required flag
- controlled-drug classification
- precursor flag
- compounding ingredient flag
- cold-chain flag
- minimum/maximum storage condition
- BUD configuration when applicable to compounded products
- recall status
- blocked-for-sale flag

## Commercial

- supplier
- purchase price
- moving average cost / batch cost
- selling price(s)
- margin
- tax configuration
- unit(s) of sale
- discount eligibility
- promo eligibility

## Inventory

- current stock
- reserved stock
- available stock
- minimum stock
- safety stock
- reorder point
- preferred supplier
- storage location
- rack/bin

---

# 15. Unit Conversion Is a Core Concept

Example:

```text
1 Box = 10 Strip
1 Strip = 10 Tablet

1 Box = 100 Tablet
```

A pharmacy may:

- buy 5 boxes;
- receive 500 tablets;
- sell 2 strips;
- dispense 6 tablets.

**Do not store only a single quantity without a base unit.**

### Recommended model

```text
Product
  base_unit = tablet
  units:
    - tablet = 1
    - strip = 10
    - box = 100
```

Every stock movement is normalized to the base unit while preserving the transaction's displayed unit.

---

# 16. Batch + Expiry Architecture

A product and a batch are different concepts.

```text
Product: Paracetamol 500 mg

Batch A
  batch_no: P500-A01
  expiry: 2027-02
  qty: 120 tablets
  purchase_cost: 700
  supplier: PBF X

Batch B
  batch_no: P500-B14
  expiry: 2028-01
  qty: 600 tablets
  purchase_cost: 760
  supplier: PBF Y
```

## Recommended allocation policy

Primary allocation: **FEFO (First Expired, First Out)** for medicines with expiry dates.

For exceptions, allow authorized manual batch selection when clinically/operationally required, with an audit reason.

Multiple Indonesian pharmacy products explicitly position FEFO, batch, and expiry as core pharmacy functionality. This is also a recurring benchmark feature across current Indonesian pharmacy software. citeturn579019search0turn579019search3turn982856search3

**Do not claim that every pharmacy item must legally follow one universal FEFO implementation; treat it as the recommended inventory-control engine.**

---

# 17. Inventory Ledger

Every inventory change should create an immutable-ish ledger event.

### Event types

- opening balance
- purchase receipt
- sale
- prescription dispense
- compound consumption
- transfer out
- transfer in
- customer return
- supplier return
- stock adjustment
- expired/damaged write-off
- destruction
- recall quarantine
- reservation
- reservation release
- conversion/repack if supported

### Each event

```text
ledger_id
product_id
batch_id
location_id
quantity_delta_base_unit
unit_context
reference_type
reference_id
reason
actor_id
created_at
```

The UI can calculate current stock from ledger + cached balances, but the source-of-truth trail must remain explainable.

---

# 18. Procurement Workflow

A realistic pharmacy purchasing flow:

```text
Demand / Defecta
      ↓
Suggested Purchase
      ↓
Supplier Selection
      ↓
Purchase Request
      ↓
Approval
      ↓
Purchase Order / Supplier Order
      ↓
Goods Receipt
      ↓
Batch + Expiry capture
      ↓
Invoice capture
      ↓
Stock posted
      ↓
Accounts payable
```

## Inputs to purchase recommendations

- current available stock
- reserved stock
- sales velocity
- recent demand trend
- seasonality
- minimum stock
- safety stock
- reorder point
- lead time
- supplier MOQs
- supplier pack sizes
- outstanding purchase orders
- expiry risk
- supplier price
- margin

Current pharmacy practice research also shows real-world use of consumption methods, Pareto/ABC classification, epidemiological patterns, forecasting, and defecta-based replenishment. citeturn767483search5turn767483search4

---

# 19. Defecta / Reorder Engine

The product should make replenishment explainable.

Example recommendation:

```text
Amoxicillin 500 mg

Available: 18 strips
Reserved: 6
Effective available: 12
Avg daily sales: 7.2 strips
Supplier lead time: 3 days
Safety stock: 15
Reorder point: 37

Recommended order: 72 strips
Reason:
stock below ROP + expected 14-day demand + safety stock
```

### Methods to support later

- minimum/maximum stock
- reorder point
- safety stock
- moving average
- weighted moving average
- seasonal multiplier
- Pareto/ABC
- V/E/S/O or similar criticality classification
- EOQ as an optional management calculation
- manual planner override

The product should expose the formula/reason rather than output a black-box “AI recommendation”.

---

# 20. Stock Receiving

Receiving is a high-risk data-quality moment.

### Receiving checklist

- supplier
- invoice number
- purchase order
- delivery date
- product
- quantity ordered
- quantity received
- unit
- batch
- expiry
- purchase price
- discounts
- tax
- damaged quantity
- temperature-sensitive handling where relevant
- acceptance/rejection
- receiver

### Important

Never create a batch without a receiving event when batch traceability is enabled.

---

# 21. Supplier Management

Supplier profile should contain:

- supplier identity
- PBF/vendor type
- contact
- NPWP/company fields as needed
- payment terms
- credit limit
- lead time
- minimum order
- catalog
- preferred products
- negotiated prices
- price history
- reliability score
- return policy
- outstanding AP

### Analytics

- average delivery lead time
- fill rate
- late delivery rate
- rejected quantity
- price increase history
- purchase share
- outstanding invoice value

---

# 22. Purchase Invoice + Accounts Payable

A pharmacy management system should connect physical stock to financial obligation.

Flow:

`PO → Goods Receipt → Supplier Invoice → AP → Payment`

Features:

- invoice due date
- partial payment
- credit terms
- payment history
- supplier statement
- invoice discrepancy
- outstanding AP aging

---

# 23. Returns

## Supplier return

Possible reasons:

- damaged
- wrong item
- wrong quantity
- near expiry
- recalled product
- temperature excursion
- commercial return
- supplier agreement

Must preserve:

- batch
- quantity
- reason
- supplier
- return document
- actor
- approval

## Customer return

Do not automatically place returned medicines back into sellable stock.

The current BPOM framework requires returned medicines to be assessed and properly documented if they are to be used again, with stock-card traceability. citeturn159056search1

Recommended states:

`RETURN_RECEIVED → QUARANTINE → QA_DECISION → RESTOCK / WRITE_OFF / RETURN_SUPPLIER / DESTROY`

---

# 24. Expiry Management

This should be one of the most visible inventory features.

### Alert bands

Configurable, e.g.:

- expired
- < 30 days
- 30–60 days
- 60–90 days
- > 90 days

### Dashboard

```text
Expired:          Rp 2.1M
<30 days:         Rp 3.8M
30–60 days:       Rp 5.4M
60–90 days:       Rp 7.2M
```

### Actions

- quarantine
- transfer to another branch
- prioritize FEFO
- supplier return
- controlled discount if legally/operationally appropriate
- write-off
- destruction workflow

Do not allow users to change expiry or batch numbers from ordinary product-edit forms without privileged audit events.

---

# 25. Recall Management

A good pharmacy system should support product/batch recall.

Input:

- recalled product
- recalled batch
- recall reason
- source/authority/manufacturer
- effective date
- affected locations

System behavior:

1. block future sale/dispense;
2. locate all stock by batch;
3. identify purchase receipts;
4. identify affected sales/dispenses where permitted;
5. quarantine remaining stock;
6. generate recall task;
7. record resolution.

This becomes very powerful because batch-level traceability is already modeled.

---

# 26. Stock Opname

The system should support both:

- planned full stock opname;
- continuous/cycle-count opname.

Current Indonesian pharmacy software frequently markets stock opname without closing the pharmacy, including mobile/barcode-based counting. citeturn579019search8turn982856search3

## Recommended flow

```text
Create count session
  ↓
Freeze only selected location/category if necessary
  ↓
Count by barcode / manual
  ↓
Compare system vs physical
  ↓
Variance review
  ↓
Approval
  ↓
Adjustment ledger
```

Never make stock adjustments silently.

Variance report:

| Product | System | Physical | Variance | Value | Reason | Approved by |
|---|---:|---:|---:|---:|---|---|

---

# 27. Cashier / Shift Management

A pharmacy POS should have explicit cash shifts.

### Open shift

- cashier
- workstation
- branch
- opening cash
- timestamp

### During shift

- sales
- refunds
- cash in/out
- payment methods
- prescription sales
- discounts
- voids

### Blind closing

Recommended:

1. cashier counts physical cash without seeing expected cash;
2. enters actual amount;
3. system calculates variance;
4. supervisor reviews.

Current pharmacy POS competitors explicitly market shift management, cash reconciliation, and audit trails as core pharmacy controls. citeturn579019search0turn982856search6

---

# 28. Payment Methods

Support at minimum:

- cash
- QRIS
- bank transfer
- debit/credit card
- e-wallet where integrated
- mixed/split payment
- receivable/credit for authorized customers

Payment must remain independent from stock posting semantics so failed/reversed payments can be handled safely.

---

# 29. Customer / Membership

Customers can be modeled at two levels:

### Retail customer

- name
- phone
- purchase history
- membership
- points/promotions

### Patient

A patient is a clinical identity and needs stronger privacy/access control. A person may be both a customer and a patient, but do not force the application to make all retail customers into patients.

Recommended identity relationship:

```text
Person
 ├── Customer Profile
 └── Patient Profile
```

---

# 30. Online Orders / Marketplace / Delivery

This is increasingly relevant. Current Indonesian pharmacy platforms support online prescription upload, online orders, and branch-based fulfillment. K24Klik supports prescription upload and delivery; GoApotik supports upload → merchant review → checkout, with restrictions for certain controlled/risky products. citeturn779944search1turn779944search5

POS should therefore optionally expose an **Order Queue**:

```text
NEW
→ NEEDS_REVIEW
→ PRESCRIPTION_REVIEW
→ ACCEPTED
→ PACKING
→ READY_FOR_PICKUP
→ OUT_FOR_DELIVERY
→ COMPLETED
→ CANCELLED
```

### Online-specific rules

- reserve inventory carefully;
- do not oversell stock already reserved for prescription/online orders;
- prescription upload should be protected;
- pharmacist approval should remain explicit;
- delivery address is personal data;
- controlled/restricted products require stricter routing.

---

# 31. Reporting & Analytics

The owner dashboard should answer business questions, not merely show charts.

## 31.1 Sales dashboard

KPIs:

- gross sales
- net sales
- transactions
- average basket size
- units sold
- prescription sales
- OTC sales
- sales by category
- sales by product
- sales by branch
- sales by cashier
- sales by payment method

Charts:

- sales trend
- hour/day heatmap
- top products
- top categories
- prescription vs OTC

---

## 31.2 Profitability

Important distinction:

**Revenue ≠ profit.**

Show:

- revenue
- COGS / HPP
- gross profit
- gross margin %
- discounts
- stock write-offs
- expiry losses
- estimated contribution after variable fees

### Product profitability

```text
Product
Sales Qty
Revenue
Average Cost
COGS
Gross Profit
Margin %
```

---

## 31.3 Inventory dashboard

KPIs:

- inventory value
- available value
- reserved value
- slow-moving value
- dead stock value
- near-expiry value
- expired value
- stockout count
- inventory turns
- days of inventory

### Health score

Optional:

```text
Inventory Health =
availability + expiry risk + aging + movement + margin
```

Do not use one opaque score without allowing drill-down.

---

# 32. Procurement Analytics

KPIs:

- purchases by supplier
- purchase value by category
- purchase price trend
- order frequency
- fill rate
- lead time
- late supplier rate
- PO outstanding
- AP aging
- defecta coverage
- stockout caused by supplier delay

### Supplier scorecard

```text
Supplier A
Fill rate: 96%
Avg lead time: 2.4 days
Late PO: 5%
Price change: +4.2%
Returns: 1.3%
```

---

# 33. Expiry / Waste Analytics

This is a major pharmacy-specific owner metric.

Show:

- expired units
- expired value at cost
- write-off value
- near-expiry value
- expiry by supplier
- expiry by product
- expiry by branch
- expiry by batch
- recurring expiry SKUs

### Useful question

> “How much money is currently at risk because stock is likely to expire?”

This is more useful than merely listing expiry dates.

---

# 34. Prescription Analytics

KPIs:

- prescriptions received
- prescriptions completed
- rejected/held prescriptions
- partial fills
- average turnaround time
- compounding count
- compounded revenue
- prescription items per Rx
- repeat patients
- top prescribers
- top prescribed products

### Operational metric

`Prescription turnaround time = Ready for dispensing - prescription received`

Break this down by:

- branch
- shift
- hour
- prescription type
- compounding/non-compounding

---

# 35. Pharmacist / Service Analytics

Do **not** turn clinical staff into simplistic sales-ranking employees.

Useful operational measures:

- prescriptions reviewed
- interventions documented
- average review time
- counseling sessions documented
- service queue waiting time
- unresolved prescription holds
- controlled transaction review count

Clinical quality metrics should be handled carefully and with pharmacist/domain input.

---

# 36. Employee Analytics

For cashier/operations staff:

- sales by staff
- transaction count
- average basket
- voids
- discounts
- returns
- stock adjustments
- cash variance
- shift attendance

For supervisors:

- unauthorized attempts
- repeated corrections
- unusual discount pattern
- repeated stock adjustments

The goal is operational control, not surveillance theater.

---

# 37. Multi-Branch Management

For a pharmacy chain, separate:

- organization
- branch
- warehouse/store room
- workstation
- cashier
- inventory location

### Capabilities

- consolidated sales
- branch P&L
- branch inventory value
- inter-branch transfer
- central purchasing
- branch-specific pricing
- shared product master
- branch-specific suppliers
- transfer requests
- transfer receiving

Current pharmacy systems in Indonesia increasingly market multi-branch consolidation and role-based branch controls. citeturn579019search12turn982856search9

---

# 38. Roles & Permissions

Recommended roles:

### Owner / Super Admin

Full access.

### Branch Manager

- branch sales
- inventory
- purchasing
- staff
- reports

### Pharmacist / APJ

- prescription screening
- dispensing approval
- compounding verification
- controlled medication approval
- clinical notes
- controlled stock reconciliation

### Pharmacy Technician / TTK

- prepare/pick
- receive goods
- inventory operations within limits
- draft transactions

### Cashier

- OTC sales
- payment
- customer lookup
- print receipt
- limited prescription checkout after approval

### Purchasing

- suppliers
- PO
- receiving
- invoice/AP

### Warehouse

- receive
- move
- stock count
- batch/expiry

### Finance

- payment
- AP/AR
- expenses
- financial reports

### Auditor / Read-only

- reports
- audit trail
- no mutation

**Critical:** enforce authorization on the backend/API, not just hidden menus. Current pharmacy software also emphasizes server-side permissions and audit trails. citeturn982856search6

---

# 39. Audit Trail

Audit events should include:

```text
who
what
when
where/branch
entity
entity_id
before
after
reason
reference
ip/device (where appropriate)
```

High-risk events:

- stock adjustments
- price changes
- prescription changes
- prescription cancellation
- controlled-medication dispense
- controlled-medication adjustment
- user permission changes
- batch/expiry changes
- supplier changes
- refunds
- voids
- manual payment changes
- destruction
- return-to-stock decision

A current Indonesian pharmacy POS benchmark explicitly treats cancellations, stock adjustments, price changes, controlled medicine sales, and user changes as audit events. citeturn982856search6

---

# 40. Offline-First Is a Serious Product Advantage

Indonesian pharmacy software products actively position offline transaction capability as a differentiator because internet interruptions should not stop the counter. citeturn579019search12turn982856search8

Recommended architecture:

### Local POS cache / local transaction queue

```text
POS Client
   ↓
Local DB / transaction queue
   ↓
Sync engine
   ↓
Cloud API
   ↓
Central DB
```

### Offline-safe transactions

Could include:

- OTC sales
- payment receipt
- stock deduction
- printed receipt
- shift events

For operations requiring cloud verification/integration, expose a clear “pending sync” or “requires connection” state.

### Avoid

Silent conflicts.

The sync system needs:

- idempotency keys
- deterministic transaction IDs
- conflict policy
- retry queue
- sync status
- audit log

---

# 41. Data Model — Suggested Core Entities

```text
Organization
Branch
Location
Workstation
User
Role
Permission
Employee

Product
ProductVariant
ProductUnit
ProductBarcode
ProductRegulatoryProfile
ProductPrice
ProductSupplier

Batch
InventoryBalance
InventoryLedger
InventoryReservation
InventoryLocation

Supplier
PurchaseOrder
PurchaseOrderItem
GoodsReceipt
GoodsReceiptItem
SupplierInvoice
SupplierPayment
PurchaseReturn
PurchaseReturnItem

Customer
Patient
PatientAllergy
PatientMedicationHistory
Prescriber

Prescription
PrescriptionItem
PrescriptionReview
PrescriptionIntervention
Dispense
DispenseItem
DispenseBatchAllocation
CompoundRecipe
CompoundIngredient
CompoundingSession
MedicationLabel
CounselingRecord

Sale
SaleItem
Payment
Refund
CashShift
CashMovement

StockCount
StockCountItem
StockAdjustment
Transfer
TransferItem
Recall
RecallItem
Destruction
DestructionItem

Expense
Account
JournalEntry (optional finance module)

AuditEvent
IntegrationEvent
SyncJob
Notification
```

---

# 42. Prescription Data Model — Example

```ts
Prescription {
  id
  prescriptionNumber
  patientId
  prescriberId
  branchId
  source // PHYSICAL | SATUSEHAT | INTERNAL | ONLINE_UPLOAD
  receivedAt
  prescriptionDate
  status
  originalDocumentId?
  nationalPrescriptionNumber?
  reviewedBy?
  reviewedAt?
  notes?
}

PrescriptionItem {
  id
  prescriptionId
  productId?
  prescribedText
  strength?
  dosageForm?
  dose?
  frequency?
  duration?
  route?
  quantity
  quantityUnit
  instructions
  substitutionAllowed?
  compoundGroupId?
  status
}
```

Do not assume the raw prescription text always maps 1:1 to a product master item. Keep the original prescribed wording and then map it to an internal product.

---

# 43. Inventory Data Model — Example

```ts
Product {
  id
  sku
  name
  genericName?
  strength?
  dosageForm?
  baseUnit
  kfaCode?
  bpomNie?
  prescriptionRequired
  controlledClass?
  coldChain
}

ProductUnit {
  id
  productId
  name
  multiplierToBase
  barcode?
  sellPrice
}

Batch {
  id
  productId
  batchNumber
  expiryDate
  receivedAt
  supplierId
  purchaseCost
  locationId
  status // AVAILABLE | QUARANTINE | RECALLED | EXPIRED | DESTROYED
}
```

---

# 44. POS UX Principles

## Counter-first

For a cashier, the main view should prioritize:

- search/scan
- cart
- quantity/unit
- payment
- customer
- receipt

Everything else should not get in the way.

## Pharmacist-first

For prescription work:

- patient context is always visible
- prescription image/text is visible
- screening checklist is obvious
- stock availability is visible
- pharmacist decision is explicit
- interventions are documented

## Owner-first

The dashboard should answer:

> What is selling?
> What is profitable?
> What is about to expire?
> What is out of stock?
> Where is cash stuck?
> Which supplier is causing trouble?
> What needs my attention today?

---

# 45. Navigation Proposal

```text
Dashboard

POINT OF SALE
  New Sale
  Prescription Queue
  Online Orders
  Transactions
  Refunds
  Shifts

PHARMACY
  Prescription Management
  Patient Records
  Dispensing
  Compounding
  Counseling / Services
  Controlled Medicines
  Prescription Archive

INVENTORY
  Products
  Batches & Expiry
  Stock Ledger
  Stock Opname
  Transfers
  Returns
  Recall / Quarantine
  Destruction

PROCUREMENT
  Defecta / Reorder
  Purchase Requests
  Purchase Orders
  Receiving
  Supplier Invoices
  Suppliers
  Accounts Payable

CUSTOMERS
  Customers
  Patients
  Prescribers
  Membership

FINANCE
  Payments
  Expenses
  Cash / Bank
  Accounts Receivable
  Accounts Payable
  Profit & Loss

ANALYTICS
  Sales
  Profitability
  Inventory
  Expiry / Waste
  Procurement
  Prescriptions
  Staff
  Branch Comparison

MANAGEMENT
  Staff
  Roles & Permissions
  Branches
  Pricing
  Promotions
  Settings
  Integrations

COMPLIANCE
  Audit Trail
  Controlled Medicine Logs
  Regulatory Reports
  Integration Logs
```

---

# 46. Dashboard Wireframe Concept

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Good morning. 6 October 2026                         Branch: Sleman │
├────────────────┬────────────────┬────────────────┬──────────────────┤
│ Sales Today    │ Gross Profit   │ Rx Waiting     │ Near Expiry     │
│ Rp 18.4M       │ Rp 4.8M        │ 7              │ Rp 3.2M         │
├────────────────┴────────────────┴────────────────┴──────────────────┤
│ Sales Trend                                                     │
│ ████▆▆██████▇▇████                                            │
├──────────────────────────────┬──────────────────────────────────────┤
│ Stock Alerts                 │ Purchasing                            │
│ 12 stockout                  │ 8 PO pending                         │
│ 24 low stock                 │ Rp 52M outstanding AP                │
│ 13 expiry <30d               │ 3 supplier delays                    │
├──────────────────────────────┼──────────────────────────────────────┤
│ Top Products                 │ Action Queue                          │
│ Paracetamol 500mg            │ Review 4 prescriptions                │
│ Vitamin X                    │ Approve 2 purchase requests           │
│ Amoxicillin 500mg            │ Resolve 1 stock discrepancy           │
└──────────────────────────────┴──────────────────────────────────────┘
```

---

# 47. Reporting Library

## Operational

- daily sales
- shift report
- cashier report
- payment method
- transaction list
- void/return report

## Prescription

- prescription register
- prescription items
- dispense history
- patient medication history
- intervention report
- compounding report
- controlled medicine transactions

## Inventory

- stock on hand
- stock valuation
- stock ledger/card
- batch report
- expiry report
- dead stock
- slow-moving stock
- stock adjustment
- stock opname variance
- stock transfer
- recall
- destruction

## Procurement

- purchase register
- supplier purchase
- product purchase
- price history
- PO status
- receiving discrepancies
- supplier performance
- AP aging

## Financial

- P&L
- COGS
- margin
- cash movement
- expense
- AR aging
- AP aging
- payment report

## Management

- branch comparison
- staff activity
- permissions
- audit report
- integration health

---

# 48. Analytics That Are Actually Useful

Avoid vanity charts such as “total products: 13,422”.

Prioritize decision metrics:

### Revenue

- revenue trend
- basket size
- category contribution

### Margin

- gross margin by SKU
- gross margin by category
- margin leakage due discounts

### Inventory capital

- inventory value
- days of inventory
- dead stock value

### Availability

- stockout rate
- lost-sales estimate
- critical medicine availability

### Expiry

- expiry at risk
- expiry loss actual
- top recurring expiry items

### Procurement

- supplier lead time
- fill rate
- price inflation

### Operations

- prescription turnaround time
- queue time
- cashier variance

---

# 49. Alert System

Create a unified **Action Center**.

Examples:

```text
CRITICAL
• Controlled stock discrepancy: Alprazolam 1 mg
• 3 products have expired stock still present in sellable location

HIGH
• Amoxicillin 500mg projected stockout in 2 days
• Supplier invoice due today: Rp 24.2M

MEDIUM
• 14 batches expire within 60 days
• 6 purchase orders delayed

INFO
• Monthly sales are +8.4%
```

Alerts should be actionable, snoozable when appropriate, and link directly to the object that needs action.

---

# 50. Notifications

Channels:

- in-app
- email
- WhatsApp (optional integration)
- push notification

Potential notifications:

- near expiry
- low stock
- stockout
- failed sync
- purchase approval
- PO arrival
- invoice due
- controlled-stock variance
- online prescription received
- prescription ready

Do not spam staff. Use priority levels and digest options.

---

# 51. AI Opportunities — Later, Not First

AI can be useful, but should sit **after correct transactional data**.

Good AI use cases:

- demand forecasting
- “why did gross margin fall?” summaries
- natural-language report exploration
- anomaly detection for stock adjustments
- supplier delay prediction
- expiry-risk prioritization
- product search normalization
- OCR of supplier invoices
- OCR assistance for prescription intake

Unsafe/poor first use cases:

- autonomous diagnosis
- autonomous prescription approval
- autonomous substitution of medication
- autonomous clinical interaction decisions
- silently changing dose/quantity

For clinical behavior, the system should remain a decision-support tool under pharmacist control.

---

# 52. Recommended MVP

## MVP must have

### POS
- barcode/search
- cart
- OTC sale
- payment
- receipt
- shift open/close
- cashier role

### Inventory
- product master
- units/conversion
- stock
- batch
- expiry
- FEFO allocation
- stock ledger
- stock opname

### Purchasing
- suppliers
- purchase order
- goods receipt
- batch/expiry capture
- purchase price
- AP due date

### Pharmacy
- patient
- prescriber
- prescription intake
- screening checklist
- dispensing workflow
- etiket
- prescription archive
- partial fulfillment
- basic compounding

### Management
- dashboard
- sales reports
- inventory reports
- purchasing reports
- gross-margin report
- expiry report
- audit trail
- roles/permissions

### Infrastructure
- backups
- offline-safe POS queue
- sync status
- CSV import/export

---

# 53. Phase 2

- online order queue
- prescription upload
- mobile stock opname
- supplier performance analytics
- defecta/reorder engine
- promotions
- customer membership
- multi-branch transfers
- recall management
- destruction workflows
- controlled medicine module
- WhatsApp notifications
- SATUSEHAT connector
- KFA sync
- accounting integration

---

# 54. Phase 3

- advanced forecasting
- centralized procurement
- advanced multi-branch analytics
- automated supplier recommendations
- advanced loyalty
- warehouse/mobile picking
- e-commerce / marketplace connectors
- clinical documentation expansion
- AI analytics assistant
- advanced finance / accounting

---

# 55. What NOT to Build in the First Version

Avoid:

- full hospital EMR
- doctor appointment system
- laboratory information system
- diagnostic AI
- full accounting ERP
- complex insurance claims engine
- social-commerce marketplace
- automatic clinical substitution
- excessive pharmacy-specific configuration before core workflow is stable

First prove:

> sale → stock → batch → expiry → prescription → dispense → purchase → profit

That loop is the heart of the system.

---

# 56. Critical Edge Cases

## Inventory

- same product, multiple batches
- same batch across multiple locations
- partial box/strip sale
- expired batch still has quantity
- batch recall after previous sales
- stock negative attempt
- stock adjustment after period close
- transfer in transit

## Prescription

- partial fill
- out-of-stock item
- prescription changed after screening
- patient refuses one item
- doctor clarification pending
- prescription expired/invalid
- duplicate prescription upload
- repeat/copy prescription
- controlled prescription
- compound recipe

## Payments

- split payment
- payment failure
- underpayment
- refund after settlement
- offline sale sync conflict

## Procurement

- partial receiving
- short shipment
- extra shipment
- substitute product
- supplier price differs from PO
- batch/expiry missing
- invoice arrives later

## Returns

- sale return
- supplier return
- returned medicine quarantine
- return approved but supplier credit not received

## Compliance

- controlled stock mismatch
- destruction requires witness
- audit of deleted/changed records
- report-period correction
- integration outage

---

# 57. Acceptance Criteria — Core POS

### Sale

- [ ] scan/search product
- [ ] choose correct unit
- [ ] price calculates correctly
- [ ] discount respects permission
- [ ] tax is configurable
- [ ] stock reduces atomically
- [ ] batch allocation is recorded
- [ ] payment recorded
- [ ] receipt generated
- [ ] transaction cannot be silently duplicated

### Prescription

- [ ] prescription cannot be completed without required screening
- [ ] pharmacist reviewer is recorded
- [ ] patient is linked
- [ ] prescriber is linked
- [ ] batch allocation is recorded
- [ ] dispensing event is immutable/auditable
- [ ] partial fill is possible
- [ ] compound ingredients reduce inventory correctly
- [ ] etiket generated

### Inventory

- [ ] every stock-changing action has a ledger event
- [ ] batch and expiry are preserved
- [ ] unit conversion is deterministic
- [ ] stock opname creates auditable adjustments
- [ ] expired/recall status can prevent sale

---

# 58. Recommended Technical Principles for Claude Code

## 58.1 Build the domain model before polishing screens

Suggested order:

1. domain/entities
2. inventory ledger
3. transaction engine
4. prescription state machine
5. permissions
6. APIs
7. POS UI
8. management UI
9. reports
10. integrations

## 58.2 Keep pharmacy domain logic separate

Example modules:

```text
/domain
  /inventory
  /products
  /prescriptions
  /dispensing
  /compounding
  /procurement
  /patients
  /cashier
  /payments
  /reports
  /compliance
  /audit
  /integrations
```

## 58.3 Prefer explicit state machines

Do not represent important workflow with dozens of booleans.

Bad:

```ts
isApproved
isReady
isPaid
isDispensed
isCancelled
```

Better:

```ts
status: PrescriptionStatus
```

with controlled transitions.

## 58.4 Use immutable event records for sensitive histories

Especially:

- stock ledger
- audit events
- controlled medicine changes
- prescription status transitions
- financial transactions

## 58.5 Server-side authorization

Never rely on front-end visibility for privileged actions.

---

# 59. Suggested API Surface

```text
POST   /sales
POST   /sales/:id/pay
POST   /sales/:id/refund
GET    /sales

POST   /prescriptions
POST   /prescriptions/:id/screen
POST   /prescriptions/:id/approve
POST   /prescriptions/:id/hold
POST   /prescriptions/:id/dispense
POST   /prescriptions/:id/partial-dispense

POST   /compounds
POST   /compounds/:id/complete

GET    /patients/:id
GET    /patients/:id/medication-history

GET    /inventory
GET    /inventory/ledger
POST   /stock-counts
POST   /stock-adjustments
POST   /transfers
POST   /returns
POST   /recalls
POST   /destructions

POST   /purchase-orders
POST   /goods-receipts
POST   /supplier-invoices
POST   /supplier-payments

POST   /shifts/open
POST   /shifts/close

GET    /analytics/sales
GET    /analytics/margins
GET    /analytics/inventory
GET    /analytics/expiry
GET    /analytics/procurement
GET    /analytics/prescriptions

GET    /audit-events

POST   /integrations/satusehat/sync
POST   /integrations/kfa/sync
```

---

# 60. Data Integrity Rules

These should become automated tests.

### Stock

`stock_available >= 0` unless negative inventory is explicitly supported for an exceptional workflow.

### Prescription

`DISPENSED` requires a valid approved dispensing pathway.

### Payment

`COMPLETED sale` must have a valid payment state or authorized receivable.

### Batch

No batch allocation without a known batch if batch tracking is enabled for that product.

### Expiry

No ordinary sale from an expired/quarantined/recalled batch.

### Controlled medicine

No dispense without required authorization and prescription evidence.

### Audit

Sensitive mutations create an audit event.

---

# 61. Research Benchmark: What Current Indonesian Products Emphasize

The current competitive landscape is useful for discovering expected functionality.

## Apotika

Emphasizes:

- offline POS
- batch/expiry
- FEFO
- derived selling units
- payment methods
- cash reconciliation
- controlled-drug logbook
- purchase/inventory
- stock opname
- transfers
- audit trail
- multi-branch reports

Source: Apotika feature pages. citeturn579019search0turn982856search6

## Farmadigi

Emphasizes:

- POS
- recipe/compounding
- tuslah + embalase
- FEFO
- offline-ready
- SIPNAP export
- invoice scanning
- shift reconciliation
- digital labels

Source: Farmadigi. citeturn500238search0turn982856search8

## Mitra Apotek Digital

Emphasizes:

- POS
- prescription management
- RME
- FEFO/FIFO
- expiry management
- stock opname
- defecta
- Pareto analysis
- AP/AR
- financial reports
- employee scheduling
- KPI dashboard

Source: Google Play listing. citeturn982856search2

## GPOS Lite

Emphasizes:

- offline and online order management
- marketplace integration
- online prescription process
- PBF purchasing
- sales/purchase/stock reports
- schedule/shift management

Source: Google Play listing, updated June 2026. citeturn579019search1turn779944search6

## Macha Apotek

Emphasizes:

- sales
- purchases
- consignment
- AP/AR
- expenses
- returns
- mobile POS
- mobile stock opname
- FIFO/FEFO
- batch/expiry
- unit conversion
- accounting
- patient records
- multi-branch

Source: Macha. citeturn982856search3

## Vmedis

Its published UI/feature material demonstrates a mature pharmacy POS style with prescription-oriented checkout, customer/patient fields, price selection, and management analytics across desktop/mobile. citeturn982856image2turn982856image5

### Competitive takeaway

The baseline market expectation has moved beyond:

> **“cashier + inventory”**

toward:

> **“POS + pharmacy workflow + inventory control + procurement + financial management + reporting + compliance + mobile/online operations.”**

---

# 62. Key Product Differentiators We Should Consider

A new system should not win merely by having more menus.

Potential differentiators:

## 1. One traceability graph

Click any medicine batch and answer:

> Where did it come from? How much did we buy? Which receipts? Where is it now? Which patients/orders received it? Was any quantity returned, recalled, or destroyed?

## 2. Action-oriented owner dashboard

Instead of 50 charts:

> “You have Rp 14.7M in stock at expiry risk and 9 purchase recommendations worth Rp 21M.”

## 3. Pharmacist-safe workflow

The system actively respects clinical role boundaries.

## 4. Offline-first

Counter operations continue through internet interruption.

## 5. Explainable procurement

Every recommendation shows the reasoning.

## 6. Excellent search

Search should understand:

- brand
- generic
- partial name
- strength
- dosage form
- barcode
- KFA
- internal SKU

## 7. Batch drill-down everywhere

The batch should not be hidden in a warehouse report.

---

# 63. Product Questions to Validate with a Real Pharmacist Before Coding Too Deeply

These should become the domain-discovery interview checklist.

### Prescription

1. What prescription types do you receive most often: paper, internal electronic, SATUSEHAT/e-resep, online upload?
2. Which fields do you always inspect before accepting?
3. What causes a prescription to be held?
4. How are partial fills handled?
5. How are repeat/copy prescriptions handled?
6. Who performs each step: cashier, TTK, pharmacist?

### Compounding

7. Which compound types are common?
8. How are ingredient calculations currently done?
9. How is BUD handled?
10. Which packaging costs are charged?

### Inventory

11. Do they use FEFO consistently?
12. How are open boxes/strips handled?
13. What happens to returned medication?
14. How are near-expiry products handled?
15. How often is stock counted?

### Procurement

16. What is the actual defecta process?
17. Who approves purchase orders?
18. How much purchasing is centralized?
19. How are supplier price changes captured?
20. How are shortages/substitutions recorded?

### Controlled medicines

21. Which controlled categories are handled?
22. Who can approve them?
23. How is the controlled stock currently reconciled?
24. Which reports are actually submitted and how?

### Business

25. What are the biggest sources of margin leakage?
26. What gets written off most often?
27. What are the most important owner KPIs?

---

# 64. Core Product Loop

Everything should ultimately make this loop clean:

```text
                  ┌─────────────┐
                  │  PROCUREMENT │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │   RECEIVING  │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │   INVENTORY  │
                  │ batch + ED   │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │ SALE / RX    │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │  DISPENSING  │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │  CUSTOMER /  │
                  │    PATIENT   │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │    MONEY     │
                  │ sales / AP   │
                  └──────┬──────┘
                         ↓
                  ┌─────────────┐
                  │  ANALYTICS   │
                  └─────────────┘
```

The system becomes valuable when all boxes are connected by reliable data.

---

# 65. Final Recommendation

Build the product in this order:

### Foundation

**Product + Unit + Batch + Inventory Ledger + Permissions + Audit**

### Transaction engine

**OTC POS + Payment + Shift + Receipt**

### Pharmacy engine

**Patient + Prescriber + Prescription + Screening + Dispensing + Label + Prescription Archive**

### Supply engine

**Supplier + Purchase Order + Receiving + Defecta + Reorder + AP**

### Control engine

**Expiry + Recall + Returns + Destruction + Controlled Medicines**

### Intelligence engine

**Sales + Margin + Inventory + Expiry + Procurement + Prescription + Staff analytics**

### Ecosystem engine

**SATUSEHAT + KFA + online order/marketplace + accounting + messaging**

The product should be architected for all of these from day one, but only a carefully selected subset needs to ship in MVP.

---

# 66. Source Register

## Official / primary

1. **Kemenkes JDIH — Permenkes 73/2016: Standar Pelayanan Kefarmasian di Apotek**  
   https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-73-tahun-2016

2. **Kemenkes Farmalkes — Permenkes 73/2016**  
   https://farmalkes.kemkes.go.id/unduh/permenkes-73-2016/

3. **Kemenkes JDIH — Permenkes 9/2017: Apotek**  
   https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-9-tahun-2017

4. **Kemenkes — Permenkes 17/2024 amendment / Standard Usaha Apotek (KBLI 47721)**  
   https://jdih.kemkes.go.id/common/dokumen/2024permenkes017.pdf

5. **OSS — KBLI 2025 47721**  
   https://oss.go.id/kbli/detail/48ecd070-a47c-5abd-95a8-fc4e8c14eb0b

6. **BPOM JDIH — PerBPOM 5/2026**  
   https://jdih.pom.go.id/preview/slide/1742/5/2026/c92a10324374fac681719d63979d00fe

7. **BPOM — Press release on PerBPOM 5/2026**  
   https://www.pom.go.id/siaran-pers/regulasi-baru-bpom-atur-pengelolaan-obat-dan-bahan-obat-di-fasilitas-pelayanan-kefarmasian-dan-fasilitas-lain

8. **Kemenkes — SIPNAP**  
   https://sipnap.kemkes.go.id/

9. **Kemenkes — Permenkes 24/2022: Rekam Medis**  
   https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-24-tahun-2022

10. **SATUSEHAT — Pelayanan Kefarmasian**  
    https://satusehat.kemkes.go.id/platform/docs/id/interoperability/kefarmasian/

11. **SATUSEHAT — Master Data / KFA**  
    https://satusehat.kemkes.go.id/platform/docs/id/master-data/

12. **SATUSEHAT — KFA REST API**  
    https://satusehat.kemkes.go.id/platform/docs/id/master-data/kfa/rest-api-kfa/

13. **Kemenkes — Technical Guidelines for Pharmaceutical Service Standards in Pharmacies (2019)**  
    https://farmalkes.kemkes.go.id/unduh/petunjuk-teknis-standar-pelayanan-kefarmasian-di-apotek/

## Competitive / market benchmark

14. Apotika — https://www.apotika.id/fitur
15. Farmadigi — https://farmadigi.id/
16. Mitra Apotek Digital — Google Play listing
17. GPOS Lite — Google Play listing
18. Macha Apotek — https://www.macha.id/
19. Apotek Digital — https://apotekdigital.com/
20. Vmedis — https://vmedis.com/
21. CentralData — https://centraldata.page/produk/aplikasi-kasir-apotek
22. GoApotik — https://store.goapotik.com/pages/faq
23. K24Klik — https://www.k24klik.com/

---

# 67. Claude Code Agent Brief

Paste this section at the top of the engineering task when asking Claude Code to start implementation.

> **You are building an Indonesian pharmacy/apotek operating system, not a generic POS.**
>
> The core domain must support products, multiple units, batches, expiry, FEFO allocation, inventory ledger, procurement, prescriptions, patients, prescribers, dispensing, compounding, payments, cash shifts, audit trails, permissions, analytics, and future SATUSEHAT/KFA integration.
>
> Treat pharmacy workflows as state machines. Do not use a handful of booleans for prescription/dispensing state. Keep sensitive records traceable and auditable. Enforce permissions server-side.
>
> Build an inventory ledger rather than directly mutating a stock number from arbitrary UI actions. A sale, receipt, return, transfer, destruction, adjustment, and compounding event should produce explicit inventory movements.
>
> Separate internal SKU/product identity from external identifiers such as KFA and BPOM NIE.
>
> Treat patient data as a separate, more sensitive domain than ordinary retail-customer data.
>
> Prescription approval must remain attributable to a pharmacist/authorized role. The application may assist screening and surface warnings, but must not autonomously make clinical decisions.
>
> Design for offline-safe counter transactions with explicit sync states.
>
> MVP priority: Product → Unit → Batch → Inventory → OTC POS → Payment/Shift → Prescription → Dispensing → Purchase/Receiving → Dashboard/Reports → Audit/Permissions.
>
> Regulatory references in this document reflect research available on 6 October 2026. Regulatory details, especially controlled medicines and external reporting, must be validated against the current official rule set before production deployment.

---
