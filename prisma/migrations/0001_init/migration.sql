-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `totp_secret_enc` VARCHAR(255) NULL,
    `totp_enrolled_at` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `failed_logins` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `code` ENUM('SYSTEM_ADMIN', 'HR_OFFICER', 'PAYROLL_OFFICER', 'FINANCE_APPROVER', 'AUDITOR') NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_role_id_idx`(`role_id`),
    UNIQUE INDEX `user_roles_user_id_role_id_key`(`user_id`, `role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `cost_centre_code` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `departments_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pay_groups` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `frequency` ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pay_groups_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` VARCHAR(191) NOT NULL,
    `staff_no` VARCHAR(40) NOT NULL,
    `first_name` VARCHAR(80) NOT NULL,
    `last_name` VARCHAR(80) NOT NULL,
    `other_names` VARCHAR(120) NULL,
    `worker_type` ENUM('PERMANENT', 'CONTRACT', 'CASUAL') NOT NULL,
    `pay_group_id` VARCHAR(191) NOT NULL,
    `department_id` VARCHAR(191) NULL,
    `job_title` VARCHAR(120) NULL,
    `grade` VARCHAR(40) NULL,
    `hire_date` DATE NOT NULL,
    `exit_date` DATE NULL,
    `residency` ENUM('RESIDENT', 'NON_RESIDENT') NOT NULL DEFAULT 'RESIDENT',
    `tin` VARCHAR(20) NULL,
    `nssf_no` VARCHAR(30) NULL,
    `nin_enc` VARCHAR(255) NULL,
    `lst_district` VARCHAR(80) NULL,
    `paye_applicable` BOOLEAN NOT NULL DEFAULT true,
    `nssf_applicable` BOOLEAN NOT NULL DEFAULT true,
    `lst_applicable` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'EXITED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employees_staff_no_key`(`staff_no`),
    INDEX `employees_pay_group_id_idx`(`pay_group_id`),
    INDEX `employees_department_id_idx`(`department_id`),
    INDEX `employees_status_idx`(`status`),
    INDEX `employees_last_name_first_name_idx`(`last_name`, `first_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `banks` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `banks_name_key`(`name`),
    UNIQUE INDEX `banks_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_bank_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `bank_id` VARCHAR(191) NOT NULL,
    `branch_code` VARCHAR(20) NULL,
    `account_no_enc` VARCHAR(255) NOT NULL,
    `account_no_last4` CHAR(4) NOT NULL,
    `account_name` VARCHAR(160) NOT NULL,
    `effective_from` DATE NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `active_employee_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_one_active_bank_account`(`active_employee_id`),
    INDEX `employee_bank_accounts_employee_id_idx`(`employee_id`),
    INDEX `employee_bank_accounts_bank_id_idx`(`bank_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pay_components` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `kind` ENUM('EARNING', 'DEDUCTION', 'EMPLOYER') NOT NULL,
    `calc_type` ENUM('FIXED', 'PERCENT_OF_BASIC', 'RATE_X_QTY') NOT NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `nssfable` BOOLEAN NOT NULL DEFAULT true,
    `prorate` BOOLEAN NOT NULL DEFAULT false,
    `recurring` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `sort_order` INTEGER NOT NULL DEFAULT 100,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pay_components_code_key`(`code`),
    INDEX `pay_components_kind_is_active_idx`(`kind`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_components` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `component_id` VARCHAR(191) NOT NULL,
    `amount` BIGINT NULL,
    `rate_bp` INTEGER NULL,
    `rate_per_unit` BIGINT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_components_employee_id_component_id_effective_from_idx`(`employee_id`, `component_id`, `effective_from`),
    INDEX `employee_components_component_id_idx`(`component_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statutory_rule_versions` (
    `id` VARCHAR(191) NOT NULL,
    `rule` ENUM('PAYE_RES', 'PAYE_NONRES', 'NSSF', 'LST') NOT NULL,
    `params` JSON NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `source_url` VARCHAR(500) NULL,
    `approved_by_id` VARCHAR(191) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `statutory_rule_versions_rule_active_effective_from_idx`(`rule`, `active`, `effective_from`),
    INDEX `statutory_rule_versions_approved_by_id_idx`(`approved_by_id`),
    UNIQUE INDEX `statutory_rule_versions_rule_effective_from_key`(`rule`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pay_periods` (
    `id` VARCHAR(191) NOT NULL,
    `pay_group_id` VARCHAR(191) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `pay_date` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pay_periods_pay_date_idx`(`pay_date`),
    UNIQUE INDEX `pay_periods_pay_group_id_start_date_key`(`pay_group_id`, `start_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_inputs` (
    `id` VARCHAR(191) NOT NULL,
    `period_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `component_id` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NULL,
    `amount` BIGINT NULL,
    `source` ENUM('MANUAL', 'IMPORT') NOT NULL DEFAULT 'MANUAL',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_inputs_period_id_employee_id_idx`(`period_id`, `employee_id`),
    INDEX `payroll_inputs_employee_id_idx`(`employee_id`),
    INDEX `payroll_inputs_component_id_idx`(`component_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` VARCHAR(191) NOT NULL,
    `period_id` VARCHAR(191) NOT NULL,
    `pay_group_id` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'COMPUTED', 'SUBMITTED', 'REJECTED', 'APPROVED', 'EXPORTED', 'PAID', 'LOCKED') NOT NULL DEFAULT 'DRAFT',
    `computed_by_id` VARCHAR(191) NULL,
    `computed_at` DATETIME(3) NULL,
    `approved_by_id` VARCHAR(191) NULL,
    `approved_at` DATETIME(3) NULL,
    `rejection_comment` TEXT NULL,
    `exported_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `locked_at` DATETIME(3) NULL,
    `rule_version_ids` JSON NULL,
    `totals` JSON NULL,
    `open_period_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_one_open_run_per_period`(`open_period_id`),
    INDEX `payroll_runs_period_id_status_idx`(`period_id`, `status`),
    INDEX `payroll_runs_pay_group_id_idx`(`pay_group_id`),
    INDEX `payroll_runs_computed_by_id_idx`(`computed_by_id`),
    INDEX `payroll_runs_approved_by_id_idx`(`approved_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_run_employees` (
    `id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `gross` BIGINT NOT NULL,
    `taxable` BIGINT NOT NULL,
    `nssf_base` BIGINT NOT NULL,
    `paye` BIGINT NOT NULL,
    `nssf_employee` BIGINT NOT NULL,
    `nssf_employer` BIGINT NOT NULL,
    `lst` BIGINT NOT NULL,
    `other_deductions` BIGINT NOT NULL,
    `net` BIGINT NOT NULL,
    `employer_cost` BIGINT NOT NULL,
    `warnings` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_run_employees_employee_id_idx`(`employee_id`),
    UNIQUE INDEX `payroll_run_employees_run_id_employee_id_key`(`run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_lines` (
    `id` VARCHAR(191) NOT NULL,
    `run_employee_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `quantity` DECIMAL(10, 2) NULL,
    `rate` BIGINT NULL,
    `amount` BIGINT NOT NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_lines_run_employee_id_idx`(`run_employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loans` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `type` ENUM('LOAN', 'ADVANCE', 'SACCO') NOT NULL,
    `principal` BIGINT NOT NULL,
    `installment` BIGINT NOT NULL,
    `balance` BIGINT NOT NULL,
    `start_period_id` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'SETTLED', 'WRITTEN_OFF') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `loans_employee_id_status_idx`(`employee_id`, `status`),
    INDEX `loans_start_period_id_idx`(`start_period_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carry_forwards` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `component_code` VARCHAR(40) NOT NULL,
    `amount` BIGINT NOT NULL,
    `from_run_id` VARCHAR(191) NOT NULL,
    `settled_in_run_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `carry_forwards_employee_id_settled_in_run_id_idx`(`employee_id`, `settled_in_run_id`),
    INDEX `carry_forwards_from_run_id_idx`(`from_run_id`),
    INDEX `carry_forwards_settled_in_run_id_idx`(`settled_in_run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `export_templates` (
    `id` VARCHAR(191) NOT NULL,
    `bank_id` VARCHAR(191) NOT NULL,
    `format` ENUM('CSV', 'XLSX') NOT NULL,
    `mapping` JSON NOT NULL,
    `header_rules` JSON NULL,
    `footer_rules` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `export_templates_bank_id_idx`(`bank_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_exports` (
    `id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `bank_id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `file_sha256` CHAR(64) NOT NULL,
    `row_count` INTEGER NOT NULL,
    `total_amount` BIGINT NOT NULL,
    `generated_by_id` VARCHAR(191) NOT NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('GENERATED', 'SUPERSEDED', 'SENT') NOT NULL DEFAULT 'GENERATED',

    INDEX `bank_exports_bank_id_idx`(`bank_id`),
    INDEX `bank_exports_generated_by_id_idx`(`generated_by_id`),
    UNIQUE INDEX `bank_exports_run_id_bank_id_version_key`(`run_id`, `bank_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` VARCHAR(191) NOT NULL,
    `actor_id` VARCHAR(191) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entity` VARCHAR(80) NOT NULL,
    `entity_id` VARCHAR(191) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_entity_entity_id_idx`(`entity`, `entity_id`),
    INDEX `audit_log_actor_id_at_idx`(`actor_id`, `at`),
    INDEX `audit_log_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `value` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `settings_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_pay_group_id_fkey` FOREIGN KEY (`pay_group_id`) REFERENCES `pay_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_bank_accounts` ADD CONSTRAINT `employee_bank_accounts_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_bank_accounts` ADD CONSTRAINT `employee_bank_accounts_bank_id_fkey` FOREIGN KEY (`bank_id`) REFERENCES `banks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_components` ADD CONSTRAINT `employee_components_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_components` ADD CONSTRAINT `employee_components_component_id_fkey` FOREIGN KEY (`component_id`) REFERENCES `pay_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `statutory_rule_versions` ADD CONSTRAINT `statutory_rule_versions_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pay_periods` ADD CONSTRAINT `pay_periods_pay_group_id_fkey` FOREIGN KEY (`pay_group_id`) REFERENCES `pay_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_inputs` ADD CONSTRAINT `payroll_inputs_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `pay_periods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_inputs` ADD CONSTRAINT `payroll_inputs_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_inputs` ADD CONSTRAINT `payroll_inputs_component_id_fkey` FOREIGN KEY (`component_id`) REFERENCES `pay_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `pay_periods`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_pay_group_id_fkey` FOREIGN KEY (`pay_group_id`) REFERENCES `pay_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_computed_by_id_fkey` FOREIGN KEY (`computed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_employees` ADD CONSTRAINT `payroll_run_employees_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_employees` ADD CONSTRAINT `payroll_run_employees_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_run_employee_id_fkey` FOREIGN KEY (`run_employee_id`) REFERENCES `payroll_run_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_start_period_id_fkey` FOREIGN KEY (`start_period_id`) REFERENCES `pay_periods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carry_forwards` ADD CONSTRAINT `carry_forwards_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carry_forwards` ADD CONSTRAINT `carry_forwards_from_run_id_fkey` FOREIGN KEY (`from_run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carry_forwards` ADD CONSTRAINT `carry_forwards_settled_in_run_id_fkey` FOREIGN KEY (`settled_in_run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `export_templates` ADD CONSTRAINT `export_templates_bank_id_fkey` FOREIGN KEY (`bank_id`) REFERENCES `banks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_exports` ADD CONSTRAINT `bank_exports_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_exports` ADD CONSTRAINT `bank_exports_bank_id_fkey` FOREIGN KEY (`bank_id`) REFERENCES `banks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_exports` ADD CONSTRAINT `bank_exports_generated_by_id_fkey` FOREIGN KEY (`generated_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

