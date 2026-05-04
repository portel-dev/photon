/**
 * Cross-origin isolation headers (Track D2).
 *
 * Two header sets ride out of one handler depending on how the photon HTML
 * is being loaded:
 *
 *   - **standalone** — top-level navigation. The page benefits from
 *     cross-origin isolation: SharedArrayBuffer, WebGPU compute,
 *     persistent OPFS, Service Workers, threaded WASM modules. We send
 *       Cross-Origin-Opener-Policy: same-origin
 *       Cross-Origin-Embedder-Policy: require-corp
 *     so `crossOriginIsolated === true` resolves on the page.
 *
 *   - **embedded** — request is destined for an iframe (host UIs like
 *     Beam, Claude Apps). COOP/COEP would block embedding from another
 *     origin, so we omit them and let the existing security headers
 *     stand.
 *
 * Asset responses (`assets/**` files) get
 *   Cross-Origin-Resource-Policy: same-origin
 * regardless of mode so a standalone parent page with COEP `require-corp`
 * can still load its own SPA chunks. Without this header the browser
 * refuses cross-origin-isolated subresources.
 */

import type { ServerResponse, IncomingMessage } from 'http';

export type IsolationMode = 'standalone' | 'embedded';

/**
 * Decide the isolation mode for an HTTP request. The request opts into
 * `embedded` by sending `Sec-Fetch-Dest: iframe` (modern browsers always
 * set this) or by carrying a `?embed=1` query param (manual override for
 * test rigs and hosts that strip Sec-Fetch headers).
 */
export function detectIsolationMode(req: IncomingMessage): IsolationMode {
  const dest = req.headers['sec-fetch-dest'];
  if (typeof dest === 'string' && dest.toLowerCase() === 'iframe') return 'embedded';
  // Manual override — convenient for tests and hosts that strip Sec-Fetch.
  const url = req.url || '';
  if (/[?&]embed=1\b/.test(url)) return 'embedded';
  return 'standalone';
}

/**
 * Apply COOP/COEP headers when serving an `@ui` HTML document. No-op for
 * `embedded` mode so iframe embedding from a different origin keeps
 * working.
 */
export function applyCrossOriginIsolationHeaders(res: ServerResponse, mode: IsolationMode): void {
  if (mode !== 'standalone') return;
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
}

/**
 * Apply CORP `same-origin` to an asset response. Required so a standalone
 * parent page with COEP `require-corp` can still load the asset. Safe to
 * call unconditionally — the header has no negative effect on
 * non-isolated pages.
 */
export function applyCorpSameOrigin(res: ServerResponse): void {
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}
