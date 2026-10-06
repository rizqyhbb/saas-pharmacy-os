# Discovery Interview — Pharmacist and Owner

Status: v0.1 · 6 Oct 2026 · From blueprint §63, extended. **Run this before building anything in v1.1, and ideally before M1.** Interview a licensed APJ and the owner (often different people). Observe a real shift if allowed.

## How to run it

- 60–90 minutes each; record notes, not patient information. **Never collect real patient data in interviews.**
- Ask "walk me through the last time…" rather than "do you…".
- Capture exact words; add new terms to the PRODUCT.md Glossary.
- For each answer, note: who does it, what tool is used today, what goes wrong.
- Output: update PRD assumptions, RISKS, and mark `[VALIDATE]` items resolved or reopened.

## Before the interview — logistics

1. Which apotek hardware do they use (PC/tablet/phone, printer model, scanner)?
2. What software do they use now, and what do they dislike?
3. What does their internet reliability look like?
4. Who are the staff roles and how many people work a shift?

## A. Prescription

1. Which prescription types do you receive most: paper, internal electronic, SATUSEHAT/e-resep, online upload?
2. Which fields do you always inspect before accepting?
3. What causes a prescription to be held?
4. How are partial fills handled?
5. How are repeat/copy prescriptions handled?
6. Who performs each step: cashier, TTK, pharmacist?
7. How do you document an intervention today?
8. How long do you keep prescriptions and where?

## B. Compounding

9. Which compound types are common?
10. How are ingredient calculations done today (paper, calculator, software)?
11. How is BUD handled?
12. Which packaging costs are charged (tuslah, embalase) and how?
13. How do you round partial tablets and why?

## C. Inventory

14. Do you use FEFO consistently? What breaks it?
15. How are open boxes and strips handled?
16. What happens to returned medication?
17. How are near-expiry products handled (discount, return, transfer)?
18. How often is stock counted, and how?
19. Do you have consignment stock or repacking?
20. How do you store cold-chain items and track temperature?

## D. Procurement

21. What is your actual defecta process?
22. Who approves purchase orders?
23. How much purchasing is centralised?
24. How are supplier price changes captured?
25. How are shortages/substitutions recorded?
26. How do invoices arrive and how are they paid (credit terms)?

## E. Controlled medicines

27. Which controlled categories do you handle?
28. Who can approve them?
29. How is controlled stock reconciled today?
30. Which reports are actually submitted, to whom, how, and how often?

## F. Counter and money

31. What does a typical busy-hour sale look like?
32. How do customers pay (cash, QRIS, transfer, card)?
33. How do you do end-of-shift cash reconciliation?
34. How do you handle refunds and returns?
35. What do you do when the system or internet is down?

## G. Business and owner

36. What are the biggest sources of margin leakage?
37. What gets written off most often?
38. What are the 3 numbers you want to see every morning?
39. What would make you switch software, and what would stop you?
40. What would you pay, and how (per month, per branch, per user)?

## H. Compliance and risk

41. Which inspections or audits do you prepare for, and what do inspectors ask to see?
42. What have you been told about SATUSEHAT integration and timing?
43. What worries you most about a new system?

## After the interview

- [ ] Update `PRD.md` assumptions and open decisions.
- [ ] Update `PRODUCT.md` glossary and users.
- [ ] Re-score `RISKS.md`.
- [ ] Mark `[VALIDATE]` items confirmed / corrected / still open.
- [ ] Decide design-partner fit (D3).
- [ ] Schedule the next review.
