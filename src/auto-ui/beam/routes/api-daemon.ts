/**
 * Daemon API route handlers for Beam.
 *
 * Thin HTTP wrapper around the daemon client RPCs — gives the Beam UI a
 * parallel surface to the `photon ps` CLI for observing and controlling
 * scheduled work.
 *
 * Endpoints:
 *   GET  /api/daemon/ps                     – full snapshot (active/declared/webhooks/sessions)
 *   POST /api/daemon/schedules/enable       – body: { photon, method }
 *   POST /api/daemon/schedules/disable      – body: { photon, method }
 *   POST /api/daemon/schedules/pause        – body: { photon, method }
 *   POST /api/daemon/schedules/resume       – body: { photon, method }
 *   GET  /api/daemon/history?photon=&method=&limit=&sinceTs=
 */

import { readBody } from '../../../shared/security.js';
import { getErrorMessage } from '../../../shared/error-handler.js';
import type { RouteHandler } from '../types.js';

function writeJson(res: import('http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readAction(
  req: import('http').IncomingMessage
): Promise<{ photon: string; method: string } | { error: string }> {
  const raw = await readBody(req);
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return { error: 'Invalid JSON body' };
  }
  const body = parsed as { photon?: unknown; method?: unknown };
  if (typeof body.photon !== 'string' || !body.photon.trim()) {
    return { error: 'Missing or invalid "photon"' };
  }
  if (typeof body.method !== 'string' || !body.method.trim()) {
    return { error: 'Missing or invalid "method"' };
  }
  return { photon: body.photon, method: body.method };
}

export const handleDaemonRoutes: RouteHandler = async (req, res, url) => {
  if (!url.pathname.startsWith('/api/daemon')) return false;

  // Mutation endpoints require the CSRF-ish header used elsewhere in Beam.
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    const photonHeader = req.headers['x-photon-request'];
    if (!photonHeader) {
      writeJson(res, 403, { error: 'Missing X-Photon-Request header' });
      return true;
    }
  }

  if (url.pathname === '/api/daemon/ps' && (req.method === 'GET' || !req.method)) {
    try {
      const { fetchPsSnapshot } = await import('../../../daemon/client.js');
      const snap = await fetchPsSnapshot();
      writeJson(res, 200, snap);
    } catch (err) {
      writeJson(res, 500, { error: getErrorMessage(err) });
    }
    return true;
  }

  if (url.pathname === '/api/daemon/history' && (req.method === 'GET' || !req.method)) {
    const photon = url.searchParams.get('photon') ?? '';
    const method = url.searchParams.get('method') ?? '';
    if (!photon || !method) {
      writeJson(res, 400, { error: 'Missing required query params "photon" and "method"' });
      return true;
    }
    const limitRaw = url.searchParams.get('limit');
    const sinceRaw = url.searchParams.get('sinceTs');
    const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 20) : undefined;
    const sinceTs = sinceRaw ? parseInt(sinceRaw, 10) || undefined : undefined;
    try {
      const { fetchExecutionHistory } = await import('../../../daemon/client.js');
      const resp = await fetchExecutionHistory(photon, method, { limit, sinceTs });
      writeJson(res, 200, resp);
    } catch (err) {
      writeJson(res, 500, { error: getErrorMessage(err) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/daemon/schedules/') && (req.method === 'POST' || !req.method)) {
    const action = url.pathname.slice('/api/daemon/schedules/'.length);
    if (!['enable', 'disable', 'pause', 'resume'].includes(action)) {
      writeJson(res, 404, { error: `Unknown schedule action "${action}"` });
      return true;
    }
    const parsed = await readAction(req);
    if ('error' in parsed) {
      writeJson(res, 400, { error: parsed.error });
      return true;
    }
    try {
      const client = await import('../../../daemon/client.js');
      let result: unknown;
      if (action === 'enable') {
        result = await client.enableSchedule(parsed.photon, parsed.method);
      } else if (action === 'disable') {
        result = await client.disableSchedule(parsed.photon, parsed.method);
      } else if (action === 'pause') {
        result = await client.pauseSchedule(parsed.photon, parsed.method);
      } else {
        result = await client.resumeSchedule(parsed.photon, parsed.method);
      }
      writeJson(res, 200, { ok: true, result });
    } catch (err) {
      writeJson(res, 500, { error: getErrorMessage(err) });
    }
    return true;
  }

  return false;
};
