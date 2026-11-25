import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Rebuild the integration test database from migrations before the suite runs.
 * Only ever touches payroll_test: drops and recreates it, then applies migrations.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  if (!/\/payroll_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point at the payroll_test database');
  }
  const admin = new PrismaClient({ datasourceUrl: url });
  try {
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS payroll_test');
    await admin.$executeRawUnsafe(
      'CREATE DATABASE payroll_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci',
    );
  } finally {
    await admin.$disconnect();
  }
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, MIGRATE_DATABASE_URL: url },
  });
}
