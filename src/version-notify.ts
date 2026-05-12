/**
 * Version Upgrade Notification
 *
 * Checks npm registry for newer versions and displays an unobtrusive notice
 * with changelog highlights. Non-blocking — spawns a detached child process
 * on cache miss so CLI startup is never delayed.
 *
 * Cache: .data/.version-check.json (24h TTL)
 * Notice: shown once per new version (tracks notifiedVersion)
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getDataRoot } from '@portel/photon-core';
import { PHOTON_VERSION } from './version.js';

interface VersionCache {
  latest: string;
  checkedAt: string;
  notifiedVersion?: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachePath(): string {
  return path.join(getDataRoot(), '.version-check.json');
}

function readCache(): VersionCache | null {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return null;
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(cache: VersionCache): void {
  try {
    const cachePath = getCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // Best effort
  }
}

function isStale(cache: VersionCache): boolean {
  const checkedAt = new Date(cache.checkedAt).getTime();
  return Date.now() - checkedAt > CACHE_TTL_MS;
}

interface ParsedSemver {
  core: [number, number, number];
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver {
  const withoutBuild = version.split('+')[0];
  const [corePart, prereleasePart] = withoutBuild.split('-', 2);
  const parts = corePart.split('.').map((part) => Number(part));
  return {
    core: [
      Number.isFinite(parts[0]) ? parts[0] : 0,
      Number.isFinite(parts[1]) ? parts[1] : 0,
      Number.isFinite(parts[2]) ? parts[2] : 0,
    ],
    prerelease: prereleasePart ? prereleasePart.split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;

    const an = Number(ai);
    const bn = Number(bi);
    const aNumeric = Number.isInteger(an) && String(an) === ai;
    const bNumeric = Number.isInteger(bn) && String(bn) === bi;

    if (aNumeric && bNumeric) {
      if (an > bn) return 1;
      if (an < bn) return -1;
      continue;
    }
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }

  return 0;
}

/**
 * Compare two semver strings, ignoring build metadata.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] > pb.core[i]) return 1;
    if (pa.core[i] < pb.core[i]) return -1;
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * Spawn a detached background process that fetches the latest version
 * and changelog, then writes the cache file. The parent process does
 * not wait for this — CLI exits immediately.
 *
 * The detached child does a direct HTTPS request to registry.npmjs.org
 * rather than shelling out to `npm view`. Under launchd / sandboxed PATH,
 * `npm` is frequently absent and the previous code silently exited
 * without ever updating the cache (Bug 3 in v1.27.0).
 */
export function refreshUpdateCache(): void {
  const cache = readCache();
  if (cache && !isStale(cache)) return;

  const cachePath = getCachePath();
  const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org').replace(
    /\/+$/,
    ''
  );
  const url = `${registry}/@portel/photon/latest`;
  const userAgent = `photon/${PHOTON_VERSION} (+https://github.com/portel-dev/photon)`;
  const script = `
    const fs = require('fs');
    const path = require('path');
    const https = require('https');

    const req = https.request(${JSON.stringify(url)}, {
      method: 'GET',
      headers: { 'User-Agent': ${JSON.stringify(userAgent)}, Accept: 'application/json' },
    }, (res) => {
      if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
        res.resume();
        process.exit(0);
      }
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let latest;
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed.version !== 'string' || !parsed.version.length) process.exit(0);
          latest = parsed.version;
        } catch { process.exit(0); }

        const existing = (() => {
          try { return JSON.parse(fs.readFileSync(${JSON.stringify(cachePath)}, 'utf-8')); }
          catch { return {}; }
        })();
        const data = {
          latest,
          checkedAt: new Date().toISOString(),
          notifiedVersion: existing.notifiedVersion || undefined,
        };
        try {
          fs.mkdirSync(path.dirname(${JSON.stringify(cachePath)}), { recursive: true });
          fs.writeFileSync(${JSON.stringify(cachePath)}, JSON.stringify(data, null, 2));
        } catch {}
      });
    });
    req.on('error', () => process.exit(0));
    req.setTimeout(10000, () => { req.destroy(); });
    req.end();
  `;

  // Spawn detached — parent doesn't wait
  const child = spawn(process.execPath, ['-e', script], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * Show update notice to stderr if a newer version is available.
 *
 * Returns silently if:
 * - No cache exists (background refresh hasn't completed yet)
 * - Current version is up to date
 * - Already notified for this version
 * - Running in MCP STDIO mode
 */
export function showUpdateNotice(): void {
  if (process.env.PHOTON_TRANSPORT === 'stdio') return;

  const cache = readCache();
  if (!cache) return;
  if (compareSemver(cache.latest, PHOTON_VERSION) <= 0) return;
  if (cache.notifiedVersion === cache.latest) return;

  const current = PHOTON_VERSION;
  const latest = cache.latest;

  const lines: string[] = [];
  lines.push(`  Update available: ${current} → ${latest}`);
  lines.push(`  Update:    photon update`);
  lines.push(`  What's new: photon changelog`);

  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const pad = (s: string) => s + ' '.repeat(Math.max(0, width - s.length));

  console.error('');
  console.error(`╭${'─'.repeat(width)}╮`);
  for (const line of lines) {
    console.error(`│${pad(line)}│`);
  }
  console.error(`╰${'─'.repeat(width)}╯`);

  // Mark as notified so we don't show again for this version
  cache.notifiedVersion = cache.latest;
  writeCache(cache);
}
