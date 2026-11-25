import 'dotenv/config';
import { execSync } from 'node:child_process';

/**
 * Rebuild the integration test database from migrations before the suite runs.
 * Uses TEST_DATABASE_URL (must point at payroll_test — never the dev database).
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  if (!/\/payroll_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point at the payroll_test database');
  }
  execSync('pnpm exec prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, MIGRATE_DATABASE_URL: url },
  });
}
