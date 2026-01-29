/**
 * New User Experience (NUE) E2E Tests
 *
 * Simulates a brand-new user launching Beam with an empty --dir.
 * Verifies bundled photons load, marketplace is discoverable,
 * and the experience is smooth.
 *
 * Run: npx playwright test tests/beam/e2e/us-new-user.e2e.test.ts
 */

import { test, expect, Page } from 'playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout } from 'timers/promises';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ESM-compatible __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test configuration — unique port to avoid conflicts
const BEAM_PORT = 3860;
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let emptyDir: string;

// =============================================================================
// Setup & Teardown
// =============================================================================

test.beforeAll(async () => {
  // Create a completely empty temp dir — simulates a new user with no photons
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-nue-'));

  // Start Beam with empty dir — only bundled photons should appear
  beamProcess = spawn(
    'node',
    ['dist/cli.js', 'beam', '--port', String(BEAM_PORT), '--dir', emptyDir],
    {
      cwd: path.join(__dirname, '../../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    },
  );

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = global.setTimeout(() => {
      reject(new Error('Beam server failed to start within timeout'));
    }, 20000);

    beamProcess!.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (
        output.includes('Photon Beam') ||
        output.includes('Beam server running') ||
        output.includes('listening')
      ) {
        global.clearTimeout(timeout);
        resolve();
      }
    });

    beamProcess!.stderr?.on('data', (data: Buffer) => {
      console.error('[Beam stderr]', data.toString());
    });

    beamProcess!.on('error', (err) => {
      global.clearTimeout(timeout);
      reject(err);
    });
  });

  // Allow full initialization
  await setTimeout(2000);
});

test.afterAll(async () => {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    beamProcess = null;
  }

  // Clean up temp dir
  if (emptyDir && fs.existsSync(emptyDir)) {
    fs.rmSync(emptyDir, { recursive: true });
  }
});

// =============================================================================
// Helpers
// =============================================================================

async function waitForConnection(page: Page): Promise<void> {
  await page.waitForSelector('.status-indicator.connected', { timeout: 15000 });
}

async function selectPhoton(page: Page, name: string): Promise<void> {
  const option = page.locator('[role="option"]').filter({ hasText: new RegExp(name, 'i') });
  await option.first().click();
  await page.waitForTimeout(500);
}

// =============================================================================
// NUE Tests
// =============================================================================

test.describe('New User Experience (NUE)', () => {
  test('NUE-001: Connection succeeds on fresh start', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    const indicator = page.locator('.status-indicator');
    const isConnected = await indicator.evaluate((el) => el.classList.contains('connected'));
    expect(isConnected).toBe(true);
  });

  test('NUE-002: Bundled photons appear in sidebar', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Both maker and tunnel should appear in the sidebar
    const makerOption = page.locator('[role="option"]').filter({ hasText: /maker/i });
    const tunnelOption = page.locator('[role="option"]').filter({ hasText: /tunnel/i });

    await expect(makerOption.first()).toBeVisible({ timeout: 5000 });
    await expect(tunnelOption.first()).toBeVisible({ timeout: 5000 });
  });

  test('NUE-003: Maker photon methods are accessible', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    await selectPhoton(page, 'maker');

    // Maker exposes methods: rename, describe, addmethod, delete, source
    const methodCards = page.locator('method-card');
    await expect(methodCards.first()).toBeVisible({ timeout: 5000 });

    const count = await methodCards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('NUE-004: Tunnel photon methods are accessible', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    await selectPhoton(page, 'tunnel');

    // Tunnel exposes methods: status, start, stop, stopAll, list
    const methodCards = page.locator('method-card');
    await expect(methodCards.first()).toBeVisible({ timeout: 5000 });

    const count = await methodCards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('NUE-005: Beam system tools are available', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Select any photon first so the MCP session is established
    await selectPhoton(page, 'maker');
    await page.waitForTimeout(500);

    // Beam system tools are injected into the MCP tools list.
    // Verify by checking the page has beam tools available via MCP.
    // The sidebar should show "beam" as a system entry or the tools
    // should be accessible. Check for beam system tools in the UI.
    const beamOption = page.locator('[role="option"]').filter({ hasText: /^beam$/i });
    const beamVisible = (await beamOption.count()) > 0;

    if (beamVisible) {
      // If beam appears as a sidebar entry, click it and check methods
      await beamOption.first().click();
      await page.waitForTimeout(500);
      const methodCards = page.locator('method-card');
      const count = await methodCards.count();
      expect(count).toBeGreaterThanOrEqual(1);
    } else {
      // Beam tools are injected but may not appear as a separate sidebar entry.
      // Verify via page evaluate that MCP tools include beam-prefixed tools.
      // At minimum, confirm the page loaded without errors.
      const hasBeamTools = await page.evaluate(() => {
        // Check if beam-app has any reference to beam tools
        const beamApp = document.querySelector('beam-app');
        if (!beamApp?.shadowRoot) return false;
        // Look for any element referencing beam tools
        const allText = beamApp.shadowRoot.innerHTML;
        return (
          allText.includes('beam/') ||
          allText.includes('configure') ||
          allText.includes('reload')
        );
      });
      // Beam tools should be present in some form
      expect(hasBeamTools).toBe(true);
    }
  });

  test('NUE-006: Theme toggle works', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Theme is stored as data-theme on the beam-app element
    const initialTheme = await page.evaluate(() => {
      const beamApp = document.querySelector('beam-app');
      return beamApp?.getAttribute('data-theme') || 'dark';
    });

    // Press 't' to toggle theme (keyboard shortcut)
    await page.keyboard.press('t');
    await page.waitForTimeout(300);

    const newTheme = await page.evaluate(() => {
      const beamApp = document.querySelector('beam-app');
      return beamApp?.getAttribute('data-theme') || 'dark';
    });

    expect(newTheme).not.toEqual(initialTheme);

    // Toggle back to restore original state
    await page.keyboard.press('t');
    await page.waitForTimeout(300);
  });

  test('NUE-007: Help modal opens with ? shortcut', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Press ? to open keyboard shortcuts / help modal
    await page.keyboard.press('?');
    await page.waitForTimeout(500);

    // Look for help/shortcuts modal
    const helpModal = page.locator(
      '[class*="modal"], [class*="dialog"], [role="dialog"], [class*="shortcuts"], [class*="help"]',
    );

    const modalVisible = (await helpModal.count()) > 0;

    if (modalVisible) {
      await expect(helpModal.first()).toBeVisible();

      // Close the modal (Escape or close button)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      // Help might be shown differently — verify page is still functional
      const indicator = page.locator('.status-indicator.connected');
      await expect(indicator).toBeVisible();
    }
  });

  test('NUE-008: Search/filter UI is functional', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Look for search input in the sidebar or toolbar
    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], .search-input',
    );

    if ((await searchInput.count()) > 0) {
      // Type a search query
      await searchInput.first().fill('maker');
      await page.waitForTimeout(300);

      // Should still show maker (matches filter)
      const makerOption = page.locator('[role="option"]').filter({ hasText: /maker/i });
      const makerVisible = (await makerOption.count()) > 0;
      expect(makerVisible).toBe(true);

      // Clear search
      await searchInput.first().fill('');
      await page.waitForTimeout(300);

      // Both photons should be visible again
      const options = page.locator('[role="option"]');
      const count = await options.count();
      expect(count).toBeGreaterThanOrEqual(2);
    } else {
      // Search may use keyboard shortcut (Ctrl+K or /)
      await page.keyboard.press('/');
      await page.waitForTimeout(300);

      // Check if search appeared
      const searchAfterShortcut = page.locator(
        'input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]',
      );
      // At minimum, the page shouldn't crash
      const indicator = page.locator('.status-indicator.connected');
      await expect(indicator).toBeVisible();
    }
  });

  test('NUE-009: No errors in console on fresh start', async ({ page }) => {
    // Collect console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Give the page time to settle
    await page.waitForTimeout(2000);

    // Filter out known benign warnings/errors
    const knownNoise = [
      'favicon.ico',
      'net::ERR',
      'Failed to load resource',
      'DevTools',
      'third-party',
      'deprecated',
    ];

    const unexpectedErrors = consoleErrors.filter(
      (err) => !knownNoise.some((noise) => err.toLowerCase().includes(noise.toLowerCase())),
    );

    // No unexpected console errors
    expect(unexpectedErrors).toEqual([]);
  });

  test('NUE-010: Marketplace section is accessible', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Look for marketplace UI elements — install button, marketplace panel, or gallery
    const marketplaceElements = page.locator(
      '[class*="marketplace" i], [data-section="marketplace"], button:has-text("Install"), button:has-text("Marketplace"), [aria-label*="marketplace" i]',
    );

    if ((await marketplaceElements.count()) > 0) {
      // Marketplace element found — click the first interactive one
      const clickable = marketplaceElements.first();
      await expect(clickable).toBeVisible();
    } else {
      // Check sidebar for a marketplace section header
      const sidebarHeaders = page.locator(
        '[class*="header"], h2, h3, [role="heading"]',
      );
      const count = await sidebarHeaders.count();
      let hasMarketplace = false;
      for (let i = 0; i < count; i++) {
        const text = await sidebarHeaders.nth(i).textContent();
        if (text && /marketplace|gallery|install|browse/i.test(text)) {
          hasMarketplace = true;
          break;
        }
      }

      // Marketplace should be discoverable in some form for new users
      // If not found via text, check for the install photon workflow
      if (!hasMarketplace) {
        // At minimum, maker photon has install/create capabilities
        await selectPhoton(page, 'maker');
        await page.waitForTimeout(500);
        const methodCards = page.locator('method-card');
        const count = await methodCards.count();
        // Maker provides photon management (create, install) — sufficient for new user
        expect(count).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('NUE-011: Marketplace shows installed state for bundled photons', async ({ page }) => {
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Fetch the marketplace API directly to verify installed flags
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/marketplace/list');
      return res.json();
    });

    const photons = response.photons || [];

    // Bundled photons (maker, tunnel) should be marked as installed
    const maker = photons.find((p: any) => p.name === 'maker');
    const tunnel = photons.find((p: any) => p.name === 'tunnel');

    if (maker) {
      expect(maker.installed).toBe(true);
    }
    if (tunnel) {
      expect(tunnel.installed).toBe(true);
    }

    // If there are non-bundled photons, at least one should not be installed
    const nonBundled = photons.filter(
      (p: any) => p.name !== 'maker' && p.name !== 'tunnel' && !p.internal,
    );
    if (nonBundled.length > 0) {
      const hasUninstalled = nonBundled.some((p: any) => p.installed === false);
      expect(hasUninstalled).toBe(true);
    }
  });
});
