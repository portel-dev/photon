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
import { globalInstallCmd } from './shared-utils.js';

interface VersionCache {
  latest: string;
  checkedAt: string;
  notifiedVersion?: string;
  changelog?: string[];
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CHANGELOG_URL = 'https://raw.githubusercontent.com/portel-dev/photon/main/CHANGELOG.md';

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

/**
 * Compare two semver strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Spawn a detached background process that fetches the latest version
 * and changelog, then writes the cache file. The parent process does
 * not wait for this — CLI exits immediately.
 */
export function refreshUpdateCache(): void {
  const cache = readCache();
  if (cache && !isStale(cache)) return;

  const cachePath = getCachePath();
  const script = `
    const https = require('https');
    const fs = require('fs');
    const { execSync } = require('child_process');

    let latest = null;
    try {
      latest = execSync('npm view @portel/photon version', {
        encoding: 'utf-8', timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    } catch { process.exit(0); }

    if (!latest) process.exit(0);

    // Fetch changelog
    const url = ${JSON.stringify(CHANGELOG_URL)};
    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { writeAndExit(latest, []); return; }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        const bullets = [];
        let inVersion = false;
        for (const line of body.split('\\n')) {
          if (line.startsWith('## ')) {
            if (inVersion) break;
            if (line.includes(latest)) inVersion = true;
            continue;
          }
          if (!inVersion) continue;
          if (line.startsWith('* ')) {
            let b = line.slice(2)
              .replace(/\\s*\\(\\[[a-f0-9]+\\]\\([^)]+\\)\\)\\s*$/, '')
              .replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, '$1')
              .trim();
            if (b) { bullets.push(b); if (bullets.length >= 5) break; }
          }
        }
        writeAndExit(latest, bullets);
      });
    }).on('error', () => writeAndExit(latest, []));

    function writeAndExit(ver, changelog) {
      const existing = (() => {
        try { return JSON.parse(fs.readFileSync(${JSON.stringify(cachePath)}, 'utf-8')); }
        catch { return {}; }
      })();
      const data = {
        latest: ver,
        checkedAt: new Date().toISOString(),
        changelog,
        notifiedVersion: existing.notifiedVersion || undefined,
      };
      try {
        fs.mkdirSync(require('path').dirname(${JSON.stringify(cachePath)}), { recursive: true });
        fs.writeFileSync(${JSON.stringify(cachePath)}, JSON.stringify(data, null, 2));
      } catch {}
      process.exit(0);
    }
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
  const cmd = globalInstallCmd('@portel/photon');

  const lines: string[] = [];
  lines.push(`  Update available: ${current} → ${latest}`);

  if (cache.changelog && cache.changelog.length > 0) {
    lines.push('');
    for (const bullet of cache.changelog.slice(0, 3)) {
      lines.push(`  · ${bullet}`);
    }
    if (cache.changelog.length > 3) {
      lines.push(`  · ... and ${cache.changelog.length - 3} more`);
    }
  }

  lines.push('');
  lines.push(`  Run: ${cmd}`);

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
