/**
 * Shell Integration Tests
 *
 * Verifies that `photon init cli --hook` generates safe shell functions
 * that don't override existing system commands.
 *
 * Prevents: v1.21.0 bug where claude.photon.ts created a shell function
 * that overrode the real `claude` CLI binary.
 */

import { execSync } from 'child_process';
import { strict as assert } from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '..', 'dist', 'cli.js');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

async function runTests() {
  console.log('🧪 Shell integration tests\n');

  const hookScript = execSync(`node ${CLI_PATH} init cli --hook`, {
    encoding: 'utf-8',
    env: { ...process.env },
    timeout: 15000,
  });

  // Extract all function definitions from the hook script
  // Pattern: `command -v NAME >/dev/null 2>&1 || NAME() { photon cli NAME "$@"; }`
  const functionDefs = [...hookScript.matchAll(/command -v (\S+) >\/dev\/null/g)].map((m) => m[1]);
  const INTERNAL_FUNCTIONS = new Set([
    'command_not_found_handler',
    'command_not_found_handle',
    '_photon_complete_direct',
    '_photon',
    '_photon_complete',
  ]);
  const unguardedFunctions = [...hookScript.matchAll(/^(\w[\w-]*)(?=\(\)\s*\{)/gm)]
    .map((m) => m[1])
    .filter((name) => !INTERNAL_FUNCTIONS.has(name))
    .filter((name) => !name.startsWith('_'))
    .filter((name) => !hookScript.includes(`command -v ${name}`));

  test('Hook script generates function definitions', () => {
    assert.ok(functionDefs.length > 0, `Expected function defs, got ${functionDefs.length}`);
  });

  test('All functions have command -v guard', () => {
    assert.equal(
      unguardedFunctions.length,
      0,
      `Unguarded functions found: ${unguardedFunctions.join(', ')}`
    );
  });

  // Check specific known system commands that photons might shadow
  const systemCommands = ['node', 'git', 'ls', 'cat', 'npm', 'bun', 'curl', 'python', 'ruby'];
  for (const cmd of systemCommands) {
    test(`Does not override system command: ${cmd}`, () => {
      // Even if a photon named this exists, the guard should prevent override
      const pattern = `command -v ${cmd} >/dev/null 2>&1 || ${cmd}()`;
      if (hookScript.includes(`${cmd}()`)) {
        assert.ok(hookScript.includes(pattern), `${cmd}() exists without guard`);
      }
    });
  }

  test('command_not_found_handler is defined for fallback', () => {
    assert.ok(
      hookScript.includes('command_not_found_handler') ||
        hookScript.includes('command_not_found_handle'),
      'Expected command_not_found handler'
    );
  });

  test('Completion functions are registered', () => {
    assert.ok(
      hookScript.includes('compdef') || hookScript.includes('complete -F'),
      'Expected completion registration'
    );
  });

  test('Installed shell hook uses absolute launcher path', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-shell-'));
    try {
      execSync(`node ${CLI_PATH} init cli`, {
        encoding: 'utf-8',
        env: { ...process.env, HOME: tempHome, SHELL: '/bin/zsh' },
        timeout: 15000,
      });

      const zshrc = fs.readFileSync(path.join(tempHome, '.zshrc'), 'utf-8');
      assert.ok(zshrc.includes('# photon shell integration'), 'Expected shell marker');
      assert.match(zshrc, /eval "\$\('\/.+\/bin\/photon' init cli --hook\)"/);
      assert.ok(!zshrc.includes('eval "$(photon init cli --hook)"'), 'Expected no PATH lookup');
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
