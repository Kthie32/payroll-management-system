# Payroll Management System (Uganda) — Project Rules

Read this file in full before changing anything. It is the source of truth for the stack,
the non-negotiable rules and the domain rules.

## Stack (fixed)

- Next.js 15 (App Router) + TypeScript `strict` + pnpm
- MySQL 8.0 (local Windows service `MYSQL80` in development; MySQL 8 in production) via Prisma 6
- Auth.js v5 (Credentials provider, JWT sessions), `@node-rs/argon2` for passwords, `otplib` + `qrcode` for TOTP
- zod for validation at every boundary
- Tailwind CSS v4 + shadcn/ui
- Vitest (+ fast-check for property tests), Playwright for end-to-end tests
- ESLint + Prettier

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Run / build the app |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:coverage` | Unit tests with coverage (engine must stay at 100% lines) |
| `pnpm test:integration` | DB tests against `payroll_test` (triggers, constraints) |
| `pnpm test:e2e` | Playwright |
| `pnpm check:engine-constants` | Fails if statutory numbers appear in engine source |
| `pnpm db:migrate` | `prisma migrate deploy` (dev: `pnpm db:migrate:dev`) |
| `pnpm db:reset` | Drop + re-migrate + seed (development only) |
| `pnpm db:seed` | Idempotent seed |
| `pnpm db:studio` | Prisma Studio |

One-time setup: run `scripts/mysql-setup.sql` as MySQL `root` (creates `payroll`, `payroll_test`,
`payroll_shadow`, and the users `payroll_migrator` and `payroll_app`).

## Non-negotiable rules

1. **Money is integer UGX.** `BigInt` in the database; `Ugx` (a safe-integer `number`) in TypeScript.
   Convert only at the Prisma boundary with `toUgx` / `fromUgx`. Never use floats for money.
2. **Percentages are basis points** (`Bp`, 10,000 = 100%). Use `mulBp` / `divRoundHalfUp`.
   Round **half-up, once per line**, never on running totals.
3. **The payroll engine (`src/lib/payroll-engine`) is pure**: no I/O, no clock, no database, no
   environment. Same input → same output. It contains **no statutory numbers**; all rates, bands,
   thresholds and schedules come from `StatutoryRuleVersion.params`.
4. **Statutory rules are data.** The engine only receives rule versions that are `active`, approved
   (`approvedById` set) and in effect for the period. Missing PAYE rule → `MissingRuleError`.
5. **Every mutation is audited** with `withAudit(tx, ...)` inside the same Prisma transaction.
   `audit_log` is append-only (DB triggers + the app DB user has no DROP/TRUNCATE privilege).
6. **Approved payroll is immutable.** Rows in `payroll_run_employees` / `payroll_lines` under a run
   in `APPROVED | EXPORTED | PAID | LOCKED` cannot be inserted, updated or deleted (DB triggers).
   Run status only moves forward from `APPROVED`.
7. **Sensitive fields are encrypted** (AES-256-GCM, `lib/crypto`): bank account numbers, NIN,
   TOTP secrets. Store `last4` separately for display.
8. **Separation of duties**: the user who computed a run cannot approve it.
9. **2FA**: `SYSTEM_ADMIN` and `FINANCE_APPROVER` cannot use the app until TOTP is enrolled and
   verified for the session.
10. Table names are lowercase snake_case (`@@map`) — MySQL on Windows is case-insensitive, Linux is not.

## Roles

| Permission | SYSTEM_ADMIN | HR_OFFICER | PAYROLL_OFFICER | FINANCE_APPROVER | AUDITOR |
| --- | --- | --- | --- | --- | --- |
| users.manage | ✅ | | | | |
| settings.view | ✅ | | | ✅ | ✅ |
| settings.edit / rules.edit | ✅ | | | | |
| rules.approve | | | | ✅ | |
| employees.view | ✅ | ✅ | ✅ | ✅ | ✅ |
| employees.edit | | ✅ | | | |
| payroll.view | | ✅ | ✅ | ✅ | ✅ |
| payroll.prepare (inputs, compute) | | | ✅ | | |
| payroll.approve | | | | ✅ | |
| payroll.export / payroll.markPaid | | | ✅ | ✅ | |
| loans.view | | ✅ | ✅ | ✅ | ✅ |
| loans.edit | | ✅ | ✅ | | |
| reports.view | | ✅ | ✅ | ✅ | ✅ |
| audit.view | ✅ | | | | ✅ |
| dashboard.view | ✅ | ✅ | ✅ | ✅ | ✅ |

## Domain rules

### Statutory parameters (seeded, effective 2026-07-01)

```jsonc
// PAYE_RES — monthly chargeable income bands
{ "bands": [
    { "from": 0,      "to": 335000, "rateBp": 0 },
    { "from": 335000, "to": 410000, "rateBp": 2000 },
    { "from": 410000, "to": 485000, "rateBp": 2500 },
    { "from": 485000, "to": null,   "rateBp": 3000 } ],
  "surcharge": { "threshold": 10000000, "rateBp": 1000 } }
// NSSF
{ "employeeRateBp": 500, "employerRateBp": 1000, "ceiling": null }
// LST — seeded inactive until bands are confirmed (prisma/data/lst-bands.json)
{ "bands": [], "instalments": 4, "months": [7, 8, 9, 10], "basis": "MONTHLY_GROSS" }
```

TODO-confirm: verify these against URA / NSSF publications before go-live. `PAYE_NONRES` is not
seeded; non-resident employees fail with `MissingRuleError` until it is entered and approved.

### Calculation order (per employee, per period)

1. **Earnings.** `FIXED` → amount; `PERCENT_OF_BASIC` → `mulBp(prorated BASIC, rateBp)`;
   `RATE_X_QTY` → `round_half_up(ratePerUnit × quantity)`. Components with `prorate = true` are
   prorated by calendar days worked in the period (hire/exit dates inclusive).
2. **Gross** = sum of earnings. **Taxable** = taxable earnings. **NSSF base** = nssfable earnings.
3. **NSSF**: employee = `mulBp(base, employeeRateBp)`, employer = `mulBp(base, employerRateBp)`
   (base capped at `ceiling` if set). Zero if `nssfApplicable = false`.
4. **PAYE** on taxable gross (NSSF is not deducted first). Bands are monthly.
   - MONTHLY pay groups: `payeMonthly(params, taxable)`.
   - WEEKLY / FORTNIGHTLY: cumulative within the month —
     `max(0, payeMonthly(params, mtdTaxable + taxable) − mtdPayeWithheld)`.
   - A period belongs to the month of its **pay date**.
   - Zero with an explanatory note if `payeApplicable = false`.
5. **LST**: only in the rule's `months`, only on the last cycle of the month; band chosen on monthly
   gross (MTD gross + current gross); instalment = `round_half_up(annual ÷ instalments)`.
   LST month with no active rule → 0 and warning `LST_RULE_MISSING`. Limited to available net
   (warning `LST_SHORTFALL`).
6. **Other deductions**: carried-forward amounts first, then current deductions by `priority`
   ascending (ties by code). Allowed total = `max(0, netBeforeDeductions − mulBp(gross, minNetPayBp))`.
   Any unpaid remainder becomes a carry-forward for the next period.
7. **Net** = gross − PAYE − NSSF employee − LST − other deductions.
   **Employer cost** = gross + NSSF employer + EMPLOYER-kind components.

### Proration

Basis `CALENDAR_DAYS` (setting `prorationBasis`): `round_half_up(amount × daysWorked ÷ daysInPeriod)`.

## Phase plan

- Phase 1: foundations, schema, auth/RBAC, audit, payroll engine (this repo's first milestone)
- Phase 2: employees, components, bank accounts, loans, CSV import
- Phase 3: payroll runs (compute / review / approve), payslips
- Phase 4: bank exports, reports
