import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPhotonRuntime, disposeAllPhotons } from '../src/index.js';

describe('Photon as an in-process library', () => {
  let directory: string;
  const runtimes: ReturnType<typeof createPhotonRuntime>[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'photon-library-'));
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
    await disposeAllPhotons('test-cleanup');
    await rm(directory, { recursive: true, force: true });
  });

  function runtime() {
    const value = createPhotonRuntime();
    runtimes.push(value);
    return value;
  }

  async function fixture(name: string, source: string) {
    const file = join(directory, `${name}.photon.ts`);
    await writeFile(file, source);
    return file;
  }

  it('returns a reusable initialized object and closes its lifecycle exactly once', async () => {
    const file = await fixture(
      'counter',
      `export default class Counter {
      initialized = 0;
      closed = 0;
      count = 0;
      async onInitialize() { this.initialized++; }
      async onShutdown() { this.closed++; }
      async add(p: { amount: number }) { this.count += p.amount; return this.count; }
    }`
    );
    const owner = runtime();
    const counter = await owner.photon<any>(file, { baseDir: directory });
    expect(counter.initialized).toBe(1);
    expect(await counter.add({ amount: 2 })).toBe(2);
    expect(await owner.photon(file, { baseDir: directory })).toBe(counter);
    expect(await counter.add({ amount: 3 })).toBe(5);
    await owner.close();
    await owner.close();
    expect(counter.closed).toBe(1);
    await expect(owner.photon(file)).rejects.toThrow('closed');
  });

  it('keeps application-owned runtime caches separate', async () => {
    const file = await fixture(
      'isolated',
      `export default class Counter {
      count = 0;
      async add() { return ++this.count; }
    }`
    );
    const first = await runtime().photon<any>(file, { baseDir: directory });
    const second = await runtime().photon<any>(file, { baseDir: directory });
    expect(first).not.toBe(second);
    expect(await first.add()).toBe(1);
    expect(await first.add()).toBe(2);
    expect(await second.add()).toBe(1);
  });

  it('provides persistent memory without opening a server', async () => {
    const file = await fixture(
      'notes',
      `export default class Notes {
      async save(p: { text: string }) { await this.memory.set('text', p.text); }
      async read() { return await this.memory.get('text'); }
    }`
    );
    const first = runtime();
    const notes = await first.photon<any>(file, { baseDir: directory });
    await notes.save({ text: 'from the application' });
    await first.close();
    const reloaded = await runtime().photon<any>(file, { baseDir: directory });
    expect(await reloaded.read()).toBe('from the application');
  });

  it('composes a local constructor-injected photon through ordinary method calls', async () => {
    await fixture(
      'formatter',
      `export default class Formatter {
      async format(p: { name: string }) { return 'Hello ' + p.name; }
    }`
    );
    const file = await fixture(
      'welcome',
      `/** @photon formatter ./formatter.photon.ts */
    export default class Welcome {
      constructor(private formatter: any) {}
      async greet(p: { name: string }) { return await this.formatter.format(p); }
    }`
    );
    const welcome = await runtime().photon<any>(file, { baseDir: directory });
    expect(await welcome.greet({ name: 'Ada' })).toBe('Hello Ada');
  });

  it('closes nested and shared constructor dependencies once within their owner', async () => {
    await fixture(
      'leaf',
      `export default class Leaf {
      closed = 0;
      async onShutdown(ctx) { this.closed++; this.reason = ctx.reason; }
    }`
    );
    await fixture(
      'branch',
      `/** @photon leaf ./leaf.photon.ts */
      export default class Branch {
        closed = 0;
        constructor(public leaf: any) {}
        async onShutdown() { this.closed++; }
      }`
    );
    const file = await fixture(
      'root',
      `/** @photon branch ./branch.photon.ts
      * @photon leaf ./leaf.photon.ts */
      export default class Root {
        closed = 0;
        constructor(public branch: any, public leaf: any) {}
        async onShutdown() { this.closed++; }
      }`
    );
    const owner = runtime();
    const options = { baseDir: directory };
    const [root, leaf] = await Promise.all([
      owner.photon<any>(file, options),
      owner.photon<any>(join(directory, 'leaf.photon.ts'), options),
    ]);
    const other = await runtime().photon<any>(file, options);
    expect(root.leaf).toBe(leaf);
    expect(root.branch.leaf).toBe(leaf);
    expect(other.leaf).not.toBe(leaf);
    await owner.close('application-close');
    await owner.close();
    expect([root.closed, root.branch.closed, leaf.closed]).toEqual([1, 1, 1]);
    expect(leaf.reason).toBe('application-close');
    expect([other.closed, other.branch.closed, other.leaf.closed]).toEqual([0, 0, 0]);
  });

  it('rejects transitive and concurrent constructor cycles without hanging', async () => {
    for (const [name, dependency] of [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ]) {
      await fixture(
        name,
        `/** @photon dependency ./${dependency}.photon.ts */
        export default class Cyclic { constructor(public dependency: any) {} }`
      );
    }
    const owner = runtime();
    const options = { baseDir: directory };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Circular dependency detection timed out')), 10000);
    });
    try {
      await Promise.race([
        expect(owner.photon(join(directory, 'a.photon.ts'), options)).rejects.toThrow(
          'Circular @photon dependency'
        ),
        timeout,
      ]);
      const results = await Promise.race([
        Promise.allSettled(
          ['a', 'b', 'c'].map((name) => owner.photon(join(directory, `${name}.photon.ts`), options))
        ),
        timeout,
      ]);
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected')
          expect(result.reason.message).toContain('Circular @photon dependency');
      }
      const healthy = await fixture(
        'healthy',
        `export default class Healthy { async ping() { return 'pong'; } }`
      );
      expect(await (await owner.photon<any>(healthy, options)).ping()).toBe('pong');
    } finally {
      clearTimeout(timer);
    }
  }, 15000);
});
