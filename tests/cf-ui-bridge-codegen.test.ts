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
    await fs.mkdir(path.join(root, 'probe', 'assets'), { recursive: true });
    const photonCss = ':root { --photon-color-accent: #0f766e; }';
    await fs.writeFile(path.join(root, 'probe', 'assets', 'photon.css'), photonCss);

    const outputDir = path.join(root, 'out');
    await deployToCloudflare({ photonPath, outputDir, dryRun: true });
    const worker = await fs.readFile(path.join(outputDir, 'src', 'worker.ts'), 'utf8');
    const resourceServer = new ResourceServer({}, { filePath: '' });
    const bridge = resourceServer.generateMcpAppsBridge({
      name: 'probe',
      injectedPhotons: [],
    });
    const appRuntime = resourceServer.generateMcpAppsRuntime({
      name: 'probe',
      injectedPhotons: [],
    });
    const styles = `<style data-photon-style="photon">\n${photonCss}\n</style>`;
    expect(worker).toContain(
      Buffer.from(html.replace('<head>', `<head>\n${styles}\n${appRuntime}`)).toString('base64')
    );
    expect(worker).toContain("'openai/widgetDescription'");
    expect(worker).toContain('prefersBorder: true');
    expect(bridge).toContain("settleTransport('postmessage')");
    expect(bridge).toContain("setTimeout(function() { settleTransport('fetch'); }, 1000)");
    expect(bridge).toContain("window.parent !== window ? 'postmessage' : 'pending'");
    expect(bridge).toContain('applyThemeContext(theme, overrides)');
    expect(bridge).toContain('themeDefaults');
    expect(appRuntime).toContain('data-photon-renderer-runtime="embedded"');
    expect(appRuntime).toContain('window._photonRenderers');
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
    const appRuntime = new ResourceServer({}, { filePath: '' }).generateMcpAppsRuntime({
      name: 'probe',
      injectedPhotons: [],
    });
    expect(worker).toContain(
      Buffer.from(html.replace('<head>', `<head>\n${appRuntime}`)).toString('base64')
    );
  });
});
