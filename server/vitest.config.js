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
    // so createTenantClient works against test data
    env: {
      DATABASE_URL_APP:
        'postgresql://retailedge_app:retailedge_app_prod@retailedge-test-db-do-user-34957730-0.h.db.ondigitalocean.com:25060/retailedge_test?sslmode=require',
      JWT_SECRET: 'test-secret-key-for-vitest',
    },
  },
});
