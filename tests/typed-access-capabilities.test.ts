/**
 * End-to-end regression: plain-class photons that access loader-injected
 * capabilities via typed-access patterns — `(this as any).call(...)`,
 * `(this as any).emit(...)`, etc. — must work the same as literal
 * `this.X(...)`.
 *
 * Guards the combined fix:
 *   - photon-core widens detectCapabilities to match typed-access patterns
 *   - photon loader drops gating for cheap injections (emit/mcp/withLock/
 *     caller/allInstances/call/shell) so even patterns the regex misses
 *     still work at runtime.
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
  console.log('typed-access capabilities end-to-end:');
  const root = mkdtempSync(join(tmpdir(), 'photon-typed-'));

  await test('(this as any).emit — injection fires, method is callable', async () => {
    const photonPath = writePhoton(
      root,
      'typed-emit',
      `
        export default class TypedEmit {
          async probe() {
            const fn = (this as any).emit;
            return typeof fn;
          }
          async fire() {
            (this as any).emit({ type: 'tick', n: 1 });
            return 'ok';
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);

    const probeResult = await loader.executeTool(mcp, 'probe', {});
    const probe =
      typeof probeResult === 'string'
        ? probeResult
        : (probeResult as any)?.content?.[0]?.text || '';
    assert.equal(String(probe).trim(), 'function', 'emit must be a function via typed access');

    const fireResult = await loader.executeTool(mcp, 'fire', {});
    const fire =
      typeof fireResult === 'string' ? fireResult : (fireResult as any)?.content?.[0]?.text || '';
    assert.equal(String(fire).trim(), 'ok', 'fire must return ok — emit must not throw');
  });

  await test('(this as any).render — emit helpers are injected', async () => {
    const photonPath = writePhoton(
      root,
      'typed-render',
      `
        export default class TypedRender {
          async probe() {
            const types = [
              typeof (this as any).render,
              typeof (this as any).toast,
              typeof (this as any).status,
            ].join(',');
            return types;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const text = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(text).trim(), 'function,function,function');
  });

  await test('(this as any).withLock — injected and callable', async () => {
    const photonPath = writePhoton(
      root,
      'typed-lock',
      `
        export default class TypedLock {
          async probe() {
            return typeof (this as any).withLock;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const text = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(text).trim(), 'function');
  });

  await test('(this as any).caller — getter returns default anonymous', async () => {
    const photonPath = writePhoton(
      root,
      'typed-caller',
      `
        export default class TypedCaller {
          async probe() {
            const c = (this as any).caller;
            return c.anonymous + ':' + c.id;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const text = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(text).trim(), 'true:anonymous');
  });

  await test('(this as any).mcp — injected as a function', async () => {
    const photonPath = writePhoton(
      root,
      'typed-mcp',
      `
        export default class TypedMcp {
          async probe() {
            return typeof (this as any).mcp;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const text = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(text).trim(), 'function');
  });

  await test('(this as any).allInstances — injected as an async generator fn', async () => {
    const photonPath = writePhoton(
      root,
      'typed-all',
      `
        export default class TypedAll {
          async probe() {
            return typeof (this as any).allInstances;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const text = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(text).trim(), 'function');
  });

  await test('user-defined methods still win across all capabilities', async () => {
    const photonPath = writePhoton(
      root,
      'overrides-all',
      `
        export default class Overrides {
          emit(_data: any) { return 'user-emit'; }
          mcp(_name: string) { return 'user-mcp'; }
          async probe() {
            const e = (this as any).emit(null);
            const m = (this as any).mcp('x');
            return e + '|' + m;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    const text = typeof result === 'string' ? result : (result as any)?.content?.[0]?.text || '';
    assert.equal(String(text).trim(), 'user-emit|user-mcp');
  });

  rmSync(root, { recursive: true, force: true });
  console.log('\nAll typed-access capability tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
