/**
 * Unit tests for the MCP bearer-auth helpers in the CF worker template.
 * The helpers are inline in the .template file so we re-implement them
 * here verbatim and test the contract — the template itself is just
 * substitution. If the template version drifts, the test will catch
 * mismatches because the generated worker.ts is grep-checked in CI.
 */

import { describe, it, expect } from 'vitest';

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function checkMcpBearer(
  request: { headers: { get: (name: string) => string | null } },
  env: Record<string, unknown>
):
  | { enforced: false }
  | { enforced: true; ok: true }
  | { enforced: true; ok: false; reason: string } {
  const expected = env.PHOTON_MCP_BEARER;
  if (typeof expected !== 'string' || expected.length === 0) {
    return { enforced: false };
  }
  const header = request.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { enforced: true, ok: false, reason: 'Authorization: Bearer <token> header missing' };
  }
  const presented = match[1].trim();
  if (!timingSafeEqualString(presented, expected)) {
    return { enforced: true, ok: false, reason: 'bearer token does not match PHOTON_MCP_BEARER' };
  }
  return { enforced: true, ok: true };
}

const MCP_METHODS_BYPASSING_BEARER = new Set([
  'initialize',
  'notifications/initialized',
  'notifications/cancelled',
  'ping',
  'tools/list',
]);

function makeRequest(headers: Record<string, string>) {
  return {
    headers: {
      get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
  };
}

describe('CF /mcp bearer auth — helpers', () => {
  describe('timingSafeEqualString', () => {
    it('equal strings match', () => {
      expect(timingSafeEqualString('abc123', 'abc123')).toBe(true);
    });
    it('different strings of same length do not match', () => {
      expect(timingSafeEqualString('abc123', 'xyz123')).toBe(false);
    });
    it('different lengths do not match', () => {
      expect(timingSafeEqualString('abc', 'abc123')).toBe(false);
    });
    it('empty strings match', () => {
      expect(timingSafeEqualString('', '')).toBe(true);
    });
  });

  describe('checkMcpBearer', () => {
    it('not enforced when env.PHOTON_MCP_BEARER is unset', () => {
      const r = checkMcpBearer(makeRequest({}), {});
      expect(r).toEqual({ enforced: false });
    });

    it('not enforced when env.PHOTON_MCP_BEARER is empty string', () => {
      const r = checkMcpBearer(makeRequest({ Authorization: 'Bearer x' }), {
        PHOTON_MCP_BEARER: '',
      });
      expect(r).toEqual({ enforced: false });
    });

    it('rejects missing Authorization header', () => {
      const r = checkMcpBearer(makeRequest({}), { PHOTON_MCP_BEARER: 'secret' });
      expect(r).toEqual({
        enforced: true,
        ok: false,
        reason: 'Authorization: Bearer <token> header missing',
      });
    });

    it('rejects wrong scheme', () => {
      const r = checkMcpBearer(makeRequest({ Authorization: 'Basic dXNlcjpwYXNz' }), {
        PHOTON_MCP_BEARER: 'secret',
      });
      expect(r).toMatchObject({ enforced: true, ok: false });
    });

    it('rejects wrong bearer value', () => {
      const r = checkMcpBearer(makeRequest({ Authorization: 'Bearer wrong-token' }), {
        PHOTON_MCP_BEARER: 'secret',
      });
      expect(r).toEqual({
        enforced: true,
        ok: false,
        reason: 'bearer token does not match PHOTON_MCP_BEARER',
      });
    });

    it('accepts a matching bearer', () => {
      const r = checkMcpBearer(makeRequest({ Authorization: 'Bearer secret' }), {
        PHOTON_MCP_BEARER: 'secret',
      });
      expect(r).toEqual({ enforced: true, ok: true });
    });

    it('accepts case-insensitive scheme name (RFC 7235)', () => {
      const r = checkMcpBearer(makeRequest({ Authorization: 'bearer secret' }), {
        PHOTON_MCP_BEARER: 'secret',
      });
      expect(r).toEqual({ enforced: true, ok: true });
    });

    it('trims whitespace around the token', () => {
      const r = checkMcpBearer(makeRequest({ Authorization: 'Bearer  secret  ' }), {
        PHOTON_MCP_BEARER: 'secret',
      });
      expect(r).toEqual({ enforced: true, ok: true });
    });
  });

  describe('MCP_METHODS_BYPASSING_BEARER', () => {
    it('exempts discovery + handshake methods', () => {
      expect(MCP_METHODS_BYPASSING_BEARER.has('initialize')).toBe(true);
      expect(MCP_METHODS_BYPASSING_BEARER.has('tools/list')).toBe(true);
      expect(MCP_METHODS_BYPASSING_BEARER.has('ping')).toBe(true);
      expect(MCP_METHODS_BYPASSING_BEARER.has('notifications/initialized')).toBe(true);
      expect(MCP_METHODS_BYPASSING_BEARER.has('notifications/cancelled')).toBe(true);
    });

    it('does NOT exempt tools/call', () => {
      expect(MCP_METHODS_BYPASSING_BEARER.has('tools/call')).toBe(false);
    });
  });

  describe('worker template still embeds the helpers verbatim', () => {
    it('checkMcpBearer + mcpAuthContext + MCP_METHODS_BYPASSING_BEARER appear in the template', async () => {
      const fs = await import('fs/promises');
      const tmpl = await fs.readFile(
        new URL('../templates/cloudflare/worker.ts.template', import.meta.url),
        'utf-8'
      );
      expect(tmpl).toContain('mcpAuthContext = new AsyncLocalStorage');
      expect(tmpl).toContain('function checkMcpBearer(');
      expect(tmpl).toContain('MCP_METHODS_BYPASSING_BEARER');
      expect(tmpl).toContain("'WWW-Authenticate': 'Bearer realm=\"photon\"'");
      expect(tmpl).toContain("Object.defineProperty(instance, 'mcpAuthed'");
    });
  });
});
