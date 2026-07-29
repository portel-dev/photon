import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

type Profile = {
  name: string;
  specVersion: string;
  suite?: 'active' | 'draft';
  scenarios?: string[];
};

const TASK_SCENARIOS = [
  'tasks-lifecycle',
  'tasks-capability-negotiation',
  'tasks-wire-fields',
  'tasks-request-state-removal',
  'tasks-mrtr-input',
  'tasks-request-headers',
  'tasks-dispatch-and-envelope',
  'tasks-required-task-error',
  'tasks-mrtr-composition',
];

const allProfiles: Profile[] = [
  { name: 'mcp-2025-http', specVersion: '2025-11-25' },
  { name: 'mcp-2026-http-core', specVersion: '2026-07-28' },
  { name: 'mcp-2026-http-draft', specVersion: '2026-07-28', suite: 'draft' },
  {
    name: 'mcp-2026-tasks-extension',
    specVersion: '2026-07-28',
    scenarios: TASK_SCENARIOS,
  },
];

const selectedProfile = process.env.MCP_CONFORMANCE_PROFILE;
const selectedScenario = process.env.MCP_CONFORMANCE_SCENARIO;
const profiles = allProfiles
  .filter(
    (profile) => !selectedProfile || selectedProfile === 'all' || profile.name === selectedProfile
  )
  .map((profile) => (selectedScenario ? { ...profile, scenarios: [selectedScenario] } : profile));
if (profiles.length === 0) {
  throw new Error(`Unknown MCP_CONFORMANCE_PROFILE: ${selectedProfile}`);
}

const artifactRoot = resolve(
  process.env.MCP_CONFORMANCE_OUTPUT_DIR ?? join('artifacts', 'mcp-conformance')
);
mkdirSync(artifactRoot, { recursive: true });
const runtimeRoot = mkdtempSync(join(tmpdir(), 'photon-official-conformance-'));
const fixture = resolve('tests/fixtures/mcp-official-conformance-server.ts');
const tsx = resolve('node_modules/tsx/dist/cli.mjs');
const conformance = resolve('node_modules/@modelcontextprotocol/conformance/dist/index.js');
let child: ChildProcess | undefined;

function spawnFixture(): Promise<number> {
  child = spawn(process.execPath, [tsx, fixture, runtimeRoot], {
    env: { ...process.env, PHOTON_DIR: runtimeRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stderr!.on('data', (chunk) => {
    stderr += chunk;
    if (process.env.MCP_FIXTURE_DEBUG === '1') process.stderr.write(chunk);
  });
  return new Promise((resolvePort, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`conformance fixture startup timed out:\n${stderr}`)),
      20_000
    );
    child!.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`conformance fixture exited ${code}:\n${stderr}`));
    });
    child!.stdout!.on('data', (chunk) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith('{'));
      if (!line) return;
      clearTimeout(timeout);
      resolvePort(JSON.parse(line).port);
    });
  });
}

function runCommand(args: string[], logPath: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const command = spawn(process.execPath, [conformance, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    command.stdout.setEncoding('utf8');
    command.stderr.setEncoding('utf8');
    command.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    command.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    const timeout = setTimeout(() => {
      command.kill('SIGTERM');
      reject(new Error(`Official conformance command timed out: ${args.join(' ')}`));
    }, 10 * 60_000);
    command.once('exit', (code) => {
      clearTimeout(timeout);
      writeFileSync(logPath, output);
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`Official conformance command exited ${code}: ${args.join(' ')}`));
      }
    });
  });
}

try {
  const port = await spawnFixture();
  const url = `http://127.0.0.1:${port}/mcp`;
  const pins = JSON.parse(readFileSync(resolve('tests/conformance/pins.json'), 'utf8'));
  writeFileSync(
    join(artifactRoot, 'run-metadata.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        url: 'http://127.0.0.1:<ephemeral>/mcp',
        profiles: profiles.map(({ name, specVersion, suite, scenarios }) => ({
          name,
          specVersion,
          scenarios: scenarios ?? suite ?? 'active',
        })),
        pins,
      },
      null,
      2
    )
  );

  for (const profile of profiles) {
    const profileDir = join(artifactRoot, profile.name);
    mkdirSync(profileDir, { recursive: true });
    const scenarios = profile.scenarios ?? [undefined];
    for (const scenario of scenarios) {
      const label = scenario ?? profile.suite ?? 'active';
      console.log(`\nOfficial MCP conformance: ${profile.name} / ${label}\n`);
      const outputDir = join(profileDir, label);
      mkdirSync(outputDir, { recursive: true });
      await runCommand(
        [
          'server',
          '--url',
          url,
          '--spec-version',
          profile.specVersion,
          ...(scenario
            ? ['--scenario', scenario, '--force']
            : ['--suite', profile.suite ?? 'active']),
          '--output-dir',
          outputDir,
        ],
        join(outputDir, 'runner.log')
      );
    }
  }
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  rmSync(runtimeRoot, { recursive: true, force: true });
}
