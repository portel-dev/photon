import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn(), execSync: vi.fn() }));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  ...childProcess,
}));
import { devCloudflare, resolveCloudflareDeploymentUrl } from '../src/deploy/cloudflare.js';

describe('Cloudflare deployment URL reporting', () => {
  it('uses the deployed Worker URL, ignoring previews and unrelated links', () => {
    expect(
      resolveCloudflareDeploymentUrl(
        'task-desk',
        `
      See https://developers.cloudflare.com/workers/
      Preview: https://abc123-task-desk.team.workers.dev
      Other: https://another.team.workers.dev
      Deployed task-desk triggers (1.2 sec)
        https://task-desk.team.workers.dev
      Current Version ID: abc123
    `
      )
    ).toBe('https://task-desk.team.workers.dev');
  });
  it('preserves configured URLs, including route path prefixes', () => {
    expect(
      resolveCloudflareDeploymentUrl(
        'tasks',
        'https://tasks.team.workers.dev',
        'https://example.com/tasks'
      )
    ).toBe('https://example.com/tasks');
  });
  it('does not fabricate an endpoint when Wrangler prints no production URL', () => {
    expect(resolveCloudflareDeploymentUrl('tasks', 'Uploaded tasks')).toBeUndefined();
    expect(
      resolveCloudflareDeploymentUrl('tasks', 'https://abc-tasks.team.workers.dev')
    ).toBeUndefined();
  });
});

describe('Cloudflare preview', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it.each([false, true])(
    'installs and runs in the generated directory (explicit output: %s)',
    async (explicit) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-preview-'));
      roots.push(root);
      const name = `preview-${path.basename(root).toLowerCase()}`;
      const photonPath = path.join(root, `${name}.photon.ts`);
      await fs.writeFile(
        photonPath,
        'export default class Preview { async ping() { return "pong"; } }'
      );
      const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
      childProcess.spawn.mockImplementation(() => {
        setTimeout(() => child.emit('close', 0, null), 0);
        return child;
      });
      const signalsBefore = process.listenerCount('SIGINT');
      await devCloudflare({
        photonPath,
        ...(explicit ? { outputDir: path.join(root, 'custom') } : {}),
      });
      const installDir = childProcess.execSync.mock.calls.find(([, options]) => options?.cwd)?.[1]
        .cwd;
      expect(installDir).toBeTypeOf('string');
      if (!explicit) roots.push(installDir);
      expect(childProcess.spawn.mock.calls[0][1]).toEqual(['wrangler', 'dev']);
      expect(childProcess.spawn.mock.calls[0][2].cwd).toBe(installDir);
      expect(await fs.readFile(path.join(installDir, 'wrangler.toml'), 'utf8')).toContain(
        `name = "${name}"`
      );
      expect(await fs.stat(path.join(installDir, 'src/worker.ts'))).toBeDefined();
      expect(process.listenerCount('SIGINT')).toBe(signalsBefore);
      if (explicit) expect(installDir).toBe(path.join(root, 'custom'));
    }
  );

  it.each(['error', 'close'])('reports a preview process failure (%s)', async (event) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-preview-failed-'));
    roots.push(root);
    const photonPath = path.join(root, 'preview.photon.ts');
    await fs.writeFile(
      photonPath,
      'export default class Preview { async ping() { return "pong"; } }'
    );
    childProcess.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
      setTimeout(
        () =>
          event === 'error'
            ? child.emit('error', new Error('spawn failed'))
            : child.emit('close', 1, null),
        0
      );
      return child;
    });
    const signalsBefore = process.listenerCount('SIGINT');
    await expect(devCloudflare({ photonPath, outputDir: path.join(root, 'out') })).rejects.toThrow(
      event === 'error' ? 'spawn failed' : 'exit code 1'
    );
    expect(process.listenerCount('SIGINT')).toBe(signalsBefore);
  });
});

describe('Cloudflare deployment workflow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('streams Wrangler output and reports the real web, MCP, and playground URLs after promotion', async () => {
    const { deployToCloudflare } = await import('../src/deploy/cloudflare.js');
    const { logger } = await import('../src/shared/logger.js');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-deploy-report-'));
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Exercise only local process orchestration. No account credentials or network access.
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'integration-test-token');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'integration-test-account');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          result: { deployments: [{ versions: [{ version_id: 'new-version', percentage: 100 }] }] },
        })
      )
    );
    let listCalls = 0;
    childProcess.execSync.mockReturnValue('');
    childProcess.spawnSync.mockImplementation((_cmd, args) => {
      let result: unknown;
      if (args[1] === 'versions' && args[2] === 'list') {
        result = [{ id: ++listCalls <= 2 ? 'old-version' : 'new-version' }];
      } else if (args[1] === 'versions' && args[2] === 'view') {
        result = {
          resources: {
            bindings: [
              { type: 'durable_object_namespace', name: 'PHOTON', class_name: 'TasksPhotonDO' },
            ],
          },
        };
      } else throw new Error('Unexpected Wrangler command in deployment test');
      return { status: 0, stdout: JSON.stringify(result), stderr: '' };
    });
    childProcess.spawn.mockImplementation((_cmd, args) => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
      setTimeout(() => {
        if (args[1] === 'deploy') {
          child.stdout.emit('data', Buffer.from('Deployed tasks triggers\n  https://tasks.'));
          child.stdout.emit('data', Buffer.from('example-team.workers.dev\n'));
        }
        child.emit('close', 0, null);
      }, 0);
      return child;
    });
    try {
      const photonPath = path.join(root, 'tasks.photon.ts');
      await fs.writeFile(
        photonPath,
        'export default class Tasks { async ping() { return "pong"; } }'
      );
      await deployToCloudflare({ photonPath, outputDir: path.join(root, 'out'), devMode: true });
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'https://tasks.example-team.workers.dev'
      );
      const logs = info.mock.calls.map(([line]) => line).join('\n');
      expect(logs).toContain('Web: https://tasks.example-team.workers.dev');
      expect(logs).toContain('MCP: https://tasks.example-team.workers.dev/mcp');
      expect(logs).toContain('Playground: https://tasks.example-team.workers.dev/playground');
      expect(logs).not.toContain('<your-subdomain>');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
