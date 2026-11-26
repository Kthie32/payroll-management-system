-- AlterTable
ALTER TABLE `bank_exports` ADD COLUMN `is_reissue` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `payee_employee_ids` JSON NULL,
    ADD COLUMN `reissue_of_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `payslip_deliveries` ADD COLUMN `failed_attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `locked_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `bank_exports_reissue_of_id_idx` ON `bank_exports`(`reissue_of_id`);

-- AddForeignKey
ALTER TABLE `bank_exports` ADD CONSTRAINT `bank_exports_reissue_of_id_fkey` FOREIGN KEY (`reissue_of_id`) REFERENCES `bank_exports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: re-issue files were previously identified only by their generation audit entry.
UPDATE `bank_exports` be
JOIN `audit_log` a
  ON a.`entity` = 'BankExport' AND a.`entity_id` = be.`id` AND a.`action` = 'BANK_EXPORT_GENERATED'
SET be.`is_reissue` = TRUE,
    be.`payee_employee_ids` = JSON_EXTRACT(a.`after`, '$.employeeIds')
WHERE JSON_EXTRACT(a.`after`, '$.reissue') = TRUE;

-- Backfill: link each re-issue to the latest earlier normal file of the same run and bank.
UPDATE `bank_exports` r
JOIN (
  SELECT r2.`id` AS rid,
         (SELECT o.`id` FROM `bank_exports` o
           WHERE o.`run_id` = r2.`run_id` AND o.`bank_id` = r2.`bank_id`
             AND o.`is_reissue` = FALSE AND o.`version` < r2.`version`
           ORDER BY o.`version` DESC LIMIT 1) AS oid
  FROM `bank_exports` r2 WHERE r2.`is_reissue` = TRUE
) x ON x.rid = r.`id`
SET r.`reissue_of_id` = x.oid;

-- Backfill: wrong-answer counts were previously counted from the audit log.
UPDATE `payslip_deliveries` d
JOIN (
  SELECT `entity_id`, COUNT(*) AS n FROM `audit_log`
  WHERE `entity` = 'PayslipDelivery' AND `action` = 'PAYSLIP_LINK_VERIFY_FAILED'
  GROUP BY `entity_id`
) f ON f.`entity_id` = d.`id`
SET d.`failed_attempts` = f.n;
