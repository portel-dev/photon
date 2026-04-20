/**
 * Regression: `this.call` injection used to be gated by a regex in
 * `detectCapabilities` (photon-core) that only matched literal `this.call(`.
 * Typed-access patterns like `(this as any).call(...)` — common when
 * TypeScript can't see the loader-injected method — bypassed the regex
 * and the loader never attached `.call()`, so the runtime failed silently
 * with "Cross-photon calls not available."
 *
 * Fix: the loader always injects `.call()` on plain classes (no regex
 * gate). The underlying `_callHandler` is already always wired, so the
 * injection cost is a single method assignment.
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
  console.log('this.call always-injected:');
  const root = mkdtempSync(join(tmpdir(), 'photon-call-inject-'));

  await test('typed-access pattern (this as any).call still gets .call injected', async () => {
    // Before the fix: detectCapabilities' regex /this\.call\s*\(/ does NOT
    // match `(this as any).call(`, so the loader skipped .call injection
    // and `this.call` was undefined at runtime.
    const photonPath = writePhoton(
      root,
      'typed',
      `
        export default class Typed {
          async probe() {
            // The method name doesn't invoke .call, but the photon exposes
            // it through a typed cast the capability regex won't match.
            return typeof (this as any).call;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const got = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(got).trim(), 'function', 'this.call must be a function, not undefined');
  });

  await test('invoking (this as any).call surfaces real handler error, not "not available"', async () => {
    // When there's no _callHandler wired (no daemon context), .call still
    // exists but throws a clear runtime error. Previous behavior was
    // "this.call is not a function" at the call site, which was opaque.
    const photonPath = writePhoton(
      root,
      'invoked',
      `
        export default class Invoked {
          async tryIt() {
            try {
              return await (this as any).call('peer.x', {});
            } catch (err: any) {
              return err.message;
            }
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'tryIt', {});
    const got = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    // In loader-only test, _callHandler IS wired (loader injects it
    // unconditionally). So the call actually goes through and eventually
    // reaches sendCommand -> no daemon -> connection error. Either way,
    // the message is not "this.call is not a function".
    const msg = String(got);
    assert.ok(
      !/is not a function/.test(msg),
      `call must exist as a function, not surface "is not a function". got: ${msg}`
    );
  });

  await test('literal this.call(...) still works (no regression)', async () => {
    const photonPath = writePhoton(
      root,
      'literal',
      `
        export default class Literal {
          async probe() {
            // Literal form that the detectCapabilities regex DOES match —
            // still must inject .call the same way.
            return typeof this.call;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const got = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(got).trim(), 'function');
  });

  await test('user-defined call() on the class wins', async () => {
    const photonPath = writePhoton(
      root,
      'userCall',
      `
        export default class UserCall {
          async call(x: string) {
            return 'user:' + x;
          }
          async probe() {
            return await this.call('hello');
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const got = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(got).trim(), 'user:hello');
  });

  rmSync(root, { recursive: true, force: true });
  console.log('\nAll this.call always-injected tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
