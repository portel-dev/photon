/**
 * Beam UI Error Handling & Connection Resilience E2E Tests
 *
 * Tests verify that the UI properly handles connection loss, reconnection,
 * method execution errors, network errors, and activity log error recording.
 *
 * Run: npx playwright test tests/beam/e2e/us-error-handling.e2e.test.ts
 */

import { test, expect, Page } from 'playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout } from 'timers/promises';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Test configuration
const BEAM_PORT = 3849; // Different port to avoid conflicts with other e2e tests
const BEAM_URL = `http://localhost:${BEAM_PORT}`;
const TEST_TIMEOUT = 30000;

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create a photon with a method that throws an error
 */
function createErrorPhoton(): string {
  return `
/**
 * error-test Test Photon
 * @description A photon with methods that produce errors
 */
export default class ErrorTestPhoton {
  /**
   * A method that always throws an error
   */
  async failingMethod() {
    throw new Error('Intentional test error: something went wrong');
  }

  /**
   * A method that succeeds
   */
  async successMethod() {
    return { status: 'ok', message: 'Success' };
  }
}
`;
}

/**
 * Start the Beam server process
 */
function startBeamServer(photonDir: string, port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'node',
      ['dist/cli.js', 'beam', '--port', String(port), photonDir],
      {
        cwd: path.join(__dirname, '../../..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      }
    );

    const timeout = global.setTimeout(() => {
      reject(new Error('Beam server failed to start within timeout'));
    }, 20000);

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.log('[Beam]', output);
      if (output.includes('Beam server running') || output.includes('listening')) {
        global.clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error('[Beam stderr]', data.toString());
    });

    proc.on('error', (err) => {
      global.clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Setup: Create test photons and start Beam server
 */
test.beforeAll(async () => {
  // Create test photon directory
  testPhotonDir = path.join(os.tmpdir(), 'beam-error-handling-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  // Create a photon with error-throwing methods
  fs.writeFileSync(
    path.join(testPhotonDir, 'error-test.photon.ts'),
    createErrorPhoton()
  );

  // Start Beam server
  beamProcess = await startBeamServer(testPhotonDir, BEAM_PORT);

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
 * Helper: Select the error-test photon and a specific method
 */
async function selectMethod(page: Page, methodName: string): Promise<void> {
  // Click on the error-test photon in the MCPs section
  const photonItem = page.locator('[role="option"]', { hasText: 'error-test' });
  await photonItem.click();
  await page.waitForTimeout(500);

  // Click on the target method
  const method = page.locator(`[data-method="${methodName}"], [class*="method"]`, {
    hasText: methodName,
  });
  if ((await method.count()) > 0) {
    await method.first().click();
    await page.waitForTimeout(300);
  }
}

// =============================================================================
// USER STORY: Connection Loss & Reconnection
// =============================================================================

test.describe('User Story: Connection Resilience', () => {
  test('US-130: Connection loss updates status indicator to disconnected', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO see the status indicator change when the connection is lost
     * SO THAT I know the server is unreachable
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Verify we start connected
    const indicator = page.locator('.status-indicator');
    await expect(indicator).toHaveClass(/connected/);

    // Block all MCP requests (SSE and POST) to simulate connection loss
    await page.route('**/mcp**', (route) => route.abort('connectionrefused'));

    // Close any active EventSource connections from the browser side.
    // The MCPClient singleton is not on window, but we can close all EventSources.
    await page.evaluate(() => {
      // Override EventSource to close existing instances
      const origES = window.EventSource;
      // Close any existing event sources by triggering error state
      // The browser's native EventSource will auto-reconnect, hitting our blocked route
      // which will eventually exhaust maxReconnectAttempts and trigger disconnect
      const event = new Event('error');
      document.querySelectorAll('*').forEach(() => {}); // no-op to ensure page is settled

      // Force all EventSources to close by patching the prototype
      // This triggers the onerror handler in mcp-client.ts
      if ((window as any)._activeEventSources) {
        (window as any)._activeEventSources.forEach((es: EventSource) => es.close());
      }
    });

    // The EventSource will try to reconnect but routes are blocked.
    // After maxReconnectAttempts (5) with increasing delay, it emits 'disconnect'.
    // The beam-app then sets _connected=false, showing the connection banner.
    // We wait for either the connection banner or the disconnected status indicator.
    await page.waitForSelector(
      '.connection-banner, .status-indicator.disconnected, .status-indicator.reconnecting',
      { timeout: 20000 }
    );

    // The connection banner or disconnected/reconnecting indicator should be visible
    const hasBanner = (await page.locator('.connection-banner').count()) > 0;
    const indicatorClass = await indicator.getAttribute('class');
    const isDisconnected =
      indicatorClass?.includes('disconnected') || indicatorClass?.includes('reconnecting');

    expect(hasBanner || isDisconnected).toBe(true);

    // If the banner is visible, verify its content
    if (hasBanner) {
      const bannerText = await page.locator('.connection-banner').textContent();
      expect(bannerText).toMatch(/Disconnected|Reconnecting/i);
    }

    // Cleanup: unroute to allow future tests to connect
    await page.unroute('**/mcp**');
  });

  test('US-131: Reconnection restores connected status', async ({ page }) => {
    /**
     * AS A user
     * I WANT the UI to automatically reconnect and restore the connected indicator
     * SO THAT I can continue using the application after a temporary interruption
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Verify initial connected state
    const indicator = page.locator('.status-indicator');
    await expect(indicator).toHaveClass(/connected/);

    // Block connections to simulate loss
    await page.route('**/mcp**', (route) => route.abort('connectionrefused'));

    // Wait for the UI to detect disconnect (reconnect attempts will fail against blocked routes)
    await page.waitForSelector(
      '.connection-banner, .status-indicator.disconnected, .status-indicator.reconnecting',
      { timeout: 20000 }
    );

    // Now restore the connection by unblocking routes
    await page.unroute('**/mcp**');

    // Click the "Retry Now" button if the connection banner is showing
    const retryButton = page.locator('.connection-banner button');
    if ((await retryButton.count()) > 0) {
      await retryButton.click();
    } else {
      // If no banner, reload to trigger reconnection
      await page.reload();
    }

    // Wait for reconnection - the status indicator should become connected again
    await page.waitForSelector('.status-indicator.connected', { timeout: 15000 });

    // Connection banner should disappear when connected
    await expect(page.locator('.connection-banner')).toHaveCount(0, { timeout: 5000 });
  });
});

// =============================================================================
// USER STORY: Method Execution Errors
// =============================================================================

test.describe('User Story: Method Execution Errors', () => {
  test('US-132: Method execution error displays error message in result area', async ({
    page,
  }) => {
    /**
     * AS A user
     * I WANT TO see a clear error message when a method execution fails
     * SO THAT I understand what went wrong
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Select the error-test photon and the failing method
    await selectMethod(page, 'failingMethod');

    // Execute the method
    const executeBtn = page.locator('button:has-text("Execute"), button:has-text("Run")');
    if ((await executeBtn.count()) > 0) {
      await executeBtn.first().click();
    }

    // Wait for the error to be displayed
    await page.waitForTimeout(2000);

    // The error should appear as a toast notification
    // Toast manager renders error toasts with 'error' type
    const toastError = page.locator('toast-manager');
    const toastContent = await toastError.textContent();

    // The activity log should also record the error
    const activityLog = page.locator('activity-log');
    const logContent = await activityLog.textContent();

    // At least one of toast or activity log should contain the error indication
    const hasError =
      (toastContent && toastContent.toLowerCase().includes('error')) ||
      (logContent && logContent.toLowerCase().includes('error'));
    expect(hasError).toBe(true);
  });

  test('US-133: Network error during method call shows appropriate error', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO see an appropriate error when the network fails during a method call
     * SO THAT I know the issue is connectivity-related, not a bug in the method
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Select the success method (it would work normally, but we block the network)
    await selectMethod(page, 'successMethod');

    // Block only POST requests to /mcp to simulate network failure during execution
    await page.route('**/mcp', (route) => {
      if (route.request().method() === 'POST') {
        route.abort('connectionrefused');
      } else {
        route.continue();
      }
    });

    // Execute the method - this should trigger a network error
    const executeBtn = page.locator('button:has-text("Execute"), button:has-text("Run")');
    if ((await executeBtn.count()) > 0) {
      await executeBtn.first().click();
    }

    // Wait for the error to surface
    await page.waitForTimeout(3000);

    // The UI should show an error - either via toast, activity log, or connection banner
    const activityLog = page.locator('activity-log');
    const logContent = await activityLog.textContent();

    // Check that error was logged or a disconnection banner appeared
    const hasErrorOrDisconnect =
      (logContent && logContent.toLowerCase().includes('error')) ||
      (logContent && logContent.toLowerCase().includes('not connected')) ||
      (await page.locator('.connection-banner').count()) > 0;

    expect(hasErrorOrDisconnect).toBe(true);

    // Cleanup
    await page.unroute('**/mcp');
  });
});

// =============================================================================
// USER STORY: Activity Log Error Recording
// =============================================================================

test.describe('User Story: Activity Log Error Recording', () => {
  test('US-134: Activity log records error events', async ({ page }) => {
    /**
     * AS A user
     * I WANT error events to be recorded in the activity log
     * SO THAT I can review what went wrong and when
     */
    await page.goto(BEAM_URL);
    await waitForConnection(page);

    // Clear any existing activity log entries
    const clearBtn = page.locator('activity-log button, activity-log [class*="clear"]');
    if ((await clearBtn.count()) > 0) {
      await clearBtn.first().click();
      await page.waitForTimeout(300);
    }

    // Select and execute the failing method to generate an error log entry
    await selectMethod(page, 'failingMethod');

    const executeBtn = page.locator('button:has-text("Execute"), button:has-text("Run")');
    if ((await executeBtn.count()) > 0) {
      await executeBtn.first().click();
    }

    // Wait for the execution to complete and error to be logged
    await page.waitForTimeout(2000);

    // The activity log should contain an error entry
    const activityLog = page.locator('activity-log');
    const logContent = await activityLog.textContent();

    // Verify the error was recorded in the activity log
    // The _log('error', ...) call in beam-app creates an entry with type 'error'
    expect(logContent).toBeTruthy();

    // Check for error-related content in the log
    // The error message from the photon or a generic error indicator should be present
    const hasErrorEntry =
      logContent!.toLowerCase().includes('error') ||
      logContent!.toLowerCase().includes('fail') ||
      logContent!.includes('Intentional test error');

    expect(hasErrorEntry).toBe(true);

    // Verify the log also contains the invocation entry (showing the method was called)
    // The _log('info', 'Invoking failingMethod...') call happens before the error
    const hasInvocationEntry =
      logContent!.includes('Invoking') || logContent!.includes('failingMethod');

    expect(hasInvocationEntry).toBe(true);
  });
});
