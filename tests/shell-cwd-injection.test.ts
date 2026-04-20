/**
 * Regression test for the runtime-injected `this.shell` helper.
 *
 * Named bug (Apr 20): `this.shell('photon cli lookout ...')` from inside
 * kith-sync returned empty stdout because the child inherited the daemon
 * process's cwd, not the photon's own folder. The resolution context the
 * child CLI saw didn't match what the user expected when running the same
 * command from the photon's directory.
 *
 * Fix: the loader injects `this.shell(cmd, timeoutMs?)` on every photon
 * instance with `cwd` pinned to `dirname(photonFilePath)`. User-defined
 * `shell()` on the photon class is preserved (no clobber).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotonLoader } from '../dist/loader.js';

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

function writePhoton(dir: string, name: string, source: string): string {
  const filePath = join(dir, `${name}.photon.ts`);
  writeFileSync(filePath, source, 'utf-8');
  return filePath;
}

async function main() {
  console.log('this.shell injection:');

  const root = mkdtempSync(join(tmpdir(), 'photon-shell-'));

  await test('cwd defaults to the photon folder', async () => {
    const photonPath = writePhoton(
      root,
      'echo-cwd',
      `
        export default class EchoCwd {
          where(): string {
            return (this as any).shell('pwd').trim();
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'where', {});
    // macOS resolves /tmp → /private/tmp via symlink; accept either.
    const got = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    const gotTrim = String(got).trim();
    assert.ok(
      gotTrim === root || gotTrim === `/private${root}` || gotTrim.endsWith(root),
      `shell cwd should be the photon folder, got: ${gotTrim}`
    );
  });

  await test('user-defined shell() on the class wins', async () => {
    const photonPath = writePhoton(
      root,
      'overrides',
      `
        export default class Overrides {
          shell(cmd: string): string {
            return 'overridden:' + cmd;
          }
          call(): string {
            return (this as any).shell('anything');
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'call', {});
    const got = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(got).trim(), 'overridden:anything');
  });

  await test('non-zero exit returns partial stdout without throwing', async () => {
    const photonPath = writePhoton(
      root,
      'partial',
      `
        export default class Partial {
          tryIt(): string {
            // Prints "hello" then exits 1. execSync throws, the injected
            // shell swallows + returns stdout.
            return (this as any).shell('printf "hello\\n"; exit 1');
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'tryIt', {});
    const got = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.match(String(got), /hello/);
  });

  await test('unknown command returns empty string, does not throw', async () => {
    const photonPath = writePhoton(
      root,
      'bogus',
      `
        export default class Bogus {
          run(): string {
            return (this as any).shell('nonexistent-binary-zzz');
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'run', {});
    const got = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(got).trim(), '', 'failed command returns empty stdout');
  });

  rmSync(root, { recursive: true, force: true });
  console.log('\nAll this.shell injection tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
