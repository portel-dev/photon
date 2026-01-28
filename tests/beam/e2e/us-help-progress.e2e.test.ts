/**
 * Beam UI Help Modal & Progress Indicator E2E Tests
 *
 * Tests for help modal keyboard shortcuts and progress indicator
 * visibility during method execution.
 *
 * Run: npx playwright test tests/beam/e2e/us-help-progress.e2e.test.ts
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
const BEAM_PORT = 3849;
const BEAM_URL = `http://localhost:${BEAM_PORT}`;
const TEST_TIMEOUT = 30000;

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create a configured test photon with a slow method for progress testing
 */
function createSlowPhoton(name: string): string {
  return `
/**
 * ${name} Test Photon
 * @description A test photon with a slow method for progress indicator testing
 */
export default class ${name.replace(/-/g, '')}Photon {
  /**
   * Fast method that returns immediately
   */
  async fast() {
    return { result: 'done' };
  }

  /**
   * Slow method that takes time to complete
   */
  async slow() {
    await new Promise(resolve => global.setTimeout(resolve, 3000));
    return { result: 'completed after delay' };
  }

  /**
   * Method that throws an error after a delay
   */
  async failAfterDelay() {
    await new Promise(resolve => global.setTimeout(resolve, 1000));
    throw new Error('Intentional test error');
  }
}
`;
}

/**
 * Setup: Create test photons and start Beam server
 */
test.beforeAll(async () => {
  // Create test photon directory
  testPhotonDir = path.join(os.tmpdir(), 'beam-help-progress-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  // Create a photon with slow methods
  fs.writeFileSync(
    path.join(testPhotonDir, 'slow-test.photon.ts'),
    createSlowPhoton('slow-test')
  );

  // Start Beam server pointing to test directory
  beamProcess = spawn('node', ['dist/cli.js', 'beam', '--port', String(BEAM_PORT), '--dir', testPhotonDir], {
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
  await page.waitForSelector('.status-indicator.connected', { timeout: 10000 });
}

/**
 * Helper: Select the slow-test photon and navigate to a specific method
 */
async function selectMethod(page: Page, methodName: string): Promise<void> {
  // Click on the slow-test photon in MCPs section
  await page.click('[aria-labelledby="mcps-header"] [role="option"]');
  await page.waitForTimeout(500);

  // Click the target method
  const method = page.locator('method-card').filter({ hasText: methodName });
  await method.first().click();
  await page.waitForTimeout(300);
}

// =============================================================================
// USER STORY: Help Modal
// =============================================================================

test.describe('User Story: Help Modal', () => {
  test('US-120: Help modal opens with ? key press', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press ? to open the help modal
     * SO THAT I can quickly see available keyboard shortcuts
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Ensure help modal is not visible initially
    const modalBefore = page.locator('[aria-labelledby="help-modal-title"]');
    expect(await modalBefore.count()).toBe(0);

    // Press ? (Shift+/) to open help
    await page.keyboard.press('Shift+?');
    await page.waitForTimeout(300);

    // Help modal should now be visible
    const modal = page.locator('[aria-labelledby="help-modal-title"]');
    expect(await modal.count()).toBe(1);

    // Should have the correct title
    const title = page.locator('#help-modal-title');
    await expect(title).toHaveText('Keyboard Shortcuts');
  });

  test('US-121: Help modal displays all keyboard shortcuts', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO see all keyboard shortcuts listed in the help modal
     * SO THAT I can learn how to navigate the UI efficiently
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Open help modal
    await page.keyboard.press('Shift+?');
    await page.waitForTimeout(300);

    const modal = page.locator('[aria-labelledby="help-modal-title"]');
    expect(await modal.count()).toBe(1);

    // Should have Navigation section
    const navigationSection = modal.locator('h3:has-text("Navigation")');
    expect(await navigationSection.count()).toBe(1);

    // Should have Actions section
    const actionsSection = modal.locator('h3:has-text("Actions")');
    expect(await actionsSection.count()).toBe(1);

    // Verify key shortcuts are listed
    const shortcutItems = modal.locator('.shortcut-item');
    const count = await shortcutItems.count();
    // There should be at least 10 shortcuts (6 navigation + 6 actions from the source)
    expect(count).toBeGreaterThanOrEqual(10);

    // Verify specific shortcuts are present
    const modalText = await modal.textContent();
    expect(modalText).toContain('Focus search');
    expect(modalText).toContain('Previous / Next photon');
    expect(modalText).toContain('Navigate methods');
    expect(modalText).toContain('Submit form');
    expect(modalText).toContain('Close / Cancel');
    expect(modalText).toContain('Toggle theme');
    expect(modalText).toContain('Toggle favorites filter');
    expect(modalText).toContain('Show this help');
  });

  test('US-122: Help modal can be closed with Escape', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press Escape to close the help modal
     * SO THAT I can quickly return to working with photons
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Open help modal
    await page.keyboard.press('Shift+?');
    await page.waitForTimeout(300);

    // Verify it is open
    const modalOpen = page.locator('[aria-labelledby="help-modal-title"]');
    expect(await modalOpen.count()).toBe(1);

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Modal should be gone
    const modalClosed = page.locator('[aria-labelledby="help-modal-title"]');
    expect(await modalClosed.count()).toBe(0);
  });
});

// =============================================================================
// USER STORY: Progress Indicator
// =============================================================================

test.describe.skip('User Story: Progress Indicator', () => {
  // TODO: Requires slow-test photon from temp dir; --dir not loading properly
  test('US-123: Progress indicator shows during method execution', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO see a progress indicator while a method is running
     * SO THAT I know the system is working and hasn't frozen
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    await selectMethod(page, 'slow');

    // Click execute
    await page.click('button:has-text("Execute"), button:has-text("Run")');

    // Progress container or loading state should appear
    // The _isExecuting flag sets .loading on invoke-form and _progress shows the bar
    await page.waitForSelector('.progress-container, invoke-form[loading]', {
      timeout: 5000,
      state: 'attached',
    });

    // Verify some progress/loading UI is visible
    const progressVisible = await page.locator('.progress-container').count();
    const formLoading = await page.evaluate(() => {
      const form = document.querySelector('invoke-form');
      return form?.hasAttribute('loading') || form?.getAttribute('loading') === 'true';
    });

    expect(progressVisible > 0 || formLoading).toBeTruthy();
  });

  test('US-124: Progress indicator hides on completion', async ({ page }) => {
    /**
     * AS A user
     * I WANT the progress indicator to disappear when execution finishes
     * SO THAT I know the operation is done
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    await selectMethod(page, 'fast');

    // Click execute
    await page.click('button:has-text("Execute"), button:has-text("Run")');

    // Wait for execution to complete (fast method returns immediately)
    await page.waitForTimeout(2000);

    // Progress container should not be present after completion
    const progressContainer = page.locator('.progress-container');
    expect(await progressContainer.count()).toBe(0);

    // Result should be shown
    const result = page.locator('[class*="result"]');
    expect(await result.count()).toBeGreaterThan(0);
  });

  test('US-125: Progress indicator hides on error', async ({ page }) => {
    /**
     * AS A user
     * I WANT the progress indicator to disappear when an error occurs
     * SO THAT I can see the error message and take action
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    await selectMethod(page, 'failAfterDelay');

    // Click execute
    await page.click('button:has-text("Execute"), button:has-text("Run")');

    // Wait for the error to occur (method fails after 1s delay)
    await page.waitForTimeout(3000);

    // Progress container should not be present after error
    const progressContainer = page.locator('.progress-container');
    expect(await progressContainer.count()).toBe(0);

    // An error toast or error log entry should be visible
    const errorIndicator = page.locator('.toast.error, [class*="error"]');
    expect(await errorIndicator.count()).toBeGreaterThan(0);
  });
});
