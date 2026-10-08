# Changelog

## [UNRELEASED]

- M1 counter backend: cashier shifts with blind close and review, cash movements, idempotent sales with FEFO under row locks, split payments with change, discount limits per role, receipts, void and refund; offline sales kept with flagged conflicts; prescription-only products blocked at the counter in the database
- CSV import of products and opening stock (dry run, per-line problems, Indonesian Excel `;` and decimal comma, idempotent) and CSV export of products and stock
- Branches, locations and workstations; privileged batch correction; product category, stock levels and default location; nightly expiry and ledger reconciliation with resolvable issues; balance rebuild
- Staff management and facility profile: email invitations through Supabase (existing accounts linked), deactivation that locks people out immediately, branch assignments, and the apotek's NIB, permit and APJ details, all audited
- Catalogue and opening-stock API: products with units and barcodes, pharmacist classification (unclassified products can't be sold), audited price changes, idempotent opening balances entered in any unit, batch quarantine/recall with reason, stock card, branch-scoped staff
- M0 database and auth: Supabase (local), SQL migrations for tenancy, staff roles, audit, catalogue, batches and the append-only ledger with RLS; `packages/db` with tenant-isolation and ledger property tests; API verifies Supabase tokens and enforces the nine-role permission matrix
- Design system "Klinik Tenang": `packages/ui` tokens and primitives, `DESIGN.md`; landing page and demo rebuilt on it, always light; dark mode is opt-in for app screens
- Landing page with guided + interactive demo (`apps/web`), Indonesian and English, running on the real domain package
- M0 scaffold: pnpm workspace, CI, `packages/domain` (quantities, units, FEFO, ledger rules, state machines) with property tests, `apps/api` health route
- Initial product documentation: PRD, product definition, domain model, architecture, user stories, roadmap, success criteria, risk register, discovery interview

## [RELEASED]

_Nothing released yet._
