import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import Publish, {
  parseVersionTag,
  bumpVersion,
  writeVersionTag,
  extractMethodNames,
  suggestBumpFromDiff,
  parseOwnerRepo,
  collectChanges,
} from '../src/photons/publish.photon.js';

const exec = promisify(execFile);

// ─── unit tests: pure helpers ──────────────────────────────────────────────

describe('parseVersionTag', () => {
  it('parses a @version tag', () => {
    expect(parseVersionTag('/** @version 1.2.3 */')).toBe('1.2.3');
  });

  it('defaults to 0.0.0 when tag missing', () => {
    expect(parseVersionTag('no tag here')).toBe('0.0.0');
  });

  it('parses non-semver strings unchanged', () => {
    expect(parseVersionTag('/** @version 2.0.0-beta */')).toBe('2.0.0-beta');
  });
});

describe('bumpVersion', () => {
  it('patches the last segment', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });
  it('minors and resets patch', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });
  it('majors and resets minor/patch', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });
  it('pads short versions', () => {
    expect(bumpVersion('1', 'minor')).toBe('1.1.0');
  });
});

describe('writeVersionTag', () => {
  it('replaces existing @version', () => {
    const src = '/** @version 1.0.0 */\nclass X {}';
    expect(writeVersionTag(src, '1.1.0')).toContain('@version 1.1.0');
  });

  it('injects into existing JSDoc block when tag absent', () => {
    const src = '/**\n * Foo\n */\nclass X {}';
    const out = writeVersionTag(src, '0.1.0');
    expect(out).toContain('@version 0.1.0');
  });

  it('prepends a new JSDoc when no block exists', () => {
    const src = 'class X {}';
    const out = writeVersionTag(src, '0.1.0');
    expect(out.startsWith('/** @version 0.1.0 */')).toBe(true);
  });
});

describe('extractMethodNames', () => {
  it('finds async class methods', () => {
    const src = `
      class Foo {
        async greet() {}
        async send(x: string) {}
      }
    `;
    const names = extractMethodNames(src);
    expect(names.has('greet')).toBe(true);
    expect(names.has('send')).toBe(true);
  });

  it('ignores private (underscore) methods', () => {
    const src = `
      class Foo {
        async _internal() {}
        async public() {}
      }
    `;
    const names = extractMethodNames(src);
    expect(names.has('_internal')).toBe(false);
    expect(names.has('public')).toBe(true);
  });

  it('ignores control-flow keywords that look like calls', () => {
    const src = `
      class Foo {
        run() {
          if (x) {}
          while (y) {}
        }
      }
    `;
    const names = extractMethodNames(src);
    expect(names.has('if')).toBe(false);
    expect(names.has('while')).toBe(false);
    expect(names.has('run')).toBe(true);
  });

  it('finds static generator methods', () => {
    const src = `
      class Foo {
        static async *wizard() {}
      }
    `;
    expect(extractMethodNames(src).has('wizard')).toBe(true);
  });
});

describe('suggestBumpFromDiff', () => {
  it('returns minor when file is new (no before)', () => {
    const after = 'class X { async a() {} }';
    const r = suggestBumpFromDiff(null, after);
    expect(r.level).toBe('minor');
    expect(r.added).toContain('a');
  });

  it('returns major when methods are removed', () => {
    const before = 'class X { async a() {} async b() {} }';
    const after = 'class X { async a() {} }';
    const r = suggestBumpFromDiff(before, after);
    expect(r.level).toBe('major');
    expect(r.removed).toContain('b');
  });

  it('returns minor when methods are added', () => {
    const before = 'class X { async a() {} }';
    const after = 'class X { async a() {} async b() {} }';
    const r = suggestBumpFromDiff(before, after);
    expect(r.level).toBe('minor');
    expect(r.added).toContain('b');
  });

  it('returns patch when method signatures unchanged', () => {
    const before = 'class X { async a() { return 1; } }';
    const after = 'class X { async a() { return 2; } }';
    const r = suggestBumpFromDiff(before, after);
    expect(r.level).toBe('patch');
  });

  it('prefers major over minor when both occur', () => {
    const before = 'class X { async a() {} async b() {} }';
    const after = 'class X { async a() {} async c() {} }';
    const r = suggestBumpFromDiff(before, after);
    expect(r.level).toBe('major');
    expect(r.removed).toContain('b');
    expect(r.added).toContain('c');
  });
});

describe('parseOwnerRepo', () => {
  it('parses https URL', () => {
    expect(parseOwnerRepo('https://github.com/alice/demo.git')).toBe('alice/demo');
  });
  it('parses ssh URL', () => {
    expect(parseOwnerRepo('git@github.com:alice/demo.git')).toBe('alice/demo');
  });
  it('returns null for non-github remotes', () => {
    expect(parseOwnerRepo('https://example.com/foo.git')).toBe(null);
  });
});

// ─── integration: collectChanges against a real temp git repo ──────────────

describe('collectChanges', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-test-'));
    await exec('git', ['init', '-b', 'main'], { cwd: tmp });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: tmp });
    await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmp });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('detects new photon as status=new', async () => {
    await fs.writeFile(
      path.join(tmp, 'hello.photon.ts'),
      '/** @version 0.1.0 */\nexport default class Hello { async greet() {} }\n',
      'utf-8'
    );
    const changes = await collectChanges(tmp);
    expect(changes).toHaveLength(1);
    expect(changes[0].status).toBe('new');
    expect(changes[0].name).toBe('hello');
  });

  it('detects changed photon with added method as minor bump', async () => {
    const file = path.join(tmp, 'hello.photon.ts');
    await fs.writeFile(
      file,
      '/** @version 0.1.0 */\nexport default class Hello { async greet() {} }\n',
      'utf-8'
    );
    await exec('git', ['add', '.'], { cwd: tmp });
    await exec('git', ['commit', '-m', 'initial'], { cwd: tmp });

    await fs.writeFile(
      file,
      '/** @version 0.1.0 */\nexport default class Hello { async greet() {} async wave() {} }\n',
      'utf-8'
    );
    const changes = await collectChanges(tmp);
    expect(changes).toHaveLength(1);
    expect(changes[0].status).toBe('changed');
    expect(changes[0].suggestedBump).toBe('minor');
    expect(changes[0].suggestedVersion).toBe('0.2.0');
    expect(changes[0].addedMethods).toContain('wave');
  });

  it('detects removed method as major bump', async () => {
    const file = path.join(tmp, 'hello.photon.ts');
    await fs.writeFile(
      file,
      '/** @version 1.0.0 */\nexport default class Hello { async greet() {} async wave() {} }\n',
      'utf-8'
    );
    await exec('git', ['add', '.'], { cwd: tmp });
    await exec('git', ['commit', '-m', 'initial'], { cwd: tmp });

    await fs.writeFile(
      file,
      '/** @version 1.0.0 */\nexport default class Hello { async greet() {} }\n',
      'utf-8'
    );
    const changes = await collectChanges(tmp);
    expect(changes[0].suggestedBump).toBe('major');
    expect(changes[0].suggestedVersion).toBe('2.0.0');
    expect(changes[0].removedMethods).toContain('wave');
  });

  it('marks unchanged photon as status=unchanged', async () => {
    const file = path.join(tmp, 'hello.photon.ts');
    await fs.writeFile(
      file,
      '/** @version 1.0.0 */\nexport default class Hello { async greet() {} }\n',
      'utf-8'
    );
    await exec('git', ['add', '.'], { cwd: tmp });
    await exec('git', ['commit', '-m', 'initial'], { cwd: tmp });

    const changes = await collectChanges(tmp);
    expect(changes[0].status).toBe('unchanged');
  });
});

// ─── integration: drive the wizard generator ───────────────────────────────

describe('Publish.wizard', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-wiz-'));
    await exec('git', ['init', '-b', 'main'], { cwd: tmp });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: tmp });
    await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmp });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('bails out cleanly when no .photon.ts files exist', async () => {
    const gen = Publish.wizard({ dir: tmp });
    const yields: any[] = [];
    let r = await gen.next();
    while (!r.done) {
      yields.push(r.value);
      r = await gen.next();
    }
    const finalEmit = yields.find((y) => y.emit === 'result');
    expect(finalEmit).toBeDefined();
    expect(finalEmit.data.error).toMatch(/No \.photon\.ts/);
  });

  it('reports "nothing to publish" when all photons unchanged', async () => {
    await fs
      .writeFile(
        path.join(tmp, '.marketplace', 'photons.json').replace('/.marketplace/', '/'),
        '',
        'utf-8'
      )
      .catch(() => {}); // no-op; just ensure fs works
    await fs.mkdir(path.join(tmp, '.marketplace'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, '.marketplace', 'photons.json'),
      '{"name":"x","owner":"y","photons":[]}\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tmp, 'hello.photon.ts'),
      '/** @version 1.0.0 */\nexport default class Hello { async greet() {} }\n',
      'utf-8'
    );
    await exec('git', ['add', '.'], { cwd: tmp });
    await exec('git', ['commit', '-m', 'initial'], { cwd: tmp });

    const gen = Publish.wizard({ dir: tmp });
    const yields: any[] = [];
    let r = await gen.next();
    while (!r.done) {
      yields.push(r.value);
      r = await gen.next();
    }
    const finalEmit = yields.find((y) => y.emit === 'result');
    expect(finalEmit.data.published).toBe(0);
    expect(finalEmit.data.message).toMatch(/Nothing to publish/);
  });

  it('version-bump wizard: user can override the suggestion', async () => {
    // Setup: marketplace already exists, photon has a new method (would suggest minor)
    await fs.mkdir(path.join(tmp, '.marketplace'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, '.marketplace', 'photons.json'),
      '{"name":"x","owner":"y","photons":[]}\n',
      'utf-8'
    );
    const file = path.join(tmp, 'hello.photon.ts');
    await fs.writeFile(
      file,
      '/** @version 1.0.0 */\nexport default class Hello { async greet() {} }\n',
      'utf-8'
    );
    await exec('git', ['add', '.'], { cwd: tmp });
    await exec('git', ['commit', '-m', 'initial'], { cwd: tmp });
    await fs.writeFile(
      file,
      '/** @version 1.0.0 */\nexport default class Hello { async greet() {} async wave() {} }\n',
      'utf-8'
    );

    // Drive wizard, override minor → major
    const gen = Publish.wizard({ dir: tmp, dryRun: true });
    const yields: any[] = [];
    let input: any = undefined;
    let r = await gen.next();
    while (!r.done) {
      yields.push(r.value);
      const step: any = r.value;
      if (step.ask === 'confirm' && step.id === 'confirm-publish') input = true;
      else if (step.ask === 'select' && step.id === 'bump-hello') input = 'major';
      else if (step.ask === 'text' && step.id === 'commit-message') input = '';
      else if (step.ask === 'confirm' && step.id === 'confirm-commit')
        input = false; // stop here
      else input = undefined;
      r = await gen.next(input);
    }

    const finalEmit = yields.find((y) => y.emit === 'result');
    expect(finalEmit).toBeDefined();
    expect(finalEmit.data.cancelled).toBe(true);
    expect(finalEmit.data.atStep).toBe('confirm-commit');

    // The select should have been offered with the 'minor' recommendation
    const bumpStep = yields.find((y: any) => y.ask === 'select' && y.id === 'bump-hello');
    expect(bumpStep).toBeDefined();
    expect(bumpStep.default).toBe('minor');
  });
});
