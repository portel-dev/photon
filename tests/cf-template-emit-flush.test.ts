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
 * This test reads the template as a string and asserts the SSE
 * forwarding is in place. We don't spin up a real Worker (would
 * require miniflare + DO state) — the textual presence of the
 * required calls is enough to catch a regression where someone
 * deletes the forwarder block again. The flow itself is exercised
 * end-to-end via the existing CF deploy/runtime suites once the
 * forwarder is live.
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

  it('streamToolCall captures the client progressToken from _meta', () => {
    expect(template).toMatch(/_meta\?\s*:\s*\{\s*progressToken\?/);
    expect(template).toMatch(/clientProgressToken\s*\?\?\s*`progress_/);
  });

  it('emit forwards through the active SSE request context', () => {
    // The forwarder must read the AsyncLocalStorage store and bail
    // when no SSE call is in flight (so non-SSE invocations stay
    // pure WebSocket fan-out).
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

  it('channel websocket fan-out is preserved alongside SSE forwarding', () => {
    // The websocket loop must still exist — both paths run, not one or the other.
    expect(template).toMatch(/for\s*\(const\s+ws\s+of\s+ctx\.getWebSockets\(channel\)\)/);
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
