-- MySQL has no partial unique indexes. Emulate them with STORED generated columns that are
-- NULL when the row should not participate (UNIQUE allows many NULLs).
-- Prisma declares these as optional fields; application code must never write them.

-- One active bank account per employee.
ALTER TABLE `employee_bank_accounts`
  DROP INDEX `uq_one_active_bank_account`,
  DROP COLUMN `active_employee_id`;

ALTER TABLE `employee_bank_accounts`
  ADD COLUMN `active_employee_id` VARCHAR(191)
    GENERATED ALWAYS AS (IF(`is_active`, `employee_id`, NULL)) STORED,
  ADD UNIQUE INDEX `uq_one_active_bank_account` (`active_employee_id`);

-- One non-rejected payroll run per pay period.
ALTER TABLE `payroll_runs`
  DROP INDEX `uq_one_open_run_per_period`,
  DROP COLUMN `open_period_id`;

ALTER TABLE `payroll_runs`
  ADD COLUMN `open_period_id` VARCHAR(191)
    GENERATED ALWAYS AS (IF(`status` <> 'REJECTED', `period_id`, NULL)) STORED,
  ADD UNIQUE INDEX `uq_one_open_run_per_period` (`open_period_id`);
