import { PrismaClient } from '@prisma/client';

/**
 * Runtime Prisma client. Connects as the restricted app user (DATABASE_URL), never the migrator.
 * Seed and integration tests create their own clients with MIGRATE_DATABASE_URL / TEST_DATABASE_URL.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
