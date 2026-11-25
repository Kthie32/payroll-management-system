-- One-time local setup. Run as MySQL root:
--   mysql -u root -p < scripts/mysql-setup.sql
-- Change the passwords here AND in your .env (they match .env.example placeholders).

CREATE DATABASE IF NOT EXISTS `payroll`        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS `payroll_test`   CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS `payroll_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Migration / seed / test user: full rights on the three payroll databases.
CREATE USER IF NOT EXISTS 'payroll_migrator'@'localhost' IDENTIFIED BY 'change-me-migrator';
GRANT ALL PRIVILEGES ON `payroll`.*        TO 'payroll_migrator'@'localhost';
GRANT ALL PRIVILEGES ON `payroll_test`.*   TO 'payroll_migrator'@'localhost';
GRANT ALL PRIVILEGES ON `payroll_shadow`.* TO 'payroll_migrator'@'localhost';

-- Runtime app user: data access only. No DROP => cannot TRUNCATE audit_log; no ALTER/TRIGGER
-- => cannot remove the immutability triggers.
CREATE USER IF NOT EXISTS 'payroll_app'@'localhost' IDENTIFIED BY 'change-me-app';
GRANT SELECT, INSERT, UPDATE, DELETE ON `payroll`.* TO 'payroll_app'@'localhost';

-- MySQL 8 enables binary logging by default. Creating triggers with binary logging on requires
-- SUPER (or SET_USER_ID) unless this is set. Acceptable for a local development server; on a
-- managed production server use the provider's equivalent parameter.
SET GLOBAL log_bin_trust_function_creators = 1;

FLUSH PRIVILEGES;
