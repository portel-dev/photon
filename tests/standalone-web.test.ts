import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  browserInvocableMethodNames,
  extractApplicationManifest,
} from '../src/auto-ui/app-manifest.js';
import { generateStandaloneWebShell } from '../src/auto-ui/standalone-web/app-shell.js';
import {
  filterStandaloneManifest,
  standaloneNavigationItemsFromTools,
  standaloneNavigationItems,
  standaloneScreenHref,
} from '../src/auto-ui/standalone-web/navigation.js';

test('standalone navigation keeps manifest routes and labels stable', () => {
  const manifest = {
    version: 1 as const,
    entry: 'main',
    screens: [
      { id: 'home', method: 'main', label: 'Overview', route: 'main' },
      { id: 'listTasks', method: 'listTasks', route: 'listTasks' },
    ],
    settings: 'settings',
  };

  assert.deepEqual(
    standaloneNavigationItems(manifest).map(({ id, method, label }) => ({ id, method, label })),
    [
      { id: 'home', method: 'main', label: 'Overview' },
      { id: 'listTasks', method: 'listTasks', label: 'List Tasks' },
      { id: 'settings', method: 'settings', label: 'Settings' },
    ]
  );
  assert.equal(standaloneScreenHref('listTasks'), '?screen=listTasks');
});

test('automatic screens require the canonical MCP capability surface', () => {
  const browserMethods = browserInvocableMethodNames([
    { name: 'main', exposure: new Set(['mcp', 'cli']) },
    { name: 'cliOnly', exposure: new Set(['cli']) },
    { name: 'runtimeOnly', exposure: new Set(['runtime']) },
  ]);
  const manifest = extractApplicationManifest(
    [{ name: 'main' }, { name: 'cliOnly' }, { name: 'runtimeOnly' }],
    { autoScreens: true, browserInvocableMethods: browserMethods }
  );

  assert.deepEqual(
    manifest?.screens.map((screen) => screen.method),
    ['main']
  );
});

test('browser catalog filtering removes unavailable screens and settings', () => {
  const manifest = {
    version: 1 as const,
    screens: [
      { id: 'safe', method: 'safe', label: 'Safe' },
      { id: 'private', method: 'private', label: 'Private' },
    ],
    settings: 'settings',
  };

  assert.deepEqual(filterStandaloneManifest(manifest, new Set(['safe'])), {
    version: 1,
    screens: [{ id: 'safe', method: 'safe', label: 'Safe' }],
    settings: undefined,
  });
});

test('empty standalone shells render a safe empty state and shared hooks', () => {
  const html = generateStandaloneWebShell({
    photonName: 'empty-app',
    title: 'Empty App',
    manifest: { version: 1, screens: [] },
  });

  assert.match(html, /No screens available/);
  assert.match(html, /\/api\/photon-renderers\.js/);
  assert.match(html, /\/photon-form\.bundle\.js/);
  assert.match(html, /\/beam-form\.bundle\.js/);
  assert.match(html, /protocolVersion/);
  assert.match(html, /clientInfo/);
  assert.match(html, /capabilities/);
  assert.match(html, /prefers-color-scheme/);
  assert.doesNotMatch(html, /\/api\/invoke/);
});

test('generated shell discovers screens from the runtime catalog only', () => {
  const html = generateStandaloneWebShell({
    photonName: 'secure-app',
    title: 'Secure App',
    manifest: {
      version: 1,
      entry: 'hiddenAdmin',
      screens: [
        {
          id: 'hiddenAdmin',
          method: 'hiddenAdmin',
          label: 'Hidden Admin Console',
        },
      ],
    },
  });

  assert.doesNotMatch(html, /hiddenAdmin|Hidden Admin Console/);
  assert.match(html, /tools\/list/);
  assert.match(html, /annotations\.title/);
  assert.match(html, /photon\/render/);
  assert.deepEqual(
    standaloneNavigationItemsFromTools([
      {
        name: 'visible',
        description: 'Visible description',
        annotations: { title: 'Visible title' },
        _meta: { 'photon/render': { icon: '✓' } },
      },
      { name: 'photon_context_get', description: 'Host-only helper' },
    ]),
    [{ id: 'visible', method: 'visible', label: 'Visible title', icon: '✓' }]
  );
});
