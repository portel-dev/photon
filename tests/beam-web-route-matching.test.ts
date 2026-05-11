import { strict as assert } from 'assert';
import { findBeamWebRoute } from '../src/auto-ui/beam.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

const routes = [
  { method: 'GET', path: '/', handler: 'home' },
  { method: 'GET', path: '/api/threads/:id', handler: 'apiGet' },
  { method: 'GET', path: '/api/threads/:id/stream', handler: 'apiStream' },
  { method: 'POST', path: '/api/threads/:id/stdin', handler: 'apiStdin' },
  { method: 'POST', path: '/api/threads/start', handler: 'apiStart' },
];

async function run() {
  console.log('\nBeam web route matching');

  await test('matches dynamic path params after /web prefix is stripped', () => {
    assert.equal(findBeamWebRoute(routes, 'GET', '/api/threads/t_123')?.handler, 'apiGet');
    assert.equal(
      findBeamWebRoute(routes, 'GET', '/api/threads/t_123/stream')?.handler,
      'apiStream'
    );
    assert.equal(findBeamWebRoute(routes, 'POST', '/api/threads/t_123/stdin')?.handler, 'apiStdin');
  });

  await test('prefers exact static routes over dynamic routes', () => {
    assert.equal(findBeamWebRoute(routes, 'POST', '/api/threads/start')?.handler, 'apiStart');
  });

  await test('does not match wrong method or segment count', () => {
    assert.equal(findBeamWebRoute(routes, 'GET', '/api/threads/t_123/stdin'), undefined);
    assert.equal(findBeamWebRoute(routes, 'GET', '/api/threads/t_123/stream/extra'), undefined);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
