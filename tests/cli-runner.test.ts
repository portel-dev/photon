#!/usr/bin/env tsx
/**
 * CLI Runner Tests
 * Tests for photon CLI interface functionality
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Helper to run CLI commands
function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const cliPath = path.join(process.cwd(), 'dist', 'cli.js');
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: '0' }, // Disable colors for easier testing
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

// Test photon file
const testPhotonContent = `/**
 * Test Calculator - Simple calculator for CLI testing
 */
export default class TestCalculator {
  /**
   * Add two numbers
   * @param a First number
   * @param b Second number
   * @format primitive
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }

  /**
   * Get calculator info
   * @format table
   */
  async info() {
    return {
      name: 'Test Calculator',
      version: '1.0.0',
      operations: 3
    };
  }

  /**
   * List operations
   * @format list
   */
  async operations() {
    return ['add', 'subtract', 'multiply'];
  }

  /**
   * Get nested data
   * @format tree
   */
  async nested() {
    return {
      calculator: {
        name: 'Test',
        features: {
          basic: ['add', 'subtract'],
          advanced: ['multiply', 'divide']
        }
      }
    };
  }

  /**
   * Adjust value
   * @param value Value to adjust (supports +N and -N for relative adjustments)
   */
  async adjust(params: { value: number | string }) {
    if (typeof params.value === 'string' && (params.value.startsWith('+') || params.value.startsWith('-'))) {
      return { adjusted: true, value: params.value };
    }
    return { adjusted: false, value: params.value };
  }

  /**
   * Return error
   */
  async error() {
    return { success: false, error: 'Test error message' };
  }
}
`;

async function setupTestPhoton(): Promise<string> {
  const photonDir = path.join(os.homedir(), '.photon');
  const photonPath = path.join(photonDir, 'test-cli-calc.photon.ts');

  if (!fs.existsSync(photonDir)) {
    fs.mkdirSync(photonDir, { recursive: true });
  }

  fs.writeFileSync(photonPath, testPhotonContent);
  return photonPath;
}

async function cleanupTestPhoton() {
  const photonPath = path.join(os.homedir(), '.photon', 'test-cli-calc.photon.ts');
  if (fs.existsSync(photonPath)) {
    fs.unlinkSync(photonPath);
  }
}

async function runTests() {
  console.log('🧪 Running CLI Runner Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ ${testName}`);
      passed++;
    } else {
      console.log(`❌ ${testName}`);
      failed++;
    }
  }

  try {
    // Setup test photon
    await setupTestPhoton();

    // Test 1: List methods
    {
      const result = await runCLI(['cli', 'test-cli-calc']);
      assert(
        result.stdout.includes('add') && result.stdout.includes('info') && result.exitCode === 0,
        'List all methods for a photon'
      );
    }

    // Test 2: Call method with positional arguments
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'add', '7', '3']);
      assert(
        result.stdout.includes('10') && result.exitCode === 0,
        'Call method with positional arguments'
      );
    }

    // Test 4: Format detection - primitive
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'add', '2', '3']);
      assert(
        result.stdout.trim() === '5',
        'Format primitive values correctly'
      );
    }

    // Test 5: Format detection - table
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'info']);
      assert(
        result.stdout.includes('┌') && result.stdout.includes('Name') && result.exitCode === 0,
        'Format table with bordered output'
      );
    }

    // Test 6: Format detection - list
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'operations']);
      assert(
        result.stdout.includes('•') && result.stdout.includes('add') && result.exitCode === 0,
        'Format list with bullet points'
      );
    }

    // Test 7: Format detection - tree
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'nested']);
      assert(
        result.stdout.includes('Calculator') && result.stdout.includes('Features') && result.exitCode === 0,
        'Format tree (nested JSON) correctly'
      );
    }

    // Test 8: Relative adjustments - preserve + prefix
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'adjust', '+5']);
      assert(
        result.stdout.includes('+5') && result.stdout.includes('Yes') && result.exitCode === 0,
        'Preserve + prefix for relative adjustments'
      );
    }

    // Test 9: Relative adjustments - preserve - prefix
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'adjust', '-3']);
      assert(
        result.stdout.includes('-3') && result.stdout.includes('Yes') && result.exitCode === 0,
        'Preserve - prefix for relative adjustments'
      );
    }

    // Test 10: --json flag
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'add', '2', '3', '--json']);
      const parsed = JSON.parse(result.stdout);
      assert(
        parsed === 5 && result.exitCode === 0,
        'Output raw JSON with --json flag'
      );
    }

    // Test 11: Error handling - show error message
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'error']);
      assert(
        result.stdout.includes('❌') && result.stdout.includes('Test error message'),
        'Display error messages correctly'
      );
    }

    // Test 12: Error handling - exit code 1
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'error']);
      assert(
        result.exitCode === 1,
        'Return exit code 1 on error'
      );
    }

    // Test 13: Invalid photon name
    {
      const result = await runCLI(['cli', 'nonexistent-photon']);
      const combined = result.stdout + result.stderr;
      assert(
        result.exitCode === 1 && combined.includes('not found'),
        'Handle invalid photon name'
      );
    }

    // Test 14: --help flag for photon
    {
      const result = await runCLI(['cli', 'test-cli-calc', '--help']);
      assert(
        result.stdout.includes('USAGE') && result.stdout.includes('test-cli-calc') && result.exitCode === 0,
        'Show help for photon with --help flag'
      );
    }

    // Test 15: --help flag for method
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'add', '--help']);
      assert(
        result.stdout.includes('Add two numbers') && result.stdout.includes('First number') && result.exitCode === 0,
        'Show help for specific method'
      );
    }

    // Test 16: --help flag for CLI command itself
    {
      const result = await runCLI(['cli', '--help']);
      assert(
        result.stdout.includes('USAGE') && result.stdout.includes('photon cli') && result.exitCode === 0,
        'Show CLI command help'
      );
    }

    // Test 17: Success exit code
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'add', '1', '1']);
      assert(
        result.exitCode === 0,
        'Return exit code 0 on success'
      );
    }

    // Test 18: Type coercion - string to number
    {
      const result = await runCLI(['cli', 'test-cli-calc', 'add', '42', '8']);
      assert(
        result.stdout.includes('50') && result.exitCode === 0,
        'Coerce string arguments to numbers'
      );
    }

  } catch (error: any) {
    console.error('Test setup error:', error.message);
    failed++;
  } finally {
    // Cleanup
    await cleanupTestPhoton();
  }

  console.log(`\n${passed > 0 ? '✅' : '❌'} CLI Runner tests: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
