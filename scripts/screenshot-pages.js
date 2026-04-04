/**
 * Headless UI Screenshot Capture Script
 *
 * Captures screenshots of all app pages using Playwright with headless Chromium.
 * Logs in as the dedicated screenshot test user, then visits each route.
 *
 * Usage:
 *   node scripts/screenshot-pages.js                    # All pages, desktop
 *   node scripts/screenshot-pages.js --viewport mobile  # All pages, mobile
 *   node scripts/screenshot-pages.js --page dashboard   # Single page
 *   node scripts/screenshot-pages.js --full              # Full-page screenshots
 *
 * Requires: playwright, chromium browser installed
 * Environment: APP_URL (default http://localhost:3000)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── Configuration ────────────────────────────────────────────────────

const BASE_URL = process.env.APP_URL || 'http://localhost';

const TEST_USER = {
  email: 'screenshottest@retailedgeai.com',
  password: 'Screenshot_Test_2024!',
};

const PAGES = {
  login:        { path: '/login',           auth: false, name: 'Login Page' },
  dashboard:    { path: '/',                auth: true,  name: 'Dashboard' },
  ai:           { path: '/ai',             auth: true,  name: 'AI Command Center' },
  invoices:     { path: '/invoices',       auth: true,  name: 'Invoices' },
  review:       { path: '/review',         auth: true,  name: 'Batch Review' },
  export:       { path: '/export',         auth: true,  name: 'Export' },
  products:     { path: '/products',       auth: true,  name: 'Products' },
  pricing:      { path: '/pricing',        auth: true,  name: 'Pricing Rules' },
  reports:      { path: '/reports',        auth: true,  name: 'Reports' },
  advisor:      { path: '/advisor',        auth: true,  name: 'AI Advisor' },
  competitor:   { path: '/competitor',     auth: true,  name: 'Competitor Intel' },
  connect:      { path: '/connect',        auth: true,  name: 'Connect Wizard' },
  settings:     { path: '/settings',       auth: true,  name: 'Settings' },
};

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet:  { width: 768,  height: 1024 },
  mobile:  { width: 375,  height: 812 },
};

// ── CLI argument parsing ─────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { page: null, viewport: 'desktop', full: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--page' && args[i + 1]) {
      opts.page = args[++i];
    } else if (args[i] === '--viewport' && args[i + 1]) {
      opts.viewport = args[++i];
    } else if (args[i] === '--full') {
      opts.full = true;
    }
  }

  return opts;
}

// ── Login helper ─────────────────────────────────────────────────────

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

  // Clear pre-filled values and enter test credentials
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');

  await emailInput.fill(TEST_USER.email);
  await passwordInput.fill(TEST_USER.password);

  // Click submit and wait for navigation
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 }),
    page.locator('button[type="submit"]').click(),
  ]);

  // Wait for the app to settle after redirect
  await page.waitForLoadState('networkidle');
}

// ── Error detection ──────────────────────────────────────────────────

async function checkForErrors(page) {
  const errorSelectors = [
    '.error',
    '.alert-danger',
    '[role="alert"]',
    '.error-boundary',
    '.bg-red-50',
  ];

  const errors = [];
  for (const sel of errorSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      const text = await page.locator(sel).first().textContent();
      errors.push({ selector: sel, count, text: text?.trim().slice(0, 200) });
    }
  }
  return errors;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.viewport && !VIEWPORTS[opts.viewport]) {
    console.error(`Unknown viewport: ${opts.viewport}. Options: ${Object.keys(VIEWPORTS).join(', ')}`);
    process.exit(1);
  }

  if (opts.page && !PAGES[opts.page]) {
    console.error(`Unknown page: ${opts.page}. Options: ${Object.keys(PAGES).join(', ')}`);
    process.exit(1);
  }

  const viewport = VIEWPORTS[opts.viewport];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve('screenshots', `${timestamp}_${opts.viewport}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\nScreenshot Capture`);
  console.log(`  URL:      ${BASE_URL}`);
  console.log(`  Viewport: ${opts.viewport} (${viewport.width}x${viewport.height})`);
  console.log(`  Output:   ${outDir}`);
  console.log(`  Full page: ${opts.full ? 'yes' : 'no'}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const summary = { timestamp, viewport: opts.viewport, pages: {} };

  // Determine which pages to capture
  const pageKeys = opts.page ? [opts.page] : Object.keys(PAGES);

  // Login once for authenticated pages
  const needsAuth = pageKeys.some((k) => PAGES[k].auth);
  if (needsAuth) {
    console.log('  Logging in...');
    try {
      await login(page);
      console.log('  Logged in successfully.\n');
    } catch (err) {
      console.error(`  Login failed: ${err.message}`);
      summary.loginError = err.message;
      await browser.close();
      fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2));
      process.exit(1);
    }
  }

  for (const key of pageKeys) {
    const { path: route, name } = PAGES[key];
    const filename = `${key}_${opts.viewport}.png`;
    const filepath = path.join(outDir, filename);

    process.stdout.write(`  ${name} (${route}) ... `);

    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 30000 });

      // Give dynamic content a moment to render
      await page.waitForTimeout(1000);

      await page.screenshot({ path: filepath, fullPage: opts.full });

      const errors = await checkForErrors(page);
      const status = errors.length > 0 ? 'warning' : 'ok';
      const icon = status === 'ok' ? 'OK' : 'WARN';

      summary.pages[key] = { name, route, filename, status, errors };
      console.log(`${icon}${errors.length > 0 ? ` (${errors.length} error element${errors.length > 1 ? 's' : ''})` : ''}`);
    } catch (err) {
      summary.pages[key] = { name, route, filename, status: 'error', error: err.message };
      console.log(`FAIL — ${err.message}`);
    }
  }

  // Write summary
  const summaryPath = path.join(outDir, '_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  await browser.close();

  // Print results
  const results = Object.values(summary.pages);
  const ok = results.filter((r) => r.status === 'ok').length;
  const warn = results.filter((r) => r.status === 'warning').length;
  const fail = results.filter((r) => r.status === 'error').length;

  console.log(`\nDone: ${ok} ok, ${warn} warnings, ${fail} failures`);
  console.log(`Summary: ${summaryPath}\n`);

  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
