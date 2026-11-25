# Builder 3 (Phase 3: payroll processing) — notes for the coordinator

## Shared-file requests (not applied)
1. `next.config.ts`: if `next build` fails to bundle the PDF route, add `'@react-pdf/renderer'` to
   `serverExternalPackages` (route: `src/app/api/payslips/[runId]/route.ts`, runtime nodejs).
2. `CLAUDE.md` domain rules could record the run-processing decisions below.

## Decisions / assumptions
- Month-to-date (cumulative PAYE, LST basis) only counts APPROVED-or-later runs of earlier periods
  with a pay date in the same month (`src/lib/payroll/server/compute.ts`). Earlier cycles must be
  approved before the next weekly/fortnightly run is computed, or PAYE is under-withheld.
- SUSPENDED employees are skipped; EXITED employees are included while their exit date overlaps
  the period (final pay).
- Assignments: the newest assignment overlapping the period wins (no split of a mid-period change).
- Period inputs override the assigned amount (FIXED, summed) or add quantity (RATE_X_QTY); an input
  amount on a RATE_X_QTY row overrides the rate per unit.
- Loans enter the engine as `LOAN#<loanId>` codes; unpaid loan instalments are NOT carried forward
  (the balance stays on the loan). Other unpaid deductions become CarryForward rows on approval.
- A run cannot be submitted with calculation errors or zero employees.
- The approver (and rejecter) must differ from the user who last computed the run.
- Payslip YTD = this run + approved-or-later runs in the financial year (from 1 July) up to the
  pay date.
- Snapshot keeps `employee.bank.accountId/bankId/last4` so bank exports (Phase 4) can find the
  account used; the full account number is not copied into the snapshot.
