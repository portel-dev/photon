/**
 * Namespace Migration
 *
 * Migrates flat ~/.photon/*.photon.ts files into namespace subdirectories.
 * Also cleans up legacy ~/.photon/local/ artifacts from older auto-symlink logic.
 *
 * Files with @forkedFrom metadata → move to author namespace
 * Files without metadata → stay in root (local photons live at ~/.photon/ root)
 *
 * Runs once on first startup, writes .migrated sentinel to prevent re-runs.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { listPhotonSourceFiles } from '@portel/photon-core';
import { getDefaultContext } from './context.js';

const SENTINEL = '.migrated';
const LEGACY_LOCAL_DIR = 'local';

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
  await cleanupLegacyLocalNamespace(dir);
  const sentinelPath = path.join(dir, SENTINEL);

  // Already migrated?
  if (fs.existsSync(sentinelPath)) {
    return;
  }

  // Check if there are any flat photon files to migrate.
  // listPhotonSourceFiles returns bare filenames and tolerates a missing dir.
  const photonFileNames = listPhotonSourceFiles(dir, {
    extensions: ['.photon.ts', '.photon.js'],
  });

  if (photonFileNames.length === 0) {
    // No flat files to migrate — write sentinel (if the dir exists) and return.
    if (fs.existsSync(dir)) {
      await writeSentinel(sentinelPath);
    }
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

  for (const fileName of photonFileNames) {
    const filePath = path.join(dir, fileName);
    const photonName = fileName.replace(/\.photon\.(ts|js)$/, '');

    // Determine namespace — only marketplace/forked photons get namespaced.
    // Local (user-created) photons stay in root.
    let namespace: string | null = null;

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
    if (!namespace && metadata[fileName]) {
      const meta = metadata[fileName];
      if (meta.marketplaceRepo) {
        const parts = meta.marketplaceRepo.split('/');
        if (parts.length >= 2) {
          namespace = parts[0];
        }
      }
    }

    // No namespace = local photon — skip, stays in root
    if (!namespace) {
      continue;
    }

    // Move the file to its namespace directory
    const targetDir = path.join(dir, namespace);
    const targetPath = path.join(targetDir, fileName);

    try {
      fs.mkdirSync(targetDir, { recursive: true });

      // Move the source file. Preserve symlinks by re-creating them rather
      // than dereferencing into a plain file at the destination.
      let isSymlink = false;
      try {
        isSymlink = fs.lstatSync(filePath).isSymbolicLink();
      } catch {
        // Fallthrough to rename attempt.
      }
      if (isSymlink) {
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

      // Also migrate data/<photonName>/ convention (used by WhatsApp, etc.)
      // Moves contents into the new photon data dir (targetDir/photonName/)
      const legacyDataDir = path.join(dir, 'data', photonName);
      if (fs.existsSync(legacyDataDir) && fs.statSync(legacyDataDir).isDirectory()) {
        fs.mkdirSync(targetDataDir, { recursive: true });
        const dataEntries = fs.readdirSync(legacyDataDir);
        for (const dataEntry of dataEntries) {
          const src = path.join(legacyDataDir, dataEntry);
          const dest = path.join(targetDataDir, dataEntry);
          if (!fs.existsSync(dest)) {
            fs.renameSync(src, dest);
          }
        }
        // Remove empty legacy data dir
        try {
          fs.rmdirSync(legacyDataDir);
        } catch {
          // Not empty — some files may have been skipped
        }
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
      console.warn(`[photon] Migration failed for ${fileName}: ${(err as Error).message}`);
    }
  }

  // Write sentinel
  await writeSentinel(sentinelPath);

  if (migrated > 0) {
    console.error(`[photon] Migrated ${migrated} photon(s) to namespace directories`);
  }
}

async function cleanupLegacyLocalNamespace(baseDir: string): Promise<void> {
  const localDir = path.join(baseDir, LEGACY_LOCAL_DIR);
  let entries: fs.Dirent[];

  try {
    entries = await fsp.readdir(localDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);

    if (entry.isSymbolicLink()) {
      await fsp.rm(localPath, { recursive: true, force: true });
      continue;
    }

    if (entry.isDirectory()) {
      continue;
    }

    if (!entry.isFile() || !entry.name.match(/\.photon\.(ts|js)$/)) {
      continue;
    }

    const targetPath = path.join(baseDir, entry.name);
    if (!(await pathExists(targetPath))) {
      await fsp.rename(localPath, targetPath);

      const photonName = entry.name.replace(/\.photon\.(ts|js)$/, '');
      const localAssetDir = path.join(localDir, photonName);
      const targetAssetDir = path.join(baseDir, photonName);
      if (await pathExists(localAssetDir)) {
        await moveDirectoryIfPossible(localAssetDir, targetAssetDir);
      }
      continue;
    }

    if (await filesMatch(localPath, targetPath)) {
      await fsp.rm(localPath, { force: true });
    }
  }

  if (await isDirectoryEmpty(localDir)) {
    await fsp.rm(localDir, { recursive: true, force: true });
  }
}

async function moveDirectoryIfPossible(sourceDir: string, targetDir: string): Promise<void> {
  const sourceStat = await fsp.lstat(sourceDir).catch(() => null);
  if (!sourceStat) return;

  if (sourceStat.isSymbolicLink()) {
    await fsp.rm(sourceDir, { recursive: true, force: true });
    return;
  }

  if (!sourceStat.isDirectory()) {
    return;
  }

  if (await pathExists(targetDir)) {
    return;
  }

  await fsp.rename(sourceDir, targetDir);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fsp.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function filesMatch(a: string, b: string): Promise<boolean> {
  try {
    const [aContent, bContent] = await Promise.all([fsp.readFile(a), fsp.readFile(b)]);
    return aContent.equals(bContent);
  } catch {
    return false;
  }
}

async function isDirectoryEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await fsp.readdir(dir);
    return entries.length === 0;
  } catch {
    return false;
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
