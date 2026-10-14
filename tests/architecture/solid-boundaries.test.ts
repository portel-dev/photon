import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const source = (relative: string) => readFileSync(join(root, relative), 'utf8');

function assertNoImport(sourceText: string, forbidden: string, file: string): void {
  assert.equal(
    sourceText.includes(forbidden),
    false,
    `${file} must not depend on composition root ${forbidden}`
  );
}

// Composition services depend downward on ports/domain code, never upward into roots.
for (const file of [
  'src/tasks/runtime.ts',
  'src/server-status-service.ts',
  'src/photon-reload-service.ts',
  'src/mcp/session-registry.ts',
  'src/photon-load-result.ts',
]) {
  const text = source(file);
  assertNoImport(text, "from './server.js'", file);
  assertNoImport(text, "from './daemon/server.js'", file);
  assertNoImport(text, "from './auto-ui/streamable-http-transport.js'", file);
  assertNoImport(text, "from '../auto-ui/streamable-http-transport.js'", file);
}

// Extracted lifecycle services must expose explicit ownership rather than creating
// timers/listeners as module-import side effects.
const serviceFiles = [
  'src/tasks/runtime.ts',
  'src/mcp/session-registry.ts',
  'src/server-status-service.ts',
  'src/photon-reload-service.ts',
];
for (const file of serviceFiles) {
  const text = source(file);
  assert.equal(
    /^\s*(?:const|let|var)\s+\w+.*\bsetInterval\s*\(/m.test(text),
    false,
    `${file} has an import-time interval`
  );
  assert.equal(
    /^\s*(?:const|let|var)\s+\w+.*\bprocess\.on\s*\(/m.test(text),
    false,
    `${file} has an import-time process listener`
  );
}

// The transport facade must use one context factory and one injected task runtime
// for both official and legacy paths.
const transport = source('src/auto-ui/streamable-http-transport.ts');
assert.equal(transport.includes('function buildHandlerContext('), true);
assert.equal(transport.includes('taskRuntime: options.taskRuntime'), true);
assert.equal(transport.includes('startSessionCleanup();'), false);

// Every new architecture contract test is intentionally registered in the main
// runner; this prevents green-but-unexecuted architecture work.
const runner = source('scripts/run-tests.sh');
assert.equal(runner.includes('solid-boundaries'), true);

for (const file of [
  'src/photon-load-result.ts',
  'src/photon-reload-service.ts',
  'src/server-status-service.ts',
  'src/mcp/session-registry.ts',
  'tests/task-workspace-boundary.test.ts',
  'tests/task-runtime-recovery.test.ts',
]) {
  assert.equal(existsSync(join(root, file)), true, `${file} must exist`);
}

console.log('SOLID boundary checks passed');
