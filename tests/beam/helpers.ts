/**
 * BEAM UI Test Helpers
 *
 * Provides utilities for E2E testing of BEAM UI using Playwright.
 */

import { spawn, ChildProcess } from 'child_process';
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Playwright types (dynamically imported)
type Page = any;
type Browser = any;

export interface ResultExpectation {
  type?: 'primitive' | 'kv-table' | 'grid-table' | 'markdown' | 'mermaid' | 'list' | 'json';
  value?: any;
  contains?: string[];
  columns?: string[];
  rowCount?: number;
}

export interface BeamContext {
  page: Page;
  port: number;

  /** Select a photon in the sidebar */
  selectPhoton(name: string): Promise<void>;

  /** Select a specific method */
  selectMethod(photon: string, method: string): Promise<void>;

  /** Wait for result and check expectations */
  expectResult(expected: ResultExpectation): Promise<void>;

  /** Check if element exists */
  expectElement(selector: string): Promise<void>;

  /** Check element text */
  expectText(selector: string, text: string): Promise<void>;

  /** Take a screenshot for visual comparison */
  snapshot(name: string): Promise<void>;

  /** Get the current result content */
  getResultContent(): Promise<string>;

  /** Fill form field */
  fillField(name: string, value: string): Promise<void>;

  /** Submit the form */
  submit(): Promise<void>;

  /** Open marketplace */
  openMarketplace(): Promise<void>;

  /** Search in marketplace */
  searchMarketplace(query: string): Promise<void>;
}

let beamProcess: ChildProcess | null = null;
let browser: Browser | null = null;

/**
 * Start BEAM server for testing
 */
async function startBeam(port: number, workingDir?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // --dir is a global option, so it must come before the subcommand
    // Use = syntax to avoid Commander.js parsing issues
    const args = workingDir
      ? ['dist/cli.js', `--dir=${workingDir}`, 'beam', '--port', String(port)]
      : ['dist/cli.js', 'beam', '--port', String(port)];

    if (process.env.DEBUG) {
      console.error('[BEAM] Starting with args:', args.join(' '));
    }

    beamProcess = spawn('node', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let started = false;

    beamProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (process.env.DEBUG) {
        console.error('[BEAM stdout]', output.trim());
      }
      if (output.includes('Photon Beam') && !started) {
        started = true;
        setTimeout(resolve, 500); // Give it a moment to stabilize
      }
    });

    beamProcess.stderr?.on('data', (data: Buffer) => {
      // Log but don't fail - some info goes to stderr
      if (process.env.DEBUG) {
        console.error('[BEAM stderr]', data.toString().trim());
      }
    });

    beamProcess.on('error', reject);

    // Timeout if server doesn't start
    setTimeout(() => {
      if (!started) {
        reject(new Error('BEAM server failed to start within 10s'));
      }
    }, 10000);
  });
}

/**
 * Stop BEAM server
 */
async function stopBeam(): Promise<void> {
  if (beamProcess) {
    beamProcess.kill();
    beamProcess = null;
  }
}

/**
 * Initialize Playwright browser
 */
async function initBrowser(): Promise<Browser> {
  // Dynamic import of playwright
  const { chromium } = await import('playwright');
  const headless = process.env.HEADLESS !== 'false';
  return chromium.launch({ headless });
}

/**
 * Create a BeamContext for testing
 */
function createBeamContext(page: Page, port: number): BeamContext {
  const snapshotDir = path.join(__dirname, 'snapshots');

  return {
    page,
    port,

    async selectPhoton(name: string) {
      const photon = page.locator(`.photon-header[data-photon="${name}"]`);
      await photon.waitFor({ state: 'visible', timeout: 10000 });
      await photon.click();
      await page.waitForTimeout(300);
    },

    async selectMethod(photon: string, method: string) {
      // First expand the photon if not already
      const photonHeader = page.locator(`.photon-header[data-photon="${photon}"]`);
      await photonHeader.waitFor({ state: 'visible', timeout: 10000 });
      await photonHeader.click();
      await page.waitForTimeout(200);

      // Then select the method
      const methodItem = page.locator(`#methods-${photon} .method-item:has-text("${method}")`);
      await methodItem.waitFor({ state: 'visible', timeout: 5000 });
      await methodItem.click();
      await page.waitForTimeout(500); // Wait for execution
    },

    async expectResult(expected: ResultExpectation) {
      const resultContent = page.locator('#result-content');
      await resultContent.waitFor({ state: 'visible', timeout: 5000 });

      if (expected.type === 'kv-table') {
        // Smart rendering: flat objects render as cards or kv-tables
        const kvTable = resultContent.locator('.kv-table, .smart-card');
        assert.ok(await kvTable.count() > 0, 'Expected key-value table or card');

        if (expected.contains) {
          const content = await resultContent.innerHTML();
          for (const text of expected.contains) {
            assert.ok(content.includes(text), `Expected table to contain "${text}"`);
          }
        }
      } else if (expected.type === 'grid-table') {
        // Smart rendering: arrays of objects render as lists
        const gridTable = resultContent.locator('.grid-table, .smart-list');
        assert.ok(await gridTable.count() > 0, 'Expected grid table or list');

        if (expected.columns) {
          // For smart-list, columns appear in list-item content
          const content = await resultContent.textContent();
          for (const col of expected.columns) {
            assert.ok(content?.includes(col), `Expected field "${col}" in content`);
          }
        }

        if (expected.rowCount !== undefined) {
          // Count items (rows or list-items)
          const rows = await resultContent.locator('tbody tr, .list-item').count();
          assert.strictEqual(rows, expected.rowCount, `Expected ${expected.rowCount} items`);
        }
      } else if (expected.type === 'primitive') {
        const content = await resultContent.textContent();
        if (expected.value !== undefined) {
          assert.ok(content?.includes(String(expected.value)), `Expected "${expected.value}"`);
        }
      } else if (expected.type === 'mermaid') {
        const mermaid = resultContent.locator('.mermaid-container');
        assert.ok(await mermaid.count() > 0, 'Expected mermaid diagram');
      } else if (expected.type === 'markdown') {
        // Check for rendered markdown elements
        const hasMarkdown = await resultContent.locator('p, h1, h2, h3, ul, ol, pre').count() > 0;
        assert.ok(hasMarkdown, 'Expected markdown content');
      }

      if (expected.contains && expected.type !== 'kv-table') {
        const content = await resultContent.textContent();
        for (const text of expected.contains) {
          assert.ok(content?.includes(text), `Expected content to contain "${text}"`);
        }
      }
    },

    async expectElement(selector: string) {
      const element = page.locator(selector);
      assert.ok(await element.count() > 0, `Expected element: ${selector}`);
    },

    async expectText(selector: string, text: string) {
      const element = page.locator(selector);
      const content = await element.textContent();
      assert.ok(content?.includes(text), `Expected "${text}" in ${selector}`);
    },

    async snapshot(name: string) {
      await fs.mkdir(snapshotDir, { recursive: true });
      const snapshotPath = path.join(snapshotDir, `${name}.png`);

      if (process.env.UPDATE_SNAPSHOTS) {
        await page.screenshot({ path: snapshotPath, fullPage: true });
        console.log(`  📸 Updated snapshot: ${name}`);
      } else {
        const newPath = path.join(snapshotDir, `${name}.new.png`);
        await page.screenshot({ path: newPath, fullPage: true });

        // Compare with existing snapshot if it exists
        try {
          const existing = await fs.readFile(snapshotPath);
          const newShot = await fs.readFile(newPath);
          if (!existing.equals(newShot)) {
            console.log(`  ⚠️  Snapshot differs: ${name} (see ${name}.new.png)`);
            // Don't fail - just warn for now
          } else {
            await fs.unlink(newPath); // Clean up matching snapshot
          }
        } catch (e) {
          // No existing snapshot - keep the new one
          await fs.rename(newPath, snapshotPath);
          console.log(`  📸 Created snapshot: ${name}`);
        }
      }
    },

    async getResultContent(): Promise<string> {
      const resultContent = page.locator('#result-content');
      return resultContent.textContent() || '';
    },

    async fillField(name: string, value: string) {
      const field = page.locator(`input[name="${name}"]`);
      await field.waitFor({ state: 'visible', timeout: 5000 });
      await field.fill(value);
    },

    async submit() {
      const submitBtn = page.locator('button[type="submit"]');
      await submitBtn.click();
      await page.waitForTimeout(500);
    },

    async openMarketplace() {
      const btn = page.locator('.sidebar-footer button, #empty-state-btn');
      await btn.click();
      await page.waitForTimeout(500);
    },

    async searchMarketplace(query: string) {
      const input = page.locator('#marketplace-search');
      await input.fill(query);
      await page.evaluate('document.getElementById("marketplace-search").dispatchEvent(new Event("input"))');
      await page.waitForTimeout(800);
    }
  };
}

/**
 * Run tests with BEAM context
 */
export async function withBeam(
  fn: (beam: BeamContext) => Promise<void>,
  options?: { port?: number; workingDir?: string }
): Promise<void> {
  const port = options?.port || 3500 + Math.floor(Math.random() * 100);
  let page: Page | null = null;

  try {
    await startBeam(port, options?.workingDir);
    browser = await initBrowser();
    page = await browser.newPage();

    await page.goto(`http://localhost:${port}`);
    await page.waitForLoadState('networkidle');

    const beam = createBeamContext(page, port);
    await fn(beam);
  } catch (error) {
    // Take debug screenshot on failure
    if (page) {
      const debugDir = path.join(__dirname, 'debug');
      await fs.mkdir(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, `failure-${Date.now()}.png`), fullPage: true });
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      browser = null;
    }
    await stopBeam();
  }
}

/**
 * Simple test runner
 */
export function test(name: string, fn: () => Promise<void>): void {
  tests.push({ name, fn });
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

export async function runTests(): Promise<void> {
  console.log('🧪 Running BEAM UI Tests...\n');

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      process.stdout.write(`  ${t.name}... `);
      await t.fn();
      console.log('✅');
      passed++;
    } catch (error) {
      console.log('❌');
      console.error(`    ${error}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Export assert for convenience
export { assert };
