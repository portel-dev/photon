/**
 * Photon Test Runner
 *
 * Discovers and runs tests from:
 * - External .test.ts files (preferred — companion to .photon.ts)
 * - Inline test* methods in .photon.ts (legacy, backward compatible)
 *
 * Supports multiple test modes:
 * - direct: Call methods directly on instance (unit tests)
 * - cli: Call methods via CLI subprocess (integration tests)
 * - mcp: Call methods via MCP protocol (integration tests)
 *
 * Usage: photon test [photon] [testName] [--mode direct|cli|all]
 */

import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { PhotonLoader } from './loader.js';
import { listPhotonMCPs, resolvePhotonPath } from './path-resolver.js';
import { logger } from './shared/logger.js';
import { SchemaExtractor, compilePhotonTS } from '@portel/photon-core';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the path to the CLI binary (either local dev or installed)
const CLI_PATH = path.resolve(__dirname, 'cli.js');

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

export type TestMode = 'direct' | 'cli' | 'mcp' | 'all';

export interface TestResult {
  photon: string;
  test: string;
  passed: boolean;
  skipped?: boolean;
  duration: number;
  error?: string;
  message?: string;
  mode: 'direct' | 'cli' | 'mcp';
  issueUrl?: string; // Pre-filled issue URL for failures
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: TestResult[];
  mode: TestMode;
}

interface MethodSchema {
  name: string;
  params: Array<{ name: string; type: string; required: boolean; example?: string }>;
}

/** A single external test descriptor discovered from a .test.ts file */
interface ExternalTestDescriptor {
  name: string;
  fn?: (photon: any) => Promise<any>;
  /** Sequence tests: ordered step functions sharing one instance */
  steps?: Array<{ name: string; fn: (photon: any) => Promise<any> }>;
  skip?: string | boolean;
  only?: boolean;
}

/** Lifecycle hooks exported from a .test.ts file */
interface ExternalTestHooks {
  beforeAll?: (photon: any) => Promise<any>;
  afterAll?: (photon: any) => Promise<any>;
  beforeEach?: (photon: any) => Promise<any>;
  afterEach?: (photon: any) => Promise<any>;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXTERNAL TEST FILE DISCOVERY & EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve the companion .test.ts path for a photon file.
 * e.g. /path/to/todo.photon.ts → /path/to/todo.test.ts
 */
function resolveTestFilePath(photonPath: string): string | null {
  const testPath = photonPath.replace(/\.photon\.ts$/, '.test.ts');
  return existsSync(testPath) ? testPath : null;
}

/**
 * Parse JSDoc tags (@skip, @only) from a .test.ts source file.
 * Returns a map of export name → { skip?, only? }.
 */
function parseTestTags(source: string): Map<string, { skip?: string; only?: boolean }> {
  const tags = new Map<string, { skip?: string; only?: boolean }>();

  // Match JSDoc comment followed by export
  const pattern = /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:async\s+)?(?:function\s+|const\s+)(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const comment = match[1];
    const name = match[2];
    const entry: { skip?: string; only?: boolean } = {};

    const skipMatch = comment.match(/@skip(?:\s+(.+?))?(?:\n|\*)/);
    if (skipMatch) {
      entry.skip = skipMatch[1]?.trim() || 'skipped';
    }

    if (/@only\b/.test(comment)) {
      entry.only = true;
    }

    tags.set(name, entry);
  }

  return tags;
}

/**
 * Discover and compile a .test.ts file, returning test descriptors and hooks.
 */
async function discoverExternalTests(
  testFilePath: string
): Promise<{ tests: ExternalTestDescriptor[]; hooks: ExternalTestHooks } | null> {
  try {
    const source = readFileSync(testFilePath, 'utf-8');
    const tags = parseTestTags(source);

    // Compile the test file
    const cacheDir = path.join(path.dirname(testFilePath), '.photon-cache', 'tests');
    const jsPath = await compilePhotonTS(testFilePath, { cacheDir });

    // Import the compiled module
    const moduleUrl = pathToFileURL(jsPath).href;
    const mod = await import(moduleUrl);

    const tests: ExternalTestDescriptor[] = [];
    const hooks: ExternalTestHooks = {};

    for (const [key, value] of Object.entries(mod)) {
      // Lifecycle hooks
      if (key === 'beforeAll' && typeof value === 'function') {
        hooks.beforeAll = value as any;
        continue;
      }
      if (key === 'afterAll' && typeof value === 'function') {
        hooks.afterAll = value as any;
        continue;
      }
      if (key === 'beforeEach' && typeof value === 'function') {
        hooks.beforeEach = value as any;
        continue;
      }
      if (key === 'afterEach' && typeof value === 'function') {
        hooks.afterEach = value as any;
        continue;
      }

      // Test functions
      if (key.startsWith('test') && typeof value === 'function') {
        const tagInfo = tags.get(key);
        tests.push({
          name: key,
          fn: value as any,
          skip: tagInfo?.skip,
          only: tagInfo?.only,
        });
      }

      // Sequence tests (exported arrays of functions)
      if (key.startsWith('test') && Array.isArray(value)) {
        const tagInfo = tags.get(key);
        const steps = (value as any)
          .filter((fn: any) => typeof fn === 'function')
          .map((fn: any) => ({ name: fn.name || 'anonymous', fn }));

        if (steps.length > 0) {
          tests.push({
            name: key,
            steps,
            skip: tagInfo?.skip,
            only: tagInfo?.only,
          });
        }
      }
    }

    return { tests, hooks };
  } catch (error: any) {
    logger.error(`Failed to discover external tests from ${testFilePath}: ${error.message}`);
    return null;
  }
}

/**
 * Run a single external test function with a fresh photon instance.
 */
async function runExternalTest(
  testFn: (photon: any) => Promise<any>,
  photonPath: string,
  photonName: string,
  testName: string,
  workingDir: string,
  hooks?: ExternalTestHooks
): Promise<TestResult> {
  const start = Date.now();

  try {
    // Create a fresh instance for isolation
    const loader = new PhotonLoader(false);
    const loaded = await loader.loadFile(photonPath);
    const instance = loaded.instance;

    // Run beforeEach hook
    if (hooks?.beforeEach) {
      await hooks.beforeEach(instance);
    }

    try {
      const result = await testFn(instance);
      const duration = Date.now() - start;

      // Same contract as inline tests: explicit { passed: false } or throw
      if (result && typeof result === 'object') {
        if (result.skipped === true) {
          return {
            photon: photonName,
            test: testName,
            passed: true,
            skipped: true,
            duration,
            message: result.reason || 'Skipped',
            mode: 'direct',
          };
        }
        if (result.passed === false) {
          const failResult: TestResult = {
            photon: photonName,
            test: testName,
            passed: false,
            duration,
            error: result.error || result.message || 'Test returned passed: false',
            mode: 'direct',
          };
          failResult.issueUrl = generateIssueUrl(failResult, workingDir);
          return failResult;
        }
      }

      return { photon: photonName, test: testName, passed: true, duration, mode: 'direct' };
    } finally {
      // Run afterEach hook (always, even on failure)
      if (hooks?.afterEach) {
        try {
          await hooks.afterEach(instance);
        } catch {
          /* best effort */
        }
      }
    }
  } catch (error: any) {
    const duration = Date.now() - start;
    const failResult: TestResult = {
      photon: photonName,
      test: testName,
      passed: false,
      duration,
      error: error.message || String(error),
      mode: 'direct',
    };
    failResult.issueUrl = generateIssueUrl(failResult, workingDir);
    return failResult;
  }
}

/**
 * Run a sequence test: all steps share one photon instance.
 */
async function runExternalSequence(
  steps: Array<{ name: string; fn: (photon: any) => Promise<any> }>,
  photonPath: string,
  photonName: string,
  sequenceName: string,
  workingDir: string
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    const loader = new PhotonLoader(false);
    const loaded = await loader.loadFile(photonPath);
    const instance = loaded.instance;

    for (const step of steps) {
      const stepTestName = `${sequenceName}/${step.name}`;
      const start = Date.now();

      try {
        await step.fn(instance);
        results.push({
          photon: photonName,
          test: stepTestName,
          passed: true,
          duration: Date.now() - start,
          mode: 'direct',
        });
      } catch (error: any) {
        const failResult: TestResult = {
          photon: photonName,
          test: stepTestName,
          passed: false,
          duration: Date.now() - start,
          error: error.message || String(error),
          mode: 'direct',
        };
        failResult.issueUrl = generateIssueUrl(failResult, workingDir);
        results.push(failResult);
        // Abort remaining steps on failure
        for (const remaining of steps.slice(steps.indexOf(step) + 1)) {
          results.push({
            photon: photonName,
            test: `${sequenceName}/${remaining.name}`,
            passed: false,
            skipped: true,
            duration: 0,
            message: 'Skipped (previous step failed)',
            mode: 'direct',
          });
        }
        break;
      }
    }
  } catch (error: any) {
    results.push({
      photon: photonName,
      test: `${sequenceName}/*`,
      passed: false,
      duration: 0,
      error: `Failed to load photon: ${error.message}`,
      mode: 'direct',
    });
  }

  return results;
}

/**
 * Run all external tests from a .test.ts file.
 */
async function runExternalTests(
  testFilePath: string,
  photonPath: string,
  photonName: string,
  workingDir: string,
  specificTest?: string
): Promise<TestResult[]> {
  const discovered = await discoverExternalTests(testFilePath);
  if (!discovered || discovered.tests.length === 0) return [];

  const { tests, hooks } = discovered;
  const results: TestResult[] = [];

  // Filter by specific test name if provided
  let testsToRun = specificTest
    ? tests.filter((t) => t.name === specificTest || t.name === `test${specificTest}`)
    : tests;

  // Handle @only: if any test has @only, run only those
  const onlyTests = testsToRun.filter((t) => t.only);
  if (onlyTests.length > 0) {
    testsToRun = onlyTests;
  }

  // Run beforeAll hook (with a temporary instance)
  if (hooks.beforeAll) {
    try {
      const loader = new PhotonLoader(false);
      const loaded = await loader.loadFile(photonPath);
      await hooks.beforeAll(loaded.instance);
    } catch (error: any) {
      return [
        {
          photon: photonName,
          test: 'beforeAll',
          passed: false,
          duration: 0,
          error: `Setup failed: ${error.message}`,
          mode: 'direct',
        },
      ];
    }
  }

  for (const test of testsToRun) {
    // Handle @skip
    if (test.skip) {
      results.push({
        photon: photonName,
        test: test.name,
        passed: true,
        skipped: true,
        duration: 0,
        message: typeof test.skip === 'string' ? test.skip : 'Skipped',
        mode: 'direct',
      });
      continue;
    }

    if (test.steps) {
      // Sequence test
      const seqResults = await runExternalSequence(
        test.steps,
        photonPath,
        photonName,
        test.name,
        workingDir
      );
      results.push(...seqResults);
    } else if (test.fn) {
      // Regular test
      const result = await runExternalTest(
        test.fn,
        photonPath,
        photonName,
        test.name,
        workingDir,
        hooks
      );
      results.push(result);
    }
  }

  // Run afterAll hook
  if (hooks.afterAll) {
    try {
      const loader = new PhotonLoader(false);
      const loaded = await loader.loadFile(photonPath);
      await hooks.afterAll(loaded.instance);
    } catch (error: any) {
      results.push({
        photon: photonName,
        test: 'afterAll',
        passed: false,
        duration: 0,
        error: `Teardown failed: ${error.message}`,
        mode: 'direct',
      });
    }
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// ISSUE URL GENERATOR
// ══════════════════════════════════════════════════════════════════════════════

const ISSUE_REPO = 'https://github.com/anthropics/photon';

/**
 * Generate a pre-filled GitHub issue URL for a failed test
 */
function generateIssueUrl(result: TestResult, workingDir: string): string {
  const title = encodeURIComponent(
    `[Test Failure] ${result.photon}.${result.test} (${result.mode} mode)`
  );

  const body = encodeURIComponent(`## Test Failure Report

**Photon:** \`${result.photon}\`
**Test:** \`${result.test}\`
**Mode:** ${result.mode}
**Duration:** ${result.duration}ms

### Error
\`\`\`
${result.error || 'No error message'}
\`\`\`

### Environment
- Working Directory: \`${workingDir}\`
- Node Version: \`${process.version}\`
- Platform: \`${process.platform}\`

### Steps to Reproduce
\`\`\`bash
photon test ${result.photon} ${result.test} --mode ${result.mode}
\`\`\`

### Additional Context
<!-- Add any additional context about the problem here -->
`);

  return `${ISSUE_REPO}/issues/new?title=${title}&body=${body}&labels=bug,test-failure`;
}

// ══════════════════════════════════════════════════════════════════════════════
// DIRECT TEST EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Extract test methods from a photon instance
 * Excludes testBeforeAll and testAfterAll (lifecycle hooks)
 */
function getTestMethods(instance: any): string[] {
  const methods: string[] = [];
  const proto = Object.getPrototypeOf(instance);

  for (const name of Object.getOwnPropertyNames(proto)) {
    if (
      name.startsWith('test') &&
      typeof instance[name] === 'function' &&
      name !== 'constructor' &&
      name !== 'testBeforeAll' &&
      name !== 'testAfterAll'
    ) {
      methods.push(name);
    }
  }

  return methods.sort();
}

/**
 * Check if photon has lifecycle hooks
 */
function hasLifecycleHook(instance: any, hookName: string): boolean {
  return typeof instance[hookName] === 'function';
}

/**
 * Run a single test method directly
 */
async function runDirectTest(
  instance: any,
  photonName: string,
  testName: string,
  workingDir: string
): Promise<TestResult> {
  const start = Date.now();

  try {
    const result = await instance[testName]();
    const duration = Date.now() - start;

    // Check result format
    if (result && typeof result === 'object') {
      // Handle skipped tests
      if (result.skipped === true) {
        return {
          photon: photonName,
          test: testName,
          passed: true,
          skipped: true,
          duration,
          message: result.reason || 'Skipped',
          mode: 'direct',
        };
      }

      if (result.passed === false) {
        const failResult: TestResult = {
          photon: photonName,
          test: testName,
          passed: false,
          duration,
          error: result.error || result.message || 'Test returned passed: false',
          mode: 'direct',
        };
        failResult.issueUrl = generateIssueUrl(failResult, workingDir);
        return failResult;
      }
      return {
        photon: photonName,
        test: testName,
        passed: true,
        duration,
        message: result.message,
        mode: 'direct',
      };
    }

    // If no explicit result, consider it passed
    return {
      photon: photonName,
      test: testName,
      passed: true,
      duration,
      mode: 'direct',
    };
  } catch (error: any) {
    const duration = Date.now() - start;
    const failResult: TestResult = {
      photon: photonName,
      test: testName,
      passed: false,
      duration,
      error: error.message || String(error),
      mode: 'direct',
    };
    failResult.issueUrl = generateIssueUrl(failResult, workingDir);
    return failResult;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLI INTERFACE TEST EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get public methods with their schemas for interface testing
 */
async function getPublicMethods(photonPath: string): Promise<MethodSchema[]> {
  try {
    const extractor = new SchemaExtractor();
    const schemas = await extractor.extractFromFile(photonPath);

    return schemas.map((schema: any) => ({
      name: schema.name,
      params: schema.inputSchema?.properties
        ? Object.entries(schema.inputSchema.properties).map(([name, prop]: [string, any]) => ({
            name,
            type: prop.type || 'string',
            required: schema.inputSchema?.required?.includes(name) || false,
            example: prop.examples?.[0],
          }))
        : [],
    }));
  } catch {
    return [];
  }
}

/**
 * Build example params for a method from its schema
 */
function buildExampleParams(method: MethodSchema): Record<string, any> {
  const params: Record<string, any> = {};

  for (const param of method.params) {
    if (param.example !== undefined) {
      params[param.name] = param.example;
    } else if (param.required) {
      // Generate default values based on type
      switch (param.type) {
        case 'string':
          params[param.name] = 'test';
          break;
        case 'number':
        case 'integer':
          params[param.name] = 1;
          break;
        case 'boolean':
          params[param.name] = true;
          break;
        case 'array':
          params[param.name] = [];
          break;
        case 'object':
          params[param.name] = {};
          break;
      }
    }
  }

  return params;
}

/**
 * Run a method via CLI subprocess
 */
async function runCliTest(
  photonName: string,
  methodName: string,
  params: Record<string, any>,
  workingDir: string
): Promise<TestResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    // Build CLI arguments (use 'cli' command - the implicit run mode)
    const args = ['cli', photonName, methodName, '--json'];

    // Add params as CLI flags
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'object') {
        args.push(`--${key}`, JSON.stringify(value));
      } else {
        args.push(`--${key}`, String(value));
      }
    }

    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000, // 30 second timeout
      env: { ...process.env, PHOTON_DIR: workingDir },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const duration = Date.now() - start;

      // Interface tests verify the transport layer works, not business logic.
      // A method that returns an error still proves the CLI interface works.
      // Check if we got any output (stdout or stderr) - indicates the CLI ran
      const hasOutput = stdout.trim() || stderr.trim();

      // Check for specific CLI infrastructure errors (not method errors)
      const isInfraError =
        stderr.includes('Photon not found') ||
        stderr.includes('command not found') ||
        stderr.includes('Cannot find module') ||
        stderr.includes('ENOENT');

      if (hasOutput && !isInfraError) {
        // Got a response - interface test passes
        // Note: method may have returned an error, but CLI transport worked
        resolve({
          photon: photonName,
          test: `cli:${methodName}`,
          passed: true,
          duration,
          mode: 'cli',
        });
      } else {
        // CLI infrastructure failed
        const failResult: TestResult = {
          photon: photonName,
          test: `cli:${methodName}`,
          passed: false,
          duration,
          error: stderr || `CLI exited with code ${code} (no output)`,
          mode: 'cli',
        };
        failResult.issueUrl = generateIssueUrl(failResult, workingDir);
        resolve(failResult);
      }
    });

    proc.on('error', (err) => {
      const duration = Date.now() - start;
      const failResult: TestResult = {
        photon: photonName,
        test: `cli:${methodName}`,
        passed: false,
        duration,
        error: `Failed to spawn CLI: ${err.message}`,
        mode: 'cli',
      };
      failResult.issueUrl = generateIssueUrl(failResult, workingDir);
      resolve(failResult);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MCP INTERFACE TEST EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Run a method via MCP protocol
 * This starts a temporary MCP server and calls the method through it
 */
async function runMcpTest(
  photonPath: string,
  photonName: string,
  methodName: string,
  params: Record<string, any>,
  workingDir: string
): Promise<TestResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    // Start MCP server for this photon
    const args = ['mcp', photonName];

    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PHOTON_DIR: workingDir },
    });

    let initialized = false;
    let responseReceived = false;
    const requestId = 1;

    // Send initialize request
    const initRequest = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'photon-test', version: '1.0.0' },
      },
    };

    proc.stdin?.write(JSON.stringify(initRequest) + '\n');

    proc.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const response = JSON.parse(line);

          if (response.id === 0 && !initialized) {
            // Initialize response received, send tool call
            initialized = true;

            const toolRequest = {
              jsonrpc: '2.0',
              id: requestId,
              method: 'tools/call',
              params: {
                name: methodName,
                arguments: params,
              },
            };

            proc.stdin?.write(JSON.stringify(toolRequest) + '\n');
          } else if (response.id === requestId && !responseReceived) {
            responseReceived = true;
            const duration = Date.now() - start;

            proc.kill();

            // Interface tests verify the transport layer works, not business logic.
            // A response (even an error response) proves the MCP protocol works.
            // Only MCP-level errors (not method errors) should fail the test.
            if (response.error && response.error.code && response.error.code < -32000) {
              // JSON-RPC protocol error (not a method error)
              const failResult: TestResult = {
                photon: photonName,
                test: `mcp:${methodName}`,
                passed: false,
                duration,
                error: response.error.message || JSON.stringify(response.error),
                mode: 'mcp',
              };
              failResult.issueUrl = generateIssueUrl(failResult, workingDir);
              resolve(failResult);
            } else {
              // Got a valid MCP response - interface test passes
              // Note: method may have returned an error, but MCP transport worked
              resolve({
                photon: photonName,
                test: `mcp:${methodName}`,
                passed: true,
                duration,
                mode: 'mcp',
              });
            }
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!responseReceived) {
        proc.kill();
        const duration = Date.now() - start;
        const failResult: TestResult = {
          photon: photonName,
          test: `mcp:${methodName}`,
          passed: false,
          duration,
          error: 'MCP request timed out after 30 seconds',
          mode: 'mcp',
        };
        failResult.issueUrl = generateIssueUrl(failResult, workingDir);
        resolve(failResult);
      }
    }, 30000);

    proc.on('error', (err) => {
      const duration = Date.now() - start;
      const failResult: TestResult = {
        photon: photonName,
        test: `mcp:${methodName}`,
        passed: false,
        duration,
        error: `Failed to start MCP server: ${err.message}`,
        mode: 'mcp',
      };
      failResult.issueUrl = generateIssueUrl(failResult, workingDir);
      resolve(failResult);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST ORCHESTRATION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Run tests for a single photon
 */
async function runPhotonTests(
  photonPath: string,
  photonName: string,
  workingDir: string,
  mode: TestMode,
  specificTest?: string
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const loader = new PhotonLoader(false);

  try {
    const photon = await loader.loadFile(photonPath);
    const instance = photon.instance;

    if (!instance) {
      return [
        {
          photon: photonName,
          test: '*',
          passed: false,
          duration: 0,
          error: 'Failed to load photon instance',
          mode: 'direct',
        },
      ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXTERNAL .test.ts FILE (preferred — runs first)
    // ─────────────────────────────────────────────────────────────────────────

    if (mode === 'direct' || mode === 'all') {
      const testFilePath = resolveTestFilePath(photonPath);
      if (testFilePath) {
        const externalResults = await runExternalTests(
          testFilePath,
          photonPath,
          photonName,
          workingDir,
          specificTest
        );
        results.push(...externalResults);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INLINE test* METHODS (legacy — backward compatible)
    // ─────────────────────────────────────────────────────────────────────────

    if (mode === 'direct' || mode === 'all') {
      const testMethods = getTestMethods(instance);

      if (testMethods.length > 0) {
        // Filter to specific test if requested
        const testsToRun = specificTest
          ? testMethods.filter((t) => t === specificTest || t === `test${specificTest}`)
          : testMethods;

        if (specificTest && testsToRun.length === 0 && mode === 'direct') {
          return [
            {
              photon: photonName,
              test: specificTest,
              passed: false,
              duration: 0,
              error: `Test not found: ${specificTest}`,
              mode: 'direct',
            },
          ];
        }

        // Run testBeforeAll if it exists
        if (hasLifecycleHook(instance, 'testBeforeAll')) {
          try {
            await instance.testBeforeAll();
          } catch (error: any) {
            return [
              {
                photon: photonName,
                test: 'beforeAll',
                passed: false,
                duration: 0,
                error: `Setup failed: ${error.message}`,
                mode: 'direct',
              },
            ];
          }
        }

        // Run direct tests
        for (const testName of testsToRun) {
          const result = await runDirectTest(instance, photonName, testName, workingDir);
          results.push(result);
        }

        // Run testAfterAll if it exists
        if (hasLifecycleHook(instance, 'testAfterAll')) {
          try {
            await instance.testAfterAll();
          } catch (error: any) {
            results.push({
              photon: photonName,
              test: 'afterAll',
              passed: false,
              duration: 0,
              error: `Teardown failed: ${error.message}`,
              mode: 'direct',
            });
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLI INTERFACE TESTS
    // ─────────────────────────────────────────────────────────────────────────

    if (mode === 'cli' || mode === 'all') {
      const methods = await getPublicMethods(photonPath);

      for (const method of methods) {
        // Skip test methods and lifecycle hooks in interface tests
        if (method.name.startsWith('test') || method.name.startsWith('on')) {
          continue;
        }

        // Skip if specific test requested and doesn't match
        if (specificTest && !`cli:${method.name}`.includes(specificTest)) {
          continue;
        }

        const params = buildExampleParams(method);
        const result = await runCliTest(photonName, method.name, params, workingDir);
        results.push(result);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MCP INTERFACE TESTS
    // ─────────────────────────────────────────────────────────────────────────

    if (mode === 'mcp' || mode === 'all') {
      const methods = await getPublicMethods(photonPath);

      for (const method of methods) {
        // Skip test methods and lifecycle hooks in interface tests
        if (method.name.startsWith('test') || method.name.startsWith('on')) {
          continue;
        }

        // Skip if specific test requested and doesn't match
        if (specificTest && !`mcp:${method.name}`.includes(specificTest)) {
          continue;
        }

        const params = buildExampleParams(method);
        const result = await runMcpTest(photonPath, photonName, method.name, params, workingDir);
        results.push(result);
      }
    }

    return results;
  } catch (error: any) {
    return [
      {
        photon: photonName,
        test: '*',
        passed: false,
        duration: 0,
        error: `Failed to load photon: ${error.message}`,
        mode: 'direct',
      },
    ];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// OUTPUT FORMATTING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Print a single test result
 */
function printTestResult(result: TestResult): void {
  let icon: string;
  if (result.skipped) {
    icon = chalk.yellow('○');
  } else if (result.passed) {
    icon = chalk.green('✓');
  } else {
    icon = chalk.red('✗');
  }

  // Format test name based on mode
  let displayName: string;
  if (result.test.startsWith('cli:') || result.test.startsWith('mcp:')) {
    displayName = result.test;
  } else {
    // Strip 'test' prefix and lowercase first char for direct tests
    const stripped = result.test.replace(/^test/, '');
    displayName = stripped.charAt(0).toLowerCase() + stripped.slice(1);
  }

  const modeTag = chalk.gray(`[${result.mode}]`);
  const name = chalk.gray(`${result.photon}.`) + displayName;
  const time = chalk.gray(`${result.duration}ms`);

  if (result.skipped) {
    console.log(`  ${icon} ${modeTag} ${name} ${chalk.yellow('skipped')} ${time}`);
    if (result.message) {
      console.log(chalk.yellow(`      ${result.message}`));
    }
  } else {
    console.log(`  ${icon} ${modeTag} ${name} ${time}`);
    if (!result.passed && result.error) {
      console.log(chalk.red(`      ${result.error}`));
      if (result.issueUrl) {
        console.log(chalk.gray(`      File issue: ${result.issueUrl.substring(0, 80)}...`));
      }
    }
  }
}

/**
 * Print test summary
 */
function printSummary(summary: TestSummary): void {
  console.log('');
  console.log(chalk.bold('─'.repeat(60)));
  console.log('');

  const skippedInfo = summary.skipped > 0 ? chalk.yellow(` (${summary.skipped} skipped)`) : '';
  const modeInfo = chalk.gray(` [mode: ${summary.mode}]`);

  if (summary.failed === 0) {
    console.log(
      chalk.green.bold(`✓ All ${summary.passed} tests passed`) +
        skippedInfo +
        chalk.gray(` (${summary.duration}ms)`) +
        modeInfo
    );
  } else {
    console.log(
      chalk.red.bold(`✗ ${summary.failed} of ${summary.total} tests failed`) +
        skippedInfo +
        chalk.gray(` (${summary.duration}ms)`) +
        modeInfo
    );

    // List failed tests
    console.log('');
    console.log(chalk.red('Failed tests:'));
    for (const result of summary.results.filter((r) => !r.passed && !r.skipped)) {
      console.log(chalk.red(`  • [${result.mode}] ${result.photon}.${result.test}`));
      if (result.error) {
        console.log(chalk.gray(`    ${result.error}`));
      }
    }

    // Show issue filing hint
    const interfaceFailures = summary.results.filter(
      (r) => !r.passed && !r.skipped && (r.mode === 'cli' || r.mode === 'mcp')
    );
    if (interfaceFailures.length > 0) {
      console.log('');
      console.log(chalk.yellow('Tip: Interface test failures may indicate MCP protocol issues.'));
      console.log(chalk.yellow('     Run with --json to get issue URLs for bug reports.'));
    }
  }

  console.log('');
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * List all tests for a photon (external + inline).
 * Used by Beam UI to discover available tests.
 */
export async function listTests(
  photonPath: string,
  instance?: any
): Promise<Array<{ name: string; source: 'external' | 'inline'; skip?: string | boolean }>> {
  const tests: Array<{ name: string; source: 'external' | 'inline'; skip?: string | boolean }> = [];

  // External .test.ts tests
  const testFilePath = resolveTestFilePath(photonPath);
  if (testFilePath) {
    const discovered = await discoverExternalTests(testFilePath);
    if (discovered) {
      for (const t of discovered.tests) {
        if (t.steps) {
          // Sequence: list each step
          for (const step of t.steps) {
            tests.push({ name: `${t.name}/${step.name}`, source: 'external', skip: t.skip });
          }
        } else {
          tests.push({ name: t.name, source: 'external', skip: t.skip });
        }
      }
    }
  }

  // Inline test* methods
  if (instance) {
    const inlineMethods = getTestMethods(instance);
    for (const name of inlineMethods) {
      tests.push({ name, source: 'inline' });
    }
  }

  return tests;
}

/**
 * Main test runner
 */
export async function runTests(
  workingDir: string,
  photonName?: string,
  testName?: string,
  options: { json?: boolean; mode?: TestMode } = {}
): Promise<TestSummary> {
  const startTime = Date.now();
  const results: TestResult[] = [];
  const mode = options.mode || 'direct';

  if (!options.json) {
    console.log('');
    console.log(chalk.bold('⚡ Photon Test Runner'));
    console.log(chalk.gray(`   ${workingDir}`));
    console.log(chalk.gray(`   Mode: ${mode}`));
    console.log('');
  }

  if (photonName) {
    // Run tests for specific photon
    const photonPath = await resolvePhotonPath(photonName, workingDir);

    if (!photonPath) {
      logger.error(`Photon not found: ${photonName}`);
      process.exit(1);
    }

    if (!options.json) {
      console.log(chalk.bold(photonName));
    }

    const photonResults = await runPhotonTests(photonPath, photonName, workingDir, mode, testName);
    results.push(...photonResults);

    // Print progress for each result
    if (!options.json) {
      for (const result of photonResults) {
        printTestResult(result);
      }
    }
  } else {
    // Run tests for all photons
    const photons = await listPhotonMCPs(workingDir);

    if (photons.length === 0) {
      if (!options.json) {
        console.log(chalk.yellow('No photons found in working directory'));
      }
      return {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        results: [],
        mode,
      };
    }

    for (const photon of photons) {
      const photonPath = path.join(workingDir, `${photon}.photon.ts`);

      if (!existsSync(photonPath)) {
        continue;
      }

      // Check if photon has any tests (external .test.ts or inline test* methods)
      if (mode === 'direct') {
        const hasExternalTests = resolveTestFilePath(photonPath) !== null;

        if (!hasExternalTests) {
          const loader = new PhotonLoader(false);
          try {
            const loaded = await loader.loadFile(photonPath);
            const testMethods = getTestMethods(loaded.instance);

            if (testMethods.length === 0) {
              continue; // Skip photons with no tests in direct mode
            }
          } catch {
            continue;
          }
        }
      }

      if (!options.json) {
        console.log(chalk.bold(photon));
      }

      const photonResults = await runPhotonTests(photonPath, photon, workingDir, mode);
      results.push(...photonResults);

      // Print progress for each result
      if (!options.json) {
        for (const result of photonResults) {
          printTestResult(result);
        }
        if (photonResults.length > 0) {
          console.log('');
        }
      }
    }
  }

  const duration = Date.now() - startTime;
  const skipped = results.filter((r) => r.skipped).length;
  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const failed = results.filter((r) => !r.passed).length;

  const summary: TestSummary = {
    total: results.length,
    passed,
    failed,
    skipped,
    duration,
    results,
    mode,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }

  return summary;
}
