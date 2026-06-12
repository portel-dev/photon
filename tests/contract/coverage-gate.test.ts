/**
 * Coverage gate — new surface area must arrive with its enforcement hooks.
 *
 * The fix-to-feature ratio in this repo's history is 1.3:1 because features
 * landed without the artifacts that keep them correct. This gate makes the
 * missing artifact a CI failure on the day the surface is added:
 *
 *   1. Every DaemonRequest type declared in the protocol must have a
 *      dispatch site in the daemon server AND appear in at least one test.
 *      A new request type without handler + test fails here, not in prod.
 *   2. Every format the registry claims Beam renders must have a
 *      FORMAT_CATALOG entry — the catalog example is what feeds the DOM
 *      render contract, so a missing entry means an untested renderer.
 *
 * (New OutputFormat values are already gated by tsc via FORMAT_COVERAGE;
 * new fixture methods are auto-covered by the conformance matrix.)
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FORMAT_COVERAGE } from '../../dist/formats/format-registry.js';
import { FORMAT_CATALOG, generateRenderersScript } from '../../dist/auto-ui/bridge/renderers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}\n     ${err.message}`);
  }
}

console.log('\n🚧 Coverage gate\n');

// ── Daemon protocol request types ────────────────────────────

function declaredRequestTypes(): string[] {
  const src = fs.readFileSync(path.join(ROOT, 'src/daemon/protocol.ts'), 'utf-8');
  const m = src.match(/interface DaemonRequest\s*\{\s*type:\s*([\s\S]*?);/);
  assert.ok(m, 'DaemonRequest type union not found in protocol.ts');
  const types: string[] = [];
  const lit = /'([^']+)'/g;
  let t: RegExpExecArray | null;
  while ((t = lit.exec(m[1])) !== null) types.push(t[1]);
  assert.ok(types.length > 5, `suspiciously few request types parsed: ${types.length}`);
  return types;
}

function listTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'fixtures') {
      listTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const requestTypes = declaredRequestTypes();

test(`every DaemonRequest type has a dispatch site in the daemon server (${requestTypes.length} types)`, () => {
  const server = fs.readFileSync(path.join(ROOT, 'src/daemon/server.ts'), 'utf-8');
  const unhandled = requestTypes.filter(
    (t) => !server.includes(`request.type === '${t}'`) && !server.includes(`case '${t}'`)
  );
  assert.deepEqual(
    unhandled,
    [],
    `protocol declares request types the daemon never dispatches: ${unhandled.join(', ')}`
  );
});

test('every DaemonRequest type appears in at least one test', () => {
  const corpus = listTestFiles(path.join(ROOT, 'tests'))
    .map((f) => fs.readFileSync(f, 'utf-8'))
    .join('\n');
  const untested = requestTypes.filter((t) => !corpus.includes(`'${t}'`));
  assert.deepEqual(
    untested,
    [],
    `request types with no test exercising them (add a case to daemon-protocol-validation or a dedicated test): ${untested.join(', ')}`
  );
});

// ── Bridge cells must match the real generated script ────────

function bridgeRegistrations(): Set<string> {
  const script = generateRenderersScript();
  const names = new Set<string>();
  for (const m of script.matchAll(/renderers(?:\.([a-zA-Z][\w-]*)|\['([^']+)'\])\s*=/g)) {
    names.add(m[1] || m[2]);
  }
  return names;
}

test('registry bridge cells match actual bridge registrations', () => {
  const registered = bridgeRegistrations();
  const stale: string[] = [];
  for (const [format, targets] of Object.entries(FORMAT_COVERAGE)) {
    const cell = (targets as any).bridge;
    const has = registered.has(format) || registered.has(format.split(':')[0]);
    if (cell.kind === 'renderer' && !has)
      stale.push(`${format} (claims renderer, none registered)`);
    if (cell.kind === 'fallback' && has) stale.push(`${format} (claims fallback, renderer exists)`);
  }
  assert.deepEqual(stale, [], `registry bridge cells out of sync: ${stale.join('; ')}`);
});

test('every bridge-rendered canonical format has a FORMAT_CATALOG entry (feeds the DOM contract)', () => {
  const missing = Object.entries(FORMAT_COVERAGE)
    .filter(([, targets]) => (targets as any).bridge.kind === 'renderer')
    .map(([format]) => format)
    .filter((format) => !(format in FORMAT_CATALOG));
  assert.deepEqual(
    missing,
    [],
    `bridge-rendered formats with no catalog example — the DOM render contract cannot test them: ${missing.join(', ')}`
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
