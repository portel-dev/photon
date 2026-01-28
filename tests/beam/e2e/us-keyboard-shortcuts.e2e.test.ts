/**
 * Beam UI Keyboard Shortcuts E2E Tests
 *
 * Tests for global keyboard shortcuts defined in beam-app.ts _handleKeydown().
 * Each test maps to a user story (US-080 through US-087).
 *
 * Run: npx playwright test tests/beam/e2e/us-keyboard-shortcuts.e2e.test.ts
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
const BEAM_PORT = 3849; // Different port from user-stories tests to avoid conflicts
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let testPhotonDir: string;

/**
 * Create a configured test photon (no required params) with multiple methods
 */
function createConfiguredPhoton(name: string): string {
  return `
/**
 * ${name} Test Photon
 * @description A configured test photon for keyboard shortcut tests
 */
export default class ${name.replace(/-/g, '')}Photon {
  /**
   * First method
   */
  async alpha() {
    return { method: 'alpha' };
  }

  /**
   * Second method
   */
  async beta() {
    return { method: 'beta' };
  }

  /**
   * Third method
   * @param input Some input
   */
  async gamma(params: { input: string }) {
    return { method: 'gamma', input: params.input };
  }
}
`;
}

/**
 * Create a second configured photon to test navigation between photons
 */
function createSecondPhoton(name: string): string {
  return `
/**
 * ${name} Test Photon
 * @description A second configured photon for navigation tests
 */
export default class ${name.replace(/-/g, '')}Photon {
  /**
   * Ping method
   */
  async ping() {
    return { pong: true };
  }
}
`;
}

/**
 * Setup: Create test photons and start Beam server
 */
test.beforeAll(async () => {
  testPhotonDir = path.join(os.tmpdir(), 'beam-keyboard-shortcut-tests');
  if (fs.existsSync(testPhotonDir)) {
    fs.rmSync(testPhotonDir, { recursive: true });
  }
  fs.mkdirSync(testPhotonDir, { recursive: true });

  // Create two configured photons so we can test [ ] navigation between them
  fs.writeFileSync(
    path.join(testPhotonDir, 'shortcut-alpha.photon.ts'),
    createConfiguredPhoton('shortcut-alpha')
  );
  fs.writeFileSync(
    path.join(testPhotonDir, 'shortcut-beta.photon.ts'),
    createSecondPhoton('shortcut-beta')
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
 * Helper: Navigate to Beam and wait for connection
 */
async function setupPage(page: Page): Promise<void> {
  await page.goto(BEAM_URL);
  await waitForConnection(page);
  // Click body to ensure focus is not in an input field
  await page.click('body');
  await page.waitForTimeout(300);
}

/**
 * Helper: Get the selected photon name from the sidebar
 */
async function getSelectedPhotonName(page: Page): Promise<string | null> {
  return page.$eval('[role="option"][aria-selected="true"]', (el) =>
    el.querySelector('.photon-name')?.textContent?.trim() || null
  ).catch(() => null);
}

// =============================================================================
// US-080: Cmd+K / Ctrl+K opens search / command palette
// =============================================================================

test.describe('US-080: Cmd+K / Ctrl+K focuses search', () => {
  test('Ctrl+K focuses the search input', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press Ctrl+K (or Cmd+K on Mac)
     * SO THAT the search input is focused and I can quickly search photons
     *
     * Implementation: beam-app.ts line ~2764
     *   if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !isInput))
     *     this._sidebar?.focusSearch();
     */
    await setupPage(page);

    // Press Ctrl+K
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    // The search input inside beam-sidebar shadow DOM should be focused
    const isSearchFocused = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const sidebar = app?.shadowRoot?.querySelector('beam-sidebar');
      const input = sidebar?.shadowRoot?.querySelector('input[type="search"]');
      return input === sidebar?.shadowRoot?.activeElement || document.activeElement?.shadowRoot?.activeElement?.shadowRoot?.activeElement === input;
    });
    // Alternative: check if the search input has focus by trying to type
    // Type something and verify the search input value changed
    await page.keyboard.type('alpha');
    await page.waitForTimeout(300);

    const searchValue = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const sidebar = app?.shadowRoot?.querySelector('beam-sidebar');
      const input = sidebar?.shadowRoot?.querySelector('input[type="search"]') as HTMLInputElement;
      return input?.value || '';
    });
    expect(searchValue).toContain('alpha');
  });

  test('/ key also focuses search when not in input', async ({ page }) => {
    await setupPage(page);

    await page.keyboard.press('/');
    await page.waitForTimeout(300);

    // Type and verify search is focused
    await page.keyboard.type('beta');
    await page.waitForTimeout(300);

    const searchValue = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const sidebar = app?.shadowRoot?.querySelector('beam-sidebar');
      const input = sidebar?.shadowRoot?.querySelector('input[type="search"]') as HTMLInputElement;
      return input?.value || '';
    });
    expect(searchValue).toContain('beta');
  });
});

// =============================================================================
// US-081: [ and ] navigate between photons
// =============================================================================

test.describe('US-081: [ and ] navigate between photons', () => {
  test('] selects next photon', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press ] to go to the next photon
     * SO THAT I can quickly browse through my photon list
     *
     * Implementation: beam-app.ts line ~2843
     *   if (e.key === '[' || e.key === ']') { ... navigate photons }
     */
    await setupPage(page);

    const initialPhoton = await getSelectedPhotonName(page);

    // Press ] to go to next photon
    await page.keyboard.press(']');
    await page.waitForTimeout(500);

    const nextPhoton = await getSelectedPhotonName(page);

    // The selected photon should have changed
    expect(nextPhoton).not.toBeNull();
    if (initialPhoton) {
      expect(nextPhoton).not.toBe(initialPhoton);
    }
  });

  test('[ selects previous photon', async ({ page }) => {
    await setupPage(page);

    // Navigate forward first, then back
    await page.keyboard.press(']');
    await page.waitForTimeout(500);
    const afterNext = await getSelectedPhotonName(page);

    await page.keyboard.press('[');
    await page.waitForTimeout(500);
    const afterPrev = await getSelectedPhotonName(page);

    // Should have gone back to a different photon
    expect(afterPrev).not.toBeNull();
    if (afterNext) {
      expect(afterPrev).not.toBe(afterNext);
    }
  });

  test('] wraps around to first photon from last', async ({ page }) => {
    await setupPage(page);

    // Press ] enough times to wrap around (we have 2 photons)
    await page.keyboard.press(']');
    await page.waitForTimeout(300);
    const second = await getSelectedPhotonName(page);

    await page.keyboard.press(']');
    await page.waitForTimeout(300);
    const wrappedAround = await getSelectedPhotonName(page);

    // After wrapping, we should be back at a photon different from the second
    expect(wrappedAround).not.toBe(second);
  });
});

// =============================================================================
// US-082: j/k navigate between methods in sidebar
// =============================================================================

test.describe('US-082: j/k navigate between methods', () => {
  test('j moves to next method', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press j to highlight the next method
     * SO THAT I can browse methods with the keyboard
     *
     * Implementation: beam-app.ts line ~2866
     *   if ((e.key === 'j' || e.key === 'ArrowDown' || ...) && this._view === 'list')
     */
    await setupPage(page);

    // Select a photon with multiple methods (shortcut-alpha has alpha, beta, gamma)
    // Ensure we're on the right photon by navigating
    const selectedName = await getSelectedPhotonName(page);
    if (!selectedName?.includes('alpha')) {
      await page.keyboard.press(']');
      await page.waitForTimeout(500);
    }

    // Press j to highlight first method
    await page.keyboard.press('j');
    await page.waitForTimeout(300);

    // Check a method is highlighted via beam-app's _selectedMethod state
    const hasSelectedMethod = await page.evaluate(() => {
      const app = document.querySelector('beam-app') as any;
      return !!app?._selectedMethod;
    });
    expect(hasSelectedMethod).toBe(true);
  });

  test('k moves to previous method', async ({ page }) => {
    await setupPage(page);

    // Make sure we're on a photon with methods
    const selectedName = await getSelectedPhotonName(page);
    if (!selectedName?.includes('alpha')) {
      await page.keyboard.press(']');
      await page.waitForTimeout(500);
    }

    // Navigate down twice then up once
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    await page.keyboard.press('j');
    await page.waitForTimeout(200);

    const afterJ = await page.evaluate(() => {
      const app = document.querySelector('beam-app') as any;
      return app?._selectedMethod?.name || null;
    });

    await page.keyboard.press('k');
    await page.waitForTimeout(200);

    const afterK = await page.evaluate(() => {
      const app = document.querySelector('beam-app') as any;
      return app?._selectedMethod?.name || null;
    });

    // k should have moved to a different method than where j left us
    expect(afterK).not.toBeNull();
    if (afterJ) {
      expect(afterK).not.toBe(afterJ);
    }
  });
});

// =============================================================================
// US-083: Enter selects focused method
// =============================================================================

test.describe('US-083: Enter selects focused method', () => {
  test('Enter opens the method form for the highlighted method', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press Enter on a highlighted method
     * SO THAT I can open the method invocation form
     *
     * Implementation: beam-app.ts line ~2890
     *   if (e.key === 'Enter' && this._selectedMethod && this._view === 'list')
     *     this._view = 'form';
     */
    await setupPage(page);

    // Make sure we're on the alpha photon with methods
    const selectedName = await getSelectedPhotonName(page);
    if (!selectedName?.includes('alpha')) {
      await page.keyboard.press(']');
      await page.waitForTimeout(500);
    }

    // Highlight a method using j
    await page.keyboard.press('j');
    await page.waitForTimeout(300);

    // Press Enter to select it
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // View should change to 'form'
    const view = await page.evaluate(() => {
      const app = document.querySelector('beam-app') as any;
      return app?._view || null;
    });
    expect(view).toBe('form');
  });
});

// =============================================================================
// US-084: h goes back (from method form or marketplace)
// =============================================================================

test.describe('US-084: h goes back', () => {
  test('h navigates back from method form view', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press h to go back
     * SO THAT I can return to the method list from the form view
     *
     * Implementation: beam-app.ts line ~2833
     *   if (e.key === 'h') {
     *     if (this._view === 'form') this._handleBackFromMethod();
     *     else if (this._view === 'marketplace') this._view = 'list';
     *   }
     */
    await setupPage(page);

    // Navigate to form view: select a method then press Enter
    const selectedName = await getSelectedPhotonName(page);
    if (!selectedName?.includes('alpha')) {
      await page.keyboard.press(']');
      await page.waitForTimeout(500);
    }

    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Confirm we're in form view
    let view = await page.evaluate(() => {
      const app = document.querySelector('beam-app') as any;
      return app?._view || null;
    });
    expect(view).toBe('form');

    // Press h to go back
    // Need to make sure focus is not in an input (the form may have input fields)
    await page.click('body');
    await page.waitForTimeout(200);
    await page.keyboard.press('h');
    await page.waitForTimeout(500);

    // Should be back to list view
    view = await page.evaluate(() => {
      const app = document.querySelector('beam-app') as any;
      return app?._view || null;
    });
    expect(view).toBe('list');
  });
});

// =============================================================================
// US-085: ? opens help modal
// =============================================================================

test.describe('US-085: ? opens help modal', () => {
  test('Shift+? toggles the keyboard shortcuts help modal', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press ? to see all keyboard shortcuts
     * SO THAT I can discover available shortcuts
     *
     * Implementation: beam-app.ts line ~2802
     *   if (e.key === '?' && e.shiftKey) { this._showHelp = !this._showHelp; }
     */
    await setupPage(page);

    // Press ? (which is Shift+/)
    await page.keyboard.press('Shift+/');
    await page.waitForTimeout(500);

    // The help modal should be visible (role="dialog" with aria-labelledby="help-modal-title")
    const helpModalVisible = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const modal = app?.shadowRoot?.querySelector('[aria-labelledby="help-modal-title"]');
      return !!modal;
    });
    expect(helpModalVisible).toBe(true);

    // Verify the modal contains "Keyboard Shortcuts" heading
    const helpTitle = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const title = app?.shadowRoot?.querySelector('#help-modal-title');
      return title?.textContent?.trim() || '';
    });
    expect(helpTitle).toContain('Keyboard Shortcuts');

    // Press ? again to toggle off
    await page.keyboard.press('Shift+/');
    await page.waitForTimeout(500);

    const helpModalGone = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const modal = app?.shadowRoot?.querySelector('[aria-labelledby="help-modal-title"]');
      return !!modal;
    });
    expect(helpModalGone).toBe(false);
  });
});

// =============================================================================
// US-086: t cycles theme
// =============================================================================

test.describe('US-086: t toggles theme', () => {
  test('t toggles between dark and light themes', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press t to toggle the theme
     * SO THAT I can switch between dark and light mode quickly
     *
     * Implementation: beam-app.ts line ~2808
     *   if (e.key === 't') {
     *     const newTheme = this._theme === 'dark' ? 'light' : 'dark';
     *     ...
     *     showToast(`Theme: ${newTheme}`, 'info');
     *   }
     */
    await setupPage(page);

    // Get initial theme
    const initialTheme = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      return app?.getAttribute('data-theme') || 'dark';
    });

    // Press t to toggle
    await page.keyboard.press('t');
    await page.waitForTimeout(500);

    const afterToggle = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      return app?.getAttribute('data-theme') || '';
    });

    // Theme should have flipped
    const expectedTheme = initialTheme === 'dark' ? 'light' : 'dark';
    expect(afterToggle).toBe(expectedTheme);

    // Press t again to toggle back
    await page.keyboard.press('t');
    await page.waitForTimeout(500);

    const afterSecondToggle = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      return app?.getAttribute('data-theme') || '';
    });
    expect(afterSecondToggle).toBe(initialTheme);
  });

  test('t shows a toast notification with new theme name', async ({ page }) => {
    await setupPage(page);

    await page.keyboard.press('t');
    await page.waitForTimeout(500);

    // A toast with "Theme:" text should appear
    const toastText = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const toast = app?.shadowRoot?.querySelector('toast-manager, [class*="toast"]');
      return toast?.textContent?.trim() || '';
    });
    expect(toastText).toContain('Theme');

    // Toggle back to restore original state
    await page.keyboard.press('t');
    await page.waitForTimeout(300);
  });
});

// =============================================================================
// US-087: f toggles favorites filter
// =============================================================================

test.describe('US-087: f toggles favorites filter', () => {
  test('f toggles the favorites-only filter', async ({ page }) => {
    /**
     * AS A user
     * I WANT TO press f to toggle the favorites filter
     * SO THAT I can quickly show/hide non-favorited photons
     *
     * Implementation: beam-app.ts line ~2825
     *   if (e.key === 'f') {
     *     this._sidebar?.toggleFavoritesFilter();
     *     showToast(isActive ? 'Showing favorites only' : 'Showing all photons', 'info');
     *   }
     */
    await setupPage(page);

    // Press f to activate favorites filter
    await page.keyboard.press('f');
    await page.waitForTimeout(500);

    // Favorites filter should be active in sidebar
    const isActive = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const sidebar = app?.shadowRoot?.querySelector('beam-sidebar');
      const favBtn = sidebar?.shadowRoot?.querySelector('.filter-btn[aria-pressed="true"]');
      return !!favBtn;
    });
    expect(isActive).toBe(true);

    // A toast should indicate favorites mode
    const toastText = await page.evaluate(() => {
      const toasts = document.querySelectorAll('toast-manager, [class*="toast"]');
      let text = '';
      toasts.forEach((t) => (text += t.textContent || ''));
      // Also check inside shadow DOM
      const app = document.querySelector('beam-app');
      const shadowToast = app?.shadowRoot?.querySelector('toast-manager, [class*="toast"]');
      text += shadowToast?.textContent || '';
      return text;
    });
    expect(toastText).toContain('favorites');

    // Press f again to deactivate
    await page.keyboard.press('f');
    await page.waitForTimeout(500);

    const isDeactivated = await page.evaluate(() => {
      const app = document.querySelector('beam-app');
      const sidebar = app?.shadowRoot?.querySelector('beam-sidebar');
      const favBtn = sidebar?.shadowRoot?.querySelector('.filter-btn[aria-pressed="false"]');
      return !!favBtn;
    });
    expect(isDeactivated).toBe(true);
  });
});
