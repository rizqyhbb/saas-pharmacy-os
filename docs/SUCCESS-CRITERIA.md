# Success Criteria

Status: v0.1 · 6 Oct 2026. Targets are **proposals** to be confirmed with the owner and the design partner. Nothing here is a measured baseline; there is no customer data yet. Where a number is a guess, it says so.

## 1. How to read this

Three layers, each answering a different question:

1. **Launch gates** — must be true before a milestone ships. Binary.
2. **Pilot outcomes** — what the design partner's real usage must show in the first 30–60 days.
3. **Business and product metrics** — what tells us the product is worth continuing.

Targets marked ★ are the ones that decide go / no-go.

---

## 2. Launch gates

### Gate G0 — Foundation complete (end of M0)

| # | Criterion |
|---|---|
| G0-1 | Tenant-isolation suite passes for every table and route (0 leaks) ★ |
| G0-2 | Ledger property tests pass: `Σ ledger = balance`, `on_hand ≥ 0`, replay idempotent ★ |
| G0-3 | FEFO and unit-conversion unit tests pass, including edge cases (partial strip, decimal base units) |
| G0-4 | Server-side permission tests pass for all nine roles on privileged actions |
| G0-5 | Audit event emitted for every high-risk mutation (test per event type) |
| G0-6 | CI runs all of the above on every PR |

### Gate G1 — Counter ready (end of M1)

| # | Criterion |
|---|---|
| G1-1 | OTC sale in ≤ 4 interactions for one item; add-to-cart < 100 ms on target hardware |
| G1-2 | Atomic sale commit verified; duplicate submit creates 1 sale ★ |
| G1-3 | 8-hour offline soak test: 0 lost sales, 0 duplicates after sync ★ |
| G1-4 | Two-workstation last-unit race produces a flagged conflict, not a silent drop ★ |
| G1-5 | Thermal receipt prints on at least two common 58/80 mm printers |
| G1-6 | Rx-required and controlled items cannot be sold at the OTC counter |

### Gate G2 — Supply side ready (end of M2)

| # | Criterion |
|---|---|
| G2-1 | A batch cannot exist without a receipt/opening event |
| G2-2 | Goods receipt blocks lines with missing batch or expiry |
| G2-3 | Stock opname variance posts only after approval |
| G2-4 | PO ↔ receipt ↔ invoice discrepancy flagged |

### Gate G3 — MVP v1 pilot launch (end of M3) ★

| # | Criterion |
|---|---|
| G3-1 | Design partner's catalogue and opening stock imported with batch/expiry in ≤ 1 working day ★ |
| G3-2 | First full stock opname after go-live shows 0 unexplained differences ★ |
| G3-3 | Dashboard answers expiry-at-risk and top-5 margin SKUs in < 1 minute |
| G3-4 | Backup + restore rehearsed end-to-end |
| G3-5 | 0 open critical or high defects in data integrity, security, tenant isolation ★ |
| G3-6 | Audit log reviewed by an independent person for completeness |
| G3-7 | Staging environment exists and the release was promoted through it |
| G3-8 | Owner signs off that nothing in the UI makes an unsupported regulatory claim |

### Gate G4 — v1.1 prescription launch (end of M5) ★

| # | Criterion |
|---|---|
| G4-1 | **A licensed APJ has reviewed and approved** the prescription, screening, dispensing and compounding workflows in writing ★ |
| G4-2 | Cashier/TTK cannot approve, hold, or change prescription state via API (tested) ★ |
| G4-3 | `DISPENSED` unreachable without an approved pharmacist review (tested) ★ |
| G4-4 | Prescription original text preserved verbatim; mapping separate |
| G4-5 | Compounding calculations explainable on screen; rounding rules visible; ingredient batches consumed correctly |
| G4-6 | Patient data absent from logs, analytics exports and demo data (verified by scan) ★ |
| G4-7 | Patient record reads are access-logged |
| G4-8 | Counsel has reviewed UU PDP / health-data handling and retention **[VALIDATE]** ★ |
| G4-9 | Etiket format reviewed by the APJ |

### Gate G5 — Phase 2 control features

Controlled-medicine ledger and exports are validated by an APJ against the current official reporting rules **[VALIDATE]** before any claim of "SIPNAP-ready" is made. SATUSEHAT connector passes the platform's own certification/sandbox process before production use.

---

## 3. Pilot outcomes (first 30–60 days with the design partner)

| # | Outcome | Target (proposal) | Measure |
|---|---|---|---|
| P-1 | **Full adoption** — all counter sales go through the system | 30 consecutive days ★ | Sales count vs. partner's own till tally |
| P-2 | **Ledger accuracy** | 0 unexplained stock differences at first full opname ★ | Opname variance report |
| P-3 | **Counter speed** | Median OTC sale ≤ 20 s door-to-receipt; p95 add-to-cart < 100 ms | Client timing telemetry (no PII) |
| P-4 | **Resilience** | 0 lost sales; every offline sale synced | Outbox vs. server reconciliation |
| P-5 | **Shift integrity** | Cash variance trend visible and reviewed for every closed shift | Shift report |
| P-6 | **Receiving discipline** | ≥ 98 % of received lines have batch + expiry captured at receipt | Receipt audit |
| P-7 | **Expiry visibility** | Owner can state expiry-at-risk value from the dashboard without help | Observed session |
| P-8 | **Trust** | Owner would not go back to the previous system | Structured interview at day 30 |
| P-9 | **Stability** | No counter-blocking incident > 15 minutes | Incident log |
| P-10 | **Support load** | ≤ 5 support requests per week after week 2 | Support log |

(Numbers are initial guesses. After 2 weeks of real data, re-baseline them with the owner.)

---

## 4. Product metrics (post-pilot)

### Activation and adoption
- Time from sign-up to first sale (target: same day).
- Time to complete import and first opname (target: ≤ 1 working day for import).
- % of tenants selling daily after week 2.
- Weekly active users per role.

### Counter quality
- p50 / p95 sale duration; add-to-cart latency.
- % sales completed while offline; sync success rate (target ≥ 99.9 % first-try or auto-resolved).
- Void rate; refund rate; discount rate (watch for abuse, not to maximise).

### Data quality
- % goods-receipt lines with batch + expiry (target ≥ 98 %).
- Opname variance as % of stock value (trend ↓).
- Ledger ↔ balance reconciliation mismatches (target 0).
- Offline conflicts per 1,000 sales (trend ↓).

### Owner value
- Expiry write-off value / month (trend ↓ after adoption).
- Stockout rate on top-100 SKUs (trend ↓ once reorder engine ships).
- Dashboard weekly opens by owner.
- Action Center items resolved within SLA (Critical < 1 day).

### Prescription (v1.1)
- Prescription turnaround time (received → ready), by type.
- % prescriptions with complete screening checklist at approval (target 100 %).
- Interventions documented per 100 prescriptions (descriptive, **not a performance target** for pharmacists).
- Partial-fill rate and reasons.

### Commercial (SaaS)
- Pilot → paid conversion; logo churn; ARPA per branch.
- Cost to serve per tenant (hosting, support).
- Net revenue retention once multi-branch ships.
- Gross margin on the subscription.

> Do not turn pharmacist metrics into a sales leaderboard. Operational measures only (blueprint §35).

---

## 5. Engineering quality bars

| Area | Bar |
|---|---|
| Domain core | ≥ 90 % branch coverage on `packages/domain` (FEFO, units, state machines) |
| Integrity | T1–T12 (see DOMAIN-MODEL §12) all automated and required in CI |
| Security | No critical/high findings in dependency + static scan; secrets scan clean |
| Performance | Search < 150 ms p95 on 20k SKUs offline; dashboard p95 < 2 s on 1M ledger rows |
| Reliability | API error rate < 0.5 %; RPO ≤ 24 h, RTO ≤ 4 h (proposal) |
| Accessibility | WCAG 2.1 AA on admin surfaces; keyboard-complete counter |
| Mobile | Owner and stock-count screens verified at ~390 px |
| Observability | Sync health, integration logs, error tracking; no patient data in telemetry |

---

## 6. Definition of "MVP v1 succeeded"

All of the following, at the end of the 60-day pilot:

1. P-1 through P-4 met ★
2. G3 gate fully passed ★
3. Owner states they'd pay for it (or keep paying) and refer another apotek
4. No unresolved critical integrity/security defect
5. The backlog for v1.1 is driven by observed pharmacy needs, not guesses

## 7. Definition of "MVP v1 failed or needs rethink"

Any one of:

- Design partner reverts to the old system or runs parallel records after day 30
- Unexplained stock differences persist after two opname cycles
- Offline sales lost or duplicated
- A tenant-isolation or patient-data exposure occurs
- Counter p50 sale time is slower than the partner's previous system

In which case: stop feature work, run a root-cause review, and decide with the owner whether to fix, narrow scope, or stop.

## 7b. Kill / pivot checkpoints

| When | Question | If "no" |
|---|---|---|
| End M1 | Does the offline counter work reliably on real hardware? | Fix before any supply-side work |
| Pilot day 14 | Is the partner using it for every sale? | Find the blocker; do not ship more features |
| Pilot day 30 | Would they pay? | Re-interview; reconsider segment/pricing |
| Before M4 | Is an APJ available to validate Rx workflow? | Do not build v1.1 clinical features without one |

## 8. Open items

- Confirm numeric targets with the owner and design partner.
- Decide how timing telemetry is collected without PII.
- Define pricing to model commercial metrics (PRD D2).
