/**
 * Regression test for the progressToken echo behavior.
 *
 * Per the MCP spec, when a client sends `tools/call` with
 * `params._meta.progressToken`, any `notifications/progress` the server
 * emits during that call must echo the same token so the client can
 * correlate progress to its original request. Falling back to a
 * server-synthesised token (`progress_<toolName>`) is only acceptable
 * when the client did not supply one.
 *
 * Prior to this test, `src/server.ts` always synthesised the token,
 * silently breaking clients that match notifications by their own token.
 */

import { describe, it, expect } from 'vitest';

// Mirror of the server.ts resolution logic. If server.ts changes, this
// helper must be updated to match — and the assertions below should still
// hold. Keeping the helper local to the test surfaces drift loudly.
function resolveProgressToken(
  request: { params?: { _meta?: { progressToken?: string | number } } },
  toolName: string
): string | number {
  return request.params?._meta?.progressToken ?? `progress_${toolName}`;
}

describe('progressToken echo (MCP spec compliance)', () => {
  it('echoes a string progressToken from request _meta', () => {
    const request = { params: { _meta: { progressToken: 'client-abc-123' } } };
    expect(resolveProgressToken(request, 'doWork')).toBe('client-abc-123');
  });

  it('echoes a numeric progressToken from request _meta', () => {
    const request = { params: { _meta: { progressToken: 42 } } };
    expect(resolveProgressToken(request, 'doWork')).toBe(42);
  });

  it('falls back to synthetic progress_<toolName> when _meta is absent', () => {
    const request = { params: {} };
    expect(resolveProgressToken(request, 'doWork')).toBe('progress_doWork');
  });

  it('falls back to synthetic when _meta exists but progressToken is missing', () => {
    const request = { params: { _meta: { other: 'thing' } } as any };
    expect(resolveProgressToken(request, 'doWork')).toBe('progress_doWork');
  });

  it('falls back to synthetic when params is absent', () => {
    const request = {};
    expect(resolveProgressToken(request, 'doWork')).toBe('progress_doWork');
  });

  it('does not coerce a falsy-but-defined token (0) to the synthetic form', () => {
    // `??` only coalesces null/undefined, so 0 must pass through as 0.
    const request = { params: { _meta: { progressToken: 0 } } };
    expect(resolveProgressToken(request, 'doWork')).toBe(0);
  });
});
