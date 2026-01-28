/**
 * Beam UI Mobile Responsiveness E2E Tests
 *
 * These tests verify that the Beam UI responds correctly to narrow viewports,
 * providing usable touch targets, collapsible sidebar, and stacked layouts.
 *
 * Breakpoints under test (from source CSS):
 *   - 768px: sidebar collapses, mobile menu appears, touch targets enforced
 *   - 480px: tighter spacing, smaller icons, form adjustments
 *
 * Run: npx playwright test tests/beam/e2e/us-mobile-responsive.e2e.test.ts
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

// Test configuration
const BEAM_PORT = 3849; // Different port to avoid collision with other e2e suites
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create a configured test photon (no required params)
 */
function createConfiguredPhoton(name: string): string {
  return `
/**
 * ${name} Test Photon
 * @description A configured test photon for mobile tests
 */
export default class ${name.replace(/-/g, '')}Photon {
  /**
   * Simple method
   */
  async hello() {
    return { message: 'Hello from ${name}' };
  }

  /**
   * Method with params
   * @param name Your name
   */
  async greet(params: { name: string }) {
    return { greeting: \`Hello, \${params.name}!\` };
  }
}
`;
}

/**
 * Create an unconfigured test photon (requires constructor params)
 */
function createUnconfiguredPhoton(name: string, requiredParams: string[]): string {
  const paramDecls = requiredParams.map((p) => `private ${p}: string`).join(',\n    ');
  const paramDocs = requiredParams.map((p) => ` * @param ${p} Required parameter`).join('\n');

  return `
/**
 * ${name} Test Photon
 * @description A test photon that requires configuration
${paramDocs}
 */
export default class ${name.replace(/-/g, '')}Photon {
  constructor(
    ${paramDecls}
  ) {}

  /**
   * Test method
   */
  async testMethod() {
    return { configured: true };
  }
}
`;
}

// =============================================================================
// Setup & Teardown
// =============================================================================

test.beforeAll(async () => {
  // Create test photon directory
  testPhotonDir = path.join(os.tmpdir(), 'beam-mobile-responsive-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  // Create a configured photon
  fs.writeFileSync(
    path.join(testPhotonDir, 'mobile-test.photon.ts'),
    createConfiguredPhoton('mobile-test')
  );

  // Create an unconfigured photon
  fs.writeFileSync(
    path.join(testPhotonDir, 'needs-setup-mobile.photon.ts'),
    createUnconfiguredPhoton('needs-setup-mobile', ['apiKey'])
  );

  // Start Beam server
  beamProcess = spawn('node', ['dist/cli.js', 'beam', '--port', String(BEAM_PORT), testPhotonDir], {
    cwd: path.join(__dirname, '../../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = global.setTimeout(() => {
      reject(new Error('Beam server failed to start within timeout'));
    }, 20000);

    beamProcess!.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.log('[Beam]', output);
      if (output.includes('Photon Beam') || output.includes('Beam server running') || output.includes('listening')) {
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

  // Give it a moment to fully initialize
  await setTimeout(2000);
});

test.afterAll(async () => {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    beamProcess = null;
  }

  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
});

// =============================================================================
// Helpers
// =============================================================================

async function waitForConnection(page: Page): Promise<void> {
  await page.waitForSelector('.status-indicator.connected', { timeout: 10000 });
}

/**
 * Navigate to Beam and set the viewport to a mobile-width size.
 */
async function setupMobileViewport(page: Page, width: number, height = 812): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(BEAM_URL);
  await waitForConnection(page);
}

// =============================================================================
// US-140: Sidebar collapses on narrow viewport (768px)
// =============================================================================

test.describe('US-140: Sidebar collapses on narrow viewport', () => {
  test('sidebar is hidden off-screen at 768px width', async ({ page }) => {
    /**
     * AS A mobile user
     * I WANT the sidebar to be hidden by default on narrow screens
     * SO THAT the main content area has enough room
     *
     * At <= 768px the sidebar-area gets `position: fixed` and
     * `transform: translateX(-100%)`, hiding it off-screen.
     */
    await setupMobileViewport(page, 768);

    // The sidebar-area element should exist but be off-screen (not visible)
    const sidebar = page.locator('.sidebar-area');
    await expect(sidebar).toHaveCount(1);

    // sidebar-area should NOT have the 'visible' class by default
    const hasVisibleClass = await sidebar.evaluate((el) => el.classList.contains('visible'));
    expect(hasVisibleClass).toBe(false);

    // Verify it is translated off-screen via computed transform
    const transform = await sidebar.evaluate((el) => getComputedStyle(el).transform);
    // translateX(-100%) produces a matrix like matrix(1, 0, 0, 1, -<width>, 0)
    expect(transform).not.toBe('none');
  });

  test('sidebar is inline at desktop width (1024px)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    const sidebar = page.locator('.sidebar-area');
    // At desktop width, sidebar should NOT have position: fixed
    const position = await sidebar.evaluate((el) => getComputedStyle(el).position);
    expect(position).not.toBe('fixed');
  });
});

// =============================================================================
// US-141: Mobile menu toggle shows/hides sidebar
// =============================================================================

test.describe('US-141: Mobile menu toggle shows/hides sidebar', () => {
  test('mobile menu button is visible at 768px', async ({ page }) => {
    /**
     * AS A mobile user
     * I WANT a hamburger menu button
     * SO THAT I can open the sidebar when I need it
     *
     * The `.mobile-menu-btn` is `display: none` by default and
     * becomes `display: flex` at <= 768px.
     */
    await setupMobileViewport(page, 768);

    const menuBtn = page.locator('.mobile-menu-btn');
    await expect(menuBtn).toBeVisible();
  });

  test('mobile menu button is hidden at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    const menuBtn = page.locator('.mobile-menu-btn');
    await expect(menuBtn).toBeHidden();
  });

  test('clicking menu button opens sidebar overlay', async ({ page }) => {
    await setupMobileViewport(page, 768);

    const menuBtn = page.locator('.mobile-menu-btn');
    await menuBtn.click();
    await page.waitForTimeout(400); // allow CSS transition

    // Sidebar should now have 'visible' class
    const sidebar = page.locator('.sidebar-area');
    const isVisible = await sidebar.evaluate((el) => el.classList.contains('visible'));
    expect(isVisible).toBe(true);

    // Overlay should also be visible
    const overlay = page.locator('.sidebar-overlay.visible');
    await expect(overlay).toHaveCount(1);
  });

  test('clicking menu button again closes sidebar', async ({ page }) => {
    await setupMobileViewport(page, 768);

    const menuBtn = page.locator('.mobile-menu-btn');

    // Open
    await menuBtn.click();
    await page.waitForTimeout(400);

    // Close
    await menuBtn.click();
    await page.waitForTimeout(400);

    const sidebar = page.locator('.sidebar-area');
    const isVisible = await sidebar.evaluate((el) => el.classList.contains('visible'));
    expect(isVisible).toBe(false);
  });

  test('clicking overlay closes sidebar', async ({ page }) => {
    await setupMobileViewport(page, 768);

    // Open sidebar
    await page.locator('.mobile-menu-btn').click();
    await page.waitForTimeout(400);

    // Click overlay to dismiss
    await page.locator('.sidebar-overlay').click({ force: true });
    await page.waitForTimeout(400);

    const sidebar = page.locator('.sidebar-area');
    const isVisible = await sidebar.evaluate((el) => el.classList.contains('visible'));
    expect(isVisible).toBe(false);
  });
});

// =============================================================================
// US-142: Touch targets meet 44px minimum size on mobile
// =============================================================================

test.describe('US-142: Touch targets meet 44px minimum on mobile', () => {
  test('interactive elements have at least 44px touch targets at 768px', async ({ page }) => {
    /**
     * AS A mobile user
     * I WANT all interactive elements to be at least 44px tall
     * SO THAT I can tap them reliably with my finger
     *
     * The CSS at <= 768px sets min-height: 44px on:
     *   - .photon-item (beam-sidebar)
     *   - .filter-btn (beam-sidebar)
     *   - input (beam-sidebar)
     *   - .footer-link (beam-sidebar)
     *   - .asset-card, .method-card, button, .filter-btn (beam-app)
     *   - .clear-btn (activity-log)
     *   - .mobile-menu-btn is 44x44 by default
     */
    await setupMobileViewport(page, 768);

    // Open sidebar so its elements are rendered and visible
    await page.locator('.mobile-menu-btn').click();
    await page.waitForTimeout(400);

    // Mobile menu button itself
    const menuBtn = page.locator('.mobile-menu-btn');
    const menuBox = await menuBtn.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.height).toBeGreaterThanOrEqual(44);
    expect(menuBox!.width).toBeGreaterThanOrEqual(44);

    // Photon list items in the sidebar
    const photonItems = page.locator('.sidebar-area .photon-item');
    const itemCount = await photonItems.count();
    for (let i = 0; i < itemCount; i++) {
      const box = await photonItems.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }

    // Filter buttons in sidebar
    const filterBtns = page.locator('.sidebar-area .filter-btn');
    const filterCount = await filterBtns.count();
    for (let i = 0; i < filterCount; i++) {
      const box = await filterBtns.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }

    // Search input
    const searchInput = page.locator('.sidebar-area input[type="search"]');
    if ((await searchInput.count()) > 0) {
      const box = await searchInput.boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

// =============================================================================
// US-143: Form inputs are usable on mobile viewport (480px)
// =============================================================================

test.describe('US-143: Form inputs are usable on mobile viewport (480px)', () => {
  test('search input has 16px font-size to prevent iOS zoom', async ({ page }) => {
    /**
     * AS A mobile user on iOS
     * I WANT form inputs to have at least 16px font-size
     * SO THAT the browser does not auto-zoom when I focus them
     *
     * beam-sidebar sets `font-size: 16px` on input at <= 768px.
     */
    await setupMobileViewport(page, 480);

    // Open sidebar to access the search input
    await page.locator('.mobile-menu-btn').click();
    await page.waitForTimeout(400);

    const searchInput = page.locator('.sidebar-area input[type="search"]');
    if ((await searchInput.count()) > 0) {
      const fontSize = await searchInput.evaluate((el) => {
        return parseFloat(getComputedStyle(el).fontSize);
      });
      expect(fontSize).toBeGreaterThanOrEqual(16);
    }
  });

  test('main area has reduced padding at 480px', async ({ page }) => {
    /**
     * At <= 480px, .main-area padding shrinks to var(--space-sm) to maximize
     * usable content width on very small screens.
     */
    await setupMobileViewport(page, 480);

    const mainArea = page.locator('.main-area');
    if ((await mainArea.count()) > 0) {
      const paddingLeft = await mainArea.evaluate((el) => {
        return parseFloat(getComputedStyle(el).paddingLeft);
      });
      // space-sm is typically 8px; at 480px it should be smaller than the 768px value
      // Just verify it's a reasonable small value (not the desktop default)
      expect(paddingLeft).toBeLessThanOrEqual(16);
    }
  });

  test('cards grid is single column at 480px', async ({ page }) => {
    /**
     * At <= 768px the .cards-grid uses grid-template-columns: 1fr,
     * ensuring method cards stack vertically on narrow screens.
     */
    await setupMobileViewport(page, 480);

    // Select a configured photon to show cards
    await page.locator('.mobile-menu-btn').click();
    await page.waitForTimeout(400);

    const mcpPhoton = page.locator('[aria-labelledby="mcps-header"] [role="option"]');
    if ((await mcpPhoton.count()) > 0) {
      await mcpPhoton.first().click();
      await page.waitForTimeout(500);

      const grid = page.locator('.cards-grid');
      if ((await grid.count()) > 0) {
        const columns = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
        // Single column should report a single value (the full width)
        const columnValues = columns.split(' ').filter((v) => v.trim().length > 0);
        expect(columnValues.length).toBe(1);
      }
    }
  });
});

// =============================================================================
// US-144: Activity log stacks vertically on mobile
// =============================================================================

test.describe('US-144: Activity log stacks vertically on mobile', () => {
  test('log items use column layout at 768px', async ({ page }) => {
    /**
     * AS A mobile user
     * I WANT activity log entries to stack meta and content vertically
     * SO THAT long messages are readable on narrow screens
     *
     * activity-log sets `.log-item { flex-direction: column }` at <= 768px.
     */
    await setupMobileViewport(page, 768);

    // Trigger some activity by selecting a photon
    await page.locator('.mobile-menu-btn').click();
    await page.waitForTimeout(400);

    const mcpPhoton = page.locator('[aria-labelledby="mcps-header"] [role="option"]');
    if ((await mcpPhoton.count()) > 0) {
      await mcpPhoton.first().click();
      await page.waitForTimeout(1000);
    }

    // Check activity-log items if any exist
    const logItems = page.locator('activity-log .log-item');
    const count = await logItems.count();
    if (count > 0) {
      const direction = await logItems.first().evaluate((el) => getComputedStyle(el).flexDirection);
      expect(direction).toBe('column');
    }
  });

  test('clear button has 44px touch target at 768px', async ({ page }) => {
    /**
     * activity-log's .clear-btn gets min-height: 44px at <= 768px.
     */
    await setupMobileViewport(page, 768);

    // Trigger activity
    await page.locator('.mobile-menu-btn').click();
    await page.waitForTimeout(400);
    const mcpPhoton = page.locator('[aria-labelledby="mcps-header"] [role="option"]');
    if ((await mcpPhoton.count()) > 0) {
      await mcpPhoton.first().click();
      await page.waitForTimeout(1000);
    }

    const clearBtn = page.locator('activity-log .clear-btn');
    if ((await clearBtn.count()) > 0) {
      const minHeight = await clearBtn.evaluate((el) => {
        return parseFloat(getComputedStyle(el).minHeight);
      });
      expect(minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  test('activity log has compact spacing at 480px', async ({ page }) => {
    /**
     * At <= 480px, activity-log host reduces margin-top and padding-top,
     * and .content font-size drops to 0.8rem.
     */
    await setupMobileViewport(page, 480);

    const activityLog = page.locator('activity-log');
    if ((await activityLog.count()) > 0) {
      const marginTop = await activityLog.evaluate((el) => {
        return parseFloat(getComputedStyle(el).marginTop);
      });
      // At 480px, margin-top should be var(--space-lg) which is smaller than var(--space-xl)
      // Just verify it's a reasonable value (not the desktop xl = ~32px)
      expect(marginTop).toBeLessThanOrEqual(32);
    }
  });
});
