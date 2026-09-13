/**
 * Transport dispatcher contract.
 *
 * HTTP-only methods must keep their native Request/Response signature while
 * receiving the same Photon request context that tool execution receives.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getRequestContext } from '../src/telemetry/context.js';
import { PhotonLoader } from '../src/loader.js';
import { createLogger } from '../src/shared/logger.js';

describe('Photon transport dispatcher', () => {
  it('preserves Request/Response while installing transport-aware context', async () => {
    const loader = new PhotonLoader(
      false,
      createLogger({ level: 'error' }),
      mkdtempSync(join(tmpdir(), 'photon-transport-dispatcher-'))
    );
    let received: { method: string; transport?: string; caller?: string } | undefined;
    const photon = {
      name: 'dispatcher-probe',
      tools: [],
      instance: {
        async route(request: Request): Promise<Response> {
          const context = getRequestContext();
          received = {
            method: request.method,
            transport: context?.request?.transport,
            caller: context?.caller?.id,
          };
          return new Response('ok', {
            status: 201,
            headers: { 'x-photon-transport': context?.request?.transport ?? 'missing' },
          });
        },
      },
    } as any;

    const response = await loader.executeHttpRoute(
      photon,
      'route',
      new Request('https://example.test/orders', { method: 'POST' }),
      {
        transport: 'beam-web',
        caller: { id: 'caller-1', anonymous: false },
      }
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(201);
    expect((response as Response).headers.get('x-photon-transport')).toBe('beam-web');
    expect(received).toEqual({ method: 'POST', transport: 'beam-web', caller: 'caller-1' });
  });

  it('rejects an aborted request before invoking the handler', async () => {
    const loader = new PhotonLoader(
      false,
      createLogger({ level: 'error' }),
      mkdtempSync(join(tmpdir(), 'photon-transport-abort-'))
    );
    let invoked = false;
    const photon = {
      name: 'dispatcher-abort',
      tools: [],
      instance: {
        route(): Response {
          invoked = true;
          return new Response('unexpected');
        },
      },
    } as any;
    const controller = new AbortController();
    controller.abort();

    await expect(
      loader.executeHttpRoute(photon, 'route', new Request('https://example.test/'), {
        signal: controller.signal,
      })
    ).rejects.toThrow('aborted');
    expect(invoked).toBe(false);
  });
});
