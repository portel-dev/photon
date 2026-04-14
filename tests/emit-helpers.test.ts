/**
 * Verifies that plain-class instances get parity emit helpers injected
 * (toast/log/status/progress/thinking + render routing for UI-feedback formats).
 *
 * Run: npx tsx tests/emit-helpers.test.ts
 */

import { strict as assert } from 'assert';
import { PhotonLoader } from '../src/loader.js';

async function main() {
  const loader = new PhotonLoader(false);
  const mcp = await loader.loadFile('./tests/fixtures/emit-helpers.photon.ts');

  // Capture emits from imperative path.
  const imperativeEmits: any[] = [];
  await loader.executeTool(
    mcp,
    'imperative',
    {},
    {
      outputHandler: (ev: any) => imperativeEmits.push(ev),
    }
  );

  // Capture emits from generator path.
  const generatorEmits: any[] = [];
  await loader.executeTool(
    mcp,
    'generator',
    {},
    {
      outputHandler: (ev: any) => generatorEmits.push(ev),
    }
  );

  const strip = (arr: any[]) =>
    arr
      .filter((e) => e?.emit && e.emit !== 'render:clear')
      .map((e) => {
        const { _source, ...rest } = e;
        return rest;
      });

  const imp = strip(imperativeEmits);
  const gen = strip(generatorEmits);

  // Imperative path should include 'toast' for both this.toast() and render('toast', ...).
  const toastEvents = imp.filter((e) => e.emit === 'toast');
  assert.equal(toastEvents.length, 2, `expected 2 toast emits, got ${toastEvents.length}`);
  assert.equal(toastEvents[0].message, 'hello');
  assert.equal(toastEvents[0].type, 'success');
  assert.equal(toastEvents[1].message, 'via render');

  // Every emit type used by the generator must also exist from the imperative path.
  const kinds = (arr: any[]) => new Set(arr.map((e) => e.emit));
  const genKinds = kinds(gen);
  const impKinds = kinds(imp);
  for (const k of genKinds) {
    assert.ok(impKinds.has(k), `imperative path missing '${k}' emit (generator has it)`);
  }

  // Specifically: toast/status/progress/log/thinking all reachable.
  for (const k of ['toast', 'status', 'progress', 'log', 'thinking']) {
    assert.ok(impKinds.has(k), `expected imperative emit '${k}'`);
  }

  // render('toast', ...) must NOT produce a generic 'render' event (was the bug).
  const renderEvents = imp.filter((e) => e.emit === 'render');
  assert.equal(
    renderEvents.length,
    0,
    `render('toast') should not emit generic render: ${JSON.stringify(renderEvents)}`
  );

  console.log('✅ emit helpers parity: imperative matches generator yields');
  console.log(`   imperative emits: ${imp.map((e) => e.emit).join(', ')}`);
  console.log(`   generator  emits: ${gen.map((e) => e.emit).join(', ')}`);
}

main().catch((err) => {
  console.error('❌ test failed:', err);
  process.exit(1);
});
