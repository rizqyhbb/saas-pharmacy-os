# Changelog

## [UNRELEASED]

- Catalogue and opening-stock API: products with units and barcodes, pharmacist classification (unclassified products can't be sold), audited price changes, idempotent opening balances entered in any unit, batch quarantine/recall with reason, stock card, branch-scoped staff
- M0 database and auth: Supabase (local), SQL migrations for tenancy, staff roles, audit, catalogue, batches and the append-only ledger with RLS; `packages/db` with tenant-isolation and ledger property tests; API verifies Supabase tokens and enforces the nine-role permission matrix
- Design system "Klinik Tenang": `packages/ui` tokens and primitives, `DESIGN.md`; landing page and demo rebuilt on it, always light; dark mode is opt-in for app screens
- Landing page with guided + interactive demo (`apps/web`), Indonesian and English, running on the real domain package
- M0 scaffold: pnpm workspace, CI, `packages/domain` (quantities, units, FEFO, ledger rules, state machines) with property tests, `apps/api` health route
- Initial product documentation: PRD, product definition, domain model, architecture, user stories, roadmap, success criteria, risk register, discovery interview

## [RELEASED]

_Nothing released yet._
