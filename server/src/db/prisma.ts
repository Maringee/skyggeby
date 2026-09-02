import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/**
 * Single shared Prisma client. In dev the module can be re-evaluated by the
 * watcher, so the instance is cached on globalThis to avoid connection leaks.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ['error'] : ['warn', 'error'],
  });

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}
