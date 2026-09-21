import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const alias = {
  '@bcis/shared': resolvePath('./packages/shared/src/index.ts'),
  '@bcis/validation': resolvePath('./packages/validation/src/index.ts'),
  '@bcis/domain': resolvePath('./packages/domain/src/index.ts'),
  '@bcis/database': resolvePath('./database/src/index.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/**/src/**/*.test.ts',
            'tests/unit/**/*.test.ts',
            'apps/**/src/**/*.unit.test.ts',
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts', 'apps/api/src/**/*.integration.test.ts'],
          // Repoints DATABASE_URL at the test database before any test imports
          // the app. See tests/integration/setup.ts for the safety guards.
          setupFiles: ['./tests/integration/setup.ts'],
          // Integration tests share one real PostgreSQL database and create
          // financial documents with unique numbers. Running files in parallel
          // would make failures non-deterministic, so they run serially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
