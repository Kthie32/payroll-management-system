-- audit_log is append-only (CLAUDE.md rule 5).
-- TRUNCATE cannot be trapped by a trigger in MySQL; it is prevented by privileges instead:
-- the runtime user `payroll_app` has no DROP privilege (see scripts/mysql-setup.sql).

CREATE TRIGGER `trg_audit_no_update` BEFORE UPDATE ON `audit_log`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUDIT_APPEND_ONLY';
END;

CREATE TRIGGER `trg_audit_no_delete` BEFORE DELETE ON `audit_log`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUDIT_APPEND_ONLY';
END;
