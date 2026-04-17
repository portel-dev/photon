/**
 * Beam Daemon API Route Tests
 *
 * Drives `handleDaemonRoutes` directly with mocked req/res. Covers:
 *   - URL routing (non-daemon paths pass through)
 *   - CSRF header enforcement on mutations
 *   - Input validation (missing body fields, unknown action)
 *   - History query-param parsing (missing fields)
 *
 * Happy paths that call into the live daemon are exercised by the broader
 * daemon-schedule-provider + protocol-validation suites.
 */

import { strict as assert } from 'assert';
import type { IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { handleDaemonRoutes } from '../dist/auto-ui/beam/routes/api-daemon.js';
import type { BeamState } from '../dist/auto-ui/beam/types.js';

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
      console.log(`    ${err.message}`);
    });
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  res: ServerResponse;
}

function mockResponse(): MockResponse {
  const m: MockResponse = {
    statusCode: 0,
    headers: {},
    body: '',
    res: null as unknown as ServerResponse,
  };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      m.statusCode = status;
      if (headers) Object.assign(m.headers, headers);
    },
    setHeader(k: string, v: string) {
      m.headers[k] = v;
    },
    end(body?: string) {
      m.body = body ?? '';
    },
  } as unknown as ServerResponse;
  m.res = res;
  return m;
}

function mockRequest(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  Object.assign(req, {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/',
    headers: opts.headers ?? {},
  });
  if (typeof opts.body === 'string') {
    setImmediate(() => {
      req.emit('data', Buffer.from(opts.body!));
      req.emit('end');
    });
  } else {
    setImmediate(() => req.emit('end'));
  }
  return req;
}

const STATE = {} as BeamState;

async function runTests(): Promise<void> {
  console.log('\nBeam Daemon Routes:');

  await test('returns false for non-daemon paths', async () => {
    const req = mockRequest({ url: '/api/other' });
    const res = mockResponse();
    const handled = await handleDaemonRoutes(
      req,
      res.res,
      new URL('http://localhost/api/other'),
      STATE
    );
    assert.equal(handled, false);
    assert.equal(res.statusCode, 0, 'did not write a response');
  });

  await test('POST requires X-Photon-Request header', async () => {
    const req = mockRequest({ method: 'POST', url: '/api/daemon/schedules/enable' });
    const res = mockResponse();
    const handled = await handleDaemonRoutes(
      req,
      res.res,
      new URL('http://localhost/api/daemon/schedules/enable'),
      STATE
    );
    assert.equal(handled, true);
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.match(body.error, /X-Photon-Request/);
  });

  await test('schedules/<unknown action> → 404', async () => {
    const req = mockRequest({
      method: 'POST',
      url: '/api/daemon/schedules/hello',
      headers: { 'x-photon-request': '1' },
    });
    const res = mockResponse();
    await handleDaemonRoutes(
      req,
      res.res,
      new URL('http://localhost/api/daemon/schedules/hello'),
      STATE
    );
    assert.equal(res.statusCode, 404);
    assert.match(JSON.parse(res.body).error, /Unknown schedule action/);
  });

  await test('schedule action rejects missing photon/method', async () => {
    const req = mockRequest({
      method: 'POST',
      url: '/api/daemon/schedules/enable',
      headers: { 'x-photon-request': '1' },
      body: JSON.stringify({ photon: 'demo' }),
    });
    const res = mockResponse();
    await handleDaemonRoutes(
      req,
      res.res,
      new URL('http://localhost/api/daemon/schedules/enable'),
      STATE
    );
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /method/);
  });

  await test('schedule action rejects malformed JSON body', async () => {
    const req = mockRequest({
      method: 'POST',
      url: '/api/daemon/schedules/enable',
      headers: { 'x-photon-request': '1' },
      body: 'not-json{',
    });
    const res = mockResponse();
    await handleDaemonRoutes(
      req,
      res.res,
      new URL('http://localhost/api/daemon/schedules/enable'),
      STATE
    );
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /Invalid JSON body/);
  });

  await test('history endpoint rejects missing query params', async () => {
    const req = mockRequest({ url: '/api/daemon/history' });
    const res = mockResponse();
    await handleDaemonRoutes(req, res.res, new URL('http://localhost/api/daemon/history'), STATE);
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /photon.*method/);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void runTests();
