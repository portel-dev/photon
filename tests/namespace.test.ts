/**
 * Namespace System Tests
 *
 * Tests for the namespace-based directory structure, path resolution,
 * storage/assets APIs, instance-aware DI, and migration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  resolvePath,
  listFiles,
  listFilesWithNamespace,
  type ListedPhoton,
} from '@portel/photon-core';

let testDir: string;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `photon-ns-test-${Date.now()}`);
  await fsp.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(testDir, { recursive: true, force: true });
});

describe('Path Resolution with Namespaces', () => {
  it('resolves flat files at root level (backward compat)', async () => {
    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), 'export default class Todo {}');

    const result = await resolvePath('todo', testDir);
    expect(result).toBe(path.join(testDir, 'todo.photon.ts'));
  });

  it('resolves files in namespace subdirectories', async () => {
    const nsDir = path.join(testDir, 'portel-dev');
    await fsp.mkdir(nsDir, { recursive: true });
    await fsp.writeFile(path.join(nsDir, 'whatsapp.photon.ts'), 'export default class WA {}');

    const result = await resolvePath('whatsapp', testDir);
    expect(result).toBe(path.join(nsDir, 'whatsapp.photon.ts'));
  });

  it('resolves namespace:name qualified names', async () => {
    const nsDir = path.join(testDir, 'portel-dev');
    await fsp.mkdir(nsDir, { recursive: true });
    await fsp.writeFile(path.join(nsDir, 'whatsapp.photon.ts'), 'export default class WA {}');

    const result = await resolvePath('portel-dev:whatsapp', testDir);
    expect(result).toBe(path.join(nsDir, 'whatsapp.photon.ts'));
  });

  it('returns null for non-existent namespace:name', async () => {
    const result = await resolvePath('nonexistent:photon', testDir);
    expect(result).toBeNull();
  });

  it('flat files take precedence over namespace files', async () => {
    // Create both flat and namespaced versions
    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), 'flat');
    const nsDir = path.join(testDir, 'local');
    await fsp.mkdir(nsDir, { recursive: true });
    await fsp.writeFile(path.join(nsDir, 'todo.photon.ts'), 'namespaced');

    const result = await resolvePath('todo', testDir);
    expect(result).toBe(path.join(testDir, 'todo.photon.ts'));
  });

  it('skips reserved directories during namespace scan', async () => {
    // Create a file in 'state' dir — should not be found
    const stateDir = path.join(testDir, 'state');
    await fsp.mkdir(stateDir, { recursive: true });
    await fsp.writeFile(path.join(stateDir, 'debug.photon.ts'), 'bad');

    const result = await resolvePath('debug', testDir);
    expect(result).toBeNull();
  });
});

describe('listFiles with Namespaces', () => {
  it('lists flat files', async () => {
    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), '');
    await fsp.writeFile(path.join(testDir, 'notes.photon.ts'), '');

    const files = await listFiles(testDir);
    expect(files).toContain('todo');
    expect(files).toContain('notes');
  });

  it('lists files from namespace subdirectories', async () => {
    const nsDir = path.join(testDir, 'portel-dev');
    await fsp.mkdir(nsDir, { recursive: true });
    await fsp.writeFile(path.join(nsDir, 'whatsapp.photon.ts'), '');

    const files = await listFiles(testDir);
    expect(files).toContain('whatsapp');
  });

  it('includes both flat and namespaced files', async () => {
    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), '');
    const nsDir = path.join(testDir, 'portel-dev');
    await fsp.mkdir(nsDir, { recursive: true });
    await fsp.writeFile(path.join(nsDir, 'whatsapp.photon.ts'), '');

    const files = await listFiles(testDir);
    expect(files.length).toBe(2);
    expect(files).toContain('todo');
    expect(files).toContain('whatsapp');
  });
});

describe('listFilesWithNamespace', () => {
  it('returns namespace metadata for each photon', async () => {
    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), '');
    const nsDir = path.join(testDir, 'portel-dev');
    await fsp.mkdir(nsDir, { recursive: true });
    await fsp.writeFile(path.join(nsDir, 'whatsapp.photon.ts'), '');

    const results = await listFilesWithNamespace(testDir);
    expect(results.length).toBe(2);

    const flat = results.find((r) => r.name === 'todo')!;
    expect(flat.namespace).toBe('');
    expect(flat.qualifiedName).toBe('todo');
    expect(flat.filePath).toBe(path.join(testDir, 'todo.photon.ts'));

    const ns = results.find((r) => r.name === 'whatsapp')!;
    expect(ns.namespace).toBe('portel-dev');
    expect(ns.qualifiedName).toBe('portel-dev:whatsapp');
    expect(ns.filePath).toBe(path.join(nsDir, 'whatsapp.photon.ts'));
  });

  it('identifies collisions between namespaces', async () => {
    const ns1 = path.join(testDir, 'portel-dev');
    const ns2 = path.join(testDir, 'arul');
    await fsp.mkdir(ns1, { recursive: true });
    await fsp.mkdir(ns2, { recursive: true });
    await fsp.writeFile(path.join(ns1, 'whatsapp.photon.ts'), '');
    await fsp.writeFile(path.join(ns2, 'whatsapp.photon.ts'), '');

    const results = await listFilesWithNamespace(testDir);
    const whatsapps = results.filter((r) => r.name === 'whatsapp');
    expect(whatsapps.length).toBe(2);

    const namespaces = whatsapps.map((r) => r.namespace).sort();
    expect(namespaces).toEqual(['arul', 'portel-dev']);
  });

  it('skips hidden directories', async () => {
    const hiddenDir = path.join(testDir, '.hidden');
    await fsp.mkdir(hiddenDir, { recursive: true });
    await fsp.writeFile(path.join(hiddenDir, 'secret.photon.ts'), '');

    const results = await listFilesWithNamespace(testDir);
    expect(results.find((r) => r.name === 'secret')).toBeUndefined();
  });
});

describe('Instance-Aware DI (schema-extractor)', () => {
  it('extracts instance name from parameter name suffix', async () => {
    const { SchemaExtractor } = await import('@portel/photon-core');
    const extractor = new SchemaExtractor();

    const source = `
      /**
       * @photon whatsapp rss-feed
       */
      export default class MyApp {
        constructor(
          private personalWhatsapp: any,
          private workWhatsapp: any,
          private whatsapp: any
        ) {}
        async test() { return 'ok'; }
      }
    `;

    const injections = extractor.resolveInjections(source, 'my-app');

    // personalWhatsapp → instance "personal"
    const personal = injections.find((i) => i.param.name === 'personalWhatsapp');
    expect(personal?.injectionType).toBe('photon');
    expect(personal?.photonDependency?.instanceName).toBe('personal');

    // workWhatsapp → instance "work"
    const work = injections.find((i) => i.param.name === 'workWhatsapp');
    expect(work?.injectionType).toBe('photon');
    expect(work?.photonDependency?.instanceName).toBe('work');

    // whatsapp → exact match, no instance prefix
    const defaultWa = injections.find((i) => i.param.name === 'whatsapp');
    expect(defaultWa?.injectionType).toBe('photon');
    expect(defaultWa?.photonDependency?.instanceName).toBeUndefined();
  });
});

describe('Namespace Migration', () => {
  it('migrates flat files to local/ when no metadata', async () => {
    // Create a flat photon file without @forkedFrom
    await fsp.writeFile(
      path.join(testDir, 'todo.photon.ts'),
      'export default class Todo { async add() {} }'
    );

    const { runNamespaceMigration } = await import('../src/namespace-migration.js');
    await runNamespaceMigration(testDir);

    // File should be in local/
    expect(fs.existsSync(path.join(testDir, 'local', 'todo.photon.ts'))).toBe(true);
    // Original should be gone
    expect(fs.existsSync(path.join(testDir, 'todo.photon.ts'))).toBe(false);
    // Sentinel should exist
    expect(fs.existsSync(path.join(testDir, '.migrated'))).toBe(true);
  });

  it('migrates files with @forkedFrom to author namespace', async () => {
    await fsp.writeFile(
      path.join(testDir, 'whatsapp.photon.ts'),
      '/**\n * @forkedFrom portel-dev/photons#whatsapp\n */\nexport default class WA {}'
    );

    const { runNamespaceMigration } = await import('../src/namespace-migration.js');
    await runNamespaceMigration(testDir);

    expect(fs.existsSync(path.join(testDir, 'portel-dev', 'whatsapp.photon.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'whatsapp.photon.ts'))).toBe(false);
  });

  it('is idempotent — does not re-run after sentinel', async () => {
    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), 'export default class Todo {}');

    const { runNamespaceMigration } = await import('../src/namespace-migration.js');
    await runNamespaceMigration(testDir);

    // Now create another flat file — migration should not run again
    await fsp.writeFile(path.join(testDir, 'notes.photon.ts'), 'export default class Notes {}');
    await runNamespaceMigration(testDir);

    // notes.photon.ts should still be flat (migration didn't re-run)
    expect(fs.existsSync(path.join(testDir, 'notes.photon.ts'))).toBe(true);
  });

  it('migrates data/<photonName>/ directory contents', async () => {
    // Simulate WhatsApp's data/whatsapp/auth structure
    await fsp.writeFile(
      path.join(testDir, 'whatsapp.photon.ts'),
      '/**\n * @forkedFrom portel-dev/photons#whatsapp\n */\nexport default class WA {}'
    );
    const legacyDataDir = path.join(testDir, 'data', 'whatsapp', 'auth');
    await fsp.mkdir(legacyDataDir, { recursive: true });
    await fsp.writeFile(path.join(legacyDataDir, 'creds.json'), '{"key": "value"}');

    const { runNamespaceMigration } = await import('../src/namespace-migration.js');
    await runNamespaceMigration(testDir);

    // Auth data should be moved to portel-dev/whatsapp/auth/
    const newAuthDir = path.join(testDir, 'portel-dev', 'whatsapp', 'auth');
    expect(fs.existsSync(path.join(newAuthDir, 'creds.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(newAuthDir, 'creds.json'), 'utf-8'))).toEqual({
      key: 'value',
    });
  });

  it('writes sentinel even when no flat files exist', async () => {
    const { runNamespaceMigration } = await import('../src/namespace-migration.js');
    await runNamespaceMigration(testDir);

    expect(fs.existsSync(path.join(testDir, '.migrated'))).toBe(true);
  });
});

describe('Photon Base Class APIs', () => {
  it('storage() returns correct path and creates directory', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();
    (photon as any)._photonFilePath = path.join(testDir, 'portel-dev', 'whatsapp.photon.ts');

    // Create the parent dir so storage() can create subdirs
    await fsp.mkdir(path.join(testDir, 'portel-dev'), { recursive: true });

    const authDir = (photon as any).storage('auth');
    expect(authDir).toBe(path.join(testDir, 'portel-dev', 'whatsapp', 'auth'));
    expect(fs.existsSync(authDir)).toBe(true);
  });

  it('assets() returns correct path using realpathSync', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    // Create a real file for realpathSync to work
    const realDir = path.join(testDir, 'real-src');
    await fsp.mkdir(realDir, { recursive: true });
    const realFile = path.join(realDir, 'todo.photon.ts');
    await fsp.writeFile(realFile, '');
    (photon as any)._photonFilePath = realFile;

    const templatesDir = (photon as any).assets('templates');
    // On macOS, /var → /private/var via realpathSync, so compare with realpath
    const expectedDir = path.join(fs.realpathSync(realDir), 'todo', 'templates');
    expect(templatesDir).toBe(expectedDir);
  });

  it('assets() can load text content with options', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    const realDir = path.join(testDir, 'real-src-load');
    await fsp.mkdir(path.join(realDir, 'todo'), { recursive: true });
    const realFile = path.join(realDir, 'todo.photon.ts');
    await fsp.writeFile(realFile, '');
    await fsp.writeFile(path.join(realDir, 'todo', 'slides.md'), '# Hello');
    (photon as any)._photonFilePath = realFile;

    const loaded = (photon as any).assets('slides.md', { load: true });
    expect(loaded).toBe('# Hello');
  });

  it('assets() accepts boolean shorthand for load', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    const realDir = path.join(testDir, 'real-src-bool');
    await fsp.mkdir(path.join(realDir, 'todo'), { recursive: true });
    const realFile = path.join(realDir, 'todo.photon.ts');
    await fsp.writeFile(realFile, '');
    await fsp.writeFile(path.join(realDir, 'todo', 'slides.md'), '# Boolean');
    (photon as any)._photonFilePath = realFile;

    const loaded = (photon as any).assets('slides.md', true);
    expect(loaded).toBe('# Boolean');
  });

  it('storage() throws without _photonFilePath', () => {
    const { Photon } = require('@portel/photon-core');
    const photon = new Photon();
    expect(() => photon.storage('auth')).toThrow('_photonFilePath');
  });

  it('photon.use() throws without resolver', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();
    await expect(photon.photon.use('whatsapp')).rejects.toThrow('photon resolution');
  });

  it('photon.use() calls resolver with correct args', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    let calledWith: [string, string | undefined] | null = null;
    (photon as any)._photonResolver = async (name: string, instance?: string) => {
      calledWith = [name, instance];
      return { mock: true };
    };

    const result = await photon.photon.use('portel-dev:whatsapp', 'personal');
    expect(calledWith).toEqual(['portel-dev:whatsapp', 'personal']);
    expect(result).toEqual({ mock: true });
  });

  it('render() emits a render event via outputHandler', async () => {
    const { Photon } = await import('@portel/photon-core');
    const photon = new Photon();

    const emitted: any[] = [];
    (photon as any).emit = (data: any) => emitted.push(data);

    (photon as any).render('qr', 'https://wa.link/abc');
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      emit: 'render',
      format: 'qr',
      value: 'https://wa.link/abc',
    });

    // Render with complex value
    (photon as any).render('dashboard', {
      chart: { format: 'chart:bar', data: [1, 2, 3] },
      status: { format: 'text', data: 'OK' },
    });
    expect(emitted[1].emit).toBe('render');
    expect(emitted[1].format).toBe('dashboard');
    expect(emitted[1].value.chart.format).toBe('chart:bar');
  });
});
