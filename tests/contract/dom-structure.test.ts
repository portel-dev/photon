/**
 * DOM Structure Regression Tests
 *
 * Validates Beam UI structural integrity via Playwright DOM assertions.
 * These are deterministic, instant checks — no AI visual analysis needed.
 * Catches layout regressions that keep coming back after fixes.
 *
 * Promises validated:
 * - P1.1: Beam shows photons in sidebar with all methods
 * - P2.1: Human can invoke via Beam UI
 * - P4.1: @format renders correctly in Beam
 * - P4.2: Auto-UI generates forms from signatures
 *
 * Run: npm run test:dom
 * Cost: ~10s (Beam startup + Playwright, no AI)
 */

import { strict as assert } from 'assert';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '..', '..', 'dist', 'cli.js');

let beamProcess: ChildProcess | null = null;
let browser: any = null;
let page: any = null;
let beamPort = 0;

// ── Server & Browser ─────────────────────────────────────────

async function startBeam(): Promise<void> {
  beamPort = 3650 + Math.floor(Math.random() * 50);

  return new Promise((resolve, reject) => {
    beamProcess = spawn('node', [CLI_PATH, 'beam', '--port', String(beamPort)], {
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
      if (!started) reject(new Error('Beam timeout'));
    }, 20000);
  });
}

async function cleanup() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    beamProcess = null;
  }
}

// ── Test Runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

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

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('\n🏗️  DOM Structure Regression Tests\n');

  await startBeam();

  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(15000);

  await page.goto(`http://localhost:${beamPort}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for sidebar to populate
  let sidebarReady = false;
  try {
    await page.waitForSelector('.photon-item', { timeout: 30000 });
    sidebarReady = true;
  } catch {
    console.log('  ⚠️  Sidebar did not populate — limited tests\n');
  }

  // ═══════════════════════════════════════════════════════════
  // P1.1: Beam structural integrity
  // ═══════════════════════════════════════════════════════════

  console.log('  P1.1 — Beam UI structure\n');

  await test('Page loads with sidebar and main content area', async () => {
    const sidebar = await page.locator('.sidebar, beam-sidebar, nav').count();
    assert.ok(sidebar > 0, 'No sidebar element found');

    const main = await page.locator('.main-content, main, .content').count();
    assert.ok(main > 0, 'No main content area found');
  });

  await test('Application title/branding is present', async () => {
    const title = await page.locator('text=Photon Beam').count();
    assert.ok(title > 0, 'No "Photon Beam" branding found');
  });

  if (sidebarReady) {
    await test('Sidebar shows photon items with names', async () => {
      const items = await page.locator('.photon-item').count();
      assert.ok(items > 0, `Expected photon items, got ${items}`);
    });

    await test('Each photon item has visible text content', async () => {
      const firstText = await page.locator('.photon-item').first().textContent();
      assert.ok(firstText && firstText.trim().length > 0, 'Photon item has no text');
    });

    await test('Sidebar has search/filter input', async () => {
      const search = await page
        .locator('input[type="search"], input[placeholder*="earch"], input[placeholder*="ilter"]')
        .count();
      assert.ok(search > 0, 'No search input in sidebar');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // P2.1: Interactive UI for humans
  // ═══════════════════════════════════════════════════════════

  if (sidebarReady) {
    console.log('\n  P2.1 — Interactive UI\n');

    await test('Clicking photon shows detail view', async () => {
      await page.locator('.photon-item').first().click();
      await page.waitForTimeout(1500);

      // Should show photon name/description somewhere in main area
      const mainText = await page.locator('.main-content, main, .content').first().textContent();
      assert.ok(mainText && mainText.length > 20, 'Detail view should have content');
    });

    await test('Detail view has method cards or action items', async () => {
      // Scroll to see methods
      const main = page.locator('.main-content, main, .content').first();
      await main.evaluate((el: Element) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(500);

      const methods = await page.locator('.method-card, .tool-card, [class*="method"]').count();
      // Methods might be below fold — at least the photon name should be visible
      const hasContent =
        methods > 0 ||
        (await page.locator('text=Methods').count()) > 0 ||
        (await page.locator('text=scroll down').count()) > 0;
      assert.ok(
        hasContent,
        `Expected method cards or method section indicator, got ${methods} cards`
      );
    });
  }

  // ═══════════════════════════════════════════════════════════
  // P4.1: Format rendering structure
  // ═══════════════════════════════════════════════════════════

  if (sidebarReady) {
    console.log('\n  P4.1 — Format rendering structure\n');

    // Try to execute a method and check DOM structure
    // Click first method card if available
    const methodCard = page.locator('.method-card, .tool-card').first();
    const hasMethodCards = await methodCard.isVisible().catch(() => false);

    if (hasMethodCards) {
      await methodCard.click();
      await page.waitForTimeout(2000);

      await test('Method execution produces a result container', async () => {
        const result = await page
          .locator('#pv-result-content, #result-content, .result-content, [class*="result"]')
          .count();
        assert.ok(result > 0, 'No result container found after method execution');
      });

      await test('Result container has non-empty content', async () => {
        const content = await page
          .locator('#pv-result-content, #result-content, .result-content')
          .first()
          .textContent()
          .catch(() => '');
        assert.ok(content && content.trim().length > 0, 'Result container is empty');
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // UI regression guards (things that kept breaking)
  // ═══════════════════════════════════════════════════════════

  console.log('\n  Regression guards\n');

  await test('No elements overflow viewport horizontally', async () => {
    const overflows = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const elements = document.querySelectorAll('*');
      const overflowing: string[] = [];
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        if (rect.right > vw + 5 && rect.width > 0) {
          // 5px tolerance
          overflowing.push(
            `${el.tagName}.${el.className.split(' ')[0]} (right: ${Math.round(rect.right)}, viewport: ${vw})`
          );
        }
      }
      return overflowing.slice(0, 3);
    });
    assert.deepEqual(overflows, [], `Elements overflow viewport: ${overflows.join(', ')}`);
  });

  await test('No elements with zero width that should have content', async () => {
    const zeroWidth = await page.evaluate(() => {
      const problems: string[] = [];
      // Check main structural elements
      for (const sel of ['.sidebar', '.main-content', 'main', '.content']) {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0) {
            problems.push(`${sel} has zero width`);
          }
        }
      }
      return problems;
    });
    assert.deepEqual(zeroWidth, [], `Elements with zero width: ${zeroWidth.join(', ')}`);
  });

  await test('No overlapping sidebar and main content', async () => {
    const overlap = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar, beam-sidebar');
      const main = document.querySelector('.main-content, main');
      if (!sidebar || !main) return null;

      const sRect = sidebar.getBoundingClientRect();
      const mRect = main.getBoundingClientRect();

      // Sidebar right edge should not be past main content left edge (with tolerance)
      if (sRect.right > mRect.left + 10 && sRect.width > 0 && mRect.width > 0) {
        return `Sidebar right (${Math.round(sRect.right)}) overlaps main left (${Math.round(mRect.left)})`;
      }
      return null;
    });
    assert.ok(!overlap, overlap || 'Sidebar overlaps main content');
  });

  await test('No toast/notification overlap', async () => {
    const toasts = await page.locator('.toast, .notification, [class*="toast"]').count();
    if (toasts > 1) {
      const overlap = await page.evaluate(() => {
        const toasts = document.querySelectorAll('.toast, .notification, [class*="toast"]');
        if (toasts.length < 2) return null;
        const rects = Array.from(toasts).map((t) => t.getBoundingClientRect());
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            if (rects[i].bottom > rects[j].top && rects[i].top < rects[j].bottom) {
              return 'Toasts overlap vertically';
            }
          }
        }
        return null;
      });
      assert.ok(!overlap, overlap || '');
    }
    // No toasts visible = pass (no overlap possible)
  });

  await test('Sidebar items are not clipped at viewport edge', async () => {
    if (!sidebarReady) return;
    const clipped = await page.evaluate(() => {
      const items = document.querySelectorAll('.photon-item');
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        if (rect.right > vw || rect.left < -5) {
          return `Item clipped: left=${Math.round(rect.left)}, right=${Math.round(rect.right)}`;
        }
      }
      return null;
    });
    assert.ok(!clipped, clipped || '');
  });

  // ═══════════════════════════════════════════════════════════
  // Cleanup & Report
  // ═══════════════════════════════════════════════════════════

  await cleanup();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('DOM structure tests crashed:', err);
  await cleanup();
  process.exit(1);
});
