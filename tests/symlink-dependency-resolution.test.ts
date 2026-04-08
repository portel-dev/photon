import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PhotonLoader } from '../src/loader.js';

let testDir: string;

describe('Symlink dependency resolution', () => {
  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `photon-symlink-deps-${Date.now()}`);
    await fsp.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(testDir, { recursive: true, force: true });
  });

  it('resolves marketplace-style sibling @photon deps from the real symlink target directory', async () => {
    const workspace = path.join(testDir, 'workspace');
    const sourceRepo = path.join(testDir, 'source-repo');
    await fsp.mkdir(sourceRepo, { recursive: true });

    await fsp.writeFile(
      path.join(sourceRepo, 'orchestrator.photon.ts'),
      `import { Photon } from '@portel/photon-core';

/**
 * @photon child child
 */
export default class Orchestrator extends Photon {
  constructor(private child: any) { super(); }
  async main() { return await this.child.ping(); }
}`
    );

    await fsp.writeFile(
      path.join(sourceRepo, 'child.photon.ts'),
      `import { Photon } from '@portel/photon-core';
export default class Child extends Photon {
  async ping() { return { ok: true }; }
}`
    );

    await fsp.mkdir(workspace, { recursive: true });
    await fsp.symlink(
      path.join(sourceRepo, 'orchestrator.photon.ts'),
      path.join(workspace, 'orchestrator.photon.ts')
    );

    const loader = new PhotonLoader(false, undefined, workspace);
    const loaded = await loader.loadFile(path.join(workspace, 'orchestrator.photon.ts'));
    const result = await (loaded.instance as any).main();

    expect(result).toEqual({ ok: true });
    expect(fs.realpathSync(path.join(workspace, 'child.photon.ts'))).toBe(
      fs.realpathSync(path.join(sourceRepo, 'child.photon.ts'))
    );
  });

  it('resolves relative sibling @photon deps from the real symlink target directory', async () => {
    const workspace = path.join(testDir, 'workspace-rel');
    const sourceRepo = path.join(testDir, 'source-repo-rel');
    await fsp.mkdir(sourceRepo, { recursive: true });

    await fsp.writeFile(
      path.join(sourceRepo, 'parent.photon.ts'),
      `import { Photon } from '@portel/photon-core';

/**
 * @photon helper ./helper.photon.ts
 */
export default class Parent extends Photon {
  constructor(private helper: any) { super(); }
  async main() { return await this.helper.ping(); }
}`
    );

    await fsp.writeFile(
      path.join(sourceRepo, 'helper.photon.ts'),
      `import { Photon } from '@portel/photon-core';
export default class Helper extends Photon {
  async ping() { return { ok: 'relative' }; }
}`
    );

    await fsp.mkdir(workspace, { recursive: true });
    await fsp.symlink(
      path.join(sourceRepo, 'parent.photon.ts'),
      path.join(workspace, 'parent.photon.ts')
    );

    const loader = new PhotonLoader(false, undefined, workspace);
    const loaded = await loader.loadFile(path.join(workspace, 'parent.photon.ts'));
    const result = await (loaded.instance as any).main();

    expect(result).toEqual({ ok: 'relative' });
    expect(fs.existsSync(path.join(workspace, 'helper.photon.ts'))).toBe(false);
  });

  it('materializes sibling asset directory symlinks for marketplace-style deps', async () => {
    const workspace = path.join(testDir, 'workspace-assets');
    const sourceRepo = path.join(testDir, 'source-repo-assets');
    await fsp.mkdir(path.join(sourceRepo, 'child', 'ui'), { recursive: true });

    await fsp.writeFile(
      path.join(sourceRepo, 'orchestrator.photon.ts'),
      `import { Photon } from '@portel/photon-core';

/**
 * @photon child child
 */
export default class Orchestrator extends Photon {
  constructor(private child: any) { super(); }
  async main() { return await this.child.ping(); }
}`
    );

    await fsp.writeFile(
      path.join(sourceRepo, 'child.photon.ts'),
      `import { Photon } from '@portel/photon-core';
export default class Child extends Photon {
  async ping() { return { ok: 'assets' }; }
}`
    );
    await fsp.writeFile(path.join(sourceRepo, 'child', 'ui', 'dashboard.html'), '<div>child</div>');

    await fsp.mkdir(workspace, { recursive: true });
    await fsp.symlink(
      path.join(sourceRepo, 'orchestrator.photon.ts'),
      path.join(workspace, 'orchestrator.photon.ts')
    );

    const loader = new PhotonLoader(false, undefined, workspace);
    const loaded = await loader.loadFile(path.join(workspace, 'orchestrator.photon.ts'));
    const result = await (loaded.instance as any).main();

    expect(result).toEqual({ ok: 'assets' });
    expect(fs.realpathSync(path.join(workspace, 'child'))).toBe(
      fs.realpathSync(path.join(sourceRepo, 'child'))
    );
  });
});
