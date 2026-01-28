/**
 * Beam UI Prompts, Resources & View Source E2E Tests
 *
 * Tests for prompt modal, resource viewer, and view source features.
 * Photons declare @prompt and @resource assets via docblock tags,
 * and Beam exposes these as clickable cards in the main panel.
 *
 * Run: npx playwright test tests/beam/e2e/us-prompts-resources-source.e2e.test.ts
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

// Test configuration - unique port to avoid conflicts with other E2E suites
const BEAM_PORT = 3849;
const BEAM_URL = `http://localhost:${BEAM_PORT}`;
const TEST_TIMEOUT = 30000;

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create a photon with @prompt and @resource assets declared via docblock tags.
 *
 * The @prompt tag references a file in the photon's asset folder.
 * The @resource tag references a file in the photon's asset folder.
 * Asset folder convention: same name as photon basename (without .photon.ts).
 */
function createPhotonWithAssets(): string {
  return `
/**
 * Assets Test Photon
 * @description A test photon with prompts and resources
 * @prompt greet ./prompts/greet.txt
 * @prompt summarize ./prompts/summarize.txt
 * @resource config ./data/config.json
 */
export default class AssetstestPhoton {
  /**
   * Simple method
   */
  async hello() {
    return { message: 'Hello from assets-test' };
  }
}
`;
}

/**
 * Setup: Create test photons with asset files and start Beam server
 */
test.beforeAll(async () => {
  // Create test photon directory
  testPhotonDir = path.join(os.tmpdir(), 'beam-prompts-resources-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  // Write the photon file
  fs.writeFileSync(
    path.join(testPhotonDir, 'assets-test.photon.ts'),
    createPhotonWithAssets()
  );

  // Create asset folder matching photon basename: assets-test/
  const assetDir = path.join(testPhotonDir, 'assets-test');
  fs.mkdirSync(path.join(assetDir, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(assetDir, 'data'), { recursive: true });

  // Create prompt files with {{variable}} placeholders
  fs.writeFileSync(
    path.join(assetDir, 'prompts', 'greet.txt'),
    'Hello {{name}}, welcome to {{place}}! We are glad to have you here.'
  );
  fs.writeFileSync(
    path.join(assetDir, 'prompts', 'summarize.txt'),
    'Please summarize the following text:\n\n{{text}}'
  );

  // Create resource file
  fs.writeFileSync(
    path.join(assetDir, 'data', 'config.json'),
    JSON.stringify({ version: '1.0.0', debug: false, maxRetries: 3 }, null, 2)
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
 * Helper: Wait for MCP connection
 */
async function waitForConnection(page: Page): Promise<void> {
  await page.waitForSelector('.status-indicator.connected', { timeout: 10000 });
}

/**
 * Helper: Select the assets-test photon in the sidebar
 */
async function selectAssetsPhoton(page: Page): Promise<void> {
  // Click on the assets-test photon in the MCPs section
  const photonOption = page.locator('[role="option"]', { hasText: 'assets-test' });
  await photonOption.click();
  await page.waitForTimeout(500);
}

// =============================================================================
// US-110: Prompt modal opens when clicking a prompt in sidebar
// =============================================================================

test.describe('User Story: Prompt Modal', () => {
  test('US-110: Prompt modal opens when clicking a prompt card', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO click on a prompt card in the main panel
     * SO THAT I can view and customize the prompt content
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);
    await selectAssetsPhoton(page);

    // The Prompts section header should be visible
    const promptsHeader = page.locator('h3.section-header', { hasText: 'Prompts' });
    await expect(promptsHeader).toBeVisible({ timeout: 5000 });

    // Click the first prompt card (greet)
    const promptCard = page.locator('.asset-card', { hasText: 'greet' });
    await expect(promptCard).toBeVisible();
    await promptCard.click();

    // The prompt modal (asset-viewer-modal) should appear
    const modal = page.locator('.asset-viewer-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Modal should display the prompt id
    const modalTitle = modal.locator('h2');
    await expect(modalTitle).toContainText('greet');

    // Modal should have a Copy to Clipboard button
    const copyBtn = modal.locator('.copy-btn');
    await expect(copyBtn).toBeVisible();

    // Close the modal by clicking the close button
    const closeBtn = modal.locator('.close-btn');
    await closeBtn.click();
    await expect(modal).not.toBeVisible();
  });

  // ===========================================================================
  // US-111: Prompt variable substitution works in prompt modal
  // ===========================================================================

  test('US-111: Prompt variable substitution works in prompt modal', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO fill in prompt variables
     * SO THAT the rendered prompt shows my values substituted inline
     *
     * The greet.txt prompt has {{name}} and {{place}} variables.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);
    await selectAssetsPhoton(page);

    // Open the greet prompt
    const promptCard = page.locator('.asset-card', { hasText: 'greet' });
    await promptCard.click();

    const modal = page.locator('.asset-viewer-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Should show Variables section with two inputs (name and place)
    const variablesSection = modal.locator('.variables-form');
    await expect(variablesSection).toBeVisible();

    const variableInputs = modal.locator('.variable-input input');
    const inputCount = await variableInputs.count();
    expect(inputCount).toBe(2);

    // Fill in the first variable (name)
    const nameInput = modal.locator('.variable-input', { hasText: 'name' }).locator('input');
    await nameInput.fill('Alice');

    // Fill in the second variable (place)
    const placeInput = modal.locator('.variable-input', { hasText: 'place' }).locator('input');
    await placeInput.fill('Wonderland');

    // The rendered content should show the substituted values
    // var-filled spans contain the substituted text
    await page.waitForTimeout(300);
    const filledSpans = modal.locator('.content-preview .var-filled');
    const filledCount = await filledSpans.count();
    expect(filledCount).toBe(2);

    // Verify substituted values appear
    const contentPreview = modal.locator('.content-preview');
    await expect(contentPreview).toContainText('Alice');
    await expect(contentPreview).toContainText('Wonderland');

    // Close
    await modal.locator('.close-btn').click();
  });
});

// =============================================================================
// US-112: Resource viewer displays resource content
// =============================================================================

test.describe('User Story: Resource Viewer', () => {
  test('US-112: Resource viewer displays resource content', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO click a resource card
     * SO THAT I can view the resource content in a modal
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);
    await selectAssetsPhoton(page);

    // The Resources section header should be visible
    const resourcesHeader = page.locator('h3.section-header', { hasText: 'Resources' });
    await expect(resourcesHeader).toBeVisible({ timeout: 5000 });

    // Click the config resource card
    const resourceCard = page.locator('.asset-card', { hasText: 'config' });
    await expect(resourceCard).toBeVisible();
    await resourceCard.click();

    // The resource modal should appear
    const modal = page.locator('.asset-viewer-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Modal should display the resource id
    const modalTitle = modal.locator('h2');
    await expect(modalTitle).toContainText('config');

    // Content should include JSON data from config.json
    const contentPreview = modal.locator('.content-preview');
    await expect(contentPreview).toContainText('version');
    await expect(contentPreview).toContainText('1.0.0');

    // Should have a Copy to Clipboard button
    const copyBtn = modal.locator('.copy-btn');
    await expect(copyBtn).toBeVisible();

    // Close the modal
    await modal.locator('.close-btn').click();
    await expect(modal).not.toBeVisible();
  });
});

// =============================================================================
// US-113: View Source opens modal with syntax-highlighted code
// =============================================================================

test.describe('User Story: View Source', () => {
  test('US-113: View Source opens modal with syntax-highlighted code', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO click View Source for a photon
     * SO THAT I can see the source code with syntax highlighting
     *
     * View Source requires the "maker" photon to be available.
     * It calls maker/source with the photon path.
     * The modal uses Prism.js for syntax highlighting.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);
    await selectAssetsPhoton(page);

    // Look for the View Source button in the photon header toolbar or settings dropdown.
    // On desktop, it may be a toolbar button; on mobile, in a settings dropdown.
    const viewSourceBtn = page.locator('button[title="View source code"]');
    const settingsDropdownBtn = page.locator('.settings-dropdown-item', { hasText: 'View Source' });

    let hasViewSource = false;

    if ((await viewSourceBtn.count()) > 0) {
      await viewSourceBtn.click();
      hasViewSource = true;
    } else {
      // Try opening settings dropdown first
      const settingsBtn = page.locator('button[aria-label*="settings"], .menu-btn');
      if ((await settingsBtn.count()) > 0) {
        await settingsBtn.first().click();
        await page.waitForTimeout(300);
        if ((await settingsDropdownBtn.count()) > 0) {
          await settingsDropdownBtn.click();
          hasViewSource = true;
        }
      }
    }

    if (hasViewSource) {
      // Wait for the source modal to appear
      const sourceModal = page.locator('.modal-overlay [role="dialog"], .modal-overlay');
      await expect(sourceModal.first()).toBeVisible({ timeout: 10000 });

      // Modal should show "Source Code" title
      const title = page.locator('#source-modal-title');
      await expect(title).toContainText('Source Code');

      // Should contain a <pre> with code
      const codeBlock = page.locator('.modal-overlay pre code');
      await expect(codeBlock).toBeVisible();

      // Code should contain class declaration from the photon source
      await expect(codeBlock).toContainText('AssetstestPhoton');

      // Should have a Copy button
      const copyBtn = page.locator('.modal-overlay button', { hasText: 'Copy' });
      await expect(copyBtn).toBeVisible();

      // Close the modal
      const closeBtn = page.locator('.modal-overlay button[aria-label="Close"]');
      await closeBtn.click();
    } else {
      // View Source may not be available if maker photon is not loaded.
      // This is expected in a minimal test setup without maker.
      test.skip();
    }
  });

  // ===========================================================================
  // US-114: Copy button in View Source copies code to clipboard
  // ===========================================================================

  test('US-114: Copy button in View Source copies code to clipboard', async ({ page, context }) => {
    /**
     * AS A user
     * I WANT TO click Copy in the View Source modal
     * SO THAT the source code is copied to my clipboard
     */
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto(BEAM_URL);
    await waitForConnection(page);
    await selectAssetsPhoton(page);

    // Try to open View Source
    const viewSourceBtn = page.locator('button[title="View source code"]');
    const settingsDropdownBtn = page.locator('.settings-dropdown-item', { hasText: 'View Source' });

    let hasViewSource = false;

    if ((await viewSourceBtn.count()) > 0) {
      await viewSourceBtn.click();
      hasViewSource = true;
    } else {
      const settingsBtn = page.locator('button[aria-label*="settings"], .menu-btn');
      if ((await settingsBtn.count()) > 0) {
        await settingsBtn.first().click();
        await page.waitForTimeout(300);
        if ((await settingsDropdownBtn.count()) > 0) {
          await settingsDropdownBtn.click();
          hasViewSource = true;
        }
      }
    }

    if (hasViewSource) {
      // Wait for modal
      const sourceModal = page.locator('.modal-overlay');
      await expect(sourceModal.first()).toBeVisible({ timeout: 10000 });

      // Click the Copy button
      const copyBtn = page.locator('.modal-overlay button', { hasText: 'Copy' });
      await copyBtn.click();

      // Verify clipboard contains source code
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toContain('AssetstestPhoton');
      expect(clipboardText).toContain('hello');

      // Close
      const closeBtn = page.locator('.modal-overlay button[aria-label="Close"]');
      await closeBtn.click();
    } else {
      test.skip();
    }
  });
});
