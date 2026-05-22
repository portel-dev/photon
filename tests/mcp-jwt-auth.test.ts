import { describe, expect, it } from 'vitest';
import {
  createPhotonAuthKeypair,
  signPhotonAuthToken,
  verifyPhotonAuthToken,
} from '../src/auth/mcp-jwt.js';

const now = new Date('2026-05-22T00:00:00Z');
const audience = 'https://appointments.example.com/mcp';

describe('Photon MCP JWT auth helpers', () => {
  it('creates an ES256 local issuer and signs a resource-bound access token', () => {
    const material = createPhotonAuthKeypair('appointments', now);
    const token = signPhotonAuthToken(material.issuer, material.privateJwk, {
      agent: 'scheduler',
      audience,
      scopes: ['bookings:read availability:write'],
      now,
      jti: 'tok_test',
    });

    const result = verifyPhotonAuthToken(token, {
      issuer: material.issuer.issuer,
      audience,
      jwks: material.jwks,
      now,
      requiredScopes: ['bookings:read'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims).toMatchObject({
        iss: 'photon-local:appointments',
        sub: 'agent:scheduler',
        aud: audience,
        tenant_id: 'default',
        client_id: 'scheduler',
        scope: 'bookings:read availability:write',
        jti: 'tok_test',
      });
    }
  });

  it('rejects wrong audience and missing required scopes', () => {
    const material = createPhotonAuthKeypair('appointments', now);
    const token = signPhotonAuthToken(material.issuer, material.privateJwk, {
      agent: 'scheduler',
      audience,
      scopes: ['bookings:read'],
      now,
    });

    expect(
      verifyPhotonAuthToken(token, {
        issuer: material.issuer.issuer,
        audience: 'https://wrong.example.com/mcp',
        jwks: material.jwks,
        now,
      })
    ).toEqual({ ok: false, reason: 'wrong_audience' });

    expect(
      verifyPhotonAuthToken(token, {
        issuer: material.issuer.issuer,
        audience,
        jwks: material.jwks,
        now,
        requiredScopes: ['availability:write'],
      })
    ).toEqual({ ok: false, reason: 'insufficient_scope' });
  });

  it('rejects expired and not-yet-valid tokens', () => {
    const material = createPhotonAuthKeypair('appointments', now);
    const token = signPhotonAuthToken(material.issuer, material.privateJwk, {
      agent: 'scheduler',
      audience,
      now,
      ttlSeconds: 60,
    });

    expect(
      verifyPhotonAuthToken(token, {
        issuer: material.issuer.issuer,
        audience,
        jwks: material.jwks,
        now: new Date('2026-05-22T00:03:00Z'),
        clockSkewSeconds: 0,
      })
    ).toEqual({ ok: false, reason: 'expired_token' });

    expect(
      verifyPhotonAuthToken(token, {
        issuer: material.issuer.issuer,
        audience,
        jwks: material.jwks,
        now: new Date('2026-05-21T23:59:00Z'),
        clockSkewSeconds: 0,
      })
    ).toEqual({ ok: false, reason: 'token_not_yet_valid' });
  });
});
