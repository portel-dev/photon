/**
 * Regression sentinel for the deployed Worker's `emit` flush behavior.
 *
 * Symptom this test pins against:
 *   - A photon calls `this.emit({ emit: 'status', message: '…' })` from
 *     inside a tool method.
 *   - The client made the call with `Accept: text/event-stream`.
 *   - On the deployed CF Worker, none of the emits reach the client
 *     until the tool returns. Only the final result appears.
 *
 * Root cause that was fixed: the inline `emit` implementation injected
 * onto the photon instance only fanned out to hibernatable WebSocket
 * subscribers (`ctx.getWebSockets(channel).forEach(ws.send(…))`). It
 * did not push to the active SSE writer in the
 * `requestContext.getStore()`. Local STDIO already mapped emits to
 * `notifications/progress` / `notifications/message` (see
 * `src/server.ts:1340-1397`); the Worker template was missing the
 * matching wiring.
 *
 * Template sentinels pin the request-context wiring and helper injection.
 * Live delivery before tool completion is covered by the generated Worker
 * integration test in cf-generated-worker.test.ts.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '..',
  'templates',
  'cloudflare',
  'worker.ts.template'
);
const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

describe('CF worker template — emit SSE flush', () => {
  it('RequestContext carries a progressToken for echo-back', () => {
    expect(template).toMatch(/progressToken\?\s*:\s*string\s*\|\s*number/);
  });

  it('captures the official SDK client progressToken without inventing one', () => {
    expect(template).toMatch(/progressToken:\s*ctx\?\.mcpReq\?\._meta\?\.progressToken/);
    expect(template).toMatch(/progressToken !== undefined \? \{ progressToken \} : \{\}/);
  });

  it('emit forwards through the active SSE request context', () => {
    // The forwarder must read the AsyncLocalStorage store and bail
    // when no SDK request is in flight.
    expect(template).toMatch(/const\s+reqCtx\s*=\s*requestContext\.getStore\(\)/);
    expect(template).toMatch(/if\s*\(!reqCtx\)\s*return/);
  });

  it('progress emits map to notifications/progress with progressToken', () => {
    // Find the progress branch and confirm it produces a JSON-RPC
    // notification with method 'notifications/progress'.
    expect(template).toMatch(/kind\s*===\s*'progress'[\s\S]{0,400}notifications\/progress/);
  });

  it('status emits map to notifications/progress with the message', () => {
    expect(template).toMatch(/kind\s*===\s*'status'[\s\S]{0,400}notifications\/progress/);
  });

  it('log emits map to notifications/message', () => {
    expect(template).toMatch(/kind\s*===\s*'log'[\s\S]{0,400}notifications\/message/);
  });

  it('render emits map to notifications/message with _render payload', () => {
    expect(template).toMatch(/kind\s*===\s*'render'[\s\S]{0,400}_render:\s*true/);
  });

  it('keeps the channel-tagged WebSocket upgrade separate from request-scoped SSE', () => {
    expect(template).toMatch(/this\.ctx\.acceptWebSocket\(server, \[channel\]\)/);
    expect(template).toContain("url.searchParams.get('channel') ?? 'default'");
  });
});

describe('CF worker template — emit helpers (status/log/progress/toast/render/thinking)', () => {
  // Plain-class photons rely on the loader to inject `this.status(...)`,
  // `this.log(...)`, etc. The classic loader does this in
  // `injectEmitHelpers`. The deployed Worker must mirror it — without
  // these helpers a photon that calls `this.status?.('msg')` silently
  // no-ops on CF and the SSE flush path has nothing to forward.

  it('injects this.status', () => {
    expect(template).toMatch(/!\('status'\s+in\s+instance\)[\s\S]{0,500}emit:\s*'status'/);
  });

  it('injects this.log', () => {
    expect(template).toMatch(/!\('log'\s+in\s+instance\)[\s\S]{0,500}emit:\s*'log'/);
  });

  it('injects this.progress', () => {
    expect(template).toMatch(/!\('progress'\s+in\s+instance\)[\s\S]{0,500}emit:\s*'progress'/);
  });

  it('injects this.toast', () => {
    expect(template).toMatch(/!\('toast'\s+in\s+instance\)[\s\S]{0,500}emit:\s*'toast'/);
  });

  it('injects this.render with status / progress / toast / render mappings', () => {
    // The render dispatcher must route 'status' / 'progress' / 'toast'
    // formats to their dedicated emit kinds (matching photon-core base).
    expect(template).toMatch(/!\('render'\s+in\s+instance\)[\s\S]{0,800}format\s*===\s*'status'/);
    expect(template).toMatch(/format\s*===\s*'progress'[\s\S]{0,500}emit:\s*'progress'/);
  });

  it('injects this.thinking', () => {
    expect(template).toMatch(/!\('thinking'\s+in\s+instance\)[\s\S]{0,500}emit:\s*'thinking'/);
  });

  it('every helper guards on `in instance` so user methods are never clobbered', () => {
    const guards =
      template.match(/!\('(render|toast|log|status|progress|thinking)'\s+in\s+instance\)/g) || [];
    // 6 helpers, each must have its guard.
    expect(guards.length).toBeGreaterThanOrEqual(6);
  });
});
