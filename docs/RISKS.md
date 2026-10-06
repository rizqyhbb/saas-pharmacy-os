# Risk Register

Status: v0.1 · 6 Oct 2026 · Likelihood (L) and Impact (I): H / M / L. Owner = who watches it. Reviewed at every milestone gate.

## Top risks

| # | Risk | L | I | Mitigation | Early signal | Owner |
|---|---|---|---|---|---|---|
| R1 | **Clinical workflow modelled wrongly** (we are not pharmacists) | H | H | APJ reviewer sign-off before M4 (G4-1); system is decision-support only; discovery interview first; no clinical content authored from model knowledge | Pharmacist says "we don't do it like that" in review | Owner |
| R2 | **Regulatory drift or a wrong compliance claim** (BPOM 5/2026 just replaced 24/2021) | M | H | Every rule dated and sourced; `[VALIDATE]` tags; claim nothing as "compliant" or "SIPNAP-ready" without APJ + counsel; export-first posture | Source regulation amended; contradictory pharmacist advice | Owner |
| R3 | **Offline sync loses or duplicates a sale / corrupts stock** | M | H | Idempotency keys, deterministic IDs, ledger, explicit conflict state, 8-h soak test, two-workstation race test (G1) | Outbox ≠ server reconciliation | Eng |
| R4 | **Patient-data exposure** (logs, exports, demo, offline cache, cross-tenant) | L | H | Separate patient domain, access logging, RLS + isolation suite, scan for patient data in logs/exports, no offline patient cache in v1.1, counsel review of UU PDP | Any patient field in a log line | Eng / Owner |
| R5 | **Scope creep toward ERP/EMR** | H | M | Non-goals list; lean-core MVP; every new request must map to a PRD ID or be deferred | Backlog items without a PRD ID | Owner |
| R6 | **No design partner / no pharmacist access** | M | H | Secure partner before M1; weekly feedback slot; do not start v1.1 without APJ | No partner by M0 end | Owner |
| R7 | **Migration friction** (importing legacy stock with batch/expiry is hard) | H | M | CSV templates + per-row error report; import is a v1 epic; target ≤ 1 day; offer assisted import for pilot | Import takes > 1 day | Eng |
| R8 | **Counter performance on weak hardware** | M | H | Phone/old-PC test matrix; local index search; perf budget in CI; measure on real device at G1 | p95 add-to-cart > 100 ms on target device | Eng |
| R9 | **Inventory model too rigid for real pharmacy habits** (open strips, repack, consignment) | M | M | Base-unit design handles strips/tablets; repack event type reserved; validate in discovery; consignment deferred | Pharmacist describes a flow we can't model | Eng |
| R10 | **Competitive parity gap** (incumbents already ship offline, FEFO, SIPNAP export) | H | M | Compete on traceability, explainability, owner insight, offline reliability — not menu count; don't claim parity we lack | Prospect rejects for a missing table-stakes feature | Owner |
| R11 | **Thermal printer / scanner compatibility** | M | M | Browser-print fallback; test two printers at G1; Web Serial/USB abstraction | Printer fails on partner hardware | Eng |
| R12 | **Hosting / data-residency concerns for health data** | M | M | Counsel review (A5); hosting region decision before pilot; encrypted backups | Partner or counsel objects to region | Owner |
| R13 | **Single point of failure: one developer + agent** | M | M | Docs-first repo; CLAUDE.md; tests as spec; small commits; backup of repo and DB | Bus-factor discussion | Owner |
| R14 | **Live-data migrations break a pharmacy** (no safe staging) | M | H | Staging environment (A4); forward-only migrations; backup before each; ledger/audit never truncated | Migration needs manual repair | Eng |
| R15 | **Back-dated or silent stock edits erode trust** | M | H | Ledger-only mutation; period close; privileged audited corrections | Reconciliation mismatch | Eng |
| R16 | **Pricing/tax handling wrong** (PPN, margin rules) | M | M | Configurable, default conservative, finance review before POS-6 | Receipt tax disputed | Owner |
| R17 | **QRIS reconciliation errors** (manual confirmation in v1) | M | M | Record reference, flag unconfirmed, daily payment-method report; processor integration deferred | Cash/QRIS totals disagree | Eng |
| R18 | **Pharmacist metrics misused as surveillance** | L | M | Operational measures only; no leaderboards (blueprint §35) | Request for per-pharmacist sales ranking | Owner |
| R19 | **`taste` skill unavailable** for landing/demo work | M | L | Confirm availability before marketing work; fallback `frontend-design`; tell the owner rather than hand-styling | Skill not found when invoked | Owner |

## Assumptions to test early

| Assumption | How to test | By |
|---|---|---|
| Offline is a buying driver | Ask in discovery: "what happens when internet drops?" | M0 |
| Import in < 1 day is achievable | Dry-run import on partner's real file | M2 |
| Partner owns a thermal printer + scanner | Ask | M0 |
| Owner values expiry-at-risk above other dashboard items | Observed session | M3 |
| An APJ is available for weekly review | Confirm before M4 | M3 |

## Regulatory caveat register

Statements that need validation before being shown to users or relied upon:

| Topic | Source in blueprint | Validate with |
|---|---|---|
| Prescription retention ≥ 5 years | BPOM 5/2026 annex (§5) | APJ / counsel |
| Narcotic/psychotropic prescription must be original manual or internal electronic; no fax/copy | BPOM 5/2026 (§5) | APJ |
| Returned-medicine handling and re-sale conditions | BPOM 5/2026 (§§5, 23) | APJ |
| Destruction documentation (witness, fields) | BPOM 5/2026 (§5) | APJ |
| SATUSEHAT integration obligation and timeline for apotek | Kemenkes statements, Permenkes 24/2022 (§6) | Counsel |
| SIPNAP reporting method (API vs. export) | Kemenkes SIPNAP (§7) | APJ |
| Tax (PPN) treatment of medicines | not in blueprint | Accountant |
| UU PDP obligations for patient data | not in blueprint | Counsel |

## Review cadence

Re-read at each gate (G0–G5). Add new risks as discovery uncovers them. Close a risk only with evidence.
