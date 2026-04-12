/**
 * Photon Publish - Publish your photons as a marketplace
 * @description System photon: init → sync → bump versions → commit → push → share
 * @internal
 *
 * Dog-foods the wizard/elicitation pattern. Each step yields either an `ask:*`
 * (elicits user input) or an `emit:*` (reports progress/result). Drivers — CLI,
 * Beam, MCP — handle yields in their own way; the photon stays surface-agnostic.
 *
 * Optional dependency on code-diagram: if installed, publish can use it for
 * richer diff/suggestion logic in a future version. v1 uses a regex-based
 * heuristic so the photon is useful on its own.
 *
 * @photon codeDiagram code-diagram?
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type BumpLevel = 'patch' | 'minor' | 'major';

type WizardStep =
  | {
      ask: 'text';
      id: string;
      message: string;
      label?: string;
      placeholder?: string;
      hint?: string;
      required?: boolean;
      default?: string;
    }
  | {
      ask: 'select';
      id: string;
      message: string;
      options: Array<{ value: string; label: string }>;
      default?: string;
    }
  | { ask: 'confirm'; id: string; message: string; default?: boolean }
  | { emit: 'status'; message: string; data?: unknown }
  | { emit: 'result'; data: unknown };

interface PhotonChange {
  file: string;
  name: string;
  status: 'new' | 'changed' | 'unchanged';
  currentVersion: string;
  suggestedBump: BumpLevel;
  suggestedVersion: string;
  chosenBump?: BumpLevel | 'skip';
  addedMethods: string[];
  removedMethods: string[];
}

export interface PublishParams {
  dir?: string;
  name?: string;
  owner?: string;
  description?: string;
  bump?: BumpLevel | 'auto';
  public?: boolean;
  dryRun?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure helpers (exported for tests)
// ═══════════════════════════════════════════════════════════════════════════

export function parseVersionTag(source: string): string {
  const m = source.match(/@version\s+(\S+)/);
  return m ? m[1] : '0.0.0';
}

export function bumpVersion(current: string, level: BumpLevel): string {
  const parts = current.split('.').map((n) => parseInt(n, 10));
  while (parts.length < 3) parts.push(0);
  const [maj, min, pat] = parts.map((n) => (isNaN(n) ? 0 : n));
  if (level === 'major') return `${maj + 1}.0.0`;
  if (level === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

export function writeVersionTag(source: string, nextVersion: string): string {
  if (/@version\s+\S+/.test(source)) {
    return source.replace(/@version\s+\S+/, `@version ${nextVersion}`);
  }
  if (/^\/\*\*/.test(source)) {
    return source.replace(/\*\//, ` * @version ${nextVersion}\n */`);
  }
  return `/** @version ${nextVersion} */\n${source}`;
}

export function extractMethodNames(source: string): Set<string> {
  const methods = new Set<string>();
  // Match method declarations: preceded by `{`, `;`, or whitespace; optional
  // modifiers; captured name; args list; then `{` (function body) — the
  // trailing `{` is what distinguishes declarations from call sites.
  const re =
    /(?<=[{\s;])(?:public\s+|protected\s+|private\s+|static\s+|async\s+)*\*?\s*(\w+)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{/g;
  const keywords = new Set([
    'constructor',
    'if',
    'for',
    'while',
    'switch',
    'return',
    'catch',
    'do',
    'else',
    'function',
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    if (keywords.has(name)) continue;
    if (name.startsWith('_')) continue;
    methods.add(name);
  }
  return methods;
}

export function suggestBumpFromDiff(
  beforeSource: string | null,
  afterSource: string
): { level: BumpLevel; added: string[]; removed: string[] } {
  if (beforeSource === null) {
    return { level: 'minor', added: [...extractMethodNames(afterSource)], removed: [] };
  }
  const before = extractMethodNames(beforeSource);
  const after = extractMethodNames(afterSource);
  const added = [...after].filter((m) => !before.has(m));
  const removed = [...before].filter((m) => !after.has(m));
  let level: BumpLevel = 'patch';
  if (removed.length > 0) level = 'major';
  else if (added.length > 0) level = 'minor';
  return { level, added, removed };
}

export function parseOwnerRepo(remote: string): string | null {
  const m = remote.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process helpers (inlined — photon cannot import runtime shared modules)
// ═══════════════════════════════════════════════════════════════════════════

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { cwd });
  return stdout.trim();
}

async function tryRun(cmd: string, args: string[], cwd: string): Promise<string | null> {
  try {
    return await run(cmd, args, cwd);
  } catch {
    return null;
  }
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync('which', [bin]);
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Change collection (exported for tests)
// ═══════════════════════════════════════════════════════════════════════════

export async function collectChanges(cwd: string): Promise<PhotonChange[]> {
  const all = (await fs.readdir(cwd)).filter((f) => f.endsWith('.photon.ts'));

  const changedFiles = new Set<string>();
  const untrackedSet = new Set<string>();

  const tracked = await tryRun('git', ['diff', '--name-only', 'HEAD', '--', '*.photon.ts'], cwd);
  if (tracked) {
    tracked
      .split('\n')
      .filter(Boolean)
      .forEach((f) => changedFiles.add(path.basename(f)));
  }
  const untracked = await tryRun(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', '*.photon.ts'],
    cwd
  );
  if (untracked) {
    untracked
      .split('\n')
      .filter(Boolean)
      .forEach((f) => {
        const b = path.basename(f);
        changedFiles.add(b);
        untrackedSet.add(b);
      });
  }

  const changes: PhotonChange[] = [];
  for (const file of all) {
    const afterSrc = await fs.readFile(path.join(cwd, file), 'utf-8');
    const currentVersion = parseVersionTag(afterSrc);
    const isNew = untrackedSet.has(file);
    const isChanged = changedFiles.has(file);

    if (!isNew && !isChanged) {
      changes.push({
        file,
        name: file.replace(/\.photon\.ts$/, ''),
        status: 'unchanged',
        currentVersion,
        suggestedBump: 'patch',
        suggestedVersion: currentVersion,
        addedMethods: [],
        removedMethods: [],
      });
      continue;
    }

    const beforeSrc = isNew ? null : await tryRun('git', ['show', `HEAD:${file}`], cwd);
    const { level, added, removed } = suggestBumpFromDiff(beforeSrc, afterSrc);

    changes.push({
      file,
      name: file.replace(/\.photon\.ts$/, ''),
      status: isNew ? 'new' : 'changed',
      currentVersion,
      suggestedBump: level,
      suggestedVersion: isNew
        ? currentVersion === '0.0.0'
          ? '0.1.0'
          : currentVersion
        : bumpVersion(currentVersion, level),
      addedMethods: added,
      removedMethods: removed,
    });
  }
  return changes;
}

// ═══════════════════════════════════════════════════════════════════════════
// The Publish photon
// ═══════════════════════════════════════════════════════════════════════════

export default class Publish {
  /**
   * Publish your photons as a marketplace — interactive wizard
   *
   * @wizard
   * @param dir Directory to publish (defaults to current working directory)
   * @param name Marketplace name (skips elicitation)
   * @param owner GitHub owner (skips elicitation)
   * @param description Marketplace description
   * @param bump Version bump: patch | minor | major | auto (skips per-photon elicitation)
   * @param public Create remote as public (default: private)
   * @param dryRun Show plan without touching anything
   */
  static async *wizard(params: PublishParams = {}): AsyncGenerator<WizardStep, void, any> {
    const cwd = path.resolve(params.dir || process.cwd());
    const dry = params.dryRun === true;

    yield { emit: 'status', message: `📦 Publishing from ${cwd}${dry ? ' (dry run)' : ''}` };

    // ── Phase 0: preflight ────────────────────────────────────────────────
    if (!existsSync(path.join(cwd, '.git'))) {
      const initAnswer = yield {
        ask: 'confirm',
        id: 'git-init',
        message: 'Not a git repo here. Initialize one?',
        default: true,
      };
      if (initAnswer !== true) {
        yield { emit: 'result', data: { cancelled: true, reason: 'no-git' } };
        return;
      }
      if (!dry) await run('git', ['init'], cwd);
      yield { emit: 'status', message: '✅ git initialized' };
    }

    const photonFiles = (await fs.readdir(cwd)).filter((f) => f.endsWith('.photon.ts'));
    if (photonFiles.length === 0) {
      yield {
        emit: 'result',
        data: {
          error: 'No .photon.ts files in this directory.',
          hint: 'Create one first: photon cli maker new <name>',
        },
      };
      return;
    }

    if (!(await commandExists('git'))) {
      yield { emit: 'result', data: { error: 'git not found. Install git first.' } };
      return;
    }
    const hasGh = await commandExists('gh');

    // ── Phase 1: marketplace init ─────────────────────────────────────────
    const marketplaceDir = path.join(cwd, '.marketplace');
    let marketplaceName = params.name;
    let owner = params.owner;
    const description = params.description;

    if (!existsSync(marketplaceDir)) {
      yield { emit: 'status', message: "No marketplace manifest — let's set one up." };

      if (!marketplaceName) {
        const nameVal = yield {
          ask: 'text',
          id: 'marketplace-name',
          message: 'Marketplace name',
          default: path.basename(cwd),
          placeholder: path.basename(cwd),
          required: true,
        };
        marketplaceName = (typeof nameVal === 'string' && nameVal.trim()) || path.basename(cwd);
      }

      if (!owner) {
        const detected =
          (await tryRun('gh', ['api', 'user', '-q', '.login'], cwd)) ||
          (await tryRun('git', ['config', 'user.name'], cwd)) ||
          '';
        const ownerVal = yield {
          ask: 'text',
          id: 'owner',
          message: 'GitHub owner',
          default: detected,
          placeholder: detected,
          required: true,
        };
        owner = (typeof ownerVal === 'string' && ownerVal.trim()) || detected;
      }

      if (!owner) {
        yield { emit: 'result', data: { error: 'Owner (GitHub username) is required.' } };
        return;
      }

      yield { emit: 'status', message: `Initializing marketplace: ${marketplaceName} (${owner})` };
      if (!dry) {
        await Publish.performMarketplaceInit(cwd, {
          name: marketplaceName,
          owner,
          description: description || '',
        });
      }
    }

    // ── Phase 2: scan & diff ──────────────────────────────────────────────
    yield { emit: 'status', message: 'Scanning photons for changes...' };
    const changes = await collectChanges(cwd);
    const publishable = changes.filter((c) => c.status !== 'unchanged');

    if (publishable.length === 0) {
      yield {
        emit: 'result',
        data: { published: 0, message: 'Nothing to publish — all photons unchanged.' },
      };
      return;
    }

    yield {
      emit: 'status',
      message: `Found ${publishable.length} photon(s) to publish`,
      data: {
        changes: publishable.map((c) => ({
          name: c.name,
          status: c.status,
          current: c.currentVersion,
          suggested: c.suggestedVersion,
          added: c.addedMethods,
          removed: c.removedMethods,
        })),
      },
    };

    const confirmPublish = yield {
      ask: 'confirm',
      id: 'confirm-publish',
      message: `Publish ${publishable.length} photon(s)?`,
      default: true,
    };
    if (confirmPublish !== true) {
      yield { emit: 'result', data: { cancelled: true, atStep: 'confirm-publish' } };
      return;
    }

    // ── Phase 2.5: version bump elicitation ───────────────────────────────
    for (const c of publishable) {
      let chosen: BumpLevel | 'skip' = c.suggestedBump;

      if (params.bump === 'auto') {
        chosen = c.suggestedBump;
      } else if (params.bump) {
        chosen = params.bump;
      } else {
        const reason = c.removedMethods.length
          ? `removed: ${c.removedMethods.join(', ')}`
          : c.addedMethods.length
            ? `new methods: ${c.addedMethods.join(', ')}`
            : 'internal changes only';

        const selection = yield {
          ask: 'select',
          id: `bump-${c.name}`,
          message: `${c.name} ${c.currentVersion} — ${reason}. Bump how?`,
          default: c.suggestedBump,
          options: [
            {
              value: c.suggestedBump,
              label: `${c.suggestedBump} → ${c.suggestedVersion} (recommended)`,
            },
            { value: 'patch', label: `patch → ${bumpVersion(c.currentVersion, 'patch')}` },
            { value: 'minor', label: `minor → ${bumpVersion(c.currentVersion, 'minor')}` },
            { value: 'major', label: `major → ${bumpVersion(c.currentVersion, 'major')}` },
            { value: 'skip', label: `skip (keep ${c.currentVersion})` },
          ],
        };
        chosen = (selection as BumpLevel | 'skip') || c.suggestedBump;
      }

      c.chosenBump = chosen;
      if (chosen !== 'skip' && c.status !== 'new') {
        c.suggestedVersion = bumpVersion(c.currentVersion, chosen);
      }

      if (chosen !== 'skip' && !dry) {
        const filePath = path.join(cwd, c.file);
        const src = await fs.readFile(filePath, 'utf-8');
        const next = writeVersionTag(src, c.suggestedVersion);
        if (next !== src) await fs.writeFile(filePath, next, 'utf-8');
        yield {
          emit: 'status',
          message: `✓ ${c.name}: ${c.currentVersion} → ${c.suggestedVersion}`,
        };
      } else if (chosen === 'skip') {
        yield { emit: 'status', message: `– ${c.name}: kept ${c.currentVersion}` };
      }
    }

    // ── Phase 3: commit & push ────────────────────────────────────────────
    if (!dry) {
      yield { emit: 'status', message: 'Syncing manifest...' };
      await Publish.performMarketplaceSync(cwd, { name: marketplaceName, owner, description });

      for (const f of photonFiles) await tryRun('git', ['add', '--', f], cwd);
      await tryRun('git', ['add', '--', '.marketplace'], cwd);
      await tryRun('git', ['add', '--', 'README.md'], cwd);
      await tryRun('git', ['add', '--', '.claude-plugin'], cwd);
      await tryRun('git', ['add', '--', '.githooks'], cwd);
      await tryRun('git', ['add', '--', '.gitignore'], cwd);
    }

    const staged = (await tryRun('git', ['diff', '--cached', '--name-only'], cwd)) || '';
    if (!staged.trim() && !dry) {
      yield { emit: 'result', data: { published: 0, message: 'Nothing staged after sync.' } };
      return;
    }

    const defaultMsg = `chore: publish ${publishable.length} photon${publishable.length === 1 ? '' : 's'}`;
    const msgVal = yield {
      ask: 'text',
      id: 'commit-message',
      message: 'Commit message',
      default: defaultMsg,
      placeholder: defaultMsg,
    };
    const commitMsg = (typeof msgVal === 'string' && msgVal.trim()) || defaultMsg;

    const confirmCommit = yield {
      ask: 'confirm',
      id: 'confirm-commit',
      message: `Commit as "${commitMsg}"?`,
      default: true,
    };
    if (confirmCommit !== true) {
      yield { emit: 'result', data: { cancelled: true, atStep: 'confirm-commit' } };
      return;
    }

    if (!dry) {
      await run('git', ['commit', '-m', commitMsg], cwd);
      yield { emit: 'status', message: '✅ Committed' };
    }

    // Remote handling
    const branch = (await tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)) || 'main';
    const hasOrigin = !!(await tryRun('git', ['remote', 'get-url', 'origin'], cwd));

    if (!hasOrigin) {
      const choice = yield {
        ask: 'select',
        id: 'remote-choice',
        message: 'No `origin` remote. What next?',
        default: 'gh',
        options: [
          { value: 'gh', label: 'Create GitHub repo via gh' },
          { value: 'manual', label: "I'll add the remote manually" },
          { value: 'cancel', label: 'Cancel' },
        ],
      };

      if (choice === 'cancel' || choice === 'manual') {
        yield {
          emit: 'result',
          data: {
            cancelled: choice === 'cancel',
            hint:
              choice === 'manual'
                ? `Add remote, then push:  git push -u origin ${branch}`
                : undefined,
          },
        };
        return;
      }

      if (!hasGh) {
        yield {
          emit: 'result',
          data: { error: 'gh not installed — install from https://cli.github.com/' },
        };
        return;
      }

      const suggested =
        owner && marketplaceName ? `${owner}/${marketplaceName}` : path.basename(cwd);
      const repoVal = yield {
        ask: 'text',
        id: 'repo-name',
        message: 'Repository (owner/name)',
        default: suggested,
        placeholder: suggested,
        required: true,
      };
      const repo = (typeof repoVal === 'string' && repoVal.trim()) || suggested;

      const makePublic =
        params.public === true ||
        (yield {
          ask: 'confirm',
          id: 'make-public',
          message: 'Make this repo public so others can install it?',
          default: false,
        }) === true;

      if (!dry) {
        const vis = makePublic ? '--public' : '--private';
        await run(
          'gh',
          ['repo', 'create', repo, vis, '--source=.', '--remote=origin', '--push'],
          cwd
        );
      }
      yield {
        emit: 'status',
        message: `✅ Created ${makePublic ? 'public' : 'private'} repo ${repo} and pushed`,
      };
    } else if (!dry) {
      try {
        await run('git', ['push', '-u', 'origin', branch], cwd);
        yield { emit: 'status', message: `✅ Pushed to origin/${branch}` };
      } catch (err: any) {
        yield {
          emit: 'result',
          data: {
            error: `Push failed: ${err?.message || String(err)}`,
            hint: 'Resolve (e.g. `git pull --rebase`), then re-run publish.',
          },
        };
        return;
      }
    }

    // ── Phase 4: share ────────────────────────────────────────────────────
    const originUrl = (await tryRun('git', ['remote', 'get-url', 'origin'], cwd)) || '';
    const ownerRepo = parseOwnerRepo(originUrl);

    yield {
      emit: 'result',
      data: {
        published: publishable.length,
        bumps: publishable.map((c) => ({
          name: c.name,
          from: c.currentVersion,
          to: c.chosenBump === 'skip' ? c.currentVersion : c.suggestedVersion,
          chosen: c.chosenBump,
        })),
        repoUrl: ownerRepo ? `https://github.com/${ownerRepo}` : null,
        installCommand: ownerRepo
          ? `photon marketplace add ${ownerRepo} && photon add <photon>`
          : null,
        next: [
          'Iterate and re-run `photon publish`',
          'Contribute to others: `photon contribute <name>`',
        ],
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Internals — inlined marketplace helpers (cannot import from src/cli/…)
  // ═════════════════════════════════════════════════════════════════════════

  private static async performMarketplaceInit(
    cwd: string,
    opts: { name: string; owner: string; description: string }
  ): Promise<void> {
    await fs.mkdir(path.join(cwd, '.marketplace'), { recursive: true });
    const manifestPath = path.join(cwd, '.marketplace', 'photons.json');
    const manifest = {
      name: opts.name,
      owner: opts.owner,
      description: opts.description,
      photons: [],
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    // Ensure .data/ gitignored
    const gitignorePath = path.join(cwd, '.gitignore');
    let existing = '';
    try {
      existing = await fs.readFile(gitignorePath, 'utf-8');
    } catch {
      /* none */
    }
    const patterns = ['.data/', 'node_modules/', '.DS_Store'];
    const lines = existing.split('\n').map((l) => l.trim());
    const missing = patterns.filter((p) => !lines.includes(p));
    if (missing.length > 0) {
      const append = (existing && !existing.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n';
      await fs.appendFile(gitignorePath, append);
    }
  }

  private static async performMarketplaceSync(
    cwd: string,
    opts: { name?: string; owner?: string; description?: string }
  ): Promise<void> {
    const manifestPath = path.join(cwd, '.marketplace', 'photons.json');
    let manifest: any = {
      name: opts.name || path.basename(cwd),
      owner: opts.owner || '',
      description: opts.description || '',
      photons: [],
    };
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    } catch {
      /* fresh */
    }

    const files = (await fs.readdir(cwd)).filter((f) => f.endsWith('.photon.ts'));
    manifest.photons = [];
    for (const f of files) {
      const src = await fs.readFile(path.join(cwd, f), 'utf-8');
      const version = parseVersionTag(src);
      const descMatch = src.match(/@description\s+(.+)/);
      manifest.photons.push({
        name: f.replace(/\.photon\.ts$/, ''),
        file: f,
        version,
        description: descMatch ? descMatch[1].trim() : '',
      });
    }

    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }
}
