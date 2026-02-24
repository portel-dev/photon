/**
 * Beam Config — Load, save, and migrate config.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { PhotonConfig } from './types.js';

/** Get config file path based on working directory */
export function getConfigFilePath(workingDir: string): string {
  return process.env.PHOTON_CONFIG_FILE || path.join(workingDir, 'config.json');
}

/** Migrate old flat config to new nested structure */
export function migrateConfig(config: any): PhotonConfig {
  if (config.photons !== undefined || config.mcpServers !== undefined) {
    return {
      photons: config.photons || {},
      mcpServers: config.mcpServers || {},
    };
  }

  console.error('📦 Migrating config.json to new nested format...');
  return {
    photons: { ...config },
    mcpServers: {},
  };
}

/** Load config.json from the working directory */
export async function loadConfig(workingDir: string): Promise<PhotonConfig> {
  const configFile = getConfigFilePath(workingDir);
  try {
    const data = await fs.readFile(configFile, 'utf-8');
    const raw = JSON.parse(data);
    const migrated = migrateConfig(raw);

    if (!raw.photons && Object.keys(raw).length > 0) {
      await saveConfig(migrated, workingDir);
      console.error('✅ Config migrated successfully');
    }

    return migrated;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return { photons: {}, mcpServers: {} };
    }
    console.error(`⚠️ Failed to load config.json: ${error?.message || error}`);
    return { photons: {}, mcpServers: {} };
  }
}

/** Save config.json to the working directory */
export async function saveConfig(config: PhotonConfig, workingDir: string): Promise<void> {
  const configFile = getConfigFilePath(workingDir);
  const dir = path.dirname(configFile);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
}
