-- Approved payroll is immutable (CLAUDE.md rule 6).
-- Runs in APPROVED | EXPORTED | PAID | LOCKED: their employee rows and lines cannot be inserted,
-- updated or deleted; the run itself cannot be deleted, its status only moves forward
-- (APPROVED -> EXPORTED -> PAID -> LOCKED) and only status/exported_at/paid_at/locked_at may change.
-- No DELIMITER statements: Prisma sends this file to MySQL as one multi-statement script.

-- ── payroll_run_employees ────────────────────────────────────────────────

CREATE TRIGGER `trg_pre_immutable_insert` BEFORE INSERT ON `payroll_run_employees`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = NEW.`run_id`)
     IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `trg_pre_immutable_update` BEFORE UPDATE ON `payroll_run_employees`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = OLD.`run_id`)
       IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED')
     OR (SELECT `status` FROM `payroll_runs` WHERE `id` = NEW.`run_id`)
       IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `trg_pre_immutable_delete` BEFORE DELETE ON `payroll_run_employees`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = OLD.`run_id`)
     IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
  END IF;
END;

-- ── payroll_lines ────────────────────────────────────────────────────────

CREATE TRIGGER `trg_pl_immutable_insert` BEFORE INSERT ON `payroll_lines`
FOR EACH ROW
BEGIN
  IF (SELECT r.`status` FROM `payroll_run_employees` e
        JOIN `payroll_runs` r ON r.`id` = e.`run_id`
       WHERE e.`id` = NEW.`run_employee_id`)
     IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `trg_pl_immutable_update` BEFORE UPDATE ON `payroll_lines`
FOR EACH ROW
BEGIN
  IF (SELECT r.`status` FROM `payroll_run_employees` e
        JOIN `payroll_runs` r ON r.`id` = e.`run_id`
       WHERE e.`id` = OLD.`run_employee_id`)
       IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED')
     OR (SELECT r.`status` FROM `payroll_run_employees` e
        JOIN `payroll_runs` r ON r.`id` = e.`run_id`
       WHERE e.`id` = NEW.`run_employee_id`)
       IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `trg_pl_immutable_delete` BEFORE DELETE ON `payroll_lines`
FOR EACH ROW
BEGIN
  IF (SELECT r.`status` FROM `payroll_run_employees` e
        JOIN `payroll_runs` r ON r.`id` = e.`run_id`
       WHERE e.`id` = OLD.`run_employee_id`)
     IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
  END IF;
END;

-- ── payroll_runs ─────────────────────────────────────────────────────────

CREATE TRIGGER `trg_run_immutable_delete` BEFORE DELETE ON `payroll_runs`
FOR EACH ROW
BEGIN
  IF OLD.`status` IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `trg_run_immutable_update` BEFORE UPDATE ON `payroll_runs`
FOR EACH ROW
BEGIN
  IF OLD.`status` IN ('APPROVED', 'EXPORTED', 'PAID', 'LOCKED') THEN
    IF NOT (
         NEW.`status` = OLD.`status`
      OR (OLD.`status` = 'APPROVED' AND NEW.`status` = 'EXPORTED')
      OR (OLD.`status` = 'EXPORTED' AND NEW.`status` = 'PAID')
      OR (OLD.`status` = 'PAID'     AND NEW.`status` = 'LOCKED')
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_STATUS_BACKWARDS';
    END IF;

    IF NOT (
          NEW.`period_id`         <=> OLD.`period_id`
      AND NEW.`pay_group_id`      <=> OLD.`pay_group_id`
      AND NEW.`computed_by_id`    <=> OLD.`computed_by_id`
      AND NEW.`computed_at`       <=> OLD.`computed_at`
      AND NEW.`approved_by_id`    <=> OLD.`approved_by_id`
      AND NEW.`approved_at`       <=> OLD.`approved_at`
      AND NEW.`rejection_comment` <=> OLD.`rejection_comment`
      AND NEW.`rule_version_ids`  <=> OLD.`rule_version_ids`
      AND NEW.`totals`            <=> OLD.`totals`
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
    END IF;

    IF OLD.`status` = 'LOCKED' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_IMMUTABLE';
    END IF;
  END IF;
END;
