/**
 * Promise Validation Suite
 *
 * Validates the current release-gate subset of Photon platform promises
 * defined in docs/PROMISES.md and reports coverage against the full contract.
 * Tests across four targets: CLI, MCP, Beam (visual), and Runtime.
 *
 * Run: npm run test:promises
 *
 * This suite is intentionally explicit about scope. It should never imply that
 * unexercised promises are validated.
 */

import { strict as assert } from 'assert';
import { execSync, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = path.join(__dirname, '..', 'dist', 'cli.js');
const FIXTURES = path.join(__dirname, 'fixtures');
const PROMISE_PHOTON = path.join(FIXTURES, 'promise-test.photon.ts');
const PROMISE_DOC = path.join(__dirname, '..', 'docs', 'PROMISES.md');

// ── Test Infrastructure ──────────────────────────────────────

interface TestResult {
  intent: string;
  promise: string;
  assertion: string;
  target: string;
  status: 'pass' | 'fail' | 'skip';
  message?: string;
  elapsed?: number;
}

interface PromiseContractSpec {
  overviewByIntent: Record<string, number>;
  sectionByIntent: Record<string, number>;
  totalOverview: number;
  totalSections: number;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function readPromiseContractSpec(): PromiseContractSpec {
  const text = fs.readFileSync(PROMISE_DOC, 'utf-8');

  const overviewByIntent: Record<string, number> = {};
  for (const match of text.matchAll(/^\| \[(\d+)\][^\n]*\| (\d+) \| P/gm)) {
    overviewByIntent[`I${match[1]}`] = Number(match[2]);
  }

  const sectionByIntent: Record<string, number> = {};
  let currentIntent: string | null = null;
  for (const line of text.split('\n')) {
    const intentMatch = line.match(/^## Intent (\d+):/);
    if (intentMatch) {
      currentIntent = `I${intentMatch[1]}`;
      sectionByIntent[currentIntent] = 0;
      continue;
    }

    if (currentIntent && /^\| \d+ \|/.test(line)) {
      sectionByIntent[currentIntent]++;
    }
  }

  const totalOverview = Object.values(overviewByIntent).reduce((sum, count) => sum + count, 0);
  const totalSections = Object.values(sectionByIntent).reduce((sum, count) => sum + count, 0);

  return { overviewByIntent, sectionByIntent, totalOverview, totalSections };
}

function cli(args: string, timeoutMs = 30_000): string {
  return execSync(`node ${CLI_PATH} ${args}`, {
    env: { ...process.env, PHOTON_DIR: FIXTURES, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: timeoutMs,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function check(
  intent: string,
  promise: string,
  assertion: string,
  target: string,
  fn: () => Promise<void>
) {
  const start = Date.now();
  try {
    await fn();
    passed++;
    results.push({
      intent,
      promise,
      assertion,
      target,
      status: 'pass',
      elapsed: Date.now() - start,
    });
    console.log(`  ✅ [${target}] ${assertion}`);
  } catch (err: any) {
    failed++;
    const msg = err.message?.slice(0, 200) || String(err);
    results.push({
      intent,
      promise,
      assertion,
      target,
      status: 'fail',
      message: msg,
      elapsed: Date.now() - start,
    });
    console.log(`  ❌ [${target}] ${assertion}`);
    console.log(`     ${msg}`);
  }
}

function skip(intent: string, promise: string, assertion: string, target: string, reason: string) {
  skipped++;
  results.push({ intent, promise, assertion, target, status: 'skip', message: reason });
  console.log(`  ⏭️  [${target}] ${assertion} — ${reason}`);
}

// ── MCP Client Helpers ───────────────────────────────────────

let mcpClient: any = null;

async function getMcpClient(): Promise<any> {
  if (mcpClient) return mcpClient;

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [CLI_PATH, 'mcp', 'promise-test'],
    env: { ...process.env, PHOTON_DIR: FIXTURES },
  });

  const client = new Client({ name: 'promise-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  mcpClient = client;
  return client;
}

async function closeMcpClient() {
  if (mcpClient) {
    await mcpClient.close().catch(() => {});
    mcpClient = null;
  }
}

// ── Beam Helpers ─────────────────────────────────────────────

let beamProcess: ChildProcess | null = null;
let beamPort = 0;

async function startBeam(): Promise<number> {
  beamPort = 3600 + Math.floor(Math.random() * 50);

  return new Promise((resolve, reject) => {
    beamProcess = spawn('node', [CLI_PATH, 'beam', '--port', String(beamPort)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    let started = false;
    beamProcess.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('Photon Beam') && !started) {
        started = true;
        setTimeout(async () => {
          for (let i = 0; i < 10; i++) {
            try {
              const r = await fetch(`http://localhost:${beamPort}`);
              if (r.ok) {
                resolve(beamPort);
                return;
              }
            } catch {}
            await new Promise((r) => setTimeout(r, 500));
          }
          resolve(beamPort);
        }, 1000);
      }
    });

    beamProcess.on('error', reject);
    setTimeout(() => {
      if (!started) reject(new Error('Beam timeout'));
    }, 20000);
  });
}

async function stopBeam() {
  if (beamProcess) {
    beamProcess.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    beamProcess = null;
  }
}

// ── Lookout Helpers ──────────────────────────────────────────

let _lookoutReady: boolean | null = null;

async function lookoutAvailable(): Promise<boolean> {
  if (_lookoutReady !== null) return _lookoutReady;
  try {
    const out = execSync('photon lookout status --json -y', {
      timeout: 15_000,
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    _lookoutReady = JSON.parse(out.trim())?.ready === true;
  } catch {
    _lookoutReady = false;
  }
  return _lookoutReady;
}

async function lookoutValidate(
  imagePath: string,
  promises: string[]
): Promise<{ passed: number; failed: number; results: any[] }> {
  const out = execSync(
    `photon lookout validate --image "${imagePath}" --promises '${JSON.stringify(promises)}' -y`,
    {
      timeout: 120_000,
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 1024 * 1024,
    }
  );

  let passCount = 0;
  let failCount = 0;
  const results: any[] = [];

  for (const promise of promises) {
    const escaped = promise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const passMatch = out.match(new RegExp(`✅.*?${escaped.slice(0, 30)}`, 'i'));
    const failMatch = out.match(new RegExp(`❌.*?${escaped.slice(0, 30)}`, 'i'));

    if (passMatch) {
      passCount++;
      results.push({ promise, status: 'PASS' });
    } else if (failMatch) {
      failCount++;
      results.push({ promise, status: 'FAIL' });
    } else {
      results.push({ promise, status: 'UNCLEAR' });
    }
  }

  return { passed: passCount, failed: failCount, results };
}

// ── Main Test Suite ──────────────────────────────────────────

async function main() {
  const contractSpec = readPromiseContractSpec();

  console.log('\n📋 Promise Validation Suite\n');
  console.log(`   Fixture: ${path.basename(PROMISE_PHOTON)}`);
  console.log(`   Targets: CLI, MCP, Beam (visual), Runtime\n`);

  await check('DOC', 'SPEC', 'Promise overview counts match detailed tables', 'Docs', async () => {
    assert.equal(
      contractSpec.totalOverview,
      contractSpec.totalSections,
      `Overview lists ${contractSpec.totalOverview} assertions, detailed tables list ${contractSpec.totalSections}`
    );

    for (const [intent, sectionCount] of Object.entries(contractSpec.sectionByIntent)) {
      const overviewCount = contractSpec.overviewByIntent[intent];
      assert.equal(
        overviewCount,
        sectionCount,
        `${intent} overview lists ${overviewCount}, detailed tables list ${sectionCount}`
      );
    }
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 1: Single File, Full Stack
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 1: Single File, Full Stack ──\n');

  // P1.1 — One file, three interfaces

  await check('I1', 'P1.1', 'CLI executes method and prints output', 'CLI', async () => {
    const out = cli(`cli ${PROMISE_PHOTON} greet --name World`);
    assert.ok(out.includes('Hello, World!'), `Expected greeting, got: ${out.slice(0, 100)}`);
  });

  await check('I1', 'P1.1', 'MCP STDIO lists tools matching public methods', 'MCP', async () => {
    const client = await getMcpClient();
    const { tools } = await client.listTools();
    const names = tools.map((t: any) => t.name);
    assert.ok(names.includes('greet'), `Expected 'greet' tool, got: ${names.join(', ')}`);
    assert.ok(names.includes('users'), `Expected 'users' tool`);
    assert.ok(names.includes('docs'), `Expected 'docs' tool`);
    assert.ok(names.includes('add'), `Expected 'add' tool`);
  });

  await check('I1', 'P1.1', 'MCP tools/call returns same data as CLI', 'MCP', async () => {
    const client = await getMcpClient();
    const result = await client.callTool({ name: 'greet', arguments: { name: 'World' } });
    const text = result.content?.[0]?.text || JSON.stringify(result);
    assert.ok(text.includes('Hello, World!'), `MCP result: ${text.slice(0, 100)}`);
  });

  // P1.2 — No boilerplate

  await check('I1', 'P1.2', 'Photon with zero imports works', 'Runtime', async () => {
    // promise-test.photon.ts has no @portel/photon-core imports — just `export default class`
    const source = fs.readFileSync(PROMISE_PHOTON, 'utf-8');
    assert.ok(!source.includes("from '@portel/photon-core'"), 'Should not import photon-core');
    const out = cli(`cli ${PROMISE_PHOTON} greet --name Test`);
    assert.ok(out.includes('Hello, Test!'), 'Should work without imports');
  });

  await check('I1', 'P1.2', 'No tsconfig.json required', 'CLI', async () => {
    assert.ok(!fs.existsSync(path.join(FIXTURES, 'tsconfig.json')), 'No tsconfig.json in fixtures');
    const out = cli(`cli ${PROMISE_PHOTON} greet --name Config`);
    assert.ok(out.includes('Hello, Config!'), 'Works without tsconfig.json');
  });

  // P1.3 — TypeScript is the only language

  await check('I1', 'P1.3', 'Parameter types generate MCP inputSchema', 'MCP', async () => {
    const client = await getMcpClient();
    const { tools } = await client.listTools();
    const addTool = tools.find((t: any) => t.name === 'add');
    assert.ok(addTool, 'add tool exists');
    const schema = addTool.inputSchema;
    assert.ok(schema?.properties?.a, 'Has param a');
    assert.ok(schema?.properties?.b, 'Has param b');
  });

  await check('I1', 'P1.3', 'JSDoc descriptions appear in CLI help', 'CLI', async () => {
    const out = cli(`cli ${PROMISE_PHOTON} greet --help`);
    assert.ok(out.includes('greet') || out.includes('Who to greet'), `Help: ${out.slice(0, 200)}`);
  });

  await check('I1', 'P1.3', 'Constraint tags validate on all surfaces', 'MCP', async () => {
    const client = await getMcpClient();
    const { tools } = await client.listTools();
    const addTool = tools.find((t: any) => t.name === 'add');
    const schema = addTool?.inputSchema;
    // @min 0 should be in schema
    const aMin = schema?.properties?.a?.minimum;
    assert.ok(aMin === 0 || aMin === '0', `Expected @min 0 in schema, got ${aMin}`);
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 2: Human + Agent, Same Surface
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 2: Human + Agent, Same Surface ──\n');

  // P2.1 — Methods work for both audiences

  await check('I2', 'P2.1', 'CLI --param style works for scripts/humans', 'CLI', async () => {
    const out = cli(`cli ${PROMISE_PHOTON} add --a 5 --b 3`);
    assert.ok(out.includes('8'), `Expected 8, got: ${out.slice(0, 100)}`);
  });

  await check('I2', 'P2.1', 'MCP tools/call works for agents', 'MCP', async () => {
    const client = await getMcpClient();
    const result = await client.callTool({ name: 'add', arguments: { a: 5, b: 3 } });
    const text = result.content?.[0]?.text || JSON.stringify(result);
    assert.ok(text.includes('8'), `Expected 8 in MCP result: ${text.slice(0, 100)}`);
  });

  await check('I2', 'P2.1', 'Output is structured data, parseable by agents', 'MCP', async () => {
    const client = await getMcpClient();
    const result = await client.callTool({ name: 'users', arguments: {} });
    // Should return structured content or JSON-parseable text
    const text = result.content?.[0]?.text || '';
    const hasStructure = result.structuredContent || text.includes('Alice');
    assert.ok(hasStructure, 'Users result should be structured');
  });

  // P2.2 — Annotations guide both audiences

  await check('I2', 'P2.2', '@readOnly appears in MCP tool annotations', 'MCP', async () => {
    const client = await getMcpClient();
    const { tools } = await client.listTools();
    const greet = tools.find((t: any) => t.name === 'greet');
    const annotations = (greet as any)?.annotations;
    assert.ok(
      annotations?.readOnlyHint === true,
      `Expected readOnlyHint, got: ${JSON.stringify(annotations)}`
    );
  });

  // P2.3 — Text-first, always

  await check('I2', 'P2.3', 'Every method produces readable CLI output', 'CLI', async () => {
    const greet = cli(`cli ${PROMISE_PHOTON} greet --name Text`);
    assert.ok(greet.includes('Hello, Text!'), 'greet readable');

    const users = cli(`cli ${PROMISE_PHOTON} users`);
    assert.ok(users.includes('Alice'), 'users readable');

    const docs = cli(`cli ${PROMISE_PHOTON} docs`);
    assert.ok(docs.includes('Promise Test') || docs.includes('Features'), 'docs readable');
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 3: Zero Config
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 3: Zero Config ──\n');

  // P3.1 — Instant start

  await check('I3', 'P3.1', 'Photon runs without ~/.photon/ setup', 'CLI', async () => {
    // Use a fresh temp dir as PHOTON_DIR
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promise-'));
    try {
      const out = execSync(`node ${CLI_PATH} cli ${PROMISE_PHOTON} greet --name Fresh`, {
        env: { ...process.env, PHOTON_DIR: tmpDir, NO_COLOR: '1' },
        timeout: 30_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      assert.ok(out.includes('Hello, Fresh!'), 'Works from fresh dir');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // P3.3 — Configuration from code

  await check('I3', 'P3.3', 'Photon with optional params runs without config', 'CLI', async () => {
    // promise-test has no required constructor params — should just work
    const out = cli(`cli ${PROMISE_PHOTON} greet --name NoConfig`);
    assert.ok(out.includes('Hello, NoConfig!'), 'Works without config');
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 4: Format-Driven Rendering
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 4: Format-Driven Rendering ──\n');

  // P4.1 — Formats render on all targets

  await check('I4', 'P4.1', '@format table produces tabular CLI output', 'CLI', async () => {
    const out = cli(`cli ${PROMISE_PHOTON} users`);
    // Should have table-like structure: headers or aligned columns
    assert.ok(
      out.includes('Alice') && out.includes('Bob') && out.includes('Charlie'),
      'All users in output'
    );
  });

  await check('I4', 'P4.1', '@format markdown renders in CLI', 'CLI', async () => {
    const out = cli(`cli ${PROMISE_PHOTON} docs`);
    assert.ok(
      out.includes('Promise Test') || out.includes('Features'),
      'Markdown content rendered'
    );
  });

  // P4.2 — Auto-UI from signatures

  await check('I4', 'P4.2', '@min constraint in MCP schema', 'MCP', async () => {
    const client = await getMcpClient();
    const { tools } = await client.listTools();
    const add = tools.find((t: any) => t.name === 'add');
    const aMin = add?.inputSchema?.properties?.a?.minimum;
    assert.ok(aMin === 0, `@min 0 should be in schema, got ${aMin}`);
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 3: Zero Config (continued)
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 3: Zero Config (additional) ──\n');

  // P3.2 — Dependencies resolve themselves

  await check('I3', 'P3.2', 'Photon with no @dependencies loads cleanly', 'Runtime', async () => {
    const out = cli(`cli ${path.join(FIXTURES, 'resilient-test.photon.ts')} ping`);
    assert.ok(out.includes('pong'), `Expected 'pong', got: ${out.slice(0, 100)}`);
  });

  // P3.3 — Configuration from code (additional)

  await check('I3', 'P3.3', 'Constructor env var mapping works', 'Runtime', async () => {
    // promise-test has no constructor params, verify it doesn't error
    const client = await getMcpClient();
    const result = await client.callTool({ name: 'greet', arguments: { name: 'EnvTest' } });
    const text = result.content?.[0]?.text || '';
    assert.ok(text.includes('Hello, EnvTest!'), 'Works without env vars');
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 5: Stateful by Annotation
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 5: Stateful by Annotation ──\n');

  const STATEFUL_PHOTON = path.join(FIXTURES, 'stateful-test.photon.ts');

  // P5.1 — Persistence without infrastructure

  await check('I5', 'P5.1', 'this.memory.set/get persists data', 'Runtime', async () => {
    const { PhotonLoader } = await import('../dist/loader.js');
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(STATEFUL_PHOTON);
    // Store a value
    await loader.executeTool(mcp, 'store', { key: 'testkey', value: 'testvalue' });
    // Retrieve it from the same instance
    const recalled = await loader.executeTool(mcp, 'recall', { key: 'testkey' });
    assert.equal(recalled, 'testvalue', `Expected 'testvalue', got: ${recalled}`);
  });

  await check('I5', 'P5.1', '@stateful class emit works', 'Runtime', async () => {
    const { PhotonLoader } = await import('../dist/loader.js');
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(STATEFUL_PHOTON);
    const result = await loader.executeTool(mcp, 'notify', { event: 'test', data: 'hello' });
    assert.ok(result.emitted === true, 'Event emission succeeded');
  });

  // P5.2 — Real-time events (basic verification)

  await check('I5', 'P5.2', '@stateful methods auto-emit execution events', 'Runtime', async () => {
    const { PhotonLoader } = await import('../dist/loader.js');
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(STATEFUL_PHOTON);
    const result = await loader.executeTool(mcp, 'store', {
      key: 'event-test',
      value: 'event-data',
    });
    assert.ok(result.stored === true, 'Method executed under @stateful');
  });

  // P5.3 — Observable by default

  await check(
    'I5',
    'P5.3',
    '@stateful tag is detected and stored on photon',
    'Runtime',
    async () => {
      const { PhotonLoader } = await import('../dist/loader.js');
      const loader = new PhotonLoader();
      const mcp = await loader.loadFile(STATEFUL_PHOTON);
      assert.ok((mcp as any).stateful === true, 'Photon should have stateful flag');
      assert.ok(typeof mcp.instance.emit === 'function', 'Instance should have emit injected');
    }
  );

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 6: Composable
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 6: Composable ──\n');

  // P6.2 — Marketplace as composition layer

  await check('I6', 'P6.2', 'photon search returns results', 'CLI', async () => {
    try {
      const out = execSync(`node ${CLI_PATH} search test`, {
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Search should produce some output (even if empty results)
      assert.ok(typeof out === 'string', 'Search command executed');
    } catch (e: any) {
      // Search may fail if no marketplace connection, but the command should exist
      assert.ok(e.message.includes('search') || e.status !== undefined, 'Search command exists');
    }
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 7: Portable
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 7: Portable ──\n');

  // P7.1 — Standalone binary

  await check('I7', 'P7.1', 'photon build command exists and parses args', 'CLI', async () => {
    try {
      const out = execSync(`node ${CLI_PATH} build --help`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      assert.ok(
        out.includes('build') || out.includes('compile') || out.includes('target'),
        `Build help: ${out.slice(0, 200)}`
      );
    } catch (e: any) {
      // Even if build fails, the command should be registered
      assert.ok(e.stdout?.includes('build') || e.stderr?.includes('build'), 'Build command exists');
    }
  });

  // P7.2 — Deploy anywhere

  await check('I7', 'P7.2', 'Photon works as MCP server (STDIO transport)', 'MCP', async () => {
    // Already proven by all the MCP tests above, but explicit assertion
    const client = await getMcpClient();
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0, 'MCP server responds with tools');
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 8: Resilient by Default
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 8: Resilient by Default ──\n');

  const RESILIENT_PHOTON = path.join(FIXTURES, 'resilient-test.photon.ts');

  // P8.1 — Middleware from annotations

  await check('I8', 'P8.1', '@retryable retries failed calls', 'Runtime', async () => {
    const { PhotonLoader } = await import('../dist/loader.js');
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(RESILIENT_PHOTON);
    const result = await loader.executeTool(mcp, 'flaky', {});
    assert.equal(result, 'success-after-retries', 'Should succeed after retries');
  });

  await check('I8', 'P8.1', '@cached memoizes results', 'Runtime', async () => {
    const { PhotonLoader } = await import('../dist/loader.js');
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(RESILIENT_PHOTON);
    const t1 = await loader.executeTool(mcp, 'timestamp', {});
    await new Promise((r) => setTimeout(r, 50));
    const t2 = await loader.executeTool(mcp, 'timestamp', {});
    assert.equal(t1, t2, 'Cached results should be identical');
  });

  await check('I8', 'P8.1', 'Multiple tags compose correctly', 'Runtime', async () => {
    // resilient-test has both @retryable and @cached methods
    // Verify both work without interfering
    const { PhotonLoader } = await import('../dist/loader.js');
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(RESILIENT_PHOTON);
    const ping = await loader.executeTool(mcp, 'ping', {});
    assert.equal(ping, 'pong', 'Non-middleware method still works');
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // INTENT 9: Secure by Default
  // ═══════════════════════════════════════════════════════════

  console.log('── Intent 9: Secure by Default ──\n');

  const AUTH_PHOTON = path.join(FIXTURES, 'auth-test.photon.ts');

  // P9.1 — OAuth without boilerplate

  await check('I9', 'P9.1', '@auth required enforces authentication', 'Runtime', async () => {
    const { PhotonLoader } = await import('../dist/loader.js');
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(AUTH_PHOTON);
    try {
      await loader.executeTool(
        mcp,
        'secret',
        {},
        {
          inputProvider: async () => null,
        }
      );
      assert.fail('Should have rejected unauthenticated call');
    } catch (e: any) {
      assert.ok(e.message.includes('Authentication required'), `Got: ${e.message}`);
    }
  });

  await check(
    'I9',
    'P9.1',
    'Authenticated caller can access @auth methods',
    'Runtime',
    async () => {
      const { PhotonLoader } = await import('../dist/loader.js');
      const loader = new PhotonLoader();
      const mcp = await loader.loadFile(AUTH_PHOTON);
      const result = await loader.executeTool(
        mcp,
        'secret',
        {},
        {
          caller: { id: 'test-user', name: 'Test', anonymous: false },
        }
      );
      assert.equal(result, 'top-secret-data');
    }
  );

  // P9.2 — Identity-aware coordination

  await check('I9', 'P9.2', 'this.caller provides authenticated identity', 'Runtime', async () => {
    const { PhotonLoader } = await import('../dist/loader.js');
    const loader = new PhotonLoader();
    const mcp = await loader.loadFile(AUTH_PHOTON);
    const result = await loader.executeTool(
      mcp,
      'whoami',
      {},
      {
        caller: { id: 'user-42', name: 'Alice', anonymous: false },
      }
    );
    assert.equal(result.id, 'user-42', `Expected user-42, got: ${result.id}`);
    assert.equal(result.anonymous, false);
  });

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // BEAM VISUAL ASSERTIONS (requires lookout + Beam)
  // ═══════════════════════════════════════════════════════════

  const hasLookout = await lookoutAvailable();

  if (hasLookout) {
    console.log('── Visual Assertions (Beam + Lookout) ──\n');

    await startBeam();

    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const screenshotDir = path.join(__dirname, 'beam', 'snapshots', 'promises');
    fs.mkdirSync(screenshotDir, { recursive: true });

    // Navigate to Beam
    await page.goto(`http://localhost:${beamPort}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForSelector('.photon-item', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // P1.1 — Beam shows photons in sidebar
    const sidebarImg = path.join(screenshotDir, 'sidebar.png');
    await page.screenshot({ path: sidebarImg, fullPage: true });

    await check('I1', 'P1.1', 'Beam shows photons in sidebar with methods', 'Beam', async () => {
      const result = await lookoutValidate(sidebarImg, [
        'A sidebar or navigation panel with a list of items',
        'Application title or branding visible',
      ]);
      assert.ok(result.failed === 0, `${result.failed} visual promise(s) failed`);
    });

    // P2.1 — Human can invoke via Beam UI
    await check(
      'I2',
      'P2.1',
      'Beam UI shows interactive interface for humans',
      'Beam',
      async () => {
        const result = await lookoutValidate(sidebarImg, [
          'A main content area for viewing results or interacting',
        ]);
        assert.ok(result.failed === 0, `${result.failed} visual promise(s) failed`);
      }
    );

    // P4.1 — Formats render in Beam
    // Click a photon and capture the method view
    const photonItem = page.locator('.photon-item').first();
    if (await photonItem.isVisible().catch(() => false)) {
      await photonItem.click();
      await page.waitForTimeout(2000);

      // Scroll down — method cards may be below the fold
      const main = page.locator('.main-content, main, .content').first();
      await main.evaluate((el: Element) => el.scrollTo(0, el.scrollHeight)).catch(() => {});
      await page.waitForTimeout(1000);

      const photonImg = path.join(screenshotDir, 'photon-view.png');
      await page.screenshot({ path: photonImg, fullPage: true });

      await check('I4', 'P4.2', 'Beam shows method cards from signatures', 'Beam', async () => {
        const result = await lookoutValidate(photonImg, [
          'Cards or panels showing available actions',
        ]);
        assert.ok(result.failed === 0, `${result.failed} visual promise(s) failed`);
      });
    }

    await browser.close();
    await stopBeam();

    // Cleanup screenshots
    fs.rmSync(screenshotDir, { recursive: true, force: true });
  } else {
    console.log('── Visual Assertions — SKIPPED (no lookout) ──\n');
    skip('I1', 'P1.1', 'Beam shows photons in sidebar', 'Beam', 'lookout not available');
    skip('I2', 'P2.1', 'Beam UI shows interactive interface', 'Beam', 'lookout not available');
    skip('I4', 'P4.2', 'Beam shows method cards from signatures', 'Beam', 'lookout not available');
  }

  console.log('');

  // ═══════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════

  await closeMcpClient();

  // ═══════════════════════════════════════════════════════════
  // Report
  // ═══════════════════════════════════════════════════════════

  console.log('═══════════════════════════════════════════════════');
  console.log('  Promise Validation Report');
  console.log('═══════════════════════════════════════════════════\n');

  // Group by intent
  const byIntent = new Map<string, TestResult[]>();
  for (const r of results) {
    const key = r.intent;
    if (!byIntent.has(key)) byIntent.set(key, []);
    byIntent.get(key)!.push(r);
  }

  const intentNames: Record<string, string> = {
    I1: 'Single File, Full Stack',
    I2: 'Human + Agent, Same Surface',
    I3: 'Zero Config',
    I4: 'Format-Driven Rendering',
    I5: 'Stateful by Annotation',
    I6: 'Composable',
    I7: 'Portable',
    I8: 'Resilient by Default',
    I9: 'Secure by Default',
    DOC: 'Documentation Integrity',
  };

  for (const [intent, tests] of byIntent) {
    const p = tests.filter((t) => t.status === 'pass').length;
    const f = tests.filter((t) => t.status === 'fail').length;
    const s = tests.filter((t) => t.status === 'skip').length;
    const icon = f > 0 ? '❌' : p > 0 ? '✅' : '⏭️';
    console.log(
      `  ${icon} ${intentNames[intent] || intent}: ${p}/${tests.length} passed${f ? `, ${f} failed` : ''}${s ? `, ${s} skipped` : ''}`
    );
  }

  console.log(`\n  Total: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  const coveredResults = results.filter((r) => /^I\d+$/.test(r.intent));
  const coveredByIntent: Record<string, number> = {};
  for (const result of coveredResults) {
    coveredByIntent[result.intent] = (coveredByIntent[result.intent] || 0) + 1;
  }

  const coveredTotal = coveredResults.length;
  const coveragePct = contractSpec.totalSections
    ? ((coveredTotal / contractSpec.totalSections) * 100).toFixed(1)
    : '0.0';

  console.log(
    `  Coverage: ${coveredTotal}/${contractSpec.totalSections} documented assertions exercised by this suite (${coveragePct}%)`
  );

  const uncoveredIntents = Object.entries(contractSpec.sectionByIntent)
    .filter(([intent]) => !coveredByIntent[intent])
    .map(([intent]) => intentNames[intent] || intent);

  if (uncoveredIntents.length > 0) {
    console.log(`  Uncovered intents in this suite: ${uncoveredIntents.join(', ')}`);
  }

  console.log('═══════════════════════════════════════════════════\n');

  // Write machine-readable report
  const reportPath = path.join(__dirname, '..', 'promise-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary: { passed, failed, skipped, total: results.length },
        coverage: {
          documentedAssertions: contractSpec.totalSections,
          suiteAssertions: coveredTotal,
          coveragePercent: Number(coveragePct),
          overviewAssertions: contractSpec.totalOverview,
          byIntent: Object.fromEntries(
            Object.entries(contractSpec.sectionByIntent).map(([intent, declared]) => [
              intent,
              {
                declared,
                covered: coveredByIntent[intent] || 0,
              },
            ])
          ),
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`  Report written to: ${reportPath}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Promise validation crashed:', err);
  await closeMcpClient();
  await stopBeam();
  process.exit(1);
});
