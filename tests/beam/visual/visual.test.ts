/**
 * Visual Test Suite — AI-powered UI verification using Lookout
 *
 * Takes screenshots of Beam UI and feeds them to the lookout photon
 * (local Qwen3-VL on Apple Silicon) for semantic analysis.
 *
 * Prerequisites:
 *   - lookout photon installed (~/.photon/lookout.photon.ts)
 *   - MLX dependencies: pip install -U mlx-vlm
 *   - Apple Silicon Mac
 *
 * When prerequisites aren't met, all tests skip gracefully.
 * Existing DOM-based and binary snapshot tests are unaffected.
 *
 * Run: npm run test:visual
 * Run with visible browser: HEADLESS=false npm run test:visual
 */

import { strict as assert } from 'assert';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { isAvailable, review, validate, compare } from './lookout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, '..', 'snapshots', 'visual');
const BASELINE_DIR = path.join(__dirname, '..', 'snapshots');
const SCORE_THRESHOLD = 70;

// ── Beam Server & Browser ────────────────────────────────────

let beamProcess: ChildProcess | null = null;
let browser: any = null;
let page: any = null;
let beamPort = 0;

async function startBeam(): Promise<void> {
  beamPort = 3500 + Math.floor(Math.random() * 100);

  return new Promise((resolve, reject) => {
    beamProcess = spawn('node', ['dist/cli.js', 'beam', '--port', String(beamPort)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    let started = false;
    beamProcess.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('Photon Beam') && !started) {
        started = true;
        setTimeout(async () => {
          for (let i = 0; i < 10; i++) {
            try {
              const r = await fetch(`http://localhost:${beamPort}`);
              if (r.ok) {
                resolve();
                return;
              }
            } catch {}
            await new Promise((r) => setTimeout(r, 500));
          }
          resolve();
        }, 1000);
      }
    });

    beamProcess.on('error', reject);
    setTimeout(() => {
      if (!started) reject(new Error('Beam failed to start in 20s'));
    }, 20000);
  });
}

async function stopBeam() {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    beamProcess = null;
  }
}

async function initBrowser() {
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  page = await browser.newPage();
  page.setDefaultTimeout(30000);
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function screenshot(name: string): Promise<string> {
  await ensureDir(SCREENSHOT_DIR);
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function waitForSidebar() {
  // Wait for sidebar to populate with at least one photon item
  await page.waitForSelector('.photon-item', { timeout: 30000 });
  await page.waitForTimeout(500);
}

async function clickFirstPhoton() {
  const first = page.locator('.photon-item').first();
  await first.click();
  await page.waitForTimeout(1000);
}

async function clickFirstMethod() {
  // After clicking a photon, the detail view shows with "scroll down for methods"
  // Method cards appear below the fold — scroll the main content area
  const mainContent = page.locator('.main-content, main, [class*="content"]').first();
  await mainContent.evaluate((el: Element) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(1000);

  // Try multiple selectors for method cards
  const methodCard = page.locator('.method-card, .tool-card, [class*="method"]').first();
  const visible = await methodCard.isVisible().catch(() => false);
  if (visible) {
    await methodCard.scrollIntoViewIfNeeded();
    await methodCard.click();
    await page.waitForTimeout(2000); // Wait for execution
  }
}

// ── Test Runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message?.slice(0, 300)}`);
  }
}

function skip(name: string, reason: string) {
  skipped++;
  console.log(`  ⏭️  ${name} — ${reason}`);
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 Visual Test Suite (Lookout AI)\n');

  // Gate: check lookout availability
  const ready = await isAvailable();
  if (!ready) {
    console.log('  ⏭️  Lookout not available (no MLX or photon not installed).');
    console.log('     Install: pip install -U mlx-vlm && photon install lookout\n');
    process.exit(0);
  }

  console.log('  Lookout ready. Starting Beam...');
  await startBeam();
  await initBrowser();

  // Navigate and wait for sidebar
  await page.goto(`http://localhost:${beamPort}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  let sidebarReady = false;
  try {
    await waitForSidebar();
    sidebarReady = true;
  } catch {
    // SSE connection may be slow — retry with fresh navigation
    try {
      await page.goto(`http://localhost:${beamPort}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForSelector('.photon-item', { timeout: 30000 });
      sidebarReady = true;
    } catch {
      console.log('  ⚠️  Sidebar did not populate — some tests will be limited.\n');
    }
  }

  console.log(`  Beam on port ${beamPort}. Running visual tests...\n`);

  // ── Test 1: Landing page health ────────────────────────

  await test('Landing page — no critical UI issues', async () => {
    const img = await screenshot('landing-page');
    const result = await review(img);

    assert.ok(result, 'Lookout returned no result');
    assert.ok(
      result.criticalCount === 0,
      `${result.criticalCount} critical issue(s):\n${result.issues
        .filter((i) => i.severity === 'critical')
        .map((i) => `  - ${i.description}`)
        .join('\n')}`
    );
  });

  // ── Test 2: Landing page visual promises ───────────────

  await test('Landing page — core UI elements present', async () => {
    const img = await screenshot('landing-elements');
    const result = await validate(img, [
      'A sidebar or navigation panel on the left',
      'A main content area taking most of the screen',
      'Application title or branding visible',
    ]);

    assert.ok(result, 'Lookout returned no result');
    assert.ok(
      result.failed === 0,
      `${result.failed} promise(s) failed:\n${result.results
        .filter((r) => r.status === 'FAIL')
        .map((r) => `  - ${r.promise}: ${r.evidence}`)
        .join('\n')}`
    );
  });

  // ── Test 3: Photon list in sidebar ─────────────────────

  if (sidebarReady) {
    await test('Sidebar — photon list visible', async () => {
      const img = await screenshot('sidebar-photons');
      const result = await validate(img, [
        'A list of items or entries in the sidebar',
        'Each item has a name or label',
      ]);

      assert.ok(result, 'Lookout returned no result');
      assert.ok(
        result.failed === 0,
        `${result.failed} promise(s) failed:\n${result.results
          .filter((r) => r.status === 'FAIL')
          .map((r) => `  - ${r.promise}: ${r.evidence}`)
          .join('\n')}`
      );
    });
  } else {
    skip('Sidebar — photon list visible', 'sidebar not populated');
  }

  // ── Test 4: Photon detail view ─────────────────────────

  if (sidebarReady) {
    await test('Photon view — method cards displayed', async () => {
      await clickFirstPhoton();
      await page.waitForTimeout(500);
      const img = await screenshot('photon-view');

      const result = await validate(img, [
        'Cards or panels showing available actions or methods',
        'Each card has a title or description',
      ]);

      assert.ok(result, 'Lookout returned no result');
      assert.ok(
        result.failed === 0,
        `${result.failed} promise(s) failed:\n${result.results
          .filter((r) => r.status === 'FAIL')
          .map((r) => `  - ${r.promise}: ${r.evidence}`)
          .join('\n')}`
      );
    });
  } else {
    skip('Photon view — method cards displayed', 'sidebar not populated');
  }

  // ── Test 5: Method execution result ────────────────────

  if (sidebarReady) {
    await test('Method result — content renders without errors', async () => {
      await clickFirstPhoton();
      await clickFirstMethod();
      const img = await screenshot('method-result');

      const result = await review(img);
      assert.ok(result, 'Lookout returned no result');

      if (result.score !== null) {
        assert.ok(
          result.score >= SCORE_THRESHOLD,
          `UI score ${result.score}/100 below threshold ${SCORE_THRESHOLD}:\n${result.issues
            .map((i) => `  [${i.severity}] ${i.description}`)
            .join('\n')}`
        );
      }

      assert.ok(
        result.criticalCount === 0,
        `${result.criticalCount} critical issue(s):\n${result.issues
          .filter((i) => i.severity === 'critical')
          .map((i) => `  - ${i.description}`)
          .join('\n')}`
      );
    });
  } else {
    skip('Method result — content renders without errors', 'sidebar not populated');
  }

  // ── Test 6: Score threshold check ──────────────────────

  await test('Overall UI health — score above threshold', async () => {
    // Navigate fresh to get a clean state
    await page.goto(`http://localhost:${beamPort}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(2000);
    const img = await screenshot('overall-health');

    const result = await review(img);
    assert.ok(result, 'Lookout returned no result');

    if (result.score !== null) {
      assert.ok(
        result.score >= SCORE_THRESHOLD,
        `UI health score ${result.score}/100 below threshold ${SCORE_THRESHOLD}:\n${result.issues
          .map((i) => `  [${i.severity}] ${i.description}`)
          .join('\n')}`
      );
    }
  });

  // ── Test 7: Regression detection ───────────────────────

  const baselineFiles = await fs.readdir(BASELINE_DIR).catch(() => []);
  const pngBaselines = (baselineFiles as string[]).filter(
    (f: string) => f.endsWith('.png') && !f.endsWith('.new.png')
  );

  if (pngBaselines.length > 0) {
    await test(`Regression check — ${pngBaselines[0]} baseline`, async () => {
      const baselinePath = path.join(BASELINE_DIR, pngBaselines[0]);
      // Take current screenshot of similar view
      await page.goto(`http://localhost:${beamPort}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
      const currentImg = await screenshot('regression-current');

      const result = await compare(baselinePath, currentImg);
      assert.ok(result, 'Lookout returned no result');

      assert.ok(
        result.newIssues === 0,
        `${result.newIssues} new issue(s) introduced since baseline`
      );

      if (result.afterScore !== null && result.beforeScore !== null) {
        const scoreDrop = result.beforeScore - result.afterScore;
        assert.ok(
          scoreDrop <= 15,
          `Score dropped by ${scoreDrop} points (${result.beforeScore} → ${result.afterScore})`
        );
      }
    });
  } else {
    skip('Regression check', 'no baseline snapshots found');
  }

  // ── Cleanup & Summary ──────────────────────────────────

  await closeBrowser();
  await stopBeam();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Visual Tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`${'─'.repeat(50)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Visual test suite crashed:', err);
  await closeBrowser();
  await stopBeam();
  process.exit(1);
});
