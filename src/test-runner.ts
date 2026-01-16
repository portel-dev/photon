/**
 * Photon Test Runner
 *
 * Discovers and runs test* methods in photons
 * Usage: photon test [photon] [testName]
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { PhotonLoader } from './loader.js';
import { listPhotonMCPs, resolvePhotonPath } from './path-resolver.js';
import { logger } from './shared/logger.js';
import chalk from 'chalk';

interface TestResult {
  photon: string;
  test: string;
  passed: boolean;
  skipped?: boolean;
  duration: number;
  error?: string;
  message?: string;
}

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: TestResult[];
}

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
  const proto = Object.getPrototypeOf(instance);
  return typeof instance[hookName] === 'function';
}

/**
 * Run a single test method
 */
async function runTest(
  instance: any,
  photonName: string,
  testName: string
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
        };
      }

      if (result.passed === false) {
        return {
          photon: photonName,
          test: testName,
          passed: false,
          duration,
          error: result.error || result.message || 'Test returned passed: false',
        };
      }
      return {
        photon: photonName,
        test: testName,
        passed: true,
        duration,
        message: result.message,
      };
    }

    // If no explicit result, consider it passed
    return {
      photon: photonName,
      test: testName,
      passed: true,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - start;
    return {
      photon: photonName,
      test: testName,
      passed: false,
      duration,
      error: error.message || String(error),
    };
  }
}

/**
 * Run tests for a single photon
 */
async function runPhotonTests(
  photonPath: string,
  photonName: string,
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
        },
      ];
    }

    const testMethods = getTestMethods(instance);

    if (testMethods.length === 0) {
      return []; // No tests, not an error
    }

    // Filter to specific test if requested
    const testsToRun = specificTest
      ? testMethods.filter((t) => t === specificTest || t === `test${specificTest}`)
      : testMethods;

    if (specificTest && testsToRun.length === 0) {
      return [
        {
          photon: photonName,
          test: specificTest,
          passed: false,
          duration: 0,
          error: `Test not found: ${specificTest}`,
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
          },
        ];
      }
    }

    // Run tests
    for (const testName of testsToRun) {
      const result = await runTest(instance, photonName, testName);
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
        });
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
      },
    ];
  }
}

/**
 * Format test name for display (remove 'test' prefix, add spaces)
 */
function formatTestName(name: string): string {
  // Remove 'test' prefix
  let formatted = name.replace(/^test/, '');
  // Add spaces before capitals
  formatted = formatted.replace(/([A-Z])/g, ' $1').trim();
  return formatted;
}

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

  // Strip 'test' prefix and lowercase first char
  const stripped = result.test.replace(/^test/, '');
  const displayName = stripped.charAt(0).toLowerCase() + stripped.slice(1);
  const name = chalk.gray(`${result.photon}.`) + displayName;
  const time = chalk.gray(`${result.duration}ms`);

  if (result.skipped) {
    console.log(`  ${icon} ${name} ${chalk.yellow('skipped')} ${time}`);
    if (result.message) {
      console.log(chalk.yellow(`    ${result.message}`));
    }
  } else {
    console.log(`  ${icon} ${name} ${time}`);
    if (!result.passed && result.error) {
      console.log(chalk.red(`    ${result.error}`));
    }
  }
}

/**
 * Print test summary
 */
function printSummary(summary: TestSummary): void {
  console.log('');
  console.log(chalk.bold('─'.repeat(50)));
  console.log('');

  const skippedInfo = summary.skipped > 0 ? chalk.yellow(` (${summary.skipped} skipped)`) : '';

  if (summary.failed === 0) {
    console.log(
      chalk.green.bold(`✓ All ${summary.passed} tests passed`) +
        skippedInfo +
        chalk.gray(` (${summary.duration}ms)`)
    );
  } else {
    console.log(
      chalk.red.bold(`✗ ${summary.failed} of ${summary.total} tests failed`) +
        skippedInfo +
        chalk.gray(` (${summary.duration}ms)`)
    );

    // List failed tests
    console.log('');
    console.log(chalk.red('Failed tests:'));
    for (const result of summary.results.filter((r) => !r.passed && !r.skipped)) {
      console.log(chalk.red(`  • ${result.photon}.${result.test}`));
      if (result.error) {
        console.log(chalk.gray(`    ${result.error}`));
      }
    }
  }

  console.log('');
}

/**
 * Main test runner
 */
export async function runTests(
  workingDir: string,
  photonName?: string,
  testName?: string,
  options: { json?: boolean } = {}
): Promise<TestSummary> {
  const startTime = Date.now();
  const results: TestResult[] = [];

  if (!options.json) {
    console.log('');
    console.log(chalk.bold('⚡ Photon Test Runner'));
    console.log(chalk.gray(`   ${workingDir}`));
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

    const photonResults = await runPhotonTests(photonPath, photonName, testName);
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
        duration: 0,
        results: [],
      };
    }

    for (const photon of photons) {
      const photonPath = path.join(workingDir, `${photon}.photon.ts`);

      if (!existsSync(photonPath)) {
        continue;
      }

      // Check if photon has any test methods before printing header
      const loader = new PhotonLoader(false);
      try {
        const loaded = await loader.loadFile(photonPath);
        const testMethods = getTestMethods(loaded.instance);

        if (testMethods.length === 0) {
          continue; // Skip photons with no tests
        }

        if (!options.json) {
          console.log(chalk.bold(photon));
        }

        const photonResults = await runPhotonTests(photonPath, photon);
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
      } catch {
        // Skip photons that fail to load
        continue;
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
