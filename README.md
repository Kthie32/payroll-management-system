# Payroll Management System

Payroll for Ugandan employers: PAYE, NSSF and LST, approvals, bank exports and an append-only
audit trail. Project rules live in [CLAUDE.md](CLAUDE.md); read it before changing anything.

## Local setup (Windows)

Prerequisites: Node.js 20+, pnpm 9 (`npm i -g pnpm@9`), MySQL 8.0 Server.

1. **Start MySQL.** In an _administrator_ terminal: `net start MYSQL80`
   (or Services → MYSQL80 → Start).
2. **Create the databases and users** (once), as MySQL root:
   ```
   mysql -u root -p < scripts/mysql-setup.sql
   ```
   This creates `payroll`, `payroll_test`, `payroll_shadow` and two users:
   `payroll_migrator` (schema changes, seed, tests) and `payroll_app` (data only; cannot drop,
   truncate or alter tables). Change the passwords in the script first if you like.
3. **Configure the environment:** copy `.env.example` to `.env`, then fill in
   `AUTH_SECRET` and `FIELD_ENCRYPTION_KEY`. Generate each with:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Keep `FIELD_ENCRYPTION_KEY` safe: losing it makes encrypted fields (bank accounts, NIN,
   2FA secrets) unreadable.
4. **Install, migrate, seed, run:**
   ```
   pnpm install
   pnpm db:migrate
   pnpm db:seed
   pnpm dev
   ```
5. Open http://localhost:3000 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
   You will be asked to change the password and set up two-factor authentication.

## Commands

| Command                                                  | Purpose                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                                               | Development server                                         |
| `pnpm typecheck` / `pnpm lint`                           | Static checks                                              |
| `pnpm test` / `pnpm test:coverage`                       | Unit tests (engine coverage must stay at 100%)             |
| `pnpm test:integration`                                  | Database tests on `payroll_test` (triggers, constraints)   |
| `pnpm test:e2e`                                          | Playwright; run `pnpm db:reset` first (needs a fresh seed) |
| `pnpm check:engine-constants`                            | No statutory numbers inside the engine                     |
| `pnpm db:migrate` / `db:seed` / `db:reset` / `db:studio` | Database                                                   |

## Database safeguards

- Rows of approved, exported, paid or locked payroll runs cannot be inserted, changed or
  deleted (MySQL triggers, migration `0003`).
- `audit_log` rejects UPDATE and DELETE (triggers, migration `0004`); TRUNCATE is blocked by the
  app user's privileges.
- One active bank account per employee and one open payroll run per period (generated columns
  with unique indexes, migration `0002`).

## Status

- **Phase 1** (this branch): foundations, schema, payroll engine, auth + 2FA, RBAC, user admin,
  audit log.
- Phase 2: employees, components, bank accounts, loans, CSV import.
- Phase 3: payroll runs, approval, payslips.
- Phase 4: bank exports, reports.
