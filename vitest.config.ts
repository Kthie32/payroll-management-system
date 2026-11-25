import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/payroll-engine/**/*.ts', 'src/lib/money/**/*.ts', 'src/lib/crypto/**/*.ts'],
      exclude: ['**/__tests__/**'],
      thresholds: {
        'src/lib/payroll-engine/**': { lines: 100, functions: 100, statements: 100 },
      },
    },
  },
});
