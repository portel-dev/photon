import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

let qrRuntime: string | undefined;

/**
 * Bundle the browser-safe QR implementation into the renderer response.
 *
 * The result is deliberately returned as source instead of being installed
 * through a second script element. This keeps the renderer runtime usable in
 * strict-CSP documents where only the canonical same-origin renderer script
 * is allowed to execute.
 */
export function getBundledQrRuntime(): string {
  if (qrRuntime) return qrRuntime;

  const require = createRequire(import.meta.url);
  const entryPoint = require.resolve('qrcode/lib/browser.js');
  qrRuntime = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'iife',
    globalName: 'PhotonQRCode',
    minify: true,
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0]?.text;

  if (!qrRuntime) throw new Error('Failed to bundle the browser QR renderer');
  return qrRuntime;
}
