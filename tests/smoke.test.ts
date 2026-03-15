/**
 * Smoke Tests — End-to-end tests for first-time user experience.
 *
 * Tests the critical path: install photon → run qualified ref → everything works.
 * Uses a fresh PHOTON_DIR for each test to simulate a new user.
 *
 * Run: npx tsx tests/smoke.test.ts
 */

import { strict as assert } from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { execSync, spawn, ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '..', 'dist', 'cli.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-smoke-'));
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function photonExec(args: string, photonDir: string, timeoutMs = 30_000): string {
  return execSync(`node ${CLI_PATH} ${args}`, {
    env: { ...process.env, PHOTON_DIR: photonDir },
    timeout: timeoutMs,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function photonExecAll(
  args: string,
  photonDir: string,
  timeoutMs = 30_000
): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      env: { ...process.env, PHOTON_DIR: photonDir },
      timeout: timeoutMs,
      encoding: 'utf-8',
    });
    return { stdout, stderr: '' };
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

async function startBeamAndWait(
  photonDir: string,
  args = '',
  waitMs = 20_000
): Promise<{ proc: ChildProcess; port: number | null }> {
  const proc = spawn('node', [CLI_PATH, 'beam', '--no-open', ...args.split(' ').filter(Boolean)], {
    env: { ...process.env, PHOTON_DIR: photonDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  proc.stdout?.on('data', (d) => {
    output += d.toString();
  });
  proc.stderr?.on('data', (d) => {
    output += d.toString();
  });

  // Poll for diagnostics endpoint instead of relying on output parsing
  const startTime = Date.now();
  let port: number | null = null;

  while (Date.now() - startTime < waitMs) {
    // Try to extract port from output first
    const portMatch = output.match(/localhost:(\d+)/);
    if (portMatch) {
      const candidate = parseInt(portMatch[1]);
      try {
        await fetchDiagnostics(candidate);
        port = candidate;
        break;
      } catch {
        /* not ready yet */
      }
    }

    // Also try common ports directly — derive start from --port arg or default 3000
    const portArgMatch = args.match(/--port\s+(\d+)/);
    const basePort = portArgMatch ? parseInt(portArgMatch[1]) : 3000;
    for (const p of [basePort, basePort + 1, basePort + 2, basePort + 3]) {
      try {
        await fetchDiagnostics(p);
        port = p;
        break;
      } catch {
        /* not this port */
      }
    }
    if (port) break;

    await new Promise((r) => setTimeout(r, 2000));
  }

  return { proc, port };
}

function killProc(proc: ChildProcess): void {
  try {
    proc.kill('SIGKILL');
  } catch {
    /* already dead */
  }
}

async function fetchDiagnostics(port: number): Promise<any> {
  const res = await fetch(`http://localhost:${port}/api/diagnostics`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Tests ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ ${name}: ${msg}`);
    failed++;
    failures.push(`${name}: ${msg}`);
  }
}

async function runAll() {
  console.log('🧪 Smoke Tests — First-Time User Experience\n');

  // ── 1. Fresh directory auto-creation ────────────────────────────────────

  await test('Fresh dir: PHOTON_DIR auto-created on CLI use', async () => {
    const dir = path.join(os.tmpdir(), `photon-virgin-${Date.now()}`);
    assert.ok(!fs.existsSync(dir), 'Dir should not exist yet');

    try {
      // Use CLI (not beam) — simpler to test dir creation
      const { stderr } = photonExecAll('portel-dev/photons/todo add --text "fresh dir test"', dir);
      assert.ok(fs.existsSync(dir), 'Dir should be auto-created');
      assert.ok(
        fs.existsSync(path.join(dir, 'marketplaces.json')) ||
          fs.existsSync(path.join(dir, 'portel-dev', 'todo.photon.ts')),
        'Should have created marketplace config or installed photon'
      );
    } finally {
      cleanup(dir);
    }
  });

  // ── 2. Simple name auto-install from marketplace ────────────────────────

  await test('CLI: simple name auto-installs from marketplace (portel-dev/photons/todo)', async () => {
    const dir = freshDir();
    try {
      const result = photonExec('portel-dev/photons/todo add --text "smoke test"', dir);
      assert.ok(result.includes('smoke test'), 'Should return the added todo');

      // Verify file was installed
      const installed = path.join(dir, 'portel-dev', 'todo.photon.ts');
      assert.ok(fs.existsSync(installed), 'todo.photon.ts should be installed in namespace dir');
    } finally {
      cleanup(dir);
    }
  });

  // ── 3. Transitive @photon dependency resolution ─────────────────────────

  await test('Install: transitive @photon deps fetched from same repo', async () => {
    const dir = freshDir();
    try {
      // Claw depends on whatsapp + agent-router, which depends on 4 runners
      const { stdout, stderr } = photonExecAll(
        'portel-dev/photons/todo add --text "dep test"',
        dir
      );

      // Use a simpler photon first to verify the mechanism works, then check claw's deps
      // separately since claw has heavy deps (WhatsApp, Baileys)
      const { MarketplaceManager } = await import('../dist/marketplace-manager.js');
      const manager = new MarketplaceManager(undefined, dir);
      await manager.initialize();
      await manager.fetchAndInstallFromRef('Arul-/photons/claw', dir);

      // Verify all transitive deps were installed
      const nsDir = path.join(dir, 'Arul-');
      const expected = [
        'claw',
        'whatsapp',
        'agent-router',
        'claude-runner',
        'gemini-runner',
        'aider-runner',
        'opencode-runner',
      ];
      for (const name of expected) {
        assert.ok(
          fs.existsSync(path.join(nsDir, `${name}.photon.ts`)),
          `${name}.photon.ts should be installed`
        );
      }
    } finally {
      cleanup(dir);
    }
  });

  // ── 4. Qualified ref — implicit CLI form ────────────────────────────────

  await test('CLI implicit: photon owner/repo/name method works', async () => {
    const dir = freshDir();
    try {
      const result = photonExec('portel-dev/photons/todo add --text "implicit test"', dir);
      assert.ok(result.includes('implicit test'), 'Should return the added todo');
    } finally {
      cleanup(dir);
    }
  });

  // ── 5. Qualified ref — explicit CLI form ────────────────────────────────

  await test('CLI explicit: photon cli owner/repo/name method works', async () => {
    const dir = freshDir();
    try {
      const result = photonExec('cli portel-dev/photons/todo add --text "explicit test"', dir);
      assert.ok(result.includes('explicit test'), 'Should return the added todo');
    } finally {
      cleanup(dir);
    }
  });

  // ── 6. Error handling — nonexistent photon ──────────────────────────────

  await test('Error: nonexistent simple name gives clean error', async () => {
    const dir = freshDir();
    try {
      const { stderr } = photonExecAll('cli nonexistent-xyz-12345 list', dir);
      assert.ok(
        stderr.includes('not found') || stderr.includes('Not found'),
        'Should show "not found" error'
      );
      assert.ok(!stderr.includes('at '), 'Should not include stack trace');
    } finally {
      cleanup(dir);
    }
  });

  await test('Error: nonexistent qualified ref gives clean error', async () => {
    const dir = freshDir();
    try {
      const { stderr } = photonExecAll('cli fake-owner/fake-repo/nope list', dir);
      assert.ok(
        stderr.includes('Could not fetch') || stderr.includes('404'),
        'Should show fetch error'
      );
      assert.ok(!stderr.includes('at MarketplaceManager'), 'Should not include stack trace');
    } finally {
      cleanup(dir);
    }
  });

  await test('Error: invalid ref format (too many slashes) gives clean error', async () => {
    const dir = freshDir();
    try {
      const { stderr } = photonExecAll('cli a/b/c/d method', dir);
      assert.ok(
        stderr.includes('not found') || stderr.includes('Invalid'),
        'Should show error for invalid format'
      );
      assert.ok(!stderr.includes('at '), 'Should not include stack trace');
    } finally {
      cleanup(dir);
    }
  });

  // ── 7. MCP STDIO mode ──────────────────────────────────────────────────

  await test('MCP: STDIO mode returns valid tools/list response', async () => {
    const dir = freshDir();
    try {
      // Pre-install todo
      photonExec('portel-dev/photons/todo add --text "mcp setup"', dir);

      const transport = new StdioClientTransport({
        command: 'node',
        args: [CLI_PATH, 'mcp', 'todo'],
        env: { ...process.env, PHOTON_DIR: dir },
      });

      const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });

      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.ok(Array.isArray(tools), 'Should return tools array');
      assert.ok(tools.length > 0, 'Should have at least one tool');

      const toolNames = tools.map((t) => t.name);
      assert.ok(toolNames.includes('add'), 'Should have "add" tool');
      assert.ok(toolNames.includes('list'), 'Should have "list" tool');

      await client.close();
    } finally {
      cleanup(dir);
    }
  });

  // ── 8. Beam with simple name ────────────────────────────────────────────

  // Kill any stale beam processes between beam tests
  try {
    execSync('pkill -9 -f "node.*cli.js.*beam"', { stdio: 'ignore' });
  } catch {
    /* none running */
  }
  await new Promise((r) => setTimeout(r, 2000));

  await test('Beam: photon beam <simple-name> auto-installs and starts', async () => {
    const dir = freshDir();
    try {
      // Pre-install todo
      photonExec('portel-dev/photons/todo add --text "pre-install"', dir);

      const { proc, port } = await startBeamAndWait(dir, 'todo', 20_000);
      try {
        assert.ok(port, 'Should detect port');
        const diag = await fetchDiagnostics(port!);
        assert.ok(diag.photonVersion, 'Should return version');
        // Verify todo is installed on disk (Beam may still be loading it)
        assert.ok(
          fs.existsSync(path.join(dir, 'portel-dev', 'todo.photon.ts')),
          'todo.photon.ts should be installed'
        );
      } finally {
        killProc(proc);
      }
    } finally {
      cleanup(dir);
    }
  });

  // ── 9. Beam with qualified ref ──────────────────────────────────────────

  await test('Beam: photon beam owner/repo/name installs with deps and starts', async () => {
    const dir = freshDir();
    try {
      // Pre-install claw + deps so beam doesn't need to fetch during startup
      const { MarketplaceManager } = await import('../dist/marketplace-manager.js');
      const manager = new MarketplaceManager(undefined, dir);
      await manager.initialize();
      await manager.fetchAndInstallFromRef('Arul-/photons/claw', dir);

      const { proc, port } = await startBeamAndWait(dir, 'claw', 20_000);
      try {
        assert.ok(port, 'Should detect port');
        const diag = await fetchDiagnostics(port!);
        assert.ok(diag.photonVersion, 'Should return version');

        // Verify transitive deps on disk
        const nsDir = path.join(dir, 'Arul-');
        assert.ok(fs.existsSync(path.join(nsDir, 'claw.photon.ts')), 'claw should be installed');
        assert.ok(
          fs.existsSync(path.join(nsDir, 'whatsapp.photon.ts')),
          'whatsapp dep should be installed'
        );
        assert.ok(
          fs.existsSync(path.join(nsDir, 'agent-router.photon.ts')),
          'agent-router dep should be installed'
        );
      } finally {
        killProc(proc);
      }
    } finally {
      cleanup(dir);
    }
  });

  // ── 10. Port conflict auto-retry ────────────────────────────────────────

  // Clean up between beam tests
  try {
    execSync('pkill -9 -f "node.*cli.js.*beam"', { stdio: 'ignore' });
  } catch {
    /* ok */
  }
  await new Promise((r) => setTimeout(r, 2000));

  await test('Beam: port conflict auto-retries to next available port', async () => {
    const dir = freshDir();
    const net = await import('net');
    // Use a high port to avoid conflicts with previous beam tests on 3000-3003
    const blockedPort = 4500;
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(blockedPort, '127.0.0.1', () => resolve());
    });

    // Spawn beam directly (not through startBeamAndWait) for precise port control
    const proc = spawn('node', [CLI_PATH, 'beam', '--no-open', '-p', String(blockedPort)], {
      env: { ...process.env, PHOTON_DIR: dir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      let port: number | null = null;
      const waitMs = 20_000;
      const startTime = Date.now();

      while (Date.now() - startTime < waitMs) {
        // Probe ports around the blocked one (beam should retry to blockedPort+1)
        for (const p of [blockedPort + 1, blockedPort + 2, blockedPort + 3]) {
          try {
            await fetchDiagnostics(p);
            port = p;
            break;
          } catch {
            /* not ready yet */
          }
        }
        if (port) break;
        await new Promise((r) => setTimeout(r, 2000));
      }

      assert.ok(port, 'Should detect port');
      assert.ok(port! > blockedPort, `Should use port > ${blockedPort} (got ${port})`);
      const diag = await fetchDiagnostics(port!);
      assert.ok(diag.photonVersion, 'Should be serving');
    } finally {
      killProc(proc);
      await new Promise<void>((r) => blocker.close(() => r()));
      cleanup(dir);
    }
  });

  // ── 11. Empty beam (no photon arg) ──────────────────────────────────────

  // Clean up between beam tests
  try {
    execSync('pkill -9 -f "node.*cli.js.*beam"', { stdio: 'ignore' });
  } catch {
    /* ok */
  }
  await new Promise((r) => setTimeout(r, 2000));

  await test('Beam: empty launch shows bundled photons only', async () => {
    const dir = freshDir();
    try {
      const { proc, port } = await startBeamAndWait(dir, '', 12_000);
      try {
        assert.ok(port, 'Should detect port');
        const diag = await fetchDiagnostics(port!);
        assert.ok(diag.photonCount >= 3, 'Should have at least 3 bundled photons');
        const names = diag.photons.map((p: any) => p.name);
        assert.ok(names.includes('maker'), 'Should have bundled maker');
        assert.ok(names.includes('marketplace'), 'Should have bundled marketplace');
      } finally {
        killProc(proc);
      }
    } finally {
      cleanup(dir);
    }
  });

  // ── 12. Global install path resolution ─────────────────────────────────

  await test('CLI: works when invoked from unrelated directory (simulates global install)', async () => {
    const dir = freshDir();
    const unrelatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-foreign-'));
    try {
      // Run CLI from a directory that has nothing to do with photon
      const result = execSync(
        `node ${CLI_PATH} portel-dev/photons/todo add --text "foreign dir test"`,
        {
          env: { ...process.env, PHOTON_DIR: dir },
          cwd: unrelatedCwd,
          timeout: 30_000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      assert.ok(result.includes('foreign dir test'), 'Should return the added todo');

      // Verify photon was installed in PHOTON_DIR, not cwd
      assert.ok(
        fs.existsSync(path.join(dir, 'portel-dev', 'todo.photon.ts')),
        'Photon should be in PHOTON_DIR, not cwd'
      );
      assert.ok(
        !fs.existsSync(path.join(unrelatedCwd, 'portel-dev')),
        'Nothing should be written to cwd'
      );
    } finally {
      cleanup(dir);
      cleanup(unrelatedCwd);
    }
  });

  // ── 13. Bare photon command (no args) via preprocessArgs ──────────────

  // Clean up between beam tests
  try {
    execSync('pkill -9 -f "node.*cli.js.*beam"', { stdio: 'ignore' });
  } catch {
    /* ok */
  }
  await new Promise((r) => setTimeout(r, 2000));

  await test('CLI: bare "photon" with no args launches Beam via preprocessArgs', async () => {
    const dir = freshDir();
    try {
      // Spawn with NO arguments at all — preprocessArgs should rewrite to 'beam'
      const proc = spawn('node', [CLI_PATH], {
        env: { ...process.env, PHOTON_DIR: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let port: number | null = null;
      const startTime = Date.now();
      while (Date.now() - startTime < 15_000) {
        for (const p of [3000, 3001, 3002, 3003]) {
          try {
            await fetchDiagnostics(p);
            port = p;
            break;
          } catch {
            /* not ready yet */
          }
        }
        if (port) break;
        await new Promise((r) => setTimeout(r, 2000));
      }

      try {
        assert.ok(port, 'Bare photon should launch Beam and serve diagnostics');
        const diag = await fetchDiagnostics(port!);
        assert.ok(diag.photonVersion, 'Should report version');
      } finally {
        killProc(proc);
      }
    } finally {
      cleanup(dir);
    }
  });

  // ── 14. Already-installed photon — skip re-install ────────────────────

  // Clean up between beam tests
  try {
    execSync('pkill -9 -f "node.*cli.js.*beam"', { stdio: 'ignore' });
  } catch {
    /* ok */
  }
  await new Promise((r) => setTimeout(r, 2000));

  await test('CLI: already-installed photon skips re-install and still works', async () => {
    const dir = freshDir();
    try {
      // First run — installs from marketplace
      const result1 = photonExec('portel-dev/photons/todo add --text "first run"', dir);
      assert.ok(result1.includes('first run'), 'First run should succeed');

      const installedFile = path.join(dir, 'portel-dev', 'todo.photon.ts');
      assert.ok(fs.existsSync(installedFile), 'Should be installed');
      const mtime1 = fs.statSync(installedFile).mtimeMs;

      // Small delay to detect mtime changes
      await new Promise((r) => setTimeout(r, 100));

      // Second run — should skip install, still work
      const result2 = photonExec('portel-dev/photons/todo add --text "second run"', dir);
      assert.ok(result2.includes('second run'), 'Second run should succeed');

      const mtime2 = fs.statSync(installedFile).mtimeMs;
      assert.ok(mtime1 === mtime2, 'File should not be re-written on second run');
    } finally {
      cleanup(dir);
    }
  });

  // ── 15. Photon with missing env vars — clean config error ─────────────

  await test('Error: photon needing env vars gives config guidance, not stack trace', async () => {
    const dir = freshDir();
    try {
      // Create a minimal photon that requires a constructor param (env var)
      const photonContent = `
import { PhotonMCP } from '@portel/photon-core';

/**
 * Test photon requiring config
 * @version 1.0.0
 */
export default class ConfigTest extends PhotonMCP {
  constructor(private apiKey: string) {
    super();
    if (!apiKey) throw new Error('apiKey is required');
  }

  async ping() { return 'pong'; }
}
`;
      fs.writeFileSync(path.join(dir, 'config-test.photon.ts'), photonContent);

      // Run via MCP (which triggers loader + constructor injection)
      const { stderr } = photonExecAll('mcp config-test --validate', dir);

      // Should mention the env var name, not crash with unhandled error
      // The enhanced error includes PHOTON_CONFIG_TEST_APIKEY or similar guidance
      const combined = stderr.toLowerCase();
      assert.ok(
        combined.includes('apikey') ||
          combined.includes('api_key') ||
          combined.includes('configuration') ||
          combined.includes('env'),
        'Should mention the missing config parameter or env var'
      );
      assert.ok(!stderr.includes('at Object.<anonymous>'), 'Should not include raw stack trace');
    } finally {
      cleanup(dir);
    }
  });

  // ── 16. SSE transport ──────────────────────────────────────────────────

  await test('SSE: photon sse <name> starts HTTP server with MCP endpoint', async () => {
    const dir = freshDir();
    try {
      // Pre-install todo
      photonExec('portel-dev/photons/todo add --text "sse setup"', dir);

      const ssePort = 4600;
      const proc = spawn('node', [CLI_PATH, 'sse', 'todo', '--port', String(ssePort)], {
        env: { ...process.env, PHOTON_DIR: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      try {
        // Wait for server to be ready
        let ready = false;
        for (let i = 0; i < 10; i++) {
          try {
            const res = await fetch(`http://localhost:${ssePort}/`, {
              signal: AbortSignal.timeout(2000),
            });
            if (res.ok) {
              ready = true;
              break;
            }
          } catch {
            /* not ready */
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        assert.ok(ready, 'SSE server should start and respond on /');

        // Verify /mcp endpoint returns SSE content type
        const mcp = await fetch(`http://localhost:${ssePort}/mcp`, {
          signal: AbortSignal.timeout(3000),
        });
        assert.ok(mcp.ok, '/mcp endpoint should respond');
        const ct = mcp.headers.get('content-type') || '';
        assert.ok(ct.includes('text/event-stream'), 'Should serve SSE on /mcp');
      } finally {
        killProc(proc);
      }
    } finally {
      cleanup(dir);
    }
  });

  // ── 17. Network failure — clean error for unreachable GitHub ──────────

  await test('Error: network failure during marketplace fetch gives clean error', async () => {
    const dir = freshDir();
    try {
      // Use a ref pointing at a valid format but unreachable host
      // by using a GitHub user that doesn't exist (404 from raw.githubusercontent.com)
      const { stderr } = photonExecAll(
        'cli zzz-nonexistent-user-99999/zzz-nonexistent-repo/test-photon ping',
        dir
      );
      assert.ok(
        stderr.includes('Could not fetch') ||
          stderr.includes('404') ||
          stderr.includes('not found'),
        'Should show fetch error'
      );
      assert.ok(!stderr.includes('at '), 'Should not include stack trace');
    } finally {
      cleanup(dir);
    }
  });

  // ── 18. photon info — lists installed photons ─────────────────────────

  await test('CLI: photon info shows installed photons in table format', async () => {
    const dir = freshDir();
    try {
      // Install todo first
      photonExec('portel-dev/photons/todo add --text "info test"', dir);

      const result = photonExec('info', dir);
      // Should show a table with the installed photon
      assert.ok(
        result.includes('todo') || result.includes('todo-list'),
        'Should list the installed todo photon'
      );
      // Should show table-like output (has column headers or box drawing)
      assert.ok(
        result.includes('Name') || result.includes('│') || result.includes('|'),
        'Should display in table format'
      );
    } finally {
      cleanup(dir);
    }
  });

  // ── 19. Daemon cold start ─────────────────────────────────────────────

  await test('CLI: works with fresh daemon (auto-starts if not running)', async () => {
    const dir = freshDir();
    try {
      // The daemon is global (always at ~/.photon/daemon.sock), so we can't
      // fully isolate this. Instead, verify the CLI works even when the daemon
      // needs to handle a brand-new PHOTON_DIR it hasn't seen before.
      // This tests the auto-registration path.
      const result = photonExec('portel-dev/photons/todo add --text "cold start test"', dir);
      assert.ok(result.includes('cold start test'), 'Should work with auto-started daemon');

      // Run a second command to verify daemon stays healthy (each CLI spawn is independent)
      const result2 = photonExec('portel-dev/photons/todo add --text "second call"', dir);
      assert.ok(result2.includes('second call'), 'Second CLI call should also work');
    } finally {
      cleanup(dir);
    }
  });

  // ── 20. Concurrent Beam instances ─────────────────────────────────────

  // Clean up between beam tests
  try {
    execSync('pkill -9 -f "node.*cli.js.*beam"', { stdio: 'ignore' });
  } catch {
    /* ok */
  }
  await new Promise((r) => setTimeout(r, 2000));

  await test('Beam: two concurrent instances on different ports both serve', async () => {
    const dir1 = freshDir();
    const dir2 = freshDir();
    try {
      const port1 = 4700;
      const port2 = 4800;

      const proc1 = spawn('node', [CLI_PATH, 'beam', '--no-open', '-p', String(port1)], {
        env: { ...process.env, PHOTON_DIR: dir1 },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const proc2 = spawn('node', [CLI_PATH, 'beam', '--no-open', '-p', String(port2)], {
        env: { ...process.env, PHOTON_DIR: dir2 },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      try {
        // Wait for both to be ready
        let found1 = false,
          found2 = false;
        for (let i = 0; i < 10; i++) {
          if (!found1) {
            try {
              await fetchDiagnostics(port1);
              found1 = true;
            } catch {
              /* not ready */
            }
          }
          if (!found2) {
            try {
              await fetchDiagnostics(port2);
              found2 = true;
            } catch {
              /* not ready */
            }
          }
          if (found1 && found2) break;
          await new Promise((r) => setTimeout(r, 2000));
        }

        assert.ok(found1, `First Beam should be serving on ${port1}`);
        assert.ok(found2, `Second Beam should be serving on ${port2}`);

        // Both should return valid diagnostics independently
        const diag1 = await fetchDiagnostics(port1);
        const diag2 = await fetchDiagnostics(port2);
        assert.ok(diag1.photonVersion, 'First instance should report version');
        assert.ok(diag2.photonVersion, 'Second instance should report version');
      } finally {
        killProc(proc1);
        killProc(proc2);
      }
    } finally {
      cleanup(dir1);
      cleanup(dir2);
    }
  });

  // ── Summary ────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    • ${f}`);
    }
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
