import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { deployToCloudflare } from '../dist/deploy/cloudflare.js';
import { ResourceServer } from '../dist/resource-server.js';

describe('Cloudflare MCP App bridge code generation', () => {
  it('injects the Photon bridge into embedded HTML UI resources', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-cf-ui-'));
    const photonPath = path.join(root, 'probe.photon.ts');
    const html = '<!doctype html><html><head></head><body><h1>Probe UI</h1></body></html>';
    await fs.writeFile(
      photonPath,
      '/** @ui main */\nexport default class Probe { async main() { return { ok: true }; } }\n'
    );
    await fs.mkdir(path.join(root, 'probe', 'ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'probe', 'ui', 'main.html'), html);

    const outputDir = path.join(root, 'out');
    await deployToCloudflare({ photonPath, outputDir, dryRun: true });
    const worker = await fs.readFile(path.join(outputDir, 'src', 'worker.ts'), 'utf8');
    const bridge = new ResourceServer({}, { filePath: '' }).generateMcpAppsBridge({
      name: 'probe',
      injectedPhotons: [],
    });
    expect(worker).toContain(
      Buffer.from(html.replace('<head>', `<head>\n${bridge}`)).toString('base64')
    );
    expect(worker).toContain("'openai/widgetDescription'");
    expect(worker).toContain('prefersBorder: true');
    expect(bridge).toContain("settleTransport('postmessage')");
    expect(bridge).toContain("setTimeout(function() { settleTransport('fetch'); }, 1000)");
    expect(bridge).toContain("window.parent !== window ? 'postmessage' : 'pending'");
    expect(bridge).toContain('applyThemeContext(theme, overrides)');
    expect(bridge).toContain('themeDefaults');
  });

  it('does not mistake a custom ui/initialize reference for an embedded bridge', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-cf-ui-handshake-'));
    const photonPath = path.join(root, 'probe.photon.ts');
    const html =
      '<!doctype html><html><head></head><body><script>const method = "ui/initialize";</script></body></html>';
    await fs.writeFile(
      photonPath,
      '/** @ui main */\nexport default class Probe { async main() { return { ok: true }; } }\n'
    );
    await fs.mkdir(path.join(root, 'probe', 'ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'probe', 'ui', 'main.html'), html);

    const outputDir = path.join(root, 'out');
    await deployToCloudflare({ photonPath, outputDir, dryRun: true });
    const worker = await fs.readFile(path.join(outputDir, 'src', 'worker.ts'), 'utf8');
    const bridge = new ResourceServer({}, { filePath: '' }).generateMcpAppsBridge({
      name: 'probe',
      injectedPhotons: [],
    });
    expect(worker).toContain(
      Buffer.from(html.replace('<head>', `<head>\n${bridge}`)).toString('base64')
    );
  });
});
