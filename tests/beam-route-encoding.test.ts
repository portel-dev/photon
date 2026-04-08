import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { handleBrowseRoutes } from '../src/auto-ui/beam/routes/api-browse.js';
import { handleConfigRoutes } from '../src/auto-ui/beam/routes/api-config.js';
import {
  buildBeamRoutePath,
  parseBeamRoutePath,
} from '../src/auto-ui/frontend/utils/beam-route.js';

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

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    writeHead(statusCode: number, headers?: Record<string, string>) {
      this.statusCode = statusCode;
      if (headers) Object.assign(this.headers, headers);
      return this;
    },
    end(body = '') {
      this.body = body;
      return this;
    },
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beam-route-encoding-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function run() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                BEAM ROUTE ENCODING TESTS                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await test('api/ui resolves alias names to real photon UI folders', async () => {
    await withTempDir(async (dir) => {
      const photonDir = path.join(dir, 'portel-dev');
      const photonPath = path.join(photonDir, 'telegram.photon.ts');
      const uiDir = path.join(photonDir, 'telegram', 'ui');
      await fs.mkdir(uiDir, { recursive: true });
      await fs.writeFile(photonPath, 'export default class Telegram {}');
      await fs.writeFile(path.join(uiDir, 'main.html'), '<div>telegram custom ui</div>');

      const req = { method: 'GET' } as any;
      const res = createMockResponse();
      const url = new URL('http://localhost/api/ui?photon=telegram%20(1)&id=main');
      const state = {
        workingDir: dir,
        photons: [
          {
            name: 'telegram (1)',
            path: photonPath,
            configured: true,
            assets: { ui: [] },
          },
        ],
      } as any;

      const handled = await handleBrowseRoutes(req, res as any, url, state);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /telegram custom ui/);
    });
  });

  await test('api/instances decodes encoded photon names in the URL path', async () => {
    await withTempDir(async (dir) => {
      const stateDir = path.join(dir, 'state', 'telegram (1)');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, 'work.json'), '{}');

      const req = {
        method: 'GET',
        socket: { remoteAddress: '127.0.0.1' },
      } as any;
      const res = createMockResponse();
      const url = new URL('http://localhost/api/instances/telegram%20(1)');
      const state = {
        workingDir: dir,
        apiRateLimiter: { isAllowed: () => true },
      } as any;

      const handled = await handleConfigRoutes(req, res as any, url, state);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const payload = JSON.parse(res.body);
      assert.equal(payload.autoInstance, 'work');
      assert.deepEqual(payload.instances.sort(), ['default', 'work']);
    });
  });

  await test('parseBeamRoutePath resolves namespaced photon detail routes without a method', () => {
    const route = parseBeamRoutePath('/portel-dev/telegram', [
      { name: 'telegram (1)', shortName: 'telegram', namespace: 'portel-dev' },
    ]);
    assert.deepEqual(route, {
      photonName: 'telegram (1)',
      methodNames: [],
    });
  });

  await test('parseBeamRoutePath resolves namespaced split-view method routes from the tail', () => {
    const route = parseBeamRoutePath('/portel-dev/telegram/main+settings+source', [
      { name: 'telegram (1)', shortName: 'telegram', namespace: 'portel-dev' },
    ]);
    assert.deepEqual(route, {
      photonName: 'telegram (1)',
      methodNames: ['main', 'settings', 'source'],
    });
  });

  await test('buildBeamRoutePath emits namespace-based paths for namespaced photons', () => {
    const route = buildBeamRoutePath(
      { name: 'telegram (1)', shortName: 'telegram', namespace: 'portel-dev' },
      'main',
      ['settings', 'source']
    );
    assert.equal(route, '/portel-dev/telegram/main+settings+source');
  });

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }

  console.log('\n  All beam route encoding tests passed!\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
