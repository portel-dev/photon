/**
 * Auth → instance binding (Track C).
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track C.
 *
 * Verifies the registry that turns auth claims into a `_targetInstance`
 * value so multi-tenant `@stateful` photons get disjoint state per
 * authenticated caller without per-call routing in the photon code.
 *
 * The downstream consumers (daemon and streamable-HTTP transport) already
 * route on `_targetInstance` — these tests cover the registry plus the
 * directive parser. Concurrent-write isolation across instances is
 * enforced by the daemon harness; covering it here would re-test the
 * dispatcher.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveInstanceFromClaims,
  parseAuthDirective,
  getSchemeDefaultClaim,
} from '../src/shared/instance-binding.js';

describe('parseAuthDirective', () => {
  it('returns undefined fields for an empty / missing directive', () => {
    expect(parseAuthDirective(undefined)).toEqual({ scheme: undefined, claim: undefined });
    expect(parseAuthDirective('')).toEqual({ scheme: undefined, claim: undefined });
  });

  it('extracts the scheme alone when no modifiers are present', () => {
    expect(parseAuthDirective('cf-access')).toEqual({
      scheme: 'cf-access',
      claim: undefined,
    });
    expect(parseAuthDirective('oauth')).toEqual({ scheme: 'oauth', claim: undefined });
  });

  it('extracts a `claim=<name>` modifier', () => {
    expect(parseAuthDirective('cf-access claim=email')).toEqual({
      scheme: 'cf-access',
      claim: 'email',
    });
    expect(parseAuthDirective('oauth claim=org_id')).toEqual({
      scheme: 'oauth',
      claim: 'org_id',
    });
  });

  it('tolerates extra whitespace between tokens', () => {
    expect(parseAuthDirective('  cf-access    claim=email  ')).toEqual({
      scheme: 'cf-access',
      claim: 'email',
    });
  });
});

describe('resolveInstanceFromClaims', () => {
  it('returns undefined when no claims are present', () => {
    expect(resolveInstanceFromClaims('cf-access', undefined)).toBeUndefined();
    expect(resolveInstanceFromClaims('cf-access', {})).toBeUndefined();
  });

  it('cf-access defaults to email — alice and bob land on disjoint instances', () => {
    const alice = resolveInstanceFromClaims('cf-access', { email: 'alice@example.com' });
    const bob = resolveInstanceFromClaims('cf-access', { email: 'bob@example.com' });
    expect(alice).toBe('alice@example.com');
    expect(bob).toBe('bob@example.com');
    expect(alice).not.toBe(bob);
  });

  it('oauth defaults to sub claim', () => {
    expect(resolveInstanceFromClaims('oauth', { sub: 'user_42' })).toBe('user_42');
  });

  it('claim override wins over the scheme default', () => {
    // Same scheme, override picks org_id instead of sub. Two callers with
    // distinct sub but the same org_id should land on the SAME instance —
    // this is how a photon scopes to organizations rather than users.
    const a = resolveInstanceFromClaims('oauth', { sub: 'user_1', org_id: 'acme' }, 'org_id');
    const b = resolveInstanceFromClaims('oauth', { sub: 'user_2', org_id: 'acme' }, 'org_id');
    expect(a).toBe('acme');
    expect(b).toBe('acme');
  });

  it('returns undefined when the required claim is missing from the bag', () => {
    // cf-access default is `email` — a JWT without it should not synthesize
    // an instance, callers must fall back to the default singleton.
    expect(resolveInstanceFromClaims('cf-access', { sub: 'user_1' })).toBeUndefined();
  });

  it('returns undefined for unknown auth schemes (no default claim mapping)', () => {
    // `required` is a v1.28 scheme that gates execution but doesn't pin a
    // claim. Without an explicit override it should not synthesize an
    // instance — the photon stays single-tenant on this scheme.
    expect(resolveInstanceFromClaims('required', { token: 'abc' })).toBeUndefined();
  });

  it('returns undefined when the claim value is empty or non-string', () => {
    expect(resolveInstanceFromClaims('cf-access', { email: '' })).toBeUndefined();
    expect(resolveInstanceFromClaims('cf-access', { email: null })).toBeUndefined();
    expect(resolveInstanceFromClaims('cf-access', { email: 42 })).toBeUndefined();
  });
});

describe('getSchemeDefaultClaim — parity with CF Worker template', () => {
  // The Cloudflare Worker template's `extractInstance` reads
  // `Cf-Access-Authenticated-User-Email` (and the `email` JWT claim). The
  // local registry must default cf-access → email so a deployed photon
  // routes to the same instance name regardless of where it runs.
  it('cf-access defaults to email (matches Worker template)', () => {
    expect(getSchemeDefaultClaim('cf-access')).toBe('email');
  });

  it('oauth defaults to sub (RFC 7519 standard subject claim)', () => {
    expect(getSchemeDefaultClaim('oauth')).toBe('sub');
  });

  it('returns undefined for unknown schemes', () => {
    expect(getSchemeDefaultClaim('required')).toBeUndefined();
    expect(getSchemeDefaultClaim('made-up')).toBeUndefined();
  });
});
