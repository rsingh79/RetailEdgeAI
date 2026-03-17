import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');

/**
 * Global test setup — runs once before all test files.
 * Uses the superuser connection for migrations (DDL requires it),
 * then tests connect as the non-superuser app role (so RLS is enforced).
 */
export async function setup() {
  // Use superuser for migrations (DDL operations)
  const migrationUrl =
    'postgresql://retailedge:retailedge_dev@localhost:5433/retailedge_test';

  console.log('\n🧪 Setting up test database...');

  // Apply all migrations to the test database using superuser
  execSync('npx prisma migrate deploy', {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: migrationUrl },
    stdio: 'pipe',
  });

  // After migrations, grant the app role access to all tables
  // (tables created by superuser aren't automatically accessible to app_user)
  execSync(
    `"C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe" exec retailedge-db psql -U retailedge -d retailedge_test -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO retailedge_app; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO retailedge_app;"`,
    { stdio: 'pipe' }
  );

  console.log('✓ Test database migrations applied\n');
}

/**
 * Global teardown — runs once after all test files.
 */
export async function teardown() {
  // Test database persists between runs for speed.
  // Each test file cleans up after itself via cleanDatabase().
}
