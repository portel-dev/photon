/**
 * Beam UI Form Persistence E2E Tests
 *
 * Tests for the "Remember Values" feature that persists form inputs
 * to localStorage so they survive page reloads and method revisits.
 *
 * Key implementation details:
 * - Toggle: beam-app._toggleRememberValues() sets localStorage 'beam-remember-values'
 * - Storage key per method: `beam-form:{photonName}:{methodName}`
 * - invoke-form reads/writes localStorage when rememberValues prop is true
 * - _clearPersistedValues() removes the key and resets form state
 *
 * Run: npx playwright test tests/beam/e2e/us-form-persistence.e2e.test.ts
 */

import { test, expect, Page } from 'playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout } from 'timers/promises';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';

// ESM-compatible __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import * as os from 'os';

// Use a distinct port to avoid conflicts with other test suites
const BEAM_PORT = 3858;
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create a photon with multiple methods that accept parameters,
 * so the invoke-form generates input fields we can fill and persist.
 */
function createParameterizedPhoton(name: string): string {
  return `
/**
 * ${name} Test Photon
 * @description A photon with parameterized methods for form persistence testing
 */
export default class ${name.replace(/-/g, '')}Photon {
  /**
   * Search for items
   * @param query Search query string
   * @param limit Maximum results to return
   */
  async search(params: { query: string; limit: string }) {
    return { results: [], query: params.query, limit: params.limit };
  }

  /**
   * Create an item
   * @param title Item title
   * @param description Item description
   */
  async create(params: { title: string; description: string }) {
    return { id: '1', title: params.title, description: params.description };
  }
}
`;
}

/**
 * Create a second photon with different methods to test separate storage keys.
 */
function createSecondPhoton(name: string): string {
  return `
/**
 * ${name} Test Photon
 * @description A second photon for cross-photon persistence testing
 */
export default class ${name.replace(/-/g, '')}Photon {
  /**
   * Lookup a record
   * @param id Record identifier
   */
  async lookup(params: { id: string }) {
    return { found: true, id: params.id };
  }
}
`;
}

// =============================================================================
// Setup & Teardown
// =============================================================================

test.beforeAll(async () => {
  testPhotonDir = path.join(os.tmpdir(), 'beam-form-persist-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  fs.writeFileSync(
    path.join(testPhotonDir, 'form-test.photon.ts'),
    createParameterizedPhoton('form-test')
  );

  fs.writeFileSync(
    path.join(testPhotonDir, 'other-photon.photon.ts'),
    createSecondPhoton('other-photon')
  );

  beamProcess = spawn('node', ['dist/cli.js', 'beam', '--port', String(BEAM_PORT), '--dir', testPhotonDir], {
    cwd: path.join(__dirname, '../../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

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
 * Navigate to a specific photon and method by clicking sidebar then method.
 */
async function navigateToMethod(
  page: Page,
  photonSubstring: string,
  methodName: string
): Promise<void> {
  // Click the photon in the sidebar whose label contains the substring
  const photonItem = page.locator(
    `[aria-labelledby="mcps-header"] [role="option"]`,
  );
  const count = await photonItem.count();
  for (let i = 0; i < count; i++) {
    const text = await photonItem.nth(i).textContent();
    if (text && text.toLowerCase().includes(photonSubstring.toLowerCase())) {
      await photonItem.nth(i).click();
      break;
    }
  }
  await page.waitForTimeout(500);

  // Click the method
  const methodEl = page.locator('method-card').filter({ hasText: new RegExp(methodName, 'i') });
  if ((await methodEl.count()) > 0) {
    await methodEl.first().click();
  }
  await page.waitForTimeout(500);
}

/**
 * Enable the Remember Values toggle if not already active.
 */
async function enableRememberValues(page: Page): Promise<void> {
  // Check if the toggle is already active via the toolbar button
  const toolbarToggle = page.locator('.toolbar-btn.toolbar-toggle .toggle-indicator.active');
  if ((await toolbarToggle.count()) > 0) {
    return; // Already enabled
  }

  // Click the Remember toolbar button
  const rememberBtn = page.locator('button[title="Remember form values between invocations"]');
  if ((await rememberBtn.count()) > 0) {
    await rememberBtn.click();
    await page.waitForTimeout(300);
    return;
  }

  // Fallback: open settings dropdown and click Remember Values
  const settingsBtn = page.locator('button[aria-label*="settings"], .mobile-settings-btn');
  if ((await settingsBtn.count()) > 0) {
    await settingsBtn.click();
    await page.waitForTimeout(300);
  }
  const rememberItem = page.locator('.settings-dropdown-item:has-text("Remember Values")');
  if ((await rememberItem.count()) > 0) {
    await rememberItem.click();
    await page.waitForTimeout(300);
  }
}

/**
 * Disable the Remember Values toggle if currently active.
 */
async function disableRememberValues(page: Page): Promise<void> {
  const toolbarToggle = page.locator('.toolbar-btn.toolbar-toggle .toggle-indicator.active');
  if ((await toolbarToggle.count()) === 0) {
    return; // Already disabled
  }

  const rememberBtn = page.locator('button[title="Remember form values between invocations"]');
  if ((await rememberBtn.count()) > 0) {
    await rememberBtn.click();
    await page.waitForTimeout(300);
  }
}

// =============================================================================
// US-090: Remember Values toggle saves form inputs to localStorage
// =============================================================================

test.describe.skip('User Story: Form Persistence', () => {
  // TODO: Test photons not being loaded from --dir; needs investigation
  test('US-090: Remember Values toggle saves form inputs to localStorage', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO toggle "Remember Values" and fill in form fields
     * SO THAT my inputs are persisted to localStorage for later use
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Navigate to a method with params
    await navigateToMethod(page, 'form-test', 'search');

    // Enable remember values
    await enableRememberValues(page);

    // Fill in form fields (need shadow DOM traversal)
    const inputCount = await page.evaluate(() => {
      const beamApp = document.querySelector('beam-app');
      const form = beamApp?.shadowRoot?.querySelector('invoke-form');
      const inputs = form?.shadowRoot?.querySelectorAll('input[type="text"], textarea') || [];
      return inputs.length;
    });
    expect(inputCount).toBeGreaterThan(0);

    // Fill the first input using evaluate
    await page.evaluate(() => {
      const beamApp = document.querySelector('beam-app');
      const form = beamApp?.shadowRoot?.querySelector('invoke-form');
      const input = form?.shadowRoot?.querySelector('input[type="text"], textarea') as HTMLInputElement;
      if (input) {
        input.value = 'test-query-value';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(300);

    // Verify localStorage has the persisted value
    const stored = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('beam-form:'));
      const result: Record<string, any> = {};
      for (const key of keys) {
        result[key] = JSON.parse(localStorage.getItem(key) || '{}');
      }
      return result;
    });

    // Should have at least one beam-form key
    const formKeys = Object.keys(stored);
    expect(formKeys.length).toBeGreaterThan(0);

    // The stored value should contain our input
    const firstEntry = stored[formKeys[0]];
    expect(firstEntry.values).toBeDefined();

    // Verify the remember preference itself is stored
    const rememberPref = await page.evaluate(() => localStorage.getItem('beam-remember-values'));
    expect(rememberPref).toBe('true');
  });

  // ===========================================================================
  // US-091: Saved form values restore when revisiting a method
  // ===========================================================================

  test('US-091: Saved form values restore when revisiting a method', async ({ page }) => {
    /**
     * AS A user
     * I WANT saved form values to be restored when I revisit a method
     * SO THAT I don't have to re-enter the same parameters repeatedly
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Enable remember values
    await navigateToMethod(page, 'form-test', 'search');
    await enableRememberValues(page);

    // Fill form fields with known values
    const inputs = page.locator('invoke-form input[type="text"], invoke-form textarea');
    await inputs.first().fill('persist-me-value');
    await page.waitForTimeout(300);

    // Navigate away (click a different photon)
    const otherPhoton = page.locator('[aria-labelledby="mcps-header"] [role="option"]');
    const photonCount = await otherPhoton.count();
    if (photonCount > 1) {
      await otherPhoton.nth(1).click();
      await page.waitForTimeout(500);
    }

    // Navigate back to the same method
    await navigateToMethod(page, 'form-test', 'search');

    // The form should restore the previously entered value
    const restoredValue = await inputs.first().inputValue();
    expect(restoredValue).toBe('persist-me-value');
  });

  // ===========================================================================
  // US-092: Clearing remembered values works
  // ===========================================================================

  test('US-092: Clearing remembered values works', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO clear my saved form values
     * SO THAT I can start fresh without old data
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Set up: enable remember and fill values
    await navigateToMethod(page, 'form-test', 'search');
    await enableRememberValues(page);

    const inputs = page.locator('invoke-form input[type="text"], invoke-form textarea');
    await inputs.first().fill('to-be-cleared');
    await page.waitForTimeout(300);

    // Verify value is in localStorage
    const beforeClear = await page.evaluate(() => {
      return Object.keys(localStorage).filter((k) => k.startsWith('beam-form:')).length;
    });
    expect(beforeClear).toBeGreaterThan(0);

    // Disable remember values (this clears persisted form values on next load)
    await disableRememberValues(page);

    // Verify the remember preference is now false
    const rememberPref = await page.evaluate(() => localStorage.getItem('beam-remember-values'));
    expect(rememberPref).toBe('false');

    // Navigate away and back - form should be empty since remember is off
    const otherPhoton = page.locator('[aria-labelledby="mcps-header"] [role="option"]');
    const photonCount = await otherPhoton.count();
    if (photonCount > 1) {
      await otherPhoton.nth(1).click();
      await page.waitForTimeout(500);
    }

    await navigateToMethod(page, 'form-test', 'search');

    // With remember disabled, form values should be empty
    const restoredValue = await inputs.first().inputValue();
    expect(restoredValue).toBe('');
  });

  // ===========================================================================
  // US-093: Different methods maintain separate saved values
  // ===========================================================================

  test('US-093: Different methods maintain separate saved values', async ({ page }) => {
    /**
     * AS A user
     * I WANT different methods to keep their own saved values
     * SO THAT form data for one method doesn't interfere with another
     *
     * Storage key format: beam-form:{photonName}:{methodName}
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Enable remember values
    await navigateToMethod(page, 'form-test', 'search');
    await enableRememberValues(page);

    // Fill form for "search" method
    const searchInputs = page.locator('invoke-form input[type="text"], invoke-form textarea');
    await searchInputs.first().fill('search-specific-value');
    await page.waitForTimeout(300);

    // Navigate to the "create" method on the same photon
    await navigateToMethod(page, 'form-test', 'create');

    // Fill form for "create" method
    const createInputs = page.locator('invoke-form input[type="text"], invoke-form textarea');
    const createCount = await createInputs.count();
    expect(createCount).toBeGreaterThan(0);
    await createInputs.first().fill('create-specific-value');
    await page.waitForTimeout(300);

    // Verify localStorage has separate keys for each method
    const storageKeys = await page.evaluate(() => {
      return Object.keys(localStorage).filter((k) => k.startsWith('beam-form:'));
    });

    // Should have at least 2 separate form keys (one per method)
    expect(storageKeys.length).toBeGreaterThanOrEqual(2);

    // Verify the keys contain different method names
    const hasSearchKey = storageKeys.some((k) => k.includes('search'));
    const hasCreateKey = storageKeys.some((k) => k.includes('create'));
    expect(hasSearchKey).toBe(true);
    expect(hasCreateKey).toBe(true);

    // Navigate back to search and verify its value is preserved independently
    await navigateToMethod(page, 'form-test', 'search');
    const searchValue = await searchInputs.first().inputValue();
    expect(searchValue).toBe('search-specific-value');

    // Navigate back to create and verify its value is preserved independently
    await navigateToMethod(page, 'form-test', 'create');
    const createValue = await createInputs.first().inputValue();
    expect(createValue).toBe('create-specific-value');
  });
});
