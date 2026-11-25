# Builder 2B notes (settings + loans)

## Exports Builder 3 relies on
- `@/lib/settings/rules`: `resolveRuleVersion(versions, rule, onDate)`, `loadRulesForDate(tx, payDate)` →
  `{ paye: { RES, NONRES }, nssf, lst, lstMonths, versionIds }` (params already zod-parsed; throws
  `InvalidRuleParamsError` if an approved version's params are corrupt), `getSettings(tx)`.
  `nssf` can be null if no NSSF version is in effect — the caller should treat that as a missing rule.
- `@/lib/settings` (barrel): same plus `getSettings`, `percentToBp`, `bpToPercent`, `parseUgxInput`, etc.
- `@/lib/loans`: `activeLoanDeductions(tx, employeeId, onDate?)` → `[{ loanId, code, amount }]`
  (pass the period end or pay date as `onDate` so loans with a later start period are skipped);
  `applyLoanRepayments(tx, repayments, runId, actorId?)`.

## Conventions to keep
- Payroll lines for loans must use `code = loan.type` (LOAN / ADVANCE / SACCO). The loan detail
  page finds repayment history by that code + employee + approved runs created after the loan.
  Only one ACTIVE loan per type per employee is allowed, so the mapping is unambiguous.
- If a loan deduction is capped by minimum net pay, call `applyLoanRepayments` with the amount
  actually deducted (not the requested instalment); the carried-forward remainder should NOT be
  applied to the balance until it is actually deducted.
- Setting keys: `minNetPayBp`, `prorationBasis`, `company.name`, `company.tin`,
  `company.nssfEmployerNo`, `company.address`, `payslip.footer` (Builder 4 payslips/reports).

## Possible shared changes (not made)
- Seeded LST draft (effective 2026-07-01, no bands): to enable LST, an admin must first discard
  that draft (or pick a different effective date), because (rule, effectiveFrom) is unique.
- `PageHeader` lives in `src/app/(app)/settings/_components/page-header.tsx`; loans pages import it.
  Could be moved to `src/components/` if others want it.
