import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TemplateManager } from '../src/template-manager.js';

describe('TemplateManager', () => {
  it('escapes markdown table pipes in photon parameter docs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-template-manager-'));
    try {
      const manager = new TemplateManager(tmpDir);
      await manager.ensureTemplates();

      const markdown = await manager.renderTemplate('photon.md', {
        name: 'union-demo',
        label: undefined,
        description: 'Union Demo\n\nTests markdown escaping.',
        version: '1.0.0',
        author: undefined,
        license: 'MIT',
        configParams: [],
        setupInstructions: undefined,
        photonType: 'api',
        features: [],
        tools: [
          {
            name: 'open',
            description: 'Open the UI.',
            params: [
              {
                name: 'preset',
                type: "'sphere' | 'torus'",
                optional: true,
                description: 'Shape | preset',
                constraintsFormatted: 'choice: sphere|torus',
              },
            ],
          },
        ],
        example: undefined,
        diagram: undefined,
        dependencies: undefined,
        externalDeps: { mcps: [], photons: [], npm: [] },
      });

      expect(markdown).toContain(
        "| `preset` | 'sphere' \\| 'torus' | No | Shape \\| preset [choice: sphere\\|torus] |"
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
