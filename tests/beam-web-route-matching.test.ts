import { strict as assert } from 'assert';
import {
  findBeamWebRoute,
  rewriteBeamWebRedirectLocation,
  selectClientAppUi,
  shouldBypassBeamServiceWorkerNavigation,
  shouldFallbackToClientAppForWebPath,
  shouldHandleBeamServiceWorkerNavigation,
  shouldServeLinkedAppForWebPath,
} from '../src/auto-ui/beam.js';

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
  { method: 'PUT', path: '/api/threads/:id', handler: 'apiUpdate' },
  { method: 'PATCH', path: '/api/threads/:id', handler: 'apiPatch' },
  { method: 'DELETE', path: '/api/threads/:id', handler: 'apiDelete' },
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

  await test('matches REST-style mutating verbs', () => {
    assert.equal(findBeamWebRoute(routes, 'PUT', '/api/threads/t_123')?.handler, 'apiUpdate');
    assert.equal(findBeamWebRoute(routes, 'PATCH', '/api/threads/t_123')?.handler, 'apiPatch');
    assert.equal(findBeamWebRoute(routes, 'DELETE', '/api/threads/t_123')?.handler, 'apiDelete');
  });

  await test('does not match wrong method or segment count', () => {
    assert.equal(findBeamWebRoute(routes, 'GET', '/api/threads/t_123/stdin'), undefined);
    assert.equal(findBeamWebRoute(routes, 'GET', '/api/threads/t_123/stream/extra'), undefined);
  });

  await test('reserves only runtime MCP paths before route matching', () => {
    assert.equal(shouldServeLinkedAppForWebPath('/', new URLSearchParams()), true);
    assert.equal(shouldServeLinkedAppForWebPath('/threads/t_123', new URLSearchParams()), true);
    assert.equal(shouldServeLinkedAppForWebPath('/api/threads/list', new URLSearchParams()), true);
    assert.equal(shouldServeLinkedAppForWebPath('/sw.js', new URLSearchParams()), true);
    assert.equal(shouldServeLinkedAppForWebPath('/mcp', new URLSearchParams()), false);
    assert.equal(shouldServeLinkedAppForWebPath('/mcp/messages', new URLSearchParams()), false);
  });

  await test('does not let the Beam service worker handle photon app routes', () => {
    assert.equal(shouldBypassBeamServiceWorkerNavigation('/web/port/threads'), true);
    assert.equal(shouldBypassBeamServiceWorkerNavigation('/web/port/api/state'), true);
    assert.equal(shouldBypassBeamServiceWorkerNavigation('/api/diagnostics'), true);
    assert.equal(shouldBypassBeamServiceWorkerNavigation('/port/_weather_current'), false);
  });

  await test('limits Beam offline navigation handling to Beam-owned routes', () => {
    assert.equal(shouldHandleBeamServiceWorkerNavigation('/'), true);
    assert.equal(shouldHandleBeamServiceWorkerNavigation('/app/port'), true);
    assert.equal(shouldHandleBeamServiceWorkerNavigation('/web/port/threads'), false);
    assert.equal(shouldHandleBeamServiceWorkerNavigation('/some-other-local-app'), false);
    assert.equal(shouldHandleBeamServiceWorkerNavigation('/port/_weather_current'), false);
  });

  await test('falls back to client app only after declared web routes lose', () => {
    assert.equal(
      shouldFallbackToClientAppForWebPath('/threads/t_123', new URLSearchParams(), undefined),
      true
    );
    assert.equal(
      shouldFallbackToClientAppForWebPath('/api/threads/t_123', new URLSearchParams(), routes[1]),
      false
    );
    assert.equal(
      shouldFallbackToClientAppForWebPath('/threads', new URLSearchParams('legacy=1'), undefined),
      false
    );
  });

  await test('keeps same-origin redirects inside the proxied photon web mount', () => {
    assert.equal(
      rewriteBeamWebRedirectLocation(
        'http://localhost:3000/api/ui/app/?view=queue',
        '/web/kith-approvals',
        'http://localhost:3000'
      ),
      '/web/kith-approvals/api/ui/app/?view=queue'
    );
    assert.equal(
      rewriteBeamWebRedirectLocation(
        '/api/approvals/list?limit=1',
        '/web/kith-approvals',
        'http://localhost:3000'
      ),
      '/web/kith-approvals/api/approvals/list?limit=1'
    );
    assert.equal(
      rewriteBeamWebRedirectLocation(
        'https://example.com/api/ui/app/',
        '/web/kith-approvals',
        'http://localhost:3000'
      ),
      'https://example.com/api/ui/app/'
    );
  });

  await test('selects a TSX UI asset as the route-owning client app', () => {
    const photon: any = {
      configured: true,
      assets: {
        ui: [
          { id: 'panel', path: './ui/panel.html' },
          { id: 'app', path: './ui/app.tsx' },
        ],
      },
    };
    assert.equal(selectClientAppUi(photon), 'app');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
