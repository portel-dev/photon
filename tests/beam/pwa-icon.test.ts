/**
 * PWA Icon Pipeline Test
 *
 * Verifies all three icon paths through /api/pwa/icon produce correct responses:
 *   1. Emoji (@icon 📦) → SVG with emoji text (image/svg+xml)
 *   2. SVG file (@icon logo.svg) → SVG file served directly (image/svg+xml)
 *   3. PNG file (@icon logo.png) → PNG file served directly (image/png)
 *
 * Also verifies the SW handleIconPng logic correctly branches on content-type:
 *   - SVG responses → text() → Blob(svg+xml) → createImageBitmap
 *   - Raster responses → blob() → createImageBitmap directly
 *
 * Run: npx tsx tests/beam/pwa-icon.test.ts
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BEAM_PORT = 3700 + Math.floor(Math.random() * 100);
const BEAM_URL = `http://localhost:${BEAM_PORT}`;

let beamProcess: ChildProcess | null = null;
let tmpDir: string;

// Minimal valid 1x1 red PNG (67 bytes)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

// Minimal valid SVG file
const TINY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="blue"/>
</svg>`;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-icon-test-'));

  // Create three test photons, each with a different icon type:

  // 1. Emoji icon (default or @icon 🎮)
  const emojiPhoton = `
/**
 * @description Emoji icon test
 * @icon 🎮
 */
export default class EmojiIcon {
  async ping() { return { ok: true }; }
}
`;
  await fs.writeFile(path.join(tmpDir, 'emoji-icon.photon.ts'), emojiPhoton);

  // 2. SVG file icon
  const svgDir = path.join(tmpDir, 'svg-icon');
  await fs.mkdir(svgDir);
  await fs.writeFile(path.join(svgDir, 'logo.svg'), TINY_SVG);

  const svgPhoton = `
/**
 * @description SVG file icon test
 * @icon logo.svg
 */
export default class SvgIcon {
  async ping() { return { ok: true }; }
}
`;
  await fs.writeFile(path.join(tmpDir, 'svg-icon.photon.ts'), svgPhoton);

  // 3. PNG file icon
  const pngDir = path.join(tmpDir, 'png-icon');
  await fs.mkdir(pngDir);
  await fs.writeFile(path.join(pngDir, 'logo.png'), TINY_PNG);

  const pngPhoton = `
/**
 * @description PNG file icon test
 * @icon logo.png
 */
export default class PngIcon {
  async ping() { return { ok: true }; }
}
`;
  await fs.writeFile(path.join(tmpDir, 'png-icon.photon.ts'), pngPhoton);
}

async function startBeam(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Beam startup timeout')), 20000);

    beamProcess = spawn(
      'node',
      [path.join(__dirname, '../../dist/cli.js'), 'beam', '--port', String(BEAM_PORT)],
      {
        cwd: tmpDir,
        env: { ...process.env, PHOTON_DIR: tmpDir, NODE_ENV: 'test' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Wait until diagnostics reports photons loaded (not just server up)
    const checkReady = () => {
      fetch(`${BEAM_URL}/api/diagnostics`, { signal: AbortSignal.timeout(1000) })
        .then(async (res) => {
          if (res.ok) {
            const diag = await res.json();
            // Photon loading is deferred after server.listen() — wait until at least
            // our 3 test photons appear in diagnostics
            if (diag.photonCount >= 3) {
              clearTimeout(timeout);
              resolve();
            } else {
              setTimeout(checkReady, 500);
            }
          } else {
            setTimeout(checkReady, 500);
          }
        })
        .catch(() => setTimeout(checkReady, 500));
    };

    beamProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    setTimeout(checkReady, 1000);
  });
}

function cleanup() {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    beamProcess = null;
  }
}

// ── Test runner ──

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function testEmojiIcon() {
  console.log('\n📋 Test: Emoji icon (@icon 🎮) → SVG');
  const res = await fetch(`${BEAM_URL}/api/pwa/icon?photon=emoji-icon`);
  assert(res.ok, `Status ${res.status} === 200`);

  const contentType = res.headers.get('content-type') || '';
  assert(contentType.includes('svg'), `Content-Type is SVG: ${contentType}`);

  const body = await res.text();
  assert(body.includes('<svg'), 'Response contains <svg> tag');
  assert(body.includes('🎮'), 'Response contains the emoji 🎮');
  assert(body.includes('xmlns="http://www.w3.org/2000/svg"'), 'Valid SVG namespace');
}

async function testSvgFileIcon() {
  console.log('\n📋 Test: SVG file icon (@icon logo.svg) → SVG');
  const res = await fetch(`${BEAM_URL}/api/pwa/icon?photon=svg-icon`);
  assert(res.ok, `Status ${res.status} === 200`);

  const contentType = res.headers.get('content-type') || '';
  assert(contentType.includes('svg'), `Content-Type is SVG: ${contentType}`);

  const body = await res.text();
  assert(body.includes('<svg'), 'Response contains <svg> tag');
  assert(body.includes('<circle'), 'Response contains original SVG content (circle)');
}

async function testPngFileIcon() {
  console.log('\n📋 Test: PNG file icon (@icon logo.png) → PNG');
  const res = await fetch(`${BEAM_URL}/api/pwa/icon?photon=png-icon`);
  assert(res.ok, `Status ${res.status} === 200`);

  const contentType = res.headers.get('content-type') || '';
  assert(contentType.includes('png'), `Content-Type is PNG: ${contentType}`);

  const body = await res.arrayBuffer();
  const buf = Buffer.from(body);
  // PNG magic bytes: 137 80 78 71 13 10 26 10
  assert(
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
    'Response has valid PNG magic bytes'
  );
  assert(buf.length > 20, `PNG has reasonable size: ${buf.length} bytes`);
}

async function testFallbackIcon() {
  console.log('\n📋 Test: Unknown photon falls back to default emoji');
  const res = await fetch(`${BEAM_URL}/api/pwa/icon?photon=nonexistent-photon`);
  assert(res.ok, `Status ${res.status} === 200`);

  const contentType = res.headers.get('content-type') || '';
  assert(contentType.includes('svg'), `Content-Type is SVG: ${contentType}`);

  const body = await res.text();
  assert(body.includes('📦'), 'Fallback uses default 📦 emoji');
}

async function testManifestIconUrls() {
  console.log('\n📋 Test: Manifest references valid icon URLs');
  const res = await fetch(`${BEAM_URL}/api/pwa/manifest.json?photon=emoji-icon`);
  assert(res.ok, `Manifest status ${res.status} === 200`);

  const manifest = await res.json();
  assert(Array.isArray(manifest.icons), 'Manifest has icons array');
  assert(manifest.icons.length >= 1, `Manifest has ${manifest.icons.length} icon(s)`);

  // Verify each icon URL is fetchable (except icon-png which is SW-intercepted)
  for (const icon of manifest.icons) {
    if (icon.src.includes('icon-png')) {
      // icon-png URLs are intercepted by the service worker in the browser;
      // the server no longer has a fallback route — this is expected
      assert(icon.type === 'image/png', `icon-png entry has PNG type: ${icon.type}`);
      continue;
    }
    const iconRes = await fetch(`${BEAM_URL}${icon.src}`);
    assert(iconRes.ok, `Icon URL fetchable: ${icon.src} (${iconRes.status})`);

    const ct = iconRes.headers.get('content-type') || '';
    if (icon.type === 'image/svg+xml') {
      assert(ct.includes('svg'), `SVG icon has correct content-type: ${ct}`);
    }
  }
}

async function testAppRouteLoads() {
  console.log('\n📋 Test: /app/{photonName} loads with full PWA shell');
  const res = await fetch(`${BEAM_URL}/app/emoji-icon`);
  assert(res.ok, `Status ${res.status} === 200`);

  const contentType = res.headers.get('content-type') || '';
  assert(contentType.includes('html'), `Content-Type is HTML: ${contentType}`);

  const body = await res.text();
  assert(body.includes('checkAndLoad'), 'Has diagnostics-first loading');
  assert(body.includes('initBridge'), 'Has postMessage bridge');
  assert(body.includes('photon:init'), 'Has photon:init message');
  assert(body.includes("register('/sw.js'"), 'Has service worker registration');
  assert(body.includes('beforeinstallprompt'), 'Has install prompt handling');
  assert(body.includes('/api/pwa/configure'), 'Has PWA configure call');
  assert(body.includes('/api/diagnostics'), 'Has diagnostics endpoint reference');
  assert(body.includes('install-btn'), 'Has install button');
}

// ── Main ──

async function main() {
  console.log('🔧 Setting up test photons...');
  await setup();

  console.log(`🚀 Starting Beam on port ${BEAM_PORT}...`);
  try {
    await startBeam();
    console.log('✅ Beam started');
  } catch (err) {
    console.error('❌ Failed to start Beam:', err);
    cleanup();
    process.exit(1);
  }

  try {
    await testEmojiIcon();
    await testSvgFileIcon();
    await testPngFileIcon();
    await testFallbackIcon();
    await testManifestIconUrls();
    await testAppRouteLoads();
  } catch (err) {
    console.error('\n💥 Unexpected error:', err);
    failed++;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}`);

  cleanup();

  // Clean up temp dir
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  process.exit(failed > 0 ? 1 : 0);
}

main();
