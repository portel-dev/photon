/**
 * Tests for Photon Loader - Template and Static extraction
 */

import { PhotonLoader } from '../src/loader.js';
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

async function runTests() {
  console.log('🧪 Running Photon Loader Tests...\n');

  const loader = new PhotonLoader();
  const testDir = path.join(os.tmpdir(), 'photon-loader-test');
  await fs.mkdir(testDir, { recursive: true });

  try {
    // Test 1: Load MCP with templates and statics
    {
      const testFile = path.join(testDir, 'test-mcp.photon.ts');
      const content = `
        type Template = string & { __brand: 'Template' };
        type Static = string & { __brand: 'Static' };
        const asTemplate = (str: string): Template => str as Template;
        const asStatic = (str: string): Static => str as Static;

        export default class TestMCP {
          /**
           * Regular tool
           * @param x Number
           */
          async tool(params: { x: number }) {
            return params.x * 2;
          }

          /**
           * Generate prompt
           * @Template
           * @param topic Topic name
           */
          async prompt(params: { topic: string }): Promise<Template> {
            return asTemplate(\`Generate content about \${params.topic}\`);
          }

          /**
           * Get docs
           * @Static api://docs
           * @mimeType text/markdown
           */
          async docs(params: {}): Promise<Static> {
            return asStatic("# Documentation");
          }
        }
      `;

      await fs.writeFile(testFile, content, 'utf-8');

      const result = await loader.loadFile(testFile);

      assert.equal(result.tools.length, 1, 'Should have 1 tool');
      assert.equal(result.templates.length, 1, 'Should have 1 template');
      assert.equal(result.statics.length, 1, 'Should have 1 static');

      assert.equal(result.tools[0].name, 'tool', 'Tool name should be tool');
      assert.equal(result.templates[0].name, 'prompt', 'Template name should be prompt');
      assert.equal(result.statics[0].name, 'docs', 'Static name should be docs');

      console.log('✅ Load MCP with mixed types');
    }

    // Test 2: Load MCP with parameterized static
    {
      const testFile = path.join(testDir, 'test-params.photon.ts');
      const content = `
        type Static = string & { __brand: 'Static' };
        const asStatic = (str: string): Static => str as Static;

        export default class ParamsMCP {
          /**
           * Get README for project
           * @Static readme://{projectType}
           * @param projectType Project type
           */
          async readme(params: { projectType: string }): Promise<Static> {
            return asStatic(\`# \${params.projectType} Project\`);
          }
        }
      `;

      await fs.writeFile(testFile, content, 'utf-8');

      const result = await loader.loadFile(testFile);

      assert.equal(result.statics.length, 1, 'Should have 1 static');
      assert.equal(result.statics[0].uri, 'readme://{projectType}', 'Should preserve URI parameters');
      assert.ok(result.statics[0].inputSchema.properties.projectType, 'Should have projectType in schema');

      console.log('✅ Load MCP with parameterized static');
    }

    // Test 3: Reload functionality
    {
      const testFile = path.join(testDir, 'test-reload.photon.ts');
      const content1 = `
        export default class ReloadMCP {
          /**
           * Tool 1
           * @param x Number
           */
          async tool1(params: { x: number }) {
            return params.x;
          }
        }
      `;

      await fs.writeFile(testFile, content1, 'utf-8');
      const result1 = await loader.loadFile(testFile);
      assert.equal(result1.tools.length, 1, 'Should have 1 tool initially');

      // Modify file
      const content2 = `
        export default class ReloadMCP {
          /**
           * Tool 1
           * @param x Number
           */
          async tool1(params: { x: number }) {
            return params.x;
          }

          /**
           * Tool 2
           * @param y String
           */
          async tool2(params: { y: string }) {
            return params.y;
          }
        }
      `;

      await fs.writeFile(testFile, content2, 'utf-8');

      // Small delay to ensure file is written
      await new Promise(resolve => setTimeout(resolve, 100));

      const result2 = await loader.reloadFile(testFile);
      assert.equal(result2.tools.length, 2, 'Should have 2 tools after reload');

      console.log('✅ Reload functionality');
    }

    // Test 4: Error handling for missing file
    {
      try {
        await loader.loadFile('/nonexistent/file.photon.ts');
        assert.fail('Should throw error for missing file');
      } catch (error: any) {
        // Error is thrown, which is what we expect
        assert.ok(error, 'Should throw error for missing file');
        console.log('✅ Error handling for missing file');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ASSET DISCOVERY TESTS
    // ═══════════════════════════════════════════════════════════════════

    // Test 5: Auto-discover assets from folder structure
    {
      const photonName = 'test-assets';
      const photonFile = path.join(testDir, `${photonName}.photon.ts`);
      const assetFolder = path.join(testDir, photonName);

      // Create asset folder structure
      await fs.mkdir(path.join(assetFolder, 'ui'), { recursive: true });
      await fs.mkdir(path.join(assetFolder, 'prompts'), { recursive: true });
      await fs.mkdir(path.join(assetFolder, 'resources'), { recursive: true });

      // Create asset files
      await fs.writeFile(path.join(assetFolder, 'ui', 'settings.html'), '<html>Settings</html>');
      await fs.writeFile(path.join(assetFolder, 'prompts', 'welcome.md'), '# Welcome');
      await fs.writeFile(path.join(assetFolder, 'resources', 'config.json'), '{"key":"value"}');

      // Create photon file
      const content = `
        export default class TestAssets {
          async doSomething() { return true; }
        }
      `;
      await fs.writeFile(photonFile, content, 'utf-8');

      const result = await loader.loadFile(photonFile);

      assert.ok(result.assets, 'Should have assets');
      assert.equal(result.assets!.ui.length, 1, 'Should auto-discover 1 UI asset');
      assert.equal(result.assets!.prompts.length, 1, 'Should auto-discover 1 prompt asset');
      assert.equal(result.assets!.resources.length, 1, 'Should auto-discover 1 resource asset');

      assert.equal(result.assets!.ui[0].id, 'settings', 'UI id should be settings');
      assert.equal(result.assets!.prompts[0].id, 'welcome', 'Prompt id should be welcome');
      assert.equal(result.assets!.resources[0].id, 'config', 'Resource id should be config');

      console.log('✅ Auto-discover assets from folder structure');
    }

    // Test 6: Method-level @ui linking
    {
      const photonName = 'test-ui-link';
      const photonFile = path.join(testDir, `${photonName}.photon.ts`);
      const assetFolder = path.join(testDir, photonName);

      // Create asset folder with UI
      await fs.mkdir(path.join(assetFolder, 'ui'), { recursive: true });
      await fs.writeFile(path.join(assetFolder, 'ui', 'editor.html'), '<html>Editor</html>');

      // Create photon file with method-level @ui annotation
      const content = `
        export default class TestUILink {
          /**
           * Edit something
           * @ui editor
           */
          async editItem() { return true; }
        }
      `;
      await fs.writeFile(photonFile, content, 'utf-8');

      const result = await loader.loadFile(photonFile);

      assert.ok(result.assets, 'Should have assets');
      assert.equal(result.assets!.ui.length, 1, 'Should have 1 UI asset');
      assert.equal(result.assets!.ui[0].linkedTool, 'editItem', 'UI should be linked to editItem');

      console.log('✅ Method-level @ui linking');
    }

    // Test 7: No assets when folder doesn't exist
    {
      const photonFile = path.join(testDir, 'no-assets.photon.ts');
      const content = `
        export default class NoAssets {
          async doSomething() { return true; }
        }
      `;
      await fs.writeFile(photonFile, content, 'utf-8');

      const result = await loader.loadFile(photonFile);

      assert.equal(result.assets, undefined, 'Should not have assets when folder does not exist');

      console.log('✅ No assets when folder does not exist');
    }

    // Test 8: Explicit @ui declaration with path
    {
      const photonName = 'test-explicit';
      const photonFile = path.join(testDir, `${photonName}.photon.ts`);
      const assetFolder = path.join(testDir, photonName);

      // Create asset folder with UI
      await fs.mkdir(path.join(assetFolder, 'ui'), { recursive: true });
      await fs.writeFile(path.join(assetFolder, 'ui', 'form.html'), '<html>Form</html>');

      // Create photon file with explicit @ui declaration
      const content = `
        /**
         * Test Photon
         * @ui custom-form ./ui/form.html
         */
        export default class TestExplicit {
          async doSomething() { return true; }
        }
      `;
      await fs.writeFile(photonFile, content, 'utf-8');

      const result = await loader.loadFile(photonFile);

      assert.ok(result.assets, 'Should have assets');
      // Explicit declaration + auto-discovered
      const hasCustomForm = result.assets!.ui.some(u => u.id === 'custom-form');
      assert.ok(hasCustomForm, 'Should have explicitly declared custom-form UI');

      console.log('✅ Explicit @ui declaration with path');
    }

    // Test 9: Marketplace source normalization with hints
    {
      const subject: any = new PhotonLoader();
      const normalized = await subject.normalizeMarketplaceSource('community/custom.photon.ts');
      assert.equal(normalized.slug, 'custom', 'Slug should strip extensions');
      assert.equal(normalized.fileName, 'custom.photon.ts', 'File name should use slug');
      assert.equal(normalized.marketplaceHint, 'community', 'Should capture marketplace hint');
      console.log('✅ Marketplace source normalization with hints');
    }

    // Test 10: resolveMarketplacePhoton falls back to cached download when needed
    {
      const subject: any = new PhotonLoader();
      const currentDir = path.join(testDir, 'parent');
      await fs.mkdir(currentDir, { recursive: true });
      const currentPhoton = path.join(currentDir, 'parent.photon.ts');
      await fs.writeFile(currentPhoton, 'export default class Parent {}');

      const cachedPath = path.join(testDir, 'cached', 'child.photon.ts');
      await fs.mkdir(path.dirname(cachedPath), { recursive: true });
      await fs.writeFile(cachedPath, 'export default class RemoteChild {}');

      const originalPathExists = subject.pathExists;
      subject.pathExists = async () => false;
      subject.fetchPhotonFromMarketplace = async () => cachedPath;

      const resolved = await subject.resolvePhotonPath({
        name: 'child',
        source: 'community/child-photon',
        sourceType: 'marketplace',
      }, currentPhoton);

      assert.equal(resolved, cachedPath, 'Should return cached marketplace path when local search fails');
      subject.pathExists = originalPathExists;
      console.log('✅ Marketplace photon resolution falls back to cached download');
    }

    // Test 11: fetchGithubPhoton caches downloaded file
    {
      const subject: any = new PhotonLoader();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: true,
        text: async () => 'export default class GithubPhoton {}',
      }) as any;

      let capturedLabel = '';
      let capturedContent = '';
      subject.writePhotonCacheFile = async (label: string, content: string) => {
        capturedLabel = label;
        capturedContent = content;
        const outPath = path.join(testDir, 'github-cache', `${label}.photon.ts`);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, content, 'utf-8');
        return outPath;
      };

      const dep = {
        name: 'ghPhoton',
        source: 'portel-dev/photon-examples/examples/basic.photon.ts',
        sourceType: 'github',
      };

      const resultPath = await subject.fetchGithubPhoton(dep);
      assert.ok(resultPath.endsWith('.photon.ts'), 'GitHub fetch should write photon file');
      assert.ok(capturedLabel.includes('portel-dev'), 'Cache label should include repo owner');
      assert.ok(capturedContent.includes('GithubPhoton'), 'Cached content should match response');

      globalThis.fetch = originalFetch;
      console.log('✅ GitHub photon fetching caches result');
    }

    // Test 12: resolveNpmPhoton installs package into cache directory
    {
      const subject: any = new PhotonLoader();
      const spec = `test-photon-package@1.0.0-${Date.now()}`;
      const dep = { name: 'npmPhoton', source: `npm:${spec}`, sourceType: 'npm' };
      const sanitized = subject.sanitizeCacheLabel(spec);
      const cacheDir = path.join(os.homedir(), '.photon', '.cache', 'npm', sanitized);

      subject.ensureNpmPackageInstalled = async (_cacheDir: string, _packageSpec: string, packageName: string) => {
        const pkgRoot = path.join(cacheDir, 'node_modules', packageName);
        await fs.mkdir(pkgRoot, { recursive: true });
        await fs.writeFile(path.join(pkgRoot, 'index.photon.ts'), 'export default class NpmPhoton {}');
      };

      const resolved = await subject.resolveNpmPhoton(dep);
      assert.ok(resolved.endsWith('.photon.ts'), 'npm photon resolution should return photon path');
      const fileContent = await fs.readFile(resolved, 'utf-8');
      assert.ok(fileContent.includes('NpmPhoton'), 'Resolved npm photon should match stub content');

      await fs.rm(cacheDir, { recursive: true, force: true });
      console.log('✅ npm photon resolution installs into temp cache');
    }

    console.log('\n✅ All Loader tests passed!');
  } finally {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}
