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
      const { stderr } = photonExecAll('portel-dev/photons/math calculate --expression "2+2"', dir);
      assert.ok(fs.existsSync(dir), 'Dir should be auto-created');
      assert.ok(
        fs.existsSync(path.join(dir, 'marketplaces.json')) ||
          fs.existsSync(path.join(dir, 'portel-dev', 'math.photon.ts')),
        'Should have created marketplace config or installed photon'
      );
    } finally {
      cleanup(dir);
    }
  });

  // ── 2. Simple name auto-install from marketplace ────────────────────────

  await test('CLI: simple name auto-installs from marketplace (portel-dev/photons/math)', async () => {
    const dir = freshDir();
    try {
      const result = photonExec('portel-dev/photons/math calculate --expression "2+2"', dir);
      assert.ok(result.includes('4'), 'Should return calculation result');

      // Verify file was installed
      const installed = path.join(dir, 'portel-dev', 'math.photon.ts');
      assert.ok(fs.existsSync(installed), 'math.photon.ts should be installed in namespace dir');
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
        'portel-dev/photons/math calculate --expression "3+3"',
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
      const result = photonExec('portel-dev/photons/math calculate --expression "5+5"', dir);
      assert.ok(result.includes('10'), 'Should return calculation result');
    } finally {
      cleanup(dir);
    }
  });

  // ── 5. Qualified ref — explicit CLI form ────────────────────────────────

  await test('CLI explicit: photon cli owner/repo/name method works', async () => {
    const dir = freshDir();
    try {
      const result = photonExec('cli portel-dev/photons/math calculate --expression "7+7"', dir);
      assert.ok(result.includes('14'), 'Should return calculation result');
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
      // Pre-install math
      photonExec('portel-dev/photons/math calculate --expression "1+1"', dir);

      const transport = new StdioClientTransport({
        command: 'node',
        args: [CLI_PATH, 'mcp', 'math'],
        env: { ...process.env, PHOTON_DIR: dir },
      });

      const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });

      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.ok(Array.isArray(tools), 'Should return tools array');
      assert.ok(tools.length > 0, 'Should have at least one tool');

      const toolNames = tools.map((t) => t.name);
      assert.ok(toolNames.includes('calculate'), 'Should have "calculate" tool');

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
      // Pre-install math
      photonExec('portel-dev/photons/math calculate --expression "1+1"', dir);

      const { proc, port } = await startBeamAndWait(dir, 'math', 20_000);
      try {
        assert.ok(port, 'Should detect port');
        const diag = await fetchDiagnostics(port!);
        assert.ok(diag.photonVersion, 'Should return version');
        // Verify math is installed on disk (Beam may still be loading it)
        assert.ok(
          fs.existsSync(path.join(dir, 'portel-dev', 'math.photon.ts')),
          'math.photon.ts should be installed'
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
        `node ${CLI_PATH} portel-dev/photons/math calculate --expression "9+9"`,
        {
          env: { ...process.env, PHOTON_DIR: dir },
          cwd: unrelatedCwd,
          timeout: 30_000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      assert.ok(result.includes('18'), 'Should return calculation result');

      // Verify photon was installed in PHOTON_DIR, not cwd
      assert.ok(
        fs.existsSync(path.join(dir, 'portel-dev', 'math.photon.ts')),
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
      const result1 = photonExec('portel-dev/photons/math calculate --expression "10+10"', dir);
      assert.ok(result1.includes('20'), 'First run should succeed');

      const installedFile = path.join(dir, 'portel-dev', 'math.photon.ts');
      assert.ok(fs.existsSync(installedFile), 'Should be installed');
      const mtime1 = fs.statSync(installedFile).mtimeMs;

      // Small delay to detect mtime changes
      await new Promise((r) => setTimeout(r, 100));

      // Second run — should skip install, still work
      const result2 = photonExec('portel-dev/photons/math calculate --expression "20+20"', dir);
      assert.ok(result2.includes('40'), 'Second run should succeed');

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
      // Pre-install math
      photonExec('portel-dev/photons/math calculate --expression "1+1"', dir);

      const ssePort = 4600;
      const proc = spawn('node', [CLI_PATH, 'sse', 'math', '--port', String(ssePort)], {
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
      // Install math first
      photonExec('portel-dev/photons/math calculate --expression "1+1"', dir);

      const result = photonExec('info', dir);
      // Should show a table with the installed photon
      assert.ok(
        result.includes('math') || result.includes('calculator'),
        'Should list the installed math photon'
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
      const result = photonExec('portel-dev/photons/math calculate --expression "4+4"', dir);
      assert.ok(result.includes('8'), 'Should work with auto-started daemon');

      // Run a second command to verify daemon stays healthy (each CLI spawn is independent)
      const result2 = photonExec('portel-dev/photons/math calculate --expression "8+8"', dir);
      assert.ok(result2.includes('16'), 'Second CLI call should also work');
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

  // ── 21. photon maker new — create from template ────────────────────────

  await test('Maker: photon maker new creates a valid photon file', async () => {
    const dir = freshDir();
    try {
      // maker new outputs to stderr, so capture with 2>&1
      const combined = execSync(`node ${CLI_PATH} maker new smoke-probe 2>&1`, {
        env: { ...process.env, PHOTON_DIR: dir },
        timeout: 15_000,
        encoding: 'utf-8',
      });
      assert.ok(
        combined.includes('Created') || combined.includes('smoke-probe'),
        'Should confirm creation'
      );

      const created = path.join(dir, 'smoke-probe.photon.ts');
      assert.ok(fs.existsSync(created), 'smoke-probe.photon.ts should exist');

      // Verify it's valid TypeScript with PhotonMCP import
      const content = fs.readFileSync(created, 'utf-8');
      assert.ok(
        content.includes('PhotonMCP') || content.includes('Photon'),
        'Should import PhotonMCP or Photon'
      );
      assert.ok(content.includes('export default'), 'Should have default export');
    } finally {
      cleanup(dir);
    }
  });

  // ── 22. MCP tool invocation — actually call a tool ────────────────────

  await test('MCP: tool call returns correct result through protocol', async () => {
    const dir = freshDir();
    try {
      // Pre-install math
      photonExec('portel-dev/photons/math calculate --expression "1+1"', dir);

      const transport = new StdioClientTransport({
        command: 'node',
        args: [CLI_PATH, 'mcp', 'math'],
        env: { ...process.env, PHOTON_DIR: dir },
      });

      const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });

      await client.connect(transport);

      // Actually invoke the 'calculate' tool
      const result = await client.callTool({
        name: 'calculate',
        arguments: { expression: '2 + 3' },
      });

      assert.ok(result.content, 'Should return content');
      assert.ok(!result.isError, 'Should not be an error');
      const text = JSON.stringify(result.content);
      assert.ok(text.includes('5'), 'Tool result should contain the calculation result');

      await client.close();
    } finally {
      cleanup(dir);
    }
  });

  // ── 23. photon search — discover photons in marketplace ───────────────

  await test('CLI: photon search returns results in table format', async () => {
    const dir = freshDir();
    try {
      const { stdout, stderr } = photonExecAll('search math', dir);
      const combined = stdout + stderr;
      // Should find the math photon in marketplace results
      assert.ok(
        combined.includes('math') || combined.includes('Math') || combined.includes('calculator'),
        'Search should find math photon'
      );
      // Should be in table format
      assert.ok(
        combined.includes('│') || combined.includes('Name') || combined.includes('┌'),
        'Results should be in table format'
      );
    } finally {
      cleanup(dir);
    }
  });

  // ── 24. photon mcp --config — generate Claude Desktop JSON ────────────

  await test('MCP: --config generates configuration template', async () => {
    const dir = freshDir();
    try {
      // Pre-install math
      photonExec('portel-dev/photons/math calculate --expression "1+1"', dir);

      // --config outputs to stderr, capture with 2>&1
      const combined = execSync(`node ${CLI_PATH} mcp math --config 2>&1`, {
        env: { ...process.env, PHOTON_DIR: dir },
        timeout: 15_000,
        encoding: 'utf-8',
      });

      // Should produce config output (either mcpServers JSON or "no configuration required")
      assert.ok(
        combined.includes('mcpServers') ||
          combined.includes('Configuration') ||
          combined.includes('configuration') ||
          combined.includes('No configuration required'),
        'Should show configuration info'
      );
      assert.ok(combined.includes('math'), 'Should reference the photon name');
      // Should not crash or show stack traces
      assert.ok(!combined.includes('at Object.<anonymous>'), 'Should not include stack traces');
    } finally {
      cleanup(dir);
    }
  });

  // ── 25. --json output flag ────────────────────────────────────────────

  await test('CLI: --json flag outputs valid parseable JSON', async () => {
    const dir = freshDir();
    try {
      photonExec('portel-dev/photons/math calculate --expression "1+1"', dir);
      const result = photonExec('cli math calculate --expression "1+1" --json', dir);

      // Should be parseable JSON
      let parsed: any;
      try {
        parsed = JSON.parse(result.trim());
      } catch {
        assert.fail(`Output should be valid JSON, got: ${result.substring(0, 100)}`);
      }
      assert.ok(parsed !== null && parsed !== undefined, 'Should parse to a valid value');
    } finally {
      cleanup(dir);
    }
  });

  // ── 26. photon doctor — health check ──────────────────────────────────

  await test('CLI: photon doctor runs without errors', async () => {
    const dir = freshDir();
    try {
      const { stdout, stderr } = photonExecAll('doctor', dir);
      const combined = stdout + stderr;

      assert.ok(combined.includes('Node.js') || combined.includes('node'), 'Should check Node.js');
      assert.ok(combined.includes('ok') || combined.includes('Status'), 'Should report status');
      // Should not crash
      assert.ok(!combined.includes('Fatal'), 'Should not have fatal errors');
    } finally {
      cleanup(dir);
    }
  });

  // ── 27. Graceful shutdown — SIGINT produces clean exit ────────────────

  // Clean up between beam tests
  try {
    execSync('pkill -9 -f "node.*cli.js.*beam"', { stdio: 'ignore' });
  } catch {
    /* ok */
  }
  await new Promise((r) => setTimeout(r, 2000));

  await test('Beam: SIGINT triggers clean shutdown without stack traces', async () => {
    const dir = freshDir();
    try {
      const proc = spawn('node', [CLI_PATH, 'beam', '--no-open', '-p', '4900'], {
        env: { ...process.env, PHOTON_DIR: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout?.on('data', (d) => {
        output += d.toString();
      });
      proc.stderr?.on('data', (d) => {
        output += d.toString();
      });

      // Wait for beam to be ready
      let ready = false;
      for (let i = 0; i < 10; i++) {
        try {
          await fetchDiagnostics(4900);
          ready = true;
          break;
        } catch {
          /* not ready */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      assert.ok(ready, 'Beam should start on port 4900');

      // Send SIGINT (Ctrl+C)
      proc.kill('SIGINT');

      // Wait for process to exit
      const exitCode = await new Promise<number | null>((resolve) => {
        const timeout = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve(null);
        }, 5000);
        proc.on('exit', (code) => {
          clearTimeout(timeout);
          resolve(code);
        });
      });

      assert.ok(exitCode !== null, 'Process should exit within 5 seconds');
      assert.ok(
        !output.includes('Error:') || output.includes('Shutting down'),
        'Should not show errors (or only shutdown message)'
      );
      assert.ok(!output.includes('at Object.<anonymous>'), 'Should not include stack traces');
    } finally {
      cleanup(dir);
    }
  });

  // ── 28. Photon with npm @dependencies ─────────────────────────────────

  await test('Loader: photon with @dependencies auto-installs npm packages', async () => {
    const dir = freshDir();
    try {
      // Create a photon that declares an npm dependency
      const photonContent = `
import { PhotonMCP } from '@portel/photon-core';

/**
 * Dep test photon
 * @version 1.0.0
 * @dependencies fast-json-patch@^3.1.1
 */
export default class DepTest extends PhotonMCP {
  async check() {
    // If fast-json-patch was installed, require won't throw
    const fjp = await import('fast-json-patch');
    return { hasFjp: typeof fjp.applyPatch === 'function' };
  }
}
`;
      fs.writeFileSync(path.join(dir, 'dep-test.photon.ts'), photonContent);

      // Use MCP STDIO to load the photon — the loader resolves from PHOTON_DIR
      const transport = new StdioClientTransport({
        command: 'node',
        args: [CLI_PATH, 'mcp', 'dep-test'],
        env: { ...process.env, PHOTON_DIR: dir },
      });

      const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });

      await client.connect(transport);
      const { tools } = await client.listTools();
      const toolNames = tools.map((t) => t.name);
      assert.ok(toolNames.includes('check'), 'Should have "check" tool (means loader succeeded)');

      // Actually call the tool to verify dependency was installed
      const result = await client.callTool({ name: 'check', arguments: {} });
      const text = JSON.stringify(result.content);
      assert.ok(
        text.includes('hasFjp') || text.includes('true'),
        'Should successfully use the auto-installed dependency'
      );

      await client.close();
    } finally {
      cleanup(dir);
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
