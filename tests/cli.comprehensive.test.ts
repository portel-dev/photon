#!/usr/bin/env tsx
/**
 * Comprehensive CLI Tests
 * Tests for photon CLI interface functionality including all commands
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const testDir = path.join(os.tmpdir(), `photon-cli-test-${Date.now()}`);

// Helper to run CLI commands
function runCLI(
  args: string[],
  options: { timeout?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const cliPath = path.join(process.cwd(), 'dist', 'cli.js');
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      cwd: options.cwd || process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = options.timeout || 30000;
    const timer = setTimeout(() => {
      child.kill();
      resolve({ stdout, stderr, exitCode: -1 });
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

// Helper to start a long-running CLI process and kill it after check
function startCLI(
  args: string[],
  options: { cwd?: string } = {}
): { process: ChildProcess; getOutput: () => { stdout: string; stderr: string } } {
  const cliPath = path.join(process.cwd(), 'dist', 'cli.js');
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    cwd: options.cwd || process.cwd(),
  });

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  return {
    process: child,
    getOutput: () => ({ stdout, stderr }),
  };
}

async function setup() {
  await fs.promises.mkdir(testDir, { recursive: true });
}

async function cleanup() {
  await fs.promises.rm(testDir, { recursive: true, force: true });
}

async function createTestPhoton(name: string, content: string): Promise<string> {
  const filePath = path.join(testDir, `${name}.photon.ts`);
  await fs.promises.writeFile(filePath, content, 'utf-8');
  return filePath;
}

// Basic photon for testing
const basicPhotonContent = `
export default class TestMCP {
  /**
   * Echo text
   * @param text Text to echo
   */
  async echo(params: { text: string }) {
    return params.text;
  }

  /**
   * Add numbers
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }

  /**
   * Get info
   */
  async info() {
    return { name: 'TestMCP', version: '1.0.0' };
  }
}
`;

async function runTests() {
  console.log('🧪 Running Comprehensive CLI Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`✅ ${testName}`);
      passed++;
    } else {
      console.log(`❌ ${testName}${details ? ` - ${details}` : ''}`);
      failed++;
    }
  }

  await setup();

  try {
    // ═══════════════════════════════════════════════════════════════════
    // VERSION COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('📋 Version Command Tests');

    // Test 1: --version flag
    {
      const result = await runCLI(['--version']);
      assert(
        result.exitCode === 0 && /\d+\.\d+\.\d+/.test(result.stdout),
        'Show version with --version flag'
      );
    }

    // Test 2: -V flag
    {
      const result = await runCLI(['-V']);
      assert(
        result.exitCode === 0 && /\d+\.\d+\.\d+/.test(result.stdout),
        'Show version with -V flag'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // HELP COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Help Command Tests');

    // Test 3: --help flag
    {
      const result = await runCLI(['--help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('photon'),
        'Show help with --help flag'
      );
    }

    // Test 4: -h flag
    {
      const result = await runCLI(['-h']);
      assert(
        result.exitCode === 0 && result.stdout.includes('Usage'),
        'Show help with -h flag'
      );
    }

    // Test 5: help command
    {
      const result = await runCLI(['help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('Commands'),
        'Show help with help command'
      );
    }

    // Test 6: help for specific command
    {
      const result = await runCLI(['help', 'run']);
      const combined = result.stdout + result.stderr;
      // Either shows help or indicates command exists
      assert(
        result.exitCode === 0 || combined.includes('run'),
        'Show help for run command'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // LIST COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 List Command Tests');

    // Test 7: list command
    {
      const result = await runCLI(['list']);
      assert(
        result.exitCode === 0,
        'List command executes successfully'
      );
    }

    // Test 8: ls alias
    {
      const result = await runCLI(['ls']);
      assert(
        result.exitCode === 0,
        'ls alias works'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // CLI COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 CLI Command Tests');

    // Create test photon for CLI tests
    const testPhotonPath = await createTestPhoton('test-mcp', basicPhotonContent);

    // Test 9: cli command with local file
    {
      const result = await runCLI(['cli', testPhotonPath]);
      assert(
        result.exitCode === 0 && (result.stdout.includes('echo') || result.stdout.includes('add')),
        'cli command with local file path'
      );
    }

    // Test 10: cli execute method
    {
      const result = await runCLI(['cli', testPhotonPath, 'add', '5', '3']);
      assert(
        result.exitCode === 0 && result.stdout.includes('8'),
        'cli execute method with args'
      );
    }

    // Test 11: cli --json flag
    {
      const result = await runCLI(['cli', testPhotonPath, 'info', '--json']);
      try {
        const parsed = JSON.parse(result.stdout);
        assert(
          result.exitCode === 0 && parsed.name === 'TestMCP',
          'cli --json outputs valid JSON'
        );
      } catch {
        assert(false, 'cli --json outputs valid JSON', 'JSON parse failed');
      }
    }

    // Test 12: cli with invalid photon
    {
      const result = await runCLI(['cli', 'nonexistent.photon.ts']);
      const combined = result.stdout + result.stderr;
      assert(
        result.exitCode !== 0 && combined.includes('not found'),
        'cli handles invalid photon path'
      );
    }

    // Test 13: cli with invalid method
    {
      const result = await runCLI(['cli', testPhotonPath, 'nonexistent']);
      const combined = result.stdout + result.stderr;
      assert(
        result.exitCode !== 0 || combined.includes('not found') || combined.includes('unknown'),
        'cli handles invalid method'
      );
    }

    // Test 14: cli help for photon
    {
      const result = await runCLI(['cli', testPhotonPath, '--help']);
      assert(
        result.exitCode === 0 && (result.stdout.includes('USAGE') || result.stdout.includes('Commands')),
        'cli --help for photon'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // SERVE COMMAND TESTS (main run command)
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Serve Command Tests (Run)');

    // Test 15: serve --help
    {
      const result = await runCLI(['serve', '--help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('serve'),
        'serve --help shows usage'
      );
    }

    // Test 16: serve with invalid file
    {
      const result = await runCLI(['serve', 'nonexistent-photon'], { timeout: 5000 });
      const combined = result.stdout + result.stderr;
      assert(
        result.exitCode !== 0 || combined.includes('not found') || combined.includes('error'),
        'serve handles invalid photon'
      );
    }

    // Test 17: mcp command --help
    {
      const result = await runCLI(['mcp', '--help']);
      assert(
        result.exitCode === 0 || result.stdout.includes('mcp'),
        'mcp --help shows usage'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // INIT COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Init Command Tests');

    // Test 18: init --help
    {
      const result = await runCLI(['init', '--help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('init'),
        'init --help shows usage'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // INFO COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Info Command Tests');

    // Test 19: info command
    {
      const result = await runCLI(['info', testPhotonPath]);
      assert(
        result.exitCode === 0,
        'info command executes'
      );
    }

    // Test 20: info --help
    {
      const result = await runCLI(['info', '--help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('info'),
        'info --help shows usage'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // MARKETPLACE COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Marketplace Command Tests');

    // Test 21: marketplace --help
    {
      const result = await runCLI(['marketplace', '--help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('marketplace'),
        'marketplace --help shows usage'
      );
    }

    // Test 22: marketplace list
    {
      const result = await runCLI(['marketplace', 'list']);
      assert(
        result.exitCode === 0,
        'marketplace list executes'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADD/REMOVE COMMAND TESTS (Package Management)
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Package Management Tests');

    // Test 23: add --help
    {
      const result = await runCLI(['add', '--help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('add'),
        'add --help shows usage'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // LOGGING OPTIONS TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Logging Options Tests');

    // Test 24: --log-level option (options after command)
    {
      const result = await runCLI(['list', '--log-level', 'debug']);
      assert(
        result.exitCode === 0,
        '--log-level debug option works'
      );
    }

    // Test 25: --json-logs option
    {
      const result = await runCLI(['list', '--json-logs']);
      assert(
        result.exitCode === 0,
        '--json-logs option works'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // ERROR HANDLING TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Error Handling Tests');

    // Test 26: Unknown command
    {
      const result = await runCLI(['unknowncommand']);
      const combined = result.stdout + result.stderr;
      assert(
        result.exitCode !== 0 || combined.includes('unknown') || combined.includes('help'),
        'Handle unknown command gracefully'
      );
    }

    // Test 27: Missing required argument
    {
      const result = await runCLI(['run']);
      const combined = result.stdout + result.stderr;
      // Should either fail or show help
      assert(
        result.exitCode !== 0 || combined.includes('Usage') || combined.includes('help'),
        'Handle missing required argument'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // BEAM COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Beam Command Tests');

    // Test 28: beam --help
    {
      const result = await runCLI(['beam', '--help']);
      assert(
        result.exitCode === 0,
        'beam --help shows usage'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // SERVE COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Serve Command Tests');

    // Test 29: serve --help
    {
      const result = await runCLI(['serve', '--help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('serve'),
        'serve --help shows usage'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // DOCTOR COMMAND TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Doctor Command Tests');

    // Test 30: doctor --help
    {
      const result = await runCLI(['doctor', '--help']);
      assert(
        result.exitCode === 0 && result.stdout.includes('doctor'),
        'doctor --help shows usage'
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Edge Cases');

    // Test 31: Empty arguments starts beam (or shows info)
    {
      // When run with no args, photon starts beam, so we test with a short timeout
      const result = await runCLI([], { timeout: 5000 });
      // Either starts beam (shows port/watching info) or shows help
      const combined = result.stdout + result.stderr;
      assert(
        combined.includes('Beam') ||
        combined.includes('localhost') ||
        combined.includes('Usage') ||
        combined.includes('photon') ||
        combined.includes('Watching') ||
        combined.includes('Port'),
        'Handle empty arguments starts beam or shows help'
      );
    }

    // Test 32: Multiple flags (options after command)
    {
      const result = await runCLI(['list', '--log-level', 'info', '--json-logs']);
      assert(
        result.exitCode === 0,
        'Handle multiple flags'
      );
    }

    // Test 33: Invalid log level defaults gracefully
    {
      const result = await runCLI(['list', '--log-level', 'invalid']);
      // Invalid log level defaults to valid level, command still executes
      assert(
        result.exitCode === 0,
        'Invalid log level defaults gracefully'
      );
    }

    console.log(`\n✅ CLI Comprehensive tests: ${passed} passed, ${failed} failed\n`);
  } finally {
    await cleanup();
  }

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
