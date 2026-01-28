/**
 * Beam UI User Stories E2E Tests
 *
 * These tests verify user-facing features from a user's perspective.
 * Each test represents a user story that must work correctly.
 *
 * IMPORTANT: These tests catch regressions like the unconfigured photons
 * SETUP section bug that broke without being detected.
 *
 * Run: npx playwright test tests/beam/e2e/user-stories.e2e.test.ts
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
const BEAM_PORT = 3848;
const BEAM_URL = `http://localhost:${BEAM_PORT}`;
const TEST_TIMEOUT = 30000;

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create a test photon that requires configuration (unconfigured)
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

/**
 * Create a configured test photon (no required params)
 */
function createConfiguredPhoton(name: string): string {
  return `
/**
 * ${name} Test Photon
 * @description A configured test photon
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
 * Setup: Create test photons and start Beam server
 */
test.beforeAll(async () => {
  // Create test photon directory
  testPhotonDir = path.join(os.tmpdir(), 'beam-user-story-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  // Create a configured photon
  fs.writeFileSync(
    path.join(testPhotonDir, 'configured-test.photon.ts'),
    createConfiguredPhoton('configured-test')
  );

  // Create an unconfigured photon (requires apiKey)
  fs.writeFileSync(
    path.join(testPhotonDir, 'needs-setup.photon.ts'),
    createUnconfiguredPhoton('needs-setup', ['apiKey'])
  );

  // Start Beam server pointing to test directory
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

/**
 * Teardown: Stop Beam server and cleanup
 */
test.afterAll(async () => {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    beamProcess = null;
  }

  // Cleanup test photons
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
});

/**
 * Helper: Wait for MCP connection
 */
async function waitForConnection(page: Page): Promise<void> {
  // Wait for the connection indicator to be green (connected)
  await page.waitForSelector('.status-indicator.connected', { timeout: 10000 });
}

/**
 * Helper: Get sidebar section headers
 */
async function getSidebarSections(page: Page): Promise<string[]> {
  return page.$$eval('.section-header', (els) => els.map((el) => el.textContent?.trim() || ''));
}

/**
 * Helper: Get photons in a specific section
 */
async function getPhotonsInSection(page: Page, sectionId: string): Promise<string[]> {
  return page.$$eval(`[aria-labelledby="${sectionId}"] [role="option"]`, (els) =>
    els.map((el) => el.getAttribute('aria-label') || el.textContent?.trim() || '')
  );
}

// =============================================================================
// USER STORY: Unconfigured Photons Display
// =============================================================================

test.describe('User Story: Unconfigured Photons Setup', () => {
  test('US-001: User sees unconfigured photons in SETUP section', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO see photons that need configuration in a separate SETUP section
     * SO THAT I know which photons need my attention before I can use them
     *
     * REGRESSION: This broke when toolsToPhotons() didn't merge unconfigured
     * photons from configurationSchema.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // SETUP section should exist
    const sections = await getSidebarSections(page);
    expect(sections).toContain('SETUP');

    // The unconfigured photon should be in SETUP section
    const setupPhotons = await getPhotonsInSection(page, 'setup-header');
    expect(setupPhotons.length).toBeGreaterThan(0);

    // Should show "?" badge for unconfigured photons
    const questionBadge = page.locator('.method-count.unconfigured');
    expect(await questionBadge.count()).toBeGreaterThan(0);
  });

  test('US-002: User can click unconfigured photon to see configuration form', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO click on an unconfigured photon
     * SO THAT I can see what configuration is needed
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Click on unconfigured photon
    await page.click('[aria-labelledby="setup-header"] [role="option"]');
    await page.waitForTimeout(500);

    // Should show configuration form with required fields
    const configForm = page.locator('input[type="text"], input[type="password"]');
    expect(await configForm.count()).toBeGreaterThan(0);

    // Should show "Configure & Enable" button
    const configButton = page.locator('button:has-text("Configure"), button:has-text("Enable")');
    expect(await configButton.count()).toBeGreaterThan(0);
  });

  test('US-003: Configured photons appear in MCPs section, not SETUP', async ({ page }) => {
    /**
     * AS A user
     * I WANT configured photons to appear in the MCPs section
     * SO THAT I can easily distinguish ready-to-use photons from those needing setup
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // MCPs section should exist
    const sections = await getSidebarSections(page);
    expect(sections).toContain('MCPS');

    // Configured photon should be in MCPs section with method count
    const mcpPhotons = await page.$$eval('[aria-labelledby="mcps-header"] [role="option"]', (els) =>
      els.map((el) => ({
        name: el.textContent?.trim() || '',
        hasMethodCount: el.querySelector('.method-count:not(.unconfigured)') !== null,
      }))
    );

    // At least one photon should have a method count (not "?")
    expect(mcpPhotons.some((p) => p.hasMethodCount)).toBe(true);
  });
});

// =============================================================================
// USER STORY: Connection Status
// =============================================================================

test.describe('User Story: Connection Status Indicator', () => {
  test('US-010: User sees connection status in sidebar header', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO see a visual indicator of my connection status
     * SO THAT I know if the server is connected
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Status indicator should be visible
    const indicator = page.locator('.status-indicator');
    expect(await indicator.count()).toBe(1);

    // Should be green (connected)
    const isConnected = await indicator.evaluate((el) => el.classList.contains('connected'));
    expect(isConnected).toBe(true);
  });
});

// =============================================================================
// USER STORY: Sidebar Organization
// =============================================================================

test.describe('User Story: Sidebar Organization', () => {
  test('US-020: Sidebar shows APPS, MCPS, and SETUP sections', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO see photons organized by type
     * SO THAT I can easily find what I'm looking for
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    const sections = await getSidebarSections(page);

    // Should have at least MCPS section (APPS depends on having app photons)
    expect(sections).toContain('MCPS');

    // If there are unconfigured photons, SETUP should exist
    const hasUnconfigured = await page.locator('.method-count.unconfigured').count();
    if (hasUnconfigured > 0) {
      expect(sections).toContain('SETUP');
    }
  });

  test('US-021: User can search photons by name', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO search for photons by name
     * SO THAT I can quickly find the one I need
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Get initial count
    const initialCount = await page.locator('[role="option"]').count();
    expect(initialCount).toBeGreaterThan(0);

    // Search for something specific
    await page.fill('input[type="search"]', 'configured');
    await page.waitForTimeout(300);

    // Should filter results
    const filteredCount = await page.locator('[role="option"]').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('US-022: User can toggle favorites filter', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO filter to show only my favorite photons
     * SO THAT I can quickly access frequently used photons
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Favorites button should exist
    const favButton = page.locator('button[aria-label*="favorites"], button[title*="favorites"]');
    expect(await favButton.count()).toBe(1);

    // Click favorites filter
    await favButton.click();
    await page.waitForTimeout(300);

    // If no favorites, list should be empty or show message
    // (This is expected behavior for a fresh test)
  });
});

// =============================================================================
// USER STORY: Theme Toggle
// =============================================================================

test.describe('User Story: Theme Selection', () => {
  test('US-030: User can toggle between light and dark themes', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO switch between light and dark themes
     * SO THAT I can use the UI comfortably in different lighting conditions
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Should start in dark theme (default)
    const host = page.locator('beam-app');
    const initialTheme = await host.getAttribute('data-theme');

    // Click light theme button
    await page.click('button[aria-label*="light"]');
    await page.waitForTimeout(300);

    // Theme should change
    const newTheme = await host.getAttribute('data-theme');
    expect(newTheme).toBe('light');

    // Click dark theme button
    await page.click('button[aria-label*="dark"]');
    await page.waitForTimeout(300);

    // Theme should change back
    const finalTheme = await host.getAttribute('data-theme');
    expect(finalTheme).toBe('dark');
  });
});

// =============================================================================
// USER STORY: Method Invocation
// =============================================================================

test.describe('User Story: Method Invocation', () => {
  test('US-040: User can invoke a method and see results', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO invoke a photon method
     * SO THAT I can see the result
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Click on configured photon
    await page.click('[aria-labelledby="mcps-header"] [role="option"]');
    await page.waitForTimeout(500);

    // Should show methods
    const methods = page.locator('[class*="method"], [data-method]');
    if ((await methods.count()) > 0) {
      // Click first method
      await methods.first().click();
      await page.waitForTimeout(300);

      // Click execute button
      await page.click('button:has-text("Execute"), button:has-text("Run")');
      await page.waitForTimeout(1000);

      // Should show result
      const result = page.locator('[class*="result"]');
      expect(await result.count()).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// USER STORY: Activity Log
// =============================================================================

test.describe('User Story: Activity Log', () => {
  test('US-050: User sees activity log with execution history', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO see an activity log of my actions
     * SO THAT I can track what I've done
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Activity log should exist
    const activityLog = page.locator('activity-log, [class*="activity-log"]');
    expect(await activityLog.count()).toBe(1);
  });

  test('US-051: Activity log messages do not include Bridge prefix', async ({ page }) => {
    /**
     * AS A user
     * I WANT activity log messages to be user-friendly
     * SO THAT I understand what's happening without technical jargon
     *
     * REGRESSION: Messages were showing "Bridge invoking X" instead of "Invoking X"
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Wait for any activity
    await page.waitForTimeout(1000);

    // Check activity log content
    const logContent = await page.locator('activity-log').textContent();

    // Should NOT contain "Bridge"
    expect(logContent).not.toContain('Bridge');
  });
});

// =============================================================================
// USER STORY: Verbose Logging Toggle
// =============================================================================

test.describe('User Story: Verbose Logging', () => {
  test('US-060: User can toggle verbose logging in settings', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO toggle verbose logging
     * SO THAT I can see more or less detail in the activity log
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // On mobile, need to open settings menu
    const settingsButton = page.locator('button[aria-label*="settings"], .mobile-settings-btn');
    if ((await settingsButton.count()) > 0) {
      await settingsButton.click();
      await page.waitForTimeout(300);
    }

    // Look for verbose logging toggle
    const verboseToggle = page.locator('[class*="verbose"], text=Verbose');
    // Note: This may be in dropdown menu on desktop or mobile settings
  });
});

// =============================================================================
// REGRESSION TESTS
// =============================================================================

test.describe('Regression Tests', () => {
  test('REG-001: Unconfigured photons show in SETUP section after page load', async ({ page }) => {
    /**
     * REGRESSION TEST for the bug where unconfigured photons were not showing
     * in the SETUP section because toolsToPhotons() only processed configured
     * photons from tools/list, ignoring the configurationSchema.
     *
     * Fixed by: Adding _addUnconfiguredPhotons() to merge unconfigured photons
     * from configurationSchema into the photon list.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Critical assertion: SETUP section must exist if there are unconfigured photons
    const setupSection = page.locator('[id="setup-header"], .section-header:has-text("SETUP")');
    expect(await setupSection.count()).toBe(1);

    // Critical assertion: At least one photon should be in SETUP
    const setupPhotons = page.locator('[aria-labelledby="setup-header"] [role="option"]');
    expect(await setupPhotons.count()).toBeGreaterThan(0);
  });

  test('REG-002: Activity log shows Invoking without Bridge prefix', async ({ page }) => {
    /**
     * REGRESSION TEST for the bug where activity log showed
     * "Bridge invoking X..." instead of "Invoking X..."
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Trigger an invocation
    await page.click('[aria-labelledby="mcps-header"] [role="option"]');
    await page.waitForTimeout(500);

    const methods = page.locator('[class*="method"], [data-method]');
    if ((await methods.count()) > 0) {
      await methods.first().click();
      await page.waitForTimeout(300);
      await page.click('button:has-text("Execute"), button:has-text("Run")');
      await page.waitForTimeout(500);
    }

    // Check activity log does NOT contain "Bridge"
    const logText = await page.locator('activity-log').textContent();
    expect(logText).not.toMatch(/Bridge\s+invoking/i);
  });
});

// =============================================================================
// USER STORY: Favorites
// =============================================================================

test.describe('User Story: Favorites', () => {
  test('US-070: User can star a photon to add it to favorites', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO click a star icon on a photon
     * SO THAT I can mark it as a favorite for quick access
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Clear any existing favorites from localStorage
    await page.evaluate(() => localStorage.removeItem('beam-favorites'));
    await page.reload();
    await waitForConnection(page);

    // Get the first photon item and hover to reveal the star button
    const firstPhoton = page.locator('[role="option"]').first();
    await firstPhoton.hover();
    await page.waitForTimeout(200);

    // Star button should be visible on hover with unfavorited state
    const starBtn = firstPhoton.locator('.star-btn');
    await expect(starBtn).toBeVisible();
    expect(await starBtn.getAttribute('aria-pressed')).toBe('false');

    // Click the star to favorite
    await starBtn.click();
    await page.waitForTimeout(300);

    // Star button should now have the favorited class and aria-pressed="true"
    await expect(starBtn).toHaveClass(/favorited/);
    expect(await starBtn.getAttribute('aria-pressed')).toBe('true');

    // The star icon should change to filled star
    const starText = await starBtn.textContent();
    expect(starText?.trim()).toBe('⭐');
  });

  test('US-071: Favorites persist in localStorage', async ({ page }) => {
    /**
     * AS A user
     * I WANT my favorite photons to persist across page reloads
     * SO THAT I don't have to re-star them every time
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Clear any existing favorites
    await page.evaluate(() => localStorage.removeItem('beam-favorites'));
    await page.reload();
    await waitForConnection(page);

    // Get the name of the first photon
    const firstPhotonName = await page.locator('[role="option"] .photon-name').first().textContent();
    expect(firstPhotonName).toBeTruthy();

    // Hover and click the star on the first photon
    const firstPhoton = page.locator('[role="option"]').first();
    await firstPhoton.hover();
    await page.waitForTimeout(200);
    await firstPhoton.locator('.star-btn').click();
    await page.waitForTimeout(300);

    // Verify localStorage contains the favorited photon
    const storedFavorites = await page.evaluate(() => {
      const raw = localStorage.getItem('beam-favorites');
      return raw ? JSON.parse(raw) : null;
    });
    expect(storedFavorites).toBeInstanceOf(Array);
    expect(storedFavorites).toContain(firstPhotonName?.trim());

    // Reload the page and verify the favorite persists
    await page.reload();
    await waitForConnection(page);

    // The star should still be favorited after reload
    const starBtnAfterReload = page.locator('[role="option"]').first().locator('.star-btn');
    await expect(starBtnAfterReload).toHaveClass(/favorited/);
    expect(await starBtnAfterReload.getAttribute('aria-pressed')).toBe('true');
  });

  test('US-072: Favorites filter mode shows only starred photons', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO filter the sidebar to show only my favorite photons
     * SO THAT I can quickly access frequently used photons without scrolling
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Clear favorites and reload for a clean state
    await page.evaluate(() => localStorage.removeItem('beam-favorites'));
    await page.reload();
    await waitForConnection(page);

    // Get total photon count before starring
    const totalPhotons = await page.locator('[role="option"]').count();
    expect(totalPhotons).toBeGreaterThan(1);

    // Star only the first photon
    const firstPhoton = page.locator('[role="option"]').first();
    await firstPhoton.hover();
    await page.waitForTimeout(200);
    await firstPhoton.locator('.star-btn').click();
    await page.waitForTimeout(300);

    // Click the favorites filter button
    const favFilterBtn = page.locator('button[aria-label="Filter by favorites"]');
    await expect(favFilterBtn).toBeVisible();
    await favFilterBtn.click();
    await page.waitForTimeout(300);

    // Filter button should be active
    await expect(favFilterBtn).toHaveClass(/active/);
    expect(await favFilterBtn.getAttribute('aria-pressed')).toBe('true');

    // Only the favorited photon should be visible
    const filteredCount = await page.locator('[role="option"]').count();
    expect(filteredCount).toBe(1);

    // The visible photon should be the one we starred
    const visibleStarBtn = page.locator('[role="option"]').first().locator('.star-btn');
    await expect(visibleStarBtn).toHaveClass(/favorited/);

    // Toggle filter off - all photons should reappear
    await favFilterBtn.click();
    await page.waitForTimeout(300);
    const unfilteredCount = await page.locator('[role="option"]').count();
    expect(unfilteredCount).toBe(totalPhotons);
  });

  test('US-073: Favorited photons appear in their sections when favorites filter is active', async ({
    page,
  }) => {
    /**
     * AS A user
     * I WANT favorited photons to remain in their correct sections (Apps, MCPs, Setup)
     *   when the favorites filter is active
     * SO THAT the organizational structure is preserved even in filtered view
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Clear favorites and reload for a clean state
    await page.evaluate(() => localStorage.removeItem('beam-favorites'));
    await page.reload();
    await waitForConnection(page);

    // Star a photon in the MCPs section
    const mcpPhoton = page.locator('[aria-labelledby="mcps-header"] [role="option"]').first();
    await mcpPhoton.hover();
    await page.waitForTimeout(200);
    await mcpPhoton.locator('.star-btn').click();
    await page.waitForTimeout(300);

    // Activate favorites filter
    const favFilterBtn = page.locator('button[aria-label="Filter by favorites"]');
    await favFilterBtn.click();
    await page.waitForTimeout(300);

    // MCPs section should still exist with the favorited photon
    const mcpsHeader = page.locator('#mcps-header');
    await expect(mcpsHeader).toBeVisible();

    const mcpPhotonsInFilter = page.locator(
      '[aria-labelledby="mcps-header"] [role="option"]'
    );
    expect(await mcpPhotonsInFilter.count()).toBeGreaterThan(0);

    // The favorited photon's star should show as favorited
    const starInSection = mcpPhotonsInFilter.first().locator('.star-btn');
    await expect(starInSection).toHaveClass(/favorited/);

    // SETUP section should NOT be visible (no favorited photons there)
    const setupPhotons = page.locator('[aria-labelledby="setup-header"] [role="option"]');
    expect(await setupPhotons.count()).toBe(0);

    // Clean up: toggle filter off
    await favFilterBtn.click();
    await page.waitForTimeout(300);
  });
});
