import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  MarketplaceManager,
  type Marketplace,
  type PhotonMetadata,
} from '../src/marketplace-manager.js';

let testDir: string;

const marketplace: Marketplace = {
  name: 'third-party',
  repo: 'acme/photons',
  url: 'https://example.com/acme/photons',
  sourceType: 'github',
  source: 'acme/photons',
  enabled: true,
};

const metadata: PhotonMetadata = {
  name: 'todo',
  version: '1.0.0',
  description: 'todo',
  source: 'todo.photon.ts',
};

describe('Forking', () => {
  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `photon-fork-test-${Date.now()}`);
    await fsp.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(testDir, { recursive: true, force: true });
  });

  it('moves a tracked namespaced photon into the local root with the same name', async () => {
    const manager = new MarketplaceManager(undefined, testDir);
    await manager.initialize();

    await fsp.mkdir(path.join(testDir, 'acme', 'todo'), { recursive: true });
    await fsp.writeFile(
      path.join(testDir, 'acme', 'todo.photon.ts'),
      '/**\n * @forkedFrom acme/photons#todo\n */\nexport default class Todo {}'
    );
    await fsp.writeFile(path.join(testDir, 'acme', 'todo', 'index.html'), '<div>todo</div>');
    await manager.savePhotonMetadata('acme/todo.photon.ts', marketplace, metadata, 'sha256:test');

    const result = await manager.forkPhoton('acme:todo', testDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'todo.photon.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'todo', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'acme', 'todo.photon.ts'))).toBe(false);
    expect(await manager.getPhotonInstallMetadata('acme/todo.photon.ts')).toBeNull();
  });

  it('requires a new name when forking an already-local photon', async () => {
    const manager = new MarketplaceManager(undefined, testDir);
    await manager.initialize();

    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), 'export default class Todo {}');

    const result = await manager.forkPhoton('todo', testDir);

    expect(result.success).toBe(false);
    expect(result.requiresName).toBe(true);
    expect(result.suggestedName).toBe('todo-copy');
  });

  it('duplicates a local photon when a new name is provided', async () => {
    const manager = new MarketplaceManager(undefined, testDir);
    await manager.initialize();

    await fsp.mkdir(path.join(testDir, 'todo'), { recursive: true });
    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), 'export default class Todo {}');
    await fsp.writeFile(path.join(testDir, 'todo', 'index.html'), '<div>todo</div>');

    const result = await manager.forkPhoton('todo', testDir, { newName: 'todo-copy' });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'todo.photon.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'todo-copy.photon.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'todo-copy', 'index.html'))).toBe(true);
  });

  it('requires a new local name when the canonical root name is already taken', async () => {
    const manager = new MarketplaceManager(undefined, testDir);
    await manager.initialize();

    await fsp.writeFile(path.join(testDir, 'todo.photon.ts'), 'export default class LocalTodo {}');
    await fsp.mkdir(path.join(testDir, 'acme'), { recursive: true });
    await fsp.writeFile(
      path.join(testDir, 'acme', 'todo.photon.ts'),
      '/**\n * @forkedFrom acme/photons#todo\n */\nexport default class MarketplaceTodo {}'
    );
    await manager.savePhotonMetadata('acme/todo.photon.ts', marketplace, metadata, 'sha256:test');

    const result = await manager.forkPhoton('acme:todo', testDir);

    expect(result.success).toBe(false);
    expect(result.requiresName).toBe(true);
    expect(result.suggestedName).toBe('todo-copy');
  });
});
