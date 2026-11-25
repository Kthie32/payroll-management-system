-- AlterTable
ALTER TABLE `banks` ADD COLUMN `kind` ENUM('BANK', 'MOBILE_MONEY') NOT NULL DEFAULT 'BANK';

-- AlterTable
ALTER TABLE `employees` ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `phone` VARCHAR(20) NULL;

-- AlterTable
ALTER TABLE `payroll_inputs` ADD COLUMN `adjusts_run_id` VARCHAR(191) NULL,
    ADD COLUMN `note` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `payroll_runs` ADD COLUMN `created_by_id` VARCHAR(191) NULL,
    ADD COLUMN `submitted_at` DATETIME(3) NULL,
    ADD COLUMN `submitted_by_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `outbound_messages` (
    `id` VARCHAR(191) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS') NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(200) NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `provider` VARCHAR(40) NOT NULL,
    `provider_ref` VARCHAR(191) NULL,
    `error` VARCHAR(500) NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sent_at` DATETIME(3) NULL,

    INDEX `outbound_messages_status_created_at_idx`(`status`, `created_at`),
    INDEX `outbound_messages_recipient_idx`(`recipient`),
    INDEX `outbound_messages_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslip_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `run_employee_id` VARCHAR(191) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS') NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `message_id` VARCHAR(191) NULL,
    `opened_at` DATETIME(3) NULL,
    `open_count` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payslip_deliveries_token_hash_key`(`token_hash`),
    INDEX `payslip_deliveries_run_employee_id_idx`(`run_employee_id`),
    INDEX `payslip_deliveries_message_id_idx`(`message_id`),
    INDEX `payslip_deliveries_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_results` (
    `id` VARCHAR(191) NOT NULL,
    `bank_export_id` VARCHAR(191) NOT NULL,
    `run_employee_id` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'FAILED') NOT NULL,
    `amount` BIGINT NOT NULL,
    `reference` VARCHAR(100) NULL,
    `reason` VARCHAR(500) NULL,
    `uploaded_by_id` VARCHAR(191) NOT NULL,
    `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_results_run_employee_id_idx`(`run_employee_id`),
    INDEX `payment_results_status_idx`(`status`),
    INDEX `payment_results_uploaded_by_id_idx`(`uploaded_by_id`),
    UNIQUE INDEX `payment_results_bank_export_id_run_employee_id_key`(`bank_export_id`, `run_employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `employees_email_idx` ON `employees`(`email`);

-- CreateIndex
CREATE INDEX `payroll_inputs_adjusts_run_id_idx` ON `payroll_inputs`(`adjusts_run_id`);

-- CreateIndex
CREATE INDEX `payroll_runs_created_by_id_idx` ON `payroll_runs`(`created_by_id`);

-- CreateIndex
CREATE INDEX `payroll_runs_submitted_by_id_idx` ON `payroll_runs`(`submitted_by_id`);

-- AddForeignKey
ALTER TABLE `payroll_inputs` ADD CONSTRAINT `payroll_inputs_adjusts_run_id_fkey` FOREIGN KEY (`adjusts_run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_submitted_by_id_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslip_deliveries` ADD CONSTRAINT `payslip_deliveries_run_employee_id_fkey` FOREIGN KEY (`run_employee_id`) REFERENCES `payroll_run_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslip_deliveries` ADD CONSTRAINT `payslip_deliveries_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `outbound_messages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslip_deliveries` ADD CONSTRAINT `payslip_deliveries_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_results` ADD CONSTRAINT `payment_results_bank_export_id_fkey` FOREIGN KEY (`bank_export_id`) REFERENCES `bank_exports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_results` ADD CONSTRAINT `payment_results_run_employee_id_fkey` FOREIGN KEY (`run_employee_id`) REFERENCES `payroll_run_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_results` ADD CONSTRAINT `payment_results_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

