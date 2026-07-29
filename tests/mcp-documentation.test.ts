import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { spawn, type ChildProcess } from 'node:child_process';
import { MCP_COMPLIANCE_MANIFEST } from '../src/mcp/protocol/compliance.js';
import { MCP_EXTENSION_REGISTRY } from '../src/mcp/protocol/extensions.js';
import { SUPPORTED_MCP_PROTOCOL_VERSIONS } from '../src/mcp/protocol/versions.js';

const execFileAsync = promisify(execFile);
const runtimeRoot = await mkdtemp(join(tmpdir(), 'photon-mcp-docs-'));
const fixture = resolve('tests/fixtures/mcp-official-conformance-server.ts');
const tsx = resolve('node_modules/tsx/dist/cli.mjs');
let server: ChildProcess | undefined;

async function startFixture(): Promise<number> {
  server = spawn(process.execPath, [tsx, fixture, runtimeRoot], {
    env: { ...process.env, PHOTON_DIR: runtimeRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.setEncoding('utf8');
  server.stderr!.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  server.stderr!.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolvePort, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`MCP documentation fixture timed out:\n${stderr}`)),
      20_000
    );
    server!.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`MCP documentation fixture exited ${code}:\n${stderr}`));
    });
    server!.stdout!.on('data', (chunk) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/u).find((candidate) => candidate.startsWith('{'));
      if (!line) return;
      clearTimeout(timeout);
      resolvePort(JSON.parse(line).port);
    });
  });
}

try {
  const port = await startFixture();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const options = {
    cwd: process.cwd(),
    env: { ...process.env, PHOTON_DIR: runtimeRoot },
    maxBuffer: 4 * 1024 * 1024,
  };

  const legacy = await execFileAsync(
    process.execPath,
    [resolve('examples/mcp-clients/legacy-2025.mjs'), endpoint],
    options
  );
  const legacyOutput = JSON.parse(legacy.stdout.trim().split(/\r?\n/u).at(-1)!);
  assert.equal(legacyOutput.protocol, 'MCP 2025 sessionful');
  assert(legacyOutput.tools.includes('greet'));

  const modern = await execFileAsync(
    process.execPath,
    [resolve('examples/mcp-clients/stateless-2026.mjs'), endpoint],
    options
  );
  const modernOutput = JSON.parse(modern.stdout.trim().split(/\r?\n/u).at(-1)!);
  assert.equal(modernOutput.protocol, '2026-07-28');
  assert.equal(modernOutput.lifecycle, 'stateless');
  assert(modernOutput.supportedVersions.includes('2025-11-25'));
  assert(modernOutput.tools.includes('greet'));

  const doctor = await execFileAsync(
    process.execPath,
    [resolve('dist/cli.js'), 'doctor', 'mcp'],
    options
  );
  const doctorOutput = `${doctor.stdout}\n${doctor.stderr}`.toLowerCase();
  for (const expected of [
    'Photon Doctor: MCP',
    '2025-03-26',
    '2025-11-25',
    '2026-07-28',
    'io.modelcontextprotocol/ui',
    'io.modelcontextprotocol/tasks',
    '42/42',
    '80/80',
  ]) {
    assert(doctorOutput.includes(expected.toLowerCase()), `doctor output is missing ${expected}`);
  }

  assert.deepEqual(
    MCP_COMPLIANCE_MANIFEST.extensions.map((extension) => extension.id),
    MCP_EXTENSION_REGISTRY.map((extension) => extension.id),
    'release manifest and runtime extension registry diverged'
  );
  assert.deepEqual(
    MCP_COMPLIANCE_MANIFEST.protocols.map((protocol) => protocol.version),
    [...SUPPORTED_MCP_PROTOCOL_VERSIONS],
    'release manifest and runtime protocol versions diverged'
  );

  const compatibility = await readFile(resolve('docs/guides/MCP-COMPATIBILITY.md'), 'utf8');
  const releaseNotes = await readFile(resolve('docs/guides/MCP-2026-RELEASE-NOTES.md'), 'utf8');
  for (const protocol of MCP_COMPLIANCE_MANIFEST.protocols) {
    assert(compatibility.includes(protocol.version));
  }
  for (const extension of MCP_COMPLIANCE_MANIFEST.extensions) {
    assert(compatibility.includes(extension.id));
  }
  assert(releaseNotes.includes('Known limitations'));
  assert(releaseNotes.includes('Rollback'));

  console.log('MCP documentation clients, doctor output, and release manifest are in sync.');
} finally {
  if (server && server.exitCode === null) server.kill('SIGTERM');
  await rm(runtimeRoot, { recursive: true, force: true });
}
