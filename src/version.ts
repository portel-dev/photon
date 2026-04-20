import { createRequire } from 'module';
import { existsSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

let pkg: { version: string; dependencies?: Record<string, string> };
try {
  const require = createRequire(import.meta.url);
  pkg = require('../package.json');
} catch {
  // Compiled binary — package.json not on disk; use build-time constant
  pkg = { version: '0.0.0-compiled' };
}

/**
 * Compute a semver build-metadata suffix when this process is running
 * from a git checkout (the dev tree, not a published tarball). Returns
 * a string like `+sha.58dc00d` or `+sha.58dc00d.dirty`. Returns empty
 * when the binary was installed from npm (no .git reachable from the
 * module path).
 *
 * Semver 2.0 allows build metadata after `+`. It does NOT affect version
 * precedence — package managers and release tooling treat
 * `1.22.1+sha.X` as equivalent to `1.22.1` for comparison. The only
 * purpose is to make `photon --version` output distinguishable between
 * "what's on npm" vs "what's on my laptop right now." Agents that see
 * a plain semver know they're running the published tarball and recent
 * source edits won't be visible.
 */
function computeDevBuildMarker(): string {
  try {
    // Walk up from this module's location looking for a .git directory.
    // When installed via npm, there won't be one up-tree — we'll bail
    // quickly and return empty.
    const thisFile = fileURLToPath(import.meta.url);
    let dir = path.dirname(thisFile);
    let gitDir: string | null = null;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, '.git');
      if (existsSync(candidate)) {
        gitDir = candidate;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!gitDir) return '';

    // .git may be a file (worktree) pointing elsewhere, or a directory.
    let realGitDir = gitDir;
    if (!statSync(gitDir).isDirectory()) {
      const content = readFileSync(gitDir, 'utf-8').trim();
      const m = content.match(/^gitdir:\s*(.+)$/);
      if (m) {
        realGitDir = path.resolve(path.dirname(gitDir), m[1]);
      } else {
        return '';
      }
    }

    const headPath = path.join(realGitDir, 'HEAD');
    if (!existsSync(headPath)) return '';
    const head = readFileSync(headPath, 'utf-8').trim();
    let sha: string;
    const refMatch = head.match(/^ref:\s*(.+)$/);
    if (refMatch) {
      const refPath = path.join(realGitDir, refMatch[1].trim());
      if (existsSync(refPath)) {
        sha = readFileSync(refPath, 'utf-8').trim();
      } else {
        // Packed refs — fall back to parsing packed-refs
        const packed = path.join(realGitDir, 'packed-refs');
        if (!existsSync(packed)) return '';
        const lines = readFileSync(packed, 'utf-8').split('\n');
        const refName = refMatch[1].trim();
        const found = lines.find((l) => l.endsWith(' ' + refName));
        if (!found) return '';
        sha = found.split(' ')[0];
      }
    } else {
      // Detached HEAD stores the SHA directly.
      sha = head;
    }
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return '';
    const short = sha.slice(0, 7);
    return `+sha.${short}`;
  } catch {
    // Any I/O glitch — fall back to no marker rather than crash the CLI.
    return '';
  }
}

const devMarker = computeDevBuildMarker();

/**
 * Photon runtime version. When running from a git checkout, includes a
 * `+sha.<short>` build-metadata suffix (semver 2.0 legal) so `photon
 * --version` distinguishes the dev tree from a published tarball.
 */
export const PHOTON_VERSION: string = pkg.version + devMarker;

/**
 * True when this process is running from a git checkout rather than an
 * installed npm tarball. Useful for guidance: agents can warn users when
 * a dev binary's fixes won't be visible to a photon running against the
 * published release.
 */
export const IS_DEV_BUILD: boolean = devMarker.length > 0;

export const PHOTON_CORE_VERSION: string =
  pkg.dependencies?.['@portel/photon-core'] || `^${pkg.version}`;

/**
 * Get the actual installed version of @portel/photon-core
 * Unlike PHOTON_CORE_VERSION which is a semver range (e.g., "^2.5.0"),
 * this returns the resolved version (e.g., "2.5.4").
 * Used for cache invalidation — detects npm link changes that don't alter the range.
 */
export function getResolvedPhotonCoreVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const corePkg = require('@portel/photon-core/package.json');
    return corePkg.version;
  } catch {
    return PHOTON_CORE_VERSION; // Fallback to range
  }
}
