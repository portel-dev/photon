/**
 * Tests for Settings — property-driven configuration
 *
 * Covers:
 * - Schema extractor detecting `protected settings` property
 * - Settings tool auto-generation
 * - Read-only proxy enforcement
 * - Persistence roundtrip
 * - Backward compat with configure() method
 */

import { SchemaExtractor } from '@portel/photon-core';
import { PhotonLoader } from '../src/loader.js';
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

async function runTests() {
  console.log('🧪 Running Settings Tests...\n');

  const extractor = new SchemaExtractor();

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEMA EXTRACTOR TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  // Test 1: Detect `protected settings` property
  {
    const source = `
      /**
       * @property wipLimit WIP limit for in-progress tasks
       * @property theme UI theme preference
       */
      export default class TestPhoton {
        protected settings = {
          wipLimit: 5,
          theme: 'dark',
        };

        async doWork() { return 'ok'; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.ok(result.settingsSchema, 'Should detect settingsSchema');
    assert.equal(result.settingsSchema!.hasSettings, true, 'hasSettings should be true');
    assert.equal(result.settingsSchema!.properties.length, 2, 'Should have 2 properties');

    const wipProp = result.settingsSchema!.properties.find((p) => p.name === 'wipLimit');
    assert.ok(wipProp, 'Should find wipLimit property');
    assert.equal(wipProp!.type, 'number', 'wipLimit should be number type');
    assert.equal(wipProp!.default, 5, 'wipLimit default should be 5');
    assert.equal(wipProp!.required, false, 'wipLimit should not be required (has default)');
    assert.equal(
      wipProp!.description,
      'WIP limit for in-progress tasks',
      'wipLimit description from @property'
    );

    const themeProp = result.settingsSchema!.properties.find((p) => p.name === 'theme');
    assert.ok(themeProp, 'Should find theme property');
    assert.equal(themeProp!.type, 'string', 'theme should be string type');
    assert.equal(themeProp!.default, 'dark', 'theme default should be dark');

    console.log('✅ Settings property detected with types, defaults, and descriptions');
  }

  // Test 2: Detect undefined defaults as required
  {
    const source = `
      /**
       * @property apiKey API key for authentication
       */
      export default class TestPhoton {
        protected settings = {
          apiKey: undefined as string | undefined,
          retries: 3,
        };

        async doWork() { return 'ok'; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.ok(result.settingsSchema, 'Should detect settingsSchema');

    const apiKeyProp = result.settingsSchema!.properties.find((p) => p.name === 'apiKey');
    assert.ok(apiKeyProp, 'Should find apiKey property');
    assert.equal(apiKeyProp!.required, true, 'apiKey should be required (undefined default)');
    assert.equal(apiKeyProp!.type, 'string', 'apiKey type inferred from as-expression');

    const retriesProp = result.settingsSchema!.properties.find((p) => p.name === 'retries');
    assert.ok(retriesProp, 'Should find retries property');
    assert.equal(retriesProp!.required, false, 'retries should not be required');
    assert.equal(retriesProp!.default, 3, 'retries default should be 3');

    console.log('✅ Undefined defaults detected as required');
  }

  // Test 3: Non-protected settings not detected
  {
    const source = `
      export default class TestPhoton {
        settings = { key: 'value' };
        async doWork() { return 'ok'; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.ok(!result.settingsSchema, 'Non-protected settings should not be detected');
    console.log('✅ Non-protected settings ignored');
  }

  // Test 4: configure() no longer hidden — appears as a tool
  {
    const source = `
      export default class TestPhoton {
        async configure(params: { theme: string }) {
          return { ok: true };
        }
        async doWork() { return 'ok'; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const configureTool = result.tools.find((t) => t.name === 'configure');
    assert.ok(configureTool, 'configure() should appear as a tool (no longer hidden)');
    assert.ok(
      result.configSchema?.hasConfigureMethod,
      'configSchema should still track configure()'
    );
    console.log('✅ configure() is now a visible tool');
  }

  // Test 5: getConfig() no longer hidden — appears as a tool
  {
    const source = `
      export default class TestPhoton {
        async getConfig() { return {}; }
        async doWork() { return 'ok'; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const getConfigTool = result.tools.find((t) => t.name === 'getConfig');
    assert.ok(getConfigTool, 'getConfig() should appear as a tool (no longer hidden)');
    console.log('✅ getConfig() is now a visible tool');
  }

  // Test 6: Boolean settings
  {
    const source = `
      export default class TestPhoton {
        protected settings = {
          enabled: true,
          debug: false,
        };
        async doWork() { return 'ok'; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.ok(result.settingsSchema, 'Should detect settingsSchema');

    const enabledProp = result.settingsSchema!.properties.find((p) => p.name === 'enabled');
    assert.equal(enabledProp!.type, 'boolean', 'enabled should be boolean');
    assert.equal(enabledProp!.default, true, 'enabled default should be true');

    const debugProp = result.settingsSchema!.properties.find((p) => p.name === 'debug');
    assert.equal(debugProp!.type, 'boolean', 'debug should be boolean');
    assert.equal(debugProp!.default, false, 'debug default should be false');

    console.log('✅ Boolean settings detected correctly');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADER TESTS — settings injection, proxy, persistence
  // ═══════════════════════════════════════════════════════════════════════════

  // Test 7: Settings tool auto-generated and settings persisted
  {
    // Create a temporary photon file with settings
    const tmpDir = path.join(os.tmpdir(), `photon-settings-test-${Date.now()}`);
    const photonDir = path.join(tmpDir, 'photons');
    const stateDir = path.join(tmpDir, 'state');
    await fs.mkdir(photonDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });

    const photonPath = path.join(photonDir, 'test-settings.photon.ts');
    await fs.writeFile(
      photonPath,
      `
      /**
       * @property maxItems Maximum items to show
       * @property theme Color theme
       */
      export default class TestSettings {
        protected settings = {
          maxItems: 10,
          theme: 'dark',
        };

        async doWork() {
          return { items: this.settings.maxItems, theme: this.settings.theme };
        }
      }
    `
    );

    const loader = new PhotonLoader(false, undefined, tmpDir);
    const mcp = await loader.loadFile(photonPath);

    // Verify settings tool was auto-generated
    const settingsTool = mcp.tools.find((t) => t.name === 'settings');
    assert.ok(settingsTool, 'settings tool should be auto-generated');
    assert.ok(
      settingsTool!.inputSchema.properties.maxItems,
      'settings tool should have maxItems param'
    );
    assert.ok(settingsTool!.inputSchema.properties.theme, 'settings tool should have theme param');
    assert.ok(!settingsTool!.inputSchema.required, 'settings tool params should all be optional');

    // Verify settings reads work
    const result = await loader.executeTool(mcp, 'doWork', {});
    assert.equal(result.items, 10, 'Should read default maxItems');
    assert.equal(result.theme, 'dark', 'Should read default theme');

    // Execute settings tool to update values
    const updated = await loader.executeTool(mcp, 'settings', { maxItems: 25 });
    assert.equal(updated.maxItems, 25, 'Updated maxItems should be 25');
    assert.equal(updated.theme, 'dark', 'theme should remain dark');

    // Verify persistence file exists
    const settingsPath = path.join(stateDir, 'test-settings', 'default-settings.json');
    const persisted = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.equal(persisted.maxItems, 25, 'Persisted maxItems should be 25');

    // Verify settings read reflects the update
    const result2 = await loader.executeTool(mcp, 'doWork', {});
    assert.equal(result2.items, 25, 'Should read updated maxItems');

    // Clean up
    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log('✅ Settings tool auto-generated, persisted, and reads updated values');
  }

  // Test 8: Read-only proxy throws on direct write
  {
    const tmpDir = path.join(os.tmpdir(), `photon-settings-proxy-${Date.now()}`);
    const photonDir = path.join(tmpDir, 'photons');
    await fs.mkdir(photonDir, { recursive: true });

    const photonPath = path.join(photonDir, 'proxy-test.photon.ts');
    await fs.writeFile(
      photonPath,
      `
      export default class ProxyTest {
        protected settings = {
          value: 42,
        };

        async tryWrite() {
          try {
            (this.settings as any).value = 99;
            return { threw: false };
          } catch (e: any) {
            return { threw: true, message: e.message };
          }
        }
      }
    `
    );

    const loader = new PhotonLoader(false, undefined, tmpDir);
    const mcp = await loader.loadFile(photonPath);

    const result = await loader.executeTool(mcp, 'tryWrite', {});
    assert.equal(
      result.threw,
      true,
      `Direct write to settings should throw, got: ${JSON.stringify(result)}`
    );
    assert.ok(
      result.message.includes('settings'),
      `Error message should mention settings, got: ${result.message}`
    );

    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log('✅ Read-only proxy throws on direct write');
  }

  // Test 9: Settings persistence roundtrip (set → reload → read)
  {
    const tmpDir = path.join(os.tmpdir(), `photon-settings-roundtrip-${Date.now()}`);
    const photonDir = path.join(tmpDir, 'photons');
    await fs.mkdir(photonDir, { recursive: true });

    const photonPath = path.join(photonDir, 'roundtrip.photon.ts');
    await fs.writeFile(
      photonPath,
      `
      export default class RoundtripTest {
        protected settings = {
          count: 0,
          label: 'default',
        };

        async read() {
          return { count: this.settings.count, label: this.settings.label };
        }
      }
    `
    );

    const loader = new PhotonLoader(false, undefined, tmpDir);

    // First load: set values
    const mcp1 = await loader.loadFile(photonPath);
    await loader.executeTool(mcp1, 'settings', { count: 42, label: 'updated' });

    // Second load: should read persisted values
    const mcp2 = await loader.reloadFile(photonPath);
    const result = await loader.executeTool(mcp2, 'read', {});
    assert.equal(result.count, 42, 'Persisted count should survive reload');
    assert.equal(result.label, 'updated', 'Persisted label should survive reload');

    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log('✅ Settings persistence roundtrip works');
  }

  // Test 10: Backward compat — configure() still visible as tool
  {
    const source = `
      export default class LegacyPhoton {
        async configure(params: { theme: string }) {
          return { applied: true };
        }
        async doWork() { return 'ok'; }
      }
    `;
    const result = extractor.extractAllFromSource(source);

    // configure() should appear as a regular tool now (not hidden)
    const configureTool = result.tools.find((t) => t.name === 'configure');
    assert.ok(configureTool, 'configure() should be a visible tool for backward compat');
    assert.ok(configureTool!.inputSchema.properties.theme, 'configure should have theme param');

    // configSchema should still be populated for metadata
    assert.ok(
      result.configSchema?.hasConfigureMethod,
      'configSchema.hasConfigureMethod should be true'
    );

    console.log('✅ Backward compat: configure() is a visible tool');
  }

  // Test 11: Settings with no params returns current values
  {
    const tmpDir = path.join(os.tmpdir(), `photon-settings-noparams-${Date.now()}`);
    const photonDir = path.join(tmpDir, 'photons');
    await fs.mkdir(photonDir, { recursive: true });

    const photonPath = path.join(photonDir, 'noparams.photon.ts');
    await fs.writeFile(
      photonPath,
      `
      export default class NoParamsTest {
        protected settings = {
          count: 7,
          name: 'test',
        };

        async check() { return 'ok'; }
      }
    `
    );

    const loader = new PhotonLoader(false, undefined, tmpDir);
    const mcp = await loader.loadFile(photonPath);

    // Call settings with no args
    const result = await loader.executeTool(mcp, 'settings', {});
    assert.equal(result.count, 7, 'Should return default count');
    assert.equal(result.name, 'test', 'Should return default name');

    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log('✅ Settings with no params returns current values');
  }

  console.log('\n🎉 All Settings tests passed!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
