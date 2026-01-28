/**
 * Beam UI Configuration Flow E2E Tests
 *
 * These tests verify the configuration flow for unconfigured photons:
 * selecting them, seeing the config form, validating fields, submitting
 * configuration, and verifying they move to the MCPs section.
 *
 * Run: npx playwright test tests/beam/e2e/us-configuration-flow.e2e.test.ts
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

// Test configuration - use a different port to avoid conflicts with other e2e tests
const BEAM_PORT = 3858;
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create an unconfigured photon with specified constructor params.
 * These params make the photon require configuration before use.
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
 * Create a configured photon (no constructor params)
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
}
`;
}

/**
 * Setup: Create test photons and start Beam server
 */
test.beforeAll(async () => {
  // Create test photon directory
  testPhotonDir = path.join(os.tmpdir(), 'beam-config-flow-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  // Create a configured photon (no constructor params)
  fs.writeFileSync(
    path.join(testPhotonDir, 'already-configured.photon.ts'),
    createConfiguredPhoton('already-configured')
  );

  // Create an unconfigured photon with a single required param (apiKey)
  fs.writeFileSync(
    path.join(testPhotonDir, 'needs-api-key.photon.ts'),
    createUnconfiguredPhoton('needs-api-key', ['apiKey'])
  );

  // Create an unconfigured photon with multiple required params
  fs.writeFileSync(
    path.join(testPhotonDir, 'multi-param.photon.ts'),
    createUnconfiguredPhoton('multi-param', ['apiKey', 'secretToken', 'endpoint'])
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

  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
});

/**
 * Helper: Wait for MCP connection to be established
 */
async function waitForConnection(page: Page): Promise<void> {
  await page.waitForSelector('.status-indicator.connected', { timeout: 10000 });
}

/**
 * Helper: Click the first unconfigured photon in the SETUP section
 */
async function selectUnconfiguredPhoton(page: Page, name?: string): Promise<void> {
  if (name) {
    await page.click(`[aria-labelledby="setup-header"] [role="option"][aria-label*="${name}"]`);
  } else {
    await page.click('[aria-labelledby="setup-header"] [role="option"]');
  }
  await page.waitForTimeout(500);
}

// =============================================================================
// US-100: Selecting unconfigured photon shows config form with required params
// =============================================================================

test.describe('Configuration Flow', () => {
  test('US-100: Selecting unconfigured photon shows config form with required params', async ({
    page,
  }) => {
    /**
     * AS A user
     * I WANT TO see a configuration form when I select an unconfigured photon
     * SO THAT I know what parameters are needed and can fill them in
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // SETUP section should exist with our unconfigured photons
    const setupSection = page.locator('[id="setup-header"], .section-header:has-text("SETUP")');
    expect(await setupSection.count()).toBe(1);

    // Click on an unconfigured photon
    await selectUnconfiguredPhoton(page);

    // Should show the photon-config component with a form
    const configForm = page.locator('photon-config form.config-form');
    await expect(configForm).toBeVisible({ timeout: 5000 });

    // Should have input fields for the required parameters
    const inputFields = page.locator('photon-config .form-group input');
    expect(await inputFields.count()).toBeGreaterThan(0);

    // Should show required field indicators (red asterisk)
    const requiredMarkers = page.locator('photon-config .form-group .required');
    expect(await requiredMarkers.count()).toBeGreaterThan(0);

    // Should show "Configure & Enable" submit button
    const submitBtn = page.locator('photon-config button.submit-btn');
    await expect(submitBtn).toBeVisible();
    const btnText = await submitBtn.textContent();
    expect(btnText).toContain('Configure & Enable');
  });

  // =============================================================================
  // US-101: Config form shows environment variable hints
  // =============================================================================

  test('US-101: Config form shows environment variable hints (PHOTON_<NAME>_<PARAM>)', async ({
    page,
  }) => {
    /**
     * AS A user
     * I WANT TO see environment variable hints next to each config field
     * SO THAT I know which env var to set for headless/CI configuration
     *
     * The hint follows the pattern PHOTON_<PHOTON_NAME>_<PARAM_NAME> and is
     * rendered as a .hint span next to the label.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Select an unconfigured photon
    await selectUnconfiguredPhoton(page);

    // Config form should be visible
    const configForm = page.locator('photon-config form.config-form');
    await expect(configForm).toBeVisible({ timeout: 5000 });

    // Each form group should have a .hint element showing the env var
    const hints = page.locator('photon-config .form-group .hint');
    const hintCount = await hints.count();
    expect(hintCount).toBeGreaterThan(0);

    // Verify that at least one hint contains the PHOTON_ prefix pattern
    // The env var format is: PHOTON_<NAME>_<PARAM> (e.g. PHOTON_NEEDS_API_KEY_API_KEY)
    const hintTexts: string[] = [];
    for (let i = 0; i < hintCount; i++) {
      const text = await hints.nth(i).textContent();
      if (text) hintTexts.push(text.trim());
    }

    // At least one hint should follow the PHOTON_ naming convention
    const hasPhotonPrefix = hintTexts.some((h) => /^PHOTON_/i.test(h));
    expect(hasPhotonPrefix).toBe(true);
  });

  // =============================================================================
  // US-102: Config form validates required fields before submission
  // =============================================================================

  test('US-102: Config form validates required fields before submission', async ({ page }) => {
    /**
     * AS A user
     * I WANT the form to validate required fields before submitting
     * SO THAT I don't accidentally submit incomplete configuration
     *
     * The form uses native HTML5 required attribute validation. When
     * the user clicks submit without filling required fields, the
     * browser prevents submission.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Select an unconfigured photon
    await selectUnconfiguredPhoton(page);

    const configForm = page.locator('photon-config form.config-form');
    await expect(configForm).toBeVisible({ timeout: 5000 });

    // Get all required input fields
    const requiredInputs = page.locator('photon-config .form-group input[required]');
    const requiredCount = await requiredInputs.count();
    expect(requiredCount).toBeGreaterThan(0);

    // Try to submit without filling in any values
    const submitBtn = page.locator('photon-config button.submit-btn');
    await submitBtn.click();

    // The form should NOT have submitted - the submit button should still say
    // "Configure & Enable" (not "Configuring...")
    await page.waitForTimeout(300);
    const btnText = await submitBtn.textContent();
    expect(btnText).toContain('Configure & Enable');

    // The required input should show validation state (browser native)
    // We verify by checking the first required input's validity
    const isInvalid = await requiredInputs.first().evaluate((el: HTMLInputElement) => {
      return !el.checkValidity();
    });
    expect(isInvalid).toBe(true);
  });

  // =============================================================================
  // US-103: Submitting config form calls beam/configure MCP tool
  // =============================================================================

  test('US-103: Submitting config form calls beam/configure MCP tool', async ({ page }) => {
    /**
     * AS A user
     * I WANT the form submission to send configuration to the server
     * SO THAT the photon gets configured with the values I provided
     *
     * The form dispatches a 'configure' CustomEvent, which beam-app handles
     * by calling mcpClient.configurePhoton(photon, config), which in turn
     * calls the beam/configure MCP tool.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Select an unconfigured photon with single param
    await selectUnconfiguredPhoton(page, 'needs-api-key');

    const configForm = page.locator('photon-config form.config-form');
    await expect(configForm).toBeVisible({ timeout: 5000 });

    // Fill in the required field(s)
    const inputs = page.locator('photon-config .form-group input');
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      await inputs.nth(i).fill('test-value-' + i);
    }

    // Submit the form
    const submitBtn = page.locator('photon-config button.submit-btn');
    await submitBtn.click();

    // The button should show loading state ("Configuring...")
    await expect(submitBtn).toContainText('Configuring', { timeout: 3000 });

    // Wait for the configuration to complete (success or error)
    // The activity log should show the configuration attempt
    await page.waitForTimeout(2000);
    const activityLog = page.locator('activity-log');
    const logText = await activityLog.textContent();
    expect(logText).toMatch(/[Cc]onfigur/);
  });

  // =============================================================================
  // US-104: Successfully configured photon moves from SETUP to MCPs section
  // =============================================================================

  test('US-104: Successfully configured photon moves from SETUP to MCPs section', async ({
    page,
  }) => {
    /**
     * AS A user
     * I WANT a successfully configured photon to move from SETUP to MCPs
     * SO THAT I can see it's ready to use alongside other configured photons
     *
     * After beam/configure succeeds, the server sends a beam/configured
     * SSE notification. The frontend handles this by updating the photon's
     * configured status, which moves it from SETUP to MCPs in the sidebar.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Count photons in SETUP before configuration
    const setupPhotonsBefore = await page
      .locator('[aria-labelledby="setup-header"] [role="option"]')
      .count();
    expect(setupPhotonsBefore).toBeGreaterThan(0);

    // Count photons in MCPs before configuration
    const mcpPhotonsBefore = await page
      .locator('[aria-labelledby="mcps-header"] [role="option"]')
      .count();

    // Select an unconfigured photon
    await selectUnconfiguredPhoton(page, 'multi-param');

    const configForm = page.locator('photon-config form.config-form');
    await expect(configForm).toBeVisible({ timeout: 5000 });

    // Fill all required fields
    const inputs = page.locator('photon-config .form-group input');
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      await inputs.nth(i).fill('test-config-value-' + i);
    }

    // Submit the form
    const submitBtn = page.locator('photon-config button.submit-btn');
    await submitBtn.click();

    // Wait for SSE beam/configured notification to arrive and UI to update
    // The photon should move from SETUP to MCPs
    await page.waitForTimeout(5000);

    // After successful configuration, MCP count should increase
    const mcpPhotonsAfter = await page
      .locator('[aria-labelledby="mcps-header"] [role="option"]')
      .count();

    // Either MCPs increased or SETUP decreased (photon moved)
    const setupPhotonsAfter = await page
      .locator('[aria-labelledby="setup-header"] [role="option"]')
      .count();

    const photonMoved =
      mcpPhotonsAfter > mcpPhotonsBefore || setupPhotonsAfter < setupPhotonsBefore;
    expect(photonMoved).toBe(true);
  });
});
