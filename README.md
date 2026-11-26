# Magezi Payroll

Internal payroll system for **Magezi Harvest Limited** (Uganda). It computes PAYE, NSSF and Local
Service Tax, produces payslips and statutory schedules, and exports bulk-payment files that Finance
uploads to the bank or mobile money provider. **It does not move money itself.**

## What it does

| Module | Highlights |
| --- | --- |
| Employees | Personal and job details, grade, employment type, TIN, NSSF number, encrypted NIN, email and phone, salary structure, payment details (bank account **or** MTN MoMo / Airtel Money wallet), CSV import |
| Pay components | Earnings (basic, allowances, overtime, bonus, arrears), deductions (statutory, loans, advances, SACCO, overpayment recovery), employer contributions |
| Payroll runs | Pick the period → compute → compare with last month → submit → approve → export → paid → lock. Approved runs can never be edited (database-enforced); mistakes are fixed with **adjustments in the next run** |
| Statutory engine | PAYE, NSSF (employee 5% / employer 10%) and LST, each **versioned by effective date** and approved by Finance, so a rate change never rewrites old payrolls |
| Payslips | PDF payslips; sent by **email** (PDF attached + link) or **SMS link**. Links expire and ask for the last 4 phone digits or the staff number |
| Disbursement | Versioned bank files per bank and mobile money provider (CSV/XLSX templates), upload of bank results, failed-payment list and re-issue file |
| Reports | Payroll register, PAYE return summary (URA), NSSF schedule, LST schedule, department cost, payment summary, payment results, loans |
| Roles and audit | Five roles; the person who creates, computes or submits a run can never approve it (server-enforced). Every change is in the audit log, which cannot be edited |

## Roles

| Role | Can | Cannot |
| --- | --- | --- |
| System Admin | Users and roles, banks/providers, export templates, system settings, statutory rule drafts | See or edit pay; prepare or approve runs |
| HR Officer | Employees, pay structures, payment details, variable inputs and adjustments, loans | Approve runs, export bank files |
| Payroll Officer | Create runs, import inputs, compute, review, submit; generate and send payslips | Approve a run they prepared; export bank files |
| Finance Approver | Approve/reject runs and statutory rules, generate and download bank files, mark paid, upload bank results | Edit employee data or run inputs |
| Auditor | Read everything, including the audit log and reports | Change anything |

System Admins and Finance Approvers must use two-factor authentication (authenticator app).

## Quick start (Windows, after first-time setup)

Double-click **`start-payroll.bat`**. Two windows open (database and app) — keep both open. The
browser opens <http://localhost:3000> after about 20 seconds. Close the two windows to stop.

## First-time setup (Windows)

Requirements: Node.js 20+, pnpm 9 (`npm i -g pnpm@9`), MySQL Server 8.0 installed (only its programs
are used — the project runs its own private instance, so no admin rights are needed).

1. Create the private database instance (once):
   `"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe" --no-defaults --initialize-insecure --datadir="%USERPROFILE%\.payroll-mysql\data"`
2. Start it: double-click `scripts\start-local-db.bat` (keep the window open). It listens on
   `127.0.0.1:3307` with low-memory settings.
3. Create the databases and users:
   `"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -h 127.0.0.1 -P 3307 -u root < scripts\mysql-setup.sql`
   then set a root password (`ALTER USER 'root'@'localhost' IDENTIFIED BY '…';`).
4. Copy `.env.example` to `.env` and fill in `AUTH_SECRET` and `FIELD_ENCRYPTION_KEY` (the file shows
   the command that generates each). **Keep `FIELD_ENCRYPTION_KEY` safe — encrypted bank numbers and
   NINs cannot be read without it.**
5. `pnpm install`
6. `pnpm db:migrate` — creates the tables, triggers and constraints.
7. `pnpm db:seed` — roles, the admin user (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, must change the
   password and enrol 2FA at first login), statutory rules, pay groups, components, banks and
   mobile money providers, departments, settings.
8. Optional, for review only: `pnpm db:seed:demo` — demo users (`hr@`, `payroll@`, `finance@`,
   `auditor@example.com`, password `Demo!Pass2026`), 10 employees and two payroll runs.
9. `pnpm build`, then use `start-payroll.bat` (or `pnpm start`).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm build` / `pnpm start` | Build / run the app (port 3000) |
| `pnpm dev` | Development server (uses more memory) |
| `pnpm typecheck` / `pnpm lint` | Type and code checks |
| `pnpm test` / `pnpm test:coverage` | Unit tests (engine must stay at 100% line coverage) |
| `pnpm test:integration` | Database tests on `payroll_test` (rebuilt each run) |
| `pnpm test:e2e` | Browser tests on `payroll_test` (own server on port 3100) |
| `pnpm check:engine-constants` | Fails if a statutory number is written into engine code |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:seed:demo` | Database schema / base data / demo data |
| `node scripts/smoke.mjs` | Opens every page as demo users against a running app |

On a machine with little memory, do not run `pnpm build` while `pnpm dev` is running.

## Email and SMS

By default `MESSAGING_MODE="outbox"`: nothing is sent; every email and SMS is stored and shown under
**Messages**. To send for real, set in `.env` and restart the app:

- `MESSAGING_MODE="live"` and `APP_BASE_URL` = the address employees will open links on
- Email (SMTP): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- SMS (Africa's Talking): `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` (`AT_USERNAME="sandbox"` uses
  the sandbox)
- `PAYSLIP_LINK_DAYS` — how long payslip links stay valid (default 7)

## Going-live checklist

- [ ] SMTP account and Africa's Talking account configured; `MESSAGING_MODE="live"`; test with one employee
- [ ] Each bank's bulk-payment file layout and real bank codes entered (Banks and Exports → Templates)
- [ ] MTN MoMo and Airtel Money bulk-payment layouts confirmed against each provider's portal
- [ ] PAYE and NSSF parameters confirmed against URA / NSSF; LST schedule confirmed with the district and **approved** by the Finance Approver (Settings → Statutory rules)
- [ ] PAYE return and NSSF schedule layouts confirmed against current URA / NSSF templates
- [ ] Mobile money wallet prefixes confirmed (MTN 76/77/78/39, Airtel 70/74/75/20)
- [ ] Company details and payslip footer set (Settings → General)
- [ ] Seeded admin password changed; demo data **not** loaded (or a fresh database used)
- [ ] Backups scheduled (below)

## Backups

Back up the `payroll` database daily and before every payroll approval, and store copies off the
machine together with (separately from) the `.env` file:

`"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -h 127.0.0.1 -P 3307 -u root -p --single-transaction --routines --triggers payroll > payroll-YYYYMMDD.sql`

Restore into an empty `payroll` database with `mysql … payroll < payroll-YYYYMMDD.sql`. A backup is
useless without the matching `FIELD_ENCRYPTION_KEY`.

## Project rules

See [`CLAUDE.md`](CLAUDE.md) for the fixed stack, non-negotiable rules, roles and domain rules.
