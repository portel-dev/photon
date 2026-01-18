/**
 * Photon Test Runner
 *
 * Discovers and runs test* methods in photons
 * Supports multiple test modes:
 * - direct: Call methods directly on instance (unit tests)
 * - cli: Call methods via CLI subprocess (integration tests)
 * - mcp: Call methods via MCP protocol (integration tests)
 *
 * Usage: photon test [photon] [testName] [--mode direct|cli|all]
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { PhotonLoader } from './loader.js';
import { listPhotonMCPs, resolvePhotonPath } from './path-resolver.js';
import { logger } from './shared/logger.js';
import { SchemaExtractor } from '@portel/photon-core';
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
    const args = ['cli', photonName, methodName, '--json', '--dir', workingDir];

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
    const args = ['mcp', photonName, '--dir', workingDir];

    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
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
    // DIRECT TESTS (test* methods)
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

      // Check if photon has any test methods before printing header (for direct mode)
      if (mode === 'direct') {
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

/**
 * Check if a photon has test methods (for UI display)
 */
export async function hasTests(photonPath: string): Promise<boolean> {
  const loader = new PhotonLoader(false);
  try {
    const photon = await loader.loadFile(photonPath);
    const testMethods = getTestMethods(photon.instance);
    return testMethods.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get list of test methods for a photon (for UI display)
 */
export async function getTests(photonPath: string): Promise<string[]> {
  const loader = new PhotonLoader(false);
  try {
    const photon = await loader.loadFile(photonPath);
    return getTestMethods(photon.instance);
  } catch {
    return [];
  }
}

/**
 * Get public methods for interface testing (for UI display)
 */
export async function getInterfaceTests(photonPath: string): Promise<string[]> {
  const methods = await getPublicMethods(photonPath);
  return methods
    .filter((m) => !m.name.startsWith('test') && !m.name.startsWith('on'))
    .map((m) => m.name);
}
