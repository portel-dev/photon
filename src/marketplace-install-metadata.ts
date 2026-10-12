import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { readJSON, writeJSON } from './shared/io.js';
import type { Marketplace } from './marketplace-manager.js';
import type { PhotonMetadata, PhotonInstallMetadata } from './marketplace-manager.js';

export interface LocalMetadata {
  photons: Record<string, PhotonInstallMetadata>;
}

export interface MarketplaceInstallMetadataStore {
  read(): Promise<LocalMetadata>;
  write(metadata: LocalMetadata): Promise<void>;
  savePhoton(
    fileName: string,
    marketplace: Marketplace,
    metadata: PhotonMetadata,
    hash: string
  ): Promise<void>;
  getPhoton(fileName: string): Promise<PhotonInstallMetadata | null>;
}

export class FileMarketplaceInstallMetadataStore implements MarketplaceInstallMetadataStore {
  constructor(private readonly metadataFile: string) {}

  async read(): Promise<LocalMetadata> {
    try {
      if (existsSync(this.metadataFile)) return await readJSON(this.metadataFile);
    } catch {
      // Corrupt metadata starts a clean local record; source files remain intact.
    }
    return { photons: {} };
  }

  async write(metadata: LocalMetadata): Promise<void> {
    await fs.mkdir(path.dirname(this.metadataFile), { recursive: true });
    await writeJSON(this.metadataFile, metadata);
  }

  async savePhoton(
    fileName: string,
    marketplace: Marketplace,
    metadata: PhotonMetadata,
    hash: string
  ): Promise<void> {
    const local = await this.read();
    local.photons[fileName] = {
      marketplace: marketplace.name,
      marketplaceRepo: marketplace.repo,
      version: metadata.version,
      originalHash: hash,
      installedAt: new Date().toISOString(),
    };
    await this.write(local);
  }

  async getPhoton(fileName: string): Promise<PhotonInstallMetadata | null> {
    const local = await this.read();
    return local.photons[fileName] || null;
  }
}
