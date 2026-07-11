import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, test, vi, beforeEach } from 'vitest';
import * as net from 'net';

import { registerDevCommand } from '../src/cli/commands/dev.js';
import { Command } from 'commander';

const tmpDirs: string[] = [];
let mockBaseDir = '';

// Mock context at the top level with original fallback
vi.mock('../src/context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/context.js')>();
  return {
    ...actual,
    getDefaultContext: () => ({
      ...actual.getDefaultContext(),
      baseDir: mockBaseDir,
    }),
    resolvePhotonFromAllSources: (name: string) => {
      if (name === 'my-calc') {
        return join(mockBaseDir, 'my-calc.photon.ts');
      }
      return actual.resolvePhotonFromAllSources(name);
    },
  };
});

// Mock daemon manager at the top level
vi.mock('../src/daemon/manager.js', async () => {
  return {
    isGlobalDaemonReachable: () => Promise.resolve(true),
    ensureDaemon: () => Promise.resolve(),
  };
});

// Mock startBeam at the top level
const startBeamMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/auto-ui/beam.js', async () => {
  return {
    startBeam: (dir: any, port: any) => startBeamMock(dir, port),
    stopBeam: () => Promise.resolve(),
  };
});

// Mock child_process at the top level
const spawnMock = vi.fn().mockReturnValue({
  on: vi.fn(),
  kill: vi.fn(),
});
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    spawn: (cmd: any, args: any, opts: any) => spawnMock(cmd, args, opts),
  };
});

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('photon dev command registration', () => {
  test('registers dev command with commander successfully', () => {
    const program = new Command();
    registerDevCommand(program);

    const devCmd = program.commands.find((c) => c.name() === 'dev');
    expect(devCmd).toBeDefined();
    expect(devCmd?.description()).toContain('hot-reloading');
  });

  test('scaffolds angular proxy configurations when angular.json exists', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'photon-dev-test-'));
    tmpDirs.push(workspace);
    mockBaseDir = workspace;

    // Create mock photon file
    const photonPath = join(workspace, 'my-calc.photon.ts');
    writeFileSync(photonPath, 'export default class MyCalc {}');

    // Create ui/ containing angular.json
    const uiDir = join(workspace, 'ui');
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, 'angular.json'), '{}');

    // Execute dev action
    const program = new Command();
    registerDevCommand(program);
    const devCmd = program.commands.find((c) => c.name() === 'dev')!;

    // Directly execute the action handler
    await devCmd.parseAsync([
      'node',
      'cli.js',
      'my-calc',
      '--port',
      '9091',
      '--backend-port',
      '9092',
    ]);

    // Check proxy.conf.json is generated
    const proxyConfPath = join(uiDir, 'proxy.conf.json');
    expect(existsSync(proxyConfPath)).toBe(true);

    const proxyConf = JSON.parse(readFileSync(proxyConfPath, 'utf8'));
    expect(proxyConf['/api'].target).toContain(':9092');

    // Check spawn was called with env VITE_DAEMON_PORT
    expect(spawnMock).toHaveBeenCalled();
    const spawnCall = spawnMock.mock.calls[0];
    const env = spawnCall[2].env;
    expect(env.VITE_DAEMON_PORT).toBe('9092');
  });
});
