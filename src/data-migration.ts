/**
 * Data Migration — Consolidate scattered data dirs into .data/
 *
 * Runs once on first startup after upgrading to the .data/ layout.
 * Uses sentinel file (.data/.migrated) to skip on subsequent runs.
 *
 * Migration map:
 *   state/{photon}/{instance}.json   → .data/{ns}/{photon}/state/{instance}/state.json
 *   state/{photon}/{instance}.log    → .data/{ns}/{photon}/state/{instance}/state.log
 *   context/{photon}.json            → .data/{ns}/{photon}/context.json
 *   env/{photon}.json                → .data/{ns}/{photon}/env.json
 *   data/{photon}/*.json             → .data/{ns}/{photon}/memory/*.json
 *   data/_global/                    → .data/_global/
 *   sessions/                        → .data/_sessions/
 *   logs/{photon}/                   → .data/{ns}/{photon}/logs/
 *   .cache/ + cache/                 → .data/.cache/
 *   tasks/                           → .data/tasks/
 *   audit.jsonl                      → .data/audit.jsonl
 *   .metadata.json                   → .data/.metadata.json
 *   daemon.sock / .pid / .log        → .data/daemon.*
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { getDataRoot, detectNamespace, listFilesWithNamespace } from '@portel/photon-core';
import { getDefaultContext } from './context.js';

const SENTINEL = '.migrated';

/**
 * Run the .data/ migration if it hasn't been run yet.
 * Safe to call on every startup — returns immediately if already migrated.
 */
export async function runDataMigration(baseDir?: string): Promise<void> {
  const dir = baseDir || getDefaultContext().baseDir;
  const dataRoot = getDataRoot(dir);
  const sentinelPath = path.join(dataRoot, SENTINEL);

  // Already migrated?
  if (fs.existsSync(sentinelPath)) {
    return;
  }

  // Check if there are any legacy directories to migrate
  const legacyDirs = ['state', 'context', 'env', 'data', 'sessions', 'logs', 'tasks'];
  const hasLegacy = legacyDirs.some((d) => fs.existsSync(path.join(dir, d)));
  const hasLegacyFiles = ['audit.jsonl', 'daemon.sock', 'daemon.pid', 'daemon.log'].some((f) =>
    fs.existsSync(path.join(dir, f))
  );

  if (!hasLegacy && !hasLegacyFiles) {
    // Nothing to migrate — write sentinel and return
    await ensureAndWriteSentinel(dataRoot, sentinelPath);
    return;
  }

  // Build photon name → namespace mapping
  const nsMap = await buildNamespaceMap(dir);

  let migrated = 0;

  // ── Per-photon data ──────────────────────────────────────────────────────

  // state/{photon}/{instance}.json → .data/{ns}/{photon}/state/{instance}/state.json
  migrated += migrateStateDir(dir, dataRoot, nsMap);

  // context/{photon}.json → .data/{ns}/{photon}/context.json
  migrated += migrateContextDir(dir, dataRoot, nsMap);

  // env/{photon}.json → .data/{ns}/{photon}/env.json
  migrated += migrateEnvDir(dir, dataRoot, nsMap);

  // data/{photon}/*.json → .data/{ns}/{photon}/memory/*.json
  migrated += migrateMemoryDir(dir, dataRoot, nsMap);

  // logs/{photon}/ → .data/{ns}/{photon}/logs/
  migrated += migrateLogsDir(dir, dataRoot, nsMap);

  // ── Global data ──────────────────────────────────────────────────────────

  // data/_global/ → .data/_global/
  migrated += copyDir(path.join(dir, 'data', '_global'), path.join(dataRoot, '_global'));

  // sessions/ → .data/_sessions/
  migrated += copyDir(path.join(dir, 'sessions'), path.join(dataRoot, '_sessions'));

  // .cache/ → .data/.cache/
  migrated += copyDir(path.join(dir, '.cache'), path.join(dataRoot, '.cache'));

  // cache/ → .data/.cache/ (merge with above)
  migrated += copyDir(path.join(dir, 'cache'), path.join(dataRoot, '.cache'));

  // tasks/ → .data/tasks/
  migrated += copyDir(path.join(dir, 'tasks'), path.join(dataRoot, 'tasks'));

  // audit.jsonl → .data/audit.jsonl
  migrated += copyFile(path.join(dir, 'audit.jsonl'), path.join(dataRoot, 'audit.jsonl'));

  // .metadata.json → .data/.metadata.json
  migrated += copyFile(path.join(dir, '.metadata.json'), path.join(dataRoot, '.metadata.json'));

  // daemon files → .data/daemon.*
  for (const f of ['daemon.sock', 'daemon.pid', 'daemon.log']) {
    migrated += copyFile(path.join(dir, f), path.join(dataRoot, f));
  }

  // Write sentinel
  await ensureAndWriteSentinel(dataRoot, sentinelPath);

  if (migrated > 0) {
    console.error(`[photon] Migrated ${migrated} item(s) to .data/ layout`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a mapping from photon name → namespace.
 * Uses installed photon files and marketplace auto-detection.
 */
async function buildNamespaceMap(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // Detect namespace from git remote (for marketplace repos)
  const detectedNs = detectNamespace(dir);

  // Scan installed photons with their namespace
  try {
    const photons = await listFilesWithNamespace(dir);
    for (const p of photons) {
      map.set(p.name, p.namespace || detectedNs);
    }
  } catch {
    // No photon files — use detected namespace for everything
  }

  // Check install metadata for additional mappings
  try {
    const metaPath = path.join(dir, '.metadata.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta.photons && Array.isArray(meta.photons)) {
        for (const p of meta.photons) {
          if (p.name && p.source && !map.has(p.name)) {
            // Extract owner from source (e.g., "portel-dev/photons" → "portel-dev")
            const slashIdx = (p.source as string).indexOf('/');
            if (slashIdx !== -1) {
              map.set(p.name, (p.source as string).slice(0, slashIdx));
            }
          }
        }
      }
    }
  } catch {
    // No metadata
  }

  // Default namespace for unmapped photons
  map.set('__default', detectedNs);

  return map;
}

function resolveNs(nsMap: Map<string, string>, photonName: string): string {
  return nsMap.get(photonName) || nsMap.get('__default') || 'local';
}

function migrateStateDir(dir: string, dataRoot: string, nsMap: Map<string, string>): number {
  const stateDir = path.join(dir, 'state');
  if (!fs.existsSync(stateDir)) return 0;

  let count = 0;
  try {
    for (const photonDir of fs.readdirSync(stateDir, { withFileTypes: true })) {
      if (!photonDir.isDirectory()) continue;
      const photonName = photonDir.name;
      const ns = resolveNs(nsMap, photonName);
      const srcDir = path.join(stateDir, photonName);

      for (const file of fs.readdirSync(srcDir)) {
        if (file.endsWith('.json')) {
          const instance = file.replace('.json', '');
          const dst = path.join(dataRoot, ns, photonName, 'state', instance, 'state.json');
          count += copyFile(path.join(srcDir, file), dst);
        } else if (file.endsWith('.log')) {
          const instance = file.replace('.log', '');
          const dst = path.join(dataRoot, ns, photonName, 'state', instance, 'state.log');
          count += copyFile(path.join(srcDir, file), dst);
        }
      }
    }
  } catch (err) {
    console.warn(`[photon] Migration: state/ scan failed: ${(err as Error).message}`);
  }
  return count;
}

function migrateContextDir(dir: string, dataRoot: string, nsMap: Map<string, string>): number {
  const contextDir = path.join(dir, 'context');
  if (!fs.existsSync(contextDir)) return 0;

  let count = 0;
  try {
    for (const file of fs.readdirSync(contextDir)) {
      if (!file.endsWith('.json')) continue;
      const photonName = file.replace('.json', '');
      const ns = resolveNs(nsMap, photonName);
      const dst = path.join(dataRoot, ns, photonName, 'context.json');
      count += copyFile(path.join(contextDir, file), dst);
    }
  } catch (err) {
    console.warn(`[photon] Migration: context/ scan failed: ${(err as Error).message}`);
  }
  return count;
}

function migrateEnvDir(dir: string, dataRoot: string, nsMap: Map<string, string>): number {
  const envDir = path.join(dir, 'env');
  if (!fs.existsSync(envDir)) return 0;

  let count = 0;
  try {
    for (const file of fs.readdirSync(envDir)) {
      if (!file.endsWith('.json')) continue;
      const photonName = file.replace('.json', '');
      const ns = resolveNs(nsMap, photonName);
      const dst = path.join(dataRoot, ns, photonName, 'env.json');
      count += copyFile(path.join(envDir, file), dst);
    }
  } catch (err) {
    console.warn(`[photon] Migration: env/ scan failed: ${(err as Error).message}`);
  }
  return count;
}

function migrateMemoryDir(dir: string, dataRoot: string, nsMap: Map<string, string>): number {
  const memDir = path.join(dir, 'data');
  if (!fs.existsSync(memDir)) return 0;

  let count = 0;
  try {
    for (const entry of fs.readdirSync(memDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Skip _global — handled separately
      if (entry.name === '_global') continue;

      const photonName = entry.name;
      const ns = resolveNs(nsMap, photonName);
      const srcDir = path.join(memDir, photonName);
      const dstDir = path.join(dataRoot, ns, photonName, 'memory');
      count += copyDir(srcDir, dstDir);
    }
  } catch (err) {
    console.warn(`[photon] Migration: data/ scan failed: ${(err as Error).message}`);
  }
  return count;
}

function migrateLogsDir(dir: string, dataRoot: string, nsMap: Map<string, string>): number {
  const logsDir = path.join(dir, 'logs');
  if (!fs.existsSync(logsDir)) return 0;

  let count = 0;
  try {
    for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const photonName = entry.name;
      const ns = resolveNs(nsMap, photonName);
      const srcDir = path.join(logsDir, photonName);
      const dstDir = path.join(dataRoot, ns, photonName, 'logs');
      count += copyDir(srcDir, dstDir);
    }
  } catch (err) {
    console.warn(`[photon] Migration: logs/ scan failed: ${(err as Error).message}`);
  }
  return count;
}

/** Copy a single file. Returns 1 if copied, 0 if skipped. */
function copyFile(src: string, dst: string): number {
  try {
    if (!fs.existsSync(src)) return 0;
    if (fs.existsSync(dst)) return 0; // Don't overwrite existing new-layout data
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return 1;
  } catch (err) {
    console.warn(`[photon] Migration: copy failed ${src} → ${dst}: ${(err as Error).message}`);
    return 0;
  }
}

/** Recursively copy a directory. Returns count of files copied. */
function copyDir(src: string, dst: string): number {
  if (!fs.existsSync(src)) return 0;
  if (!fs.statSync(src).isDirectory()) return 0;

  let count = 0;
  try {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        count += copyDir(srcPath, dstPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (!fs.existsSync(dstPath)) {
          fs.copyFileSync(srcPath, dstPath);
          count++;
        }
      }
    }
  } catch (err) {
    console.warn(`[photon] Migration: copyDir failed ${src}: ${(err as Error).message}`);
  }
  return count;
}

async function ensureAndWriteSentinel(dataRoot: string, sentinelPath: string): Promise<void> {
  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    await fsp.writeFile(
      sentinelPath,
      JSON.stringify({
        migratedAt: new Date().toISOString(),
        version: 2, // v2 = .data/ consolidation
      }),
      'utf-8'
    );
  } catch {
    // Non-critical
  }
}
