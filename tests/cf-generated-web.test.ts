import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { build } from 'esbuild';
import { deployToCloudflare } from '../src/deploy/cloudflare.js';

async function generate(source: string, setup?: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-cf-generated-web-'));
  const photonPath = path.join(root, 'tasks.photon.ts');
  await fs.writeFile(photonPath, source);
  await setup?.(root);
  const outputDir = path.join(root, 'out');
  await deployToCloudflare({ photonPath, outputDir, dryRun: true });
  return {
    root,
    outputDir,
    worker: await fs.readFile(path.join(outputDir, 'src', 'worker.ts'), 'utf8'),
  };
}

function generatedShell(worker: string): string | undefined {
  const marker = 'const STANDALONE_WEB_SHELLS: Record<string, string> = ';
  const start = worker.indexOf(marker);
  if (start < 0) return undefined;
  const valueStart = start + marker.length;
  const end = worker.indexOf(';\n\n/** Canonical Photon browser runtimes', valueStart);
  if (end < 0) throw new Error('Generated standalone shell literal is unterminated');
  const shells = JSON.parse(worker.slice(valueStart, end)) as Record<string, string>;
  return shells.tasks;
}

describe('Cloudflare generated standalone web surface', () => {
  it('generates a secure shell that uses /mcp and runtime tools/list', async () => {
    const generated = await generate(`
/** @label Task Desk @description Review assigned work */
export default class Tasks {
  async main() { return { ok: true }; }
  /** @internal */
  async maintenance() { return { internal: true }; }
}
`);

    const shell = generatedShell(generated.worker);
    expect(shell).toBeDefined();
    expect(shell).toContain("fetch('/mcp'");
    expect(shell).toContain("mcpRequest('tools/list'");
    expect(shell).toContain('MCP_INITIALIZE_PARAMS');
    // The HTML carries navigation metadata only. It must not ship the
    // generated Worker tool schemas/catalog, which would become stale and
    // could reveal caller-restricted capabilities before tools/list runs.
    expect(shell).not.toContain('toolDefinitions');
    expect(shell).not.toContain('maintenance');
    expect(generated.worker).toContain('canonicalWebAssetResponse');
    expect(generated.worker).toContain('photon-form.bundle.js');
    expect(generated.worker).toContain('api/photon-renderers.js');
    await expect(
      build({
        entryPoints: [path.join(generated.outputDir, 'src', 'worker.ts')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        external: ['cloudflare:workers', 'node:async_hooks', 'cron-parser'],
      })
    ).resolves.toBeDefined();
  });

  it('keeps an explicit HTTP root ahead of generated web fallback', async () => {
    const generated = await generate(`
export default class Tasks {
  /** @get / */
  async home() { return new Response('custom root'); }
  async main() { return { ok: true }; }
}
`);

    expect(generatedShell(generated.worker)).toBeUndefined();
    const rootIndex = generated.worker.indexOf("url.pathname === '/' && request.method === 'GET'");
    const routeIndex = generated.worker.indexOf('const matchedRoute = matchHttpRoute');
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    expect(routeIndex).toBeGreaterThan(rootIndex);
  });

  it('keeps a custom @ui surface ahead of generated web fallback', async () => {
    const generated = await generate(
      `/** @ui dashboard */
export default class Tasks {
  async main() { return { ok: true }; }
}
`,
      async (root) => {
        await fs.mkdir(path.join(root, 'tasks', 'ui'), { recursive: true });
        await fs.writeFile(
          path.join(root, 'tasks', 'ui', 'dashboard.html'),
          '<!doctype html><html><body>custom</body></html>'
        );
      }
    );

    expect(generatedShell(generated.worker)).toBeUndefined();
  });
});
