/**
 * Visual Regression Comparison Script
 *
 * Compares the latest screenshot folder against a baseline.
 * Generates diff images highlighting pixel differences.
 *
 * Usage:
 *   node scripts/screenshot-compare.js                      # Compare latest vs baseline
 *   node scripts/screenshot-compare.js --promote            # Promote latest to baseline
 *   node scripts/screenshot-compare.js --baseline <folder>  # Compare against specific folder
 *
 * Requires: pngjs
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ── Configuration ────────────────────────────────────────────────────

const SCREENSHOTS_DIR = path.resolve('screenshots');
const BASELINE_DIR = path.join(SCREENSHOTS_DIR, '_baseline');
const DIFFS_DIR = path.join(SCREENSHOTS_DIR, '_diffs');

// Per-pixel color distance threshold (0–1). Below this = same pixel.
// 0.1 is tolerant of anti-aliasing differences.
const PIXEL_THRESHOLD = 0.1;

// Page-level threshold: flag if more than this % of pixels differ.
const PAGE_THRESHOLD = 0.5;

// ── CLI argument parsing ─────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { promote: false, baseline: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--promote') {
      opts.promote = true;
    } else if (args[i] === '--baseline' && args[i + 1]) {
      opts.baseline = args[++i];
    }
  }

  return opts;
}

// ── Find latest screenshot folder ────────────────────────────────────

function findLatestFolder() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) return null;

  const entries = fs.readdirSync(SCREENSHOTS_DIR, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort()
    .reverse();

  return folders.length > 0 ? path.join(SCREENSHOTS_DIR, folders[0]) : null;
}

// ── Copy directory recursively (only .png files) ─────────────────────

function copyPngs(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const files = fs.readdirSync(src);
  for (const file of files) {
    if (file.endsWith('.png')) {
      fs.copyFileSync(path.join(src, file), path.join(dest, file));
    }
  }
}

// ── Pixel comparison ─────────────────────────────────────────────────

function comparePngs(baselinePath, currentPath, diffPath) {
  const baselineData = fs.readFileSync(baselinePath);
  const currentData = fs.readFileSync(currentPath);

  const baseline = PNG.sync.read(baselineData);
  const current = PNG.sync.read(currentData);

  // Use the smaller dimensions if sizes differ
  const width = Math.min(baseline.width, current.width);
  const height = Math.min(baseline.height, current.height);
  const diff = new PNG({ width, height });

  let diffPixels = 0;
  const totalPixels = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // For baseline, use its own width for indexing
      const bIdx = (y * baseline.width + x) * 4;
      const cIdx = (y * current.width + x) * 4;

      const rDiff = Math.abs(baseline.data[bIdx] - current.data[cIdx]) / 255;
      const gDiff = Math.abs(baseline.data[bIdx + 1] - current.data[cIdx + 1]) / 255;
      const bDiff = Math.abs(baseline.data[bIdx + 2] - current.data[cIdx + 2]) / 255;

      const distance = Math.sqrt((rDiff * rDiff + gDiff * gDiff + bDiff * bDiff) / 3);

      if (distance > PIXEL_THRESHOLD) {
        // Mark diff pixel in red
        diff.data[idx] = 255;
        diff.data[idx + 1] = 0;
        diff.data[idx + 2] = 0;
        diff.data[idx + 3] = 255;
        diffPixels++;
      } else {
        // Copy current pixel (dimmed)
        diff.data[idx] = current.data[cIdx] * 0.3;
        diff.data[idx + 1] = current.data[cIdx + 1] * 0.3;
        diff.data[idx + 2] = current.data[cIdx + 2] * 0.3;
        diff.data[idx + 3] = 255;
      }
    }
  }

  // Account for size differences as diff pixels
  const sizeChanged = baseline.width !== current.width || baseline.height !== current.height;
  if (sizeChanged) {
    const maxPixels = Math.max(baseline.width, current.width) * Math.max(baseline.height, current.height);
    diffPixels += maxPixels - totalPixels;
  }

  const diffPercent = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;

  // Write diff image
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  return {
    diffPixels,
    totalPixels,
    diffPercent: Math.round(diffPercent * 1000) / 1000,
    sizeChanged,
    baselineSize: { width: baseline.width, height: baseline.height },
    currentSize: { width: current.width, height: current.height },
  };
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();
  const latestDir = findLatestFolder();

  if (!latestDir) {
    console.error('No screenshot folders found in screenshots/');
    process.exit(1);
  }

  console.log(`\nVisual Regression Comparison`);
  console.log(`  Latest: ${path.basename(latestDir)}`);

  // ── Promote mode ───────────────────────────────────────────────
  if (opts.promote) {
    console.log(`  Promoting to baseline...`);
    if (fs.existsSync(BASELINE_DIR)) {
      fs.rmSync(BASELINE_DIR, { recursive: true });
    }
    copyPngs(latestDir, BASELINE_DIR);
    const files = fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith('.png'));
    console.log(`  Baseline updated with ${files.length} screenshots.\n`);
    return;
  }

  // ── Comparison mode ────────────────────────────────────────────
  const baselineDir = opts.baseline
    ? path.resolve(opts.baseline)
    : BASELINE_DIR;

  if (!fs.existsSync(baselineDir)) {
    console.log('  No baseline found. Promoting current screenshots as baseline...');
    copyPngs(latestDir, BASELINE_DIR);
    const files = fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith('.png'));
    console.log(`  Baseline created with ${files.length} screenshots.\n`);
    return;
  }

  console.log(`  Baseline: ${path.basename(baselineDir)}`);

  // Clean previous diffs
  if (fs.existsSync(DIFFS_DIR)) {
    fs.rmSync(DIFFS_DIR, { recursive: true });
  }
  fs.mkdirSync(DIFFS_DIR, { recursive: true });

  const baselineFiles = fs.readdirSync(baselineDir).filter((f) => f.endsWith('.png'));
  const currentFiles = fs.readdirSync(latestDir).filter((f) => f.endsWith('.png'));

  const comparison = { timestamp: new Date().toISOString(), results: {} };
  let flagged = 0;

  // Compare matching files
  for (const file of baselineFiles) {
    const baselinePath = path.join(baselineDir, file);
    const currentPath = path.join(latestDir, file);
    const diffPath = path.join(DIFFS_DIR, `diff_${file}`);

    if (!fs.existsSync(currentPath)) {
      comparison.results[file] = { status: 'missing', note: 'In baseline but not in current' };
      console.log(`  ${file}: MISSING from current`);
      flagged++;
      continue;
    }

    const result = comparePngs(baselinePath, currentPath, diffPath);
    const exceeded = result.diffPercent > PAGE_THRESHOLD;

    comparison.results[file] = {
      status: exceeded ? 'changed' : 'ok',
      ...result,
    };

    if (exceeded) {
      console.log(`  ${file}: CHANGED (${result.diffPercent}% diff)`);
      flagged++;
    } else {
      console.log(`  ${file}: OK (${result.diffPercent}% diff)`);
      // Remove diff image if below threshold
      if (fs.existsSync(diffPath)) fs.unlinkSync(diffPath);
    }
  }

  // Check for new files not in baseline
  for (const file of currentFiles) {
    if (!baselineFiles.includes(file)) {
      comparison.results[file] = { status: 'new', note: 'Not in baseline' };
      console.log(`  ${file}: NEW (not in baseline)`);
    }
  }

  // Write comparison results
  const compPath = path.join(SCREENSHOTS_DIR, '_comparison.json');
  fs.writeFileSync(compPath, JSON.stringify(comparison, null, 2));

  console.log(`\nResults: ${baselineFiles.length - flagged} ok, ${flagged} flagged`);
  console.log(`Comparison: ${compPath}`);
  if (flagged > 0) {
    console.log(`Diffs: ${DIFFS_DIR}\n`);
  } else {
    console.log('');
  }

  if (flagged > 0) process.exit(1);
}

main();
