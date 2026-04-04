import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './tests/setup.js',
    testTimeout: 30000,
    hookTimeout: 60000,
    // Run test files sequentially — they share a single test database
    fileParallelism: false,
    // Point basePrisma (via DATABASE_URL_APP) at the test database
    // so createTenantClient works against test data.
    // Point adminPrisma (via DATABASE_URL) at the same test database
    // with admin credentials so auth and admin routes work in tests.
    env: {
      DATABASE_URL_APP:
        'postgresql://retailedge_app:retailedge_app@localhost:5433/retailedge_test',
      DATABASE_URL:
        'postgresql://retailedge:retailedge@localhost:5433/retailedge_test',
      JWT_SECRET: 'test-secret-key-for-vitest',
    },
  },
});
