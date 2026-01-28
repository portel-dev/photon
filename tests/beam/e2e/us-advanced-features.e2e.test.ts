/**
 * Beam UI Advanced Features E2E Tests
 *
 * These tests verify advanced user-facing features: hot reload, marketplace,
 * elicitation, and tools-changed notifications.
 *
 * Run: npx playwright test tests/beam/e2e/us-advanced-features.e2e.test.ts
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

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create a configured test photon (no required params)
 */
function createConfiguredPhoton(name: string, methodName = 'hello'): string {
  return `
/**
 * ${name} Test Photon
 * @description A configured test photon
 */
export default class ${name.replace(/-/g, '')}Photon {
  /**
   * ${methodName} method
   */
  async ${methodName}() {
    return { message: 'Hello from ${name}' };
  }
}
`;
}

/**
 * Create an unconfigured photon (requires constructor params)
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
 * Setup: Create test photons and start Beam server
 */
test.beforeAll(async () => {
  testPhotonDir = path.join(os.tmpdir(), 'beam-advanced-features-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  // Create a configured photon
  fs.writeFileSync(
    path.join(testPhotonDir, 'initial-photon.photon.ts'),
    createConfiguredPhoton('initial-photon')
  );

  // Create an unconfigured photon
  fs.writeFileSync(
    path.join(testPhotonDir, 'needs-setup.photon.ts'),
    createUnconfiguredPhoton('needs-setup', ['apiKey'])
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
 * Helper: Get all photon names visible in the sidebar
 */
async function getAllPhotonNames(page: Page): Promise<string[]> {
  return page.$$eval('[role="option"] .photon-name', (els) =>
    els.map((el) => el.textContent?.trim() || '')
  );
}

// =============================================================================
// US-160: Hot Reload Reflects Photon File Changes Without Page Refresh
// =============================================================================

test.describe('User Story: Hot Reload', () => {
  test('US-160: Hot reload reflects photon file changes without page refresh', async ({ page }) => {
    /**
     * AS A developer
     * I WANT the sidebar to update when I create a new .photon.ts file
     * SO THAT I can see my changes immediately without refreshing the page
     *
     * The Beam server watches the photon directory and emits a
     * 'notifications/tools/list_changed' notification via SSE when files
     * change. The frontend handles this via the 'tools-changed' event,
     * re-fetching tools and updating the photon list.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Record initial photon names
    const initialNames = await getAllPhotonNames(page);
    expect(initialNames.length).toBeGreaterThan(0);

    // Write a new photon file into the watched directory
    const newPhotonName = 'hot-reload-test';
    fs.writeFileSync(
      path.join(testPhotonDir, `${newPhotonName}.photon.ts`),
      createConfiguredPhoton(newPhotonName, 'ping')
    );

    // Wait for the hot reload to propagate (file watcher + SSE notification)
    // The frontend listens for 'tools-changed' and re-fetches tools/list
    await page.waitForTimeout(5000);

    // Verify the new photon appears in the sidebar without a page refresh
    const updatedNames = await getAllPhotonNames(page);
    expect(updatedNames.length).toBeGreaterThan(initialNames.length);
    expect(updatedNames.some((n) => n.includes('hot-reload-test'))).toBe(true);

    // Clean up the file so it does not affect other tests
    fs.unlinkSync(path.join(testPhotonDir, `${newPhotonName}.photon.ts`));
    await page.waitForTimeout(3000);
  });
});

// =============================================================================
// US-161: Marketplace Modal Opens
// =============================================================================

test.describe('User Story: Marketplace', () => {
  test('US-161: Marketplace modal opens when user clicks marketplace button', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO open the marketplace view
     * SO THAT I can discover and install new Photons
     *
     * The sidebar has a marketplace button (aria-label="Open marketplace").
     * Clicking it dispatches a 'marketplace' custom event, which sets
     * _view = 'marketplace' and renders the marketplace-view component.
     *
     * If the marketplace button is not present (feature may be disabled),
     * we skip the test gracefully.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Check if marketplace button exists in the sidebar
    const marketplaceBtn = page.locator('button[aria-label="Open marketplace"]');
    const btnCount = await marketplaceBtn.count();

    if (btnCount === 0) {
      // Marketplace button not present -- check if "Browse Marketplace" exists in main content
      const browseBtn = page.locator('button:has-text("Browse Marketplace")');
      const browseCount = await browseBtn.count();
      if (browseCount === 0) {
        test.skip();
        return;
      }
      await browseBtn.click();
    } else {
      await marketplaceBtn.click();
    }

    await page.waitForTimeout(500);

    // Marketplace view should be visible with its heading
    const heading = page.locator('h1:has-text("Marketplace")');
    await expect(heading).toBeVisible({ timeout: 5000 });

    // "Back to Dashboard" link should be present
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();

    // marketplace-view component should be rendered
    const marketplaceView = page.locator('marketplace-view');
    expect(await marketplaceView.count()).toBe(1);

    // Navigate back
    await backBtn.click();
    await page.waitForTimeout(300);

    // Marketplace heading should no longer be visible
    await expect(heading).not.toBeVisible();
  });
});

// =============================================================================
// US-162: Elicitation Modal Appears When Method Requires Interactive Input
// =============================================================================

test.describe('User Story: Elicitation', () => {
  test.skip('US-162: Elicitation modal appears when server sends elicitation notification', async ({
    // TODO: Elicitation modal is in shadow DOM; need shadow-piercing selectors
    page,
  }) => {
    /**
     * AS A user
     * I WANT the UI to show a modal when a method needs interactive input
     * SO THAT I can provide required information during execution
     *
     * The MCP server sends a 'beam/elicitation' notification via SSE.
     * The MCPClient emits 'elicitation' which sets _showElicitation = true
     * and renders <elicitation-modal> with the data.
     *
     * Since triggering a real elicitation requires a photon that calls
     * the elicit API mid-execution, we simulate the event by injecting
     * it via the page's MCPClient event emitter.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Inject a simulated elicitation event into the beam-app component.
    // This mirrors what happens when mcp-client receives 'beam/elicitation'.
    await page.evaluate(() => {
      const beamApp = document.querySelector('beam-app') as any;
      if (beamApp) {
        // Directly set the elicitation state properties (LitElement reactive)
        beamApp._elicitationData = {
          ask: 'text',
          message: 'Please enter your API key',
          placeholder: 'sk-...',
          elicitationId: 'test-elicit-001',
        };
        beamApp._showElicitation = true;
        beamApp.requestUpdate();
      }
    });

    await page.waitForTimeout(500);

    // Elicitation modal should be visible
    const modal = page.locator('elicitation-modal');
    expect(await modal.count()).toBe(1);

    // The modal should display the message
    const modalText = await modal.textContent();
    expect(modalText).toContain('API key');

    // There should be a cancel/submit button
    const cancelBtn = page.locator('elicitation-modal button:has-text("Cancel")');
    expect(await cancelBtn.count()).toBeGreaterThanOrEqual(1);

    // Dismiss the modal by clicking cancel
    await cancelBtn.click();
    await page.waitForTimeout(300);
  });
});

// =============================================================================
// US-163: Tools Changed Notification Updates Sidebar Photon List
// =============================================================================

test.describe('User Story: Tools Changed Notification', () => {
  test('US-163: Tools changed notification updates sidebar photon list', async ({ page }) => {
    /**
     * AS A user
     * I WANT the photon list to update automatically when tools change
     * SO THAT I always see the latest available photons
     *
     * When the MCP server sends 'notifications/tools/list_changed',
     * the MCPClient emits 'tools-changed'. The beam-app handler
     * re-fetches tools via mcpClient.listTools() and rebuilds the
     * photon list with toolsToPhotons().
     *
     * We verify this by writing a new photon file (which triggers the
     * file watcher on the server), then confirming the sidebar updates.
     * This differs from US-160 by focusing on the notification path
     * rather than the hot-reload path.
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Count photons in the MCPs section specifically
    const initialMcpPhotons = await page.$$eval(
      '[aria-labelledby="mcps-header"] [role="option"]',
      (els) => els.map((el) => el.textContent?.trim() || '')
    );
    const initialCount = initialMcpPhotons.length;

    // Add a new photon file to trigger tools/list_changed notification
    const toolsChangedPhoton = 'tools-changed-test';
    fs.writeFileSync(
      path.join(testPhotonDir, `${toolsChangedPhoton}.photon.ts`),
      createConfiguredPhoton(toolsChangedPhoton, 'status')
    );

    // Wait for file watcher to detect change and server to emit notification
    await page.waitForTimeout(5000);

    // The MCPs section should now contain the new photon
    const updatedMcpPhotons = await page.$$eval(
      '[aria-labelledby="mcps-header"] [role="option"]',
      (els) => els.map((el) => el.textContent?.trim() || '')
    );

    expect(updatedMcpPhotons.length).toBeGreaterThan(initialCount);
    expect(updatedMcpPhotons.some((name) => name.includes('tools-changed-test'))).toBe(true);

    // Clean up
    fs.unlinkSync(path.join(testPhotonDir, `${toolsChangedPhoton}.photon.ts`));
    await page.waitForTimeout(3000);
  });
});
