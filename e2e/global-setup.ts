import 'dotenv/config';
import { execSync } from 'node:child_process';
import rebuildTestDb from '../tests/integration/global-setup';

/** E2E runs against a freshly rebuilt and seeded payroll_test database — never the dev database. */
export default async function setup() {
  await rebuildTestDb();
  execSync('pnpm exec tsx prisma/seed.ts', {
    stdio: 'inherit',
    env: { ...process.env, MIGRATE_DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
