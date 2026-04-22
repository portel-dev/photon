/**
 * Regression: `this.memory` injection used to be gated by a regex in
 * `detectCapabilities` (photon-core) that matched a narrow set of
 * `(this as X).memory` shapes. When `X` was a complex type annotation
 * containing function-type parens — the pattern TypeScript forces on you
 * when `memory` isn't declared on the class — the regex terminated at
 * the first inner `)` and the trailing `.memory` never matched. Result:
 * `this.memory` stayed undefined on plain-class photons using that shape,
 * and every `.memory.set(...)` call threw at runtime. The bug only
 * surfaced after a daemon cold start, because long-lived daemons kept
 * the old injected MemoryProvider alive in RAM.
 *
 * Fix: the loader always injects `this.memory` on plain classes (no cap
 * gate). The cost is a single lazy getter closure — constructs
 * MemoryProvider only on first access. The value of the regex-based
 * detection was log-only, and log misses don't cause data loss.
 *
 * This suite exercises the full contract that production cared about:
 * write → rehydrate on a fresh loader → read back. A loader-only test
 * is a close stand-in for "kill daemon, restart, read" — both drop the
 * cached MemoryProvider instance and force a fresh injection from source.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
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

function extractText(result: unknown): string {
  if (typeof result === 'string') return result;
  const textField = (result as any)?.content?.[0]?.text;
  if (typeof textField === 'string') return textField;
  return JSON.stringify(result);
}

async function main(): Promise<void> {
  console.log('this.memory always-injected on plain classes:');
  const root = mkdtempSync(join(tmpdir(), 'photon-memory-inject-'));

  await test('typed-access (this as any).memory gets injected', async () => {
    const photonPath = writePhoton(
      root,
      'a',
      `
        export default class A {
          async probe() {
            return typeof (this as any).memory;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    assert.equal(extractText(result).trim(), 'object');
  });

  await test('complex cast (growth-console shape) gets injected', async () => {
    // This is the exact shape that silently missed the old regex: the
    // type annotation contains a function type with parens, so `[^)]+`
    // terminated early and `.memory` was never matched. After the
    // always-inject fix, the cap gate is gone and the shape is
    // irrelevant to correctness.
    const photonPath = writePhoton(
      root,
      'b',
      `
        /** @stateful */
        export default class B {
          async probe() {
            const m = (this as unknown as {
              memory: { set: (k: string, v: unknown) => Promise<void> };
            }).memory;
            return typeof m;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    assert.equal(
      extractText(result).trim(),
      'object',
      'memory must be an object — undefined means the cap gate still exists'
    );
  });

  await test('write → fresh loader → read hydrates from disk', async () => {
    // This is the contract the user actually cares about: persistence
    // survives a process restart. Daemon restart is emulated by
    // constructing a fresh PhotonLoader (drops the in-RAM
    // MemoryProvider) and re-reading the same source.
    const photonPath = writePhoton(
      root,
      'c',
      `
        /** @stateful */
        export default class C {
          async put(params: { item: string }) {
            const existing = await (this as unknown as {
              memory: { get: (k: string) => Promise<unknown> };
            }).memory.get('items');
            const items = Array.isArray(existing) ? (existing as string[]) : [];
            items.push(params.item);
            await (this as unknown as {
              memory: { set: (k: string, v: unknown) => Promise<void> };
            }).memory.set('items', items);
            return { count: items.length };
          }
          async list() {
            const v = await (this as unknown as {
              memory: { get: (k: string) => Promise<unknown> };
            }).memory.get('items');
            return Array.isArray(v) ? v : [];
          }
        }
      `
    );

    const writeLoader = new PhotonLoader(false, undefined, root);
    const writeMcp = await writeLoader.loadFile(photonPath);
    await writeLoader.executeTool(writeMcp, 'put', { item: 'one' });
    await writeLoader.executeTool(writeMcp, 'put', { item: 'two' });

    // Assert disk actually has the data (not just daemon RAM).
    const memoryFile = join(root, '.data', 'c', 'memory', 'items.json');
    assert.ok(
      existsSync(memoryFile),
      `memory file must exist at ${memoryFile} after set() — presence proves disk write happened, not just RAM cache`
    );
    const diskContents = JSON.parse(readFileSync(memoryFile, 'utf-8'));
    assert.deepEqual(diskContents, ['one', 'two'], 'disk should contain both writes');

    // Now simulate daemon restart by building a fresh loader. This drops
    // any in-RAM MemoryProvider instance the old loader held.
    const readLoader = new PhotonLoader(false, undefined, root);
    const readMcp = await readLoader.loadFile(photonPath);
    const result = await readLoader.executeTool(readMcp, 'list', {});
    const text = extractText(result);
    // list returns an array — serialized as a JSON table or raw depending
    // on formatter. Accept either "one,two" in an array or plain array.
    assert.ok(
      /one/.test(text) && /two/.test(text),
      `fresh loader must rehydrate from disk. got: ${text}`
    );
  });

  await test('user-defined memory on the class wins', async () => {
    const photonPath = writePhoton(
      root,
      'd',
      `
        export default class D {
          memory = { tag: 'user-defined' };
          async probe() {
            return (this.memory as any).tag;
          }
        }
      `
    );
    const loader = new PhotonLoader(false, undefined, root);
    const mcp = await loader.loadFile(photonPath);
    const result = await loader.executeTool(mcp, 'probe', {});
    assert.equal(extractText(result).trim(), 'user-defined');
  });

  rmSync(root, { recursive: true, force: true });
  console.log('\nAll this.memory always-injected tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
