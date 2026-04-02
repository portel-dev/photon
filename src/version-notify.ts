/**
 * Version Upgrade Notification
 *
 * Checks npm registry for newer versions and displays unobtrusive notice.
 * Cache-based: network call at most once per 24 hours, non-blocking.
 *
 * Usage:
 *   // At CLI startup (after command completes)
 *   showUpdateNotice();
 *
 *   // Trigger background refresh (fire-and-forget)
 *   refreshUpdateCache();
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getDataRoot } from '@portel/photon-core';
import { PHOTON_VERSION } from './version.js';
import { globalInstallCmd } from './shared-utils.js';

interface VersionCache {
  latest: string;
  checkedAt: string;
  changelog?: string[];
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

/**
 * Compare two semver strings. Returns:
 *  1 if a > b, -1 if a < b, 0 if equal
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
 * Fetch latest version from npm registry (synchronous, with timeout).
 * Returns null if unreachable.
 */
function fetchLatestVersion(): string | null {
  try {
    return execSync('npm view @portel/photon version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Refresh the version cache if stale.
 * Designed to be called on every startup — fast return if cache is fresh.
 */
export function refreshUpdateCache(): void {
  const cache = readCache();
  if (cache && !isStale(cache)) return;

  const latest = fetchLatestVersion();
  if (!latest) return; // Network unavailable — keep old cache

  writeCache({
    latest,
    checkedAt: new Date().toISOString(),
  });
}

/**
 * Show update notice to stderr if a newer version is available.
 * Call after command output is complete.
 *
 * Safe to call in any context — returns silently if:
 * - No cache exists
 * - Current version is up to date
 * - Running in MCP STDIO mode (would corrupt protocol)
 */
export function showUpdateNotice(): void {
  // Don't show in MCP STDIO mode
  if (process.env.PHOTON_TRANSPORT === 'stdio') return;

  const cache = readCache();
  if (!cache) return;

  if (compareSemver(cache.latest, PHOTON_VERSION) <= 0) return;

  const current = PHOTON_VERSION;
  const latest = cache.latest;
  const cmd = globalInstallCmd('@portel/photon');

  // Box drawing — clean, unobtrusive
  const msg = `  Update available: ${current} → ${latest}`;
  const install = `  Run: ${cmd}`;
  const width = Math.max(msg.length, install.length) + 2;
  const pad = (s: string) => s + ' '.repeat(width - s.length);

  console.error('');
  console.error(`╭${'─'.repeat(width)}╮`);
  console.error(`│${pad(msg)}│`);
  console.error(`│${pad(install)}│`);
  console.error(`╰${'─'.repeat(width)}╯`);
}
