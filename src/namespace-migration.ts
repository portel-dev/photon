/**
 * Namespace Migration
 *
 * Migrates flat ~/.photon/*.photon.ts files into namespace subdirectories.
 *
 * Files with @forkedFrom metadata → move to author namespace
 * Files without metadata → move to local/
 *
 * Runs once on first startup, writes .migrated sentinel to prevent re-runs.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { getDefaultContext } from './context.js';

const SENTINEL = '.migrated';

/** Directories that are NOT namespace directories */
const SKIP_DIRS = new Set([
  'state',
  'context',
  'env',
  '.cache',
  '.config',
  'node_modules',
  'marketplace',
  'photons',
  'templates',
]);

/**
 * Run the namespace migration if it hasn't been run yet.
 * Safe to call on every startup — returns immediately if already migrated.
 *
 * Only runs on the real ~/.photon directory (not custom PHOTON_DIR overrides
 * which may be test fixture directories).
 */
export async function runNamespaceMigration(baseDir?: string): Promise<void> {
  // Skip migration when PHOTON_DIR is set (test environments, custom dirs)
  // unless explicitly passing a baseDir (programmatic call from tests)
  if (!baseDir && process.env.PHOTON_DIR) {
    return;
  }

  const dir = baseDir || getDefaultContext().baseDir;
  const sentinelPath = path.join(dir, SENTINEL);

  // Already migrated?
  if (fs.existsSync(sentinelPath)) {
    return;
  }

  // Check if there are any flat photon files to migrate
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // baseDir doesn't exist yet
  }

  const photonFiles = entries.filter(
    (e) =>
      (e.isFile() || e.isSymbolicLink()) &&
      (e.name.endsWith('.photon.ts') || e.name.endsWith('.photon.js'))
  );

  if (photonFiles.length === 0) {
    // No flat files to migrate — write sentinel and return
    await writeSentinel(sentinelPath);
    return;
  }

  // Read install metadata for @forkedFrom resolution
  const metadataPath = path.join(dir, '.config', 'photon-metadata.json');
  let metadata: Record<string, any> = {};
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  } catch {
    // No metadata file
  }

  let migrated = 0;

  for (const entry of photonFiles) {
    const filePath = path.join(dir, entry.name);
    const photonName = entry.name.replace(/\.photon\.(ts|js)$/, '');

    // Determine namespace
    let namespace = 'local';

    // Check @forkedFrom in source
    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const forkedMatch = source.match(/@forkedFrom\s+([^\s*]+)/);
      if (forkedMatch) {
        // Format: owner/repo#photonName → namespace = owner
        const origin = forkedMatch[1];
        const slashIndex = origin.indexOf('/');
        if (slashIndex !== -1) {
          namespace = origin.slice(0, slashIndex);
        }
      }
    } catch {
      // Can't read source — use metadata fallback
    }

    // Fallback: check install metadata
    if (namespace === 'local' && metadata[entry.name]) {
      const meta = metadata[entry.name];
      if (meta.marketplaceRepo) {
        const parts = meta.marketplaceRepo.split('/');
        if (parts.length >= 2) {
          namespace = parts[0];
        }
      }
    }

    // Move the file
    const targetDir = path.join(dir, namespace);
    const targetPath = path.join(targetDir, entry.name);

    try {
      fs.mkdirSync(targetDir, { recursive: true });

      // Move the source file
      if (entry.isSymbolicLink()) {
        // Preserve symlinks — read target, create new symlink
        const linkTarget = fs.readlinkSync(filePath);
        fs.symlinkSync(linkTarget, targetPath);
        fs.unlinkSync(filePath);
      } else {
        fs.renameSync(filePath, targetPath);
      }

      // Move associated data directory if it exists (e.g., photonName/ folder)
      const dataDir = path.join(dir, photonName);
      const targetDataDir = path.join(targetDir, photonName);
      if (fs.existsSync(dataDir) && fs.statSync(dataDir).isDirectory()) {
        fs.renameSync(dataDir, targetDataDir);
      }

      // Migrate state files into the new .state/ structure
      const legacyStateDir = path.join(dir, 'state', photonName);
      if (fs.existsSync(legacyStateDir)) {
        const stateEntries = fs.readdirSync(legacyStateDir);
        for (const stateEntry of stateEntries) {
          if (stateEntry.endsWith('.json')) {
            const instanceName = stateEntry.replace('.json', '');
            const newStateDir = path.join(targetDir, photonName, '.state', instanceName);
            fs.mkdirSync(newStateDir, { recursive: true });
            fs.copyFileSync(
              path.join(legacyStateDir, stateEntry),
              path.join(newStateDir, 'state.json')
            );
          } else if (stateEntry.endsWith('.log')) {
            const instanceName = stateEntry.replace('.log', '');
            const newStateDir = path.join(targetDir, photonName, '.state', instanceName);
            fs.mkdirSync(newStateDir, { recursive: true });
            fs.copyFileSync(
              path.join(legacyStateDir, stateEntry),
              path.join(newStateDir, 'state.log')
            );
          }
        }
        // Keep legacy state dir for now (don't delete — safety)
      }

      migrated++;
    } catch (err) {
      // Don't fail the whole migration for one file
      console.warn(`[photon] Migration failed for ${entry.name}: ${(err as Error).message}`);
    }
  }

  // Write sentinel
  await writeSentinel(sentinelPath);

  if (migrated > 0) {
    console.error(`[photon] Migrated ${migrated} photon(s) to namespace directories`);
  }
}

async function writeSentinel(sentinelPath: string): Promise<void> {
  try {
    await fsp.writeFile(
      sentinelPath,
      JSON.stringify({
        migratedAt: new Date().toISOString(),
        version: 1,
      }),
      'utf-8'
    );
  } catch {
    // Non-critical
  }
}
