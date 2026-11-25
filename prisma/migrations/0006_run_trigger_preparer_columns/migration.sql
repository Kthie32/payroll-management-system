-- Extend the approved-run immutability trigger to the preparer/submitter columns added in 0005.
-- Once a run is APPROVED (or later), who created, submitted and approved it can never change:
-- that record is the evidence for the per-run preparer ≠ approver rule.

DROP TRIGGER IF EXISTS `trg_run_immutable_update`;

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
      AND NEW.`created_by_id`     <=> OLD.`created_by_id`
      AND NEW.`computed_by_id`    <=> OLD.`computed_by_id`
      AND NEW.`computed_at`       <=> OLD.`computed_at`
      AND NEW.`submitted_by_id`   <=> OLD.`submitted_by_id`
      AND NEW.`submitted_at`      <=> OLD.`submitted_at`
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
