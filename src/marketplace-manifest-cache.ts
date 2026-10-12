import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { readJSON, writeJSON } from './shared/io.js';
import type { Logger } from './shared/logger.js';
import { getErrorMessage } from './shared/error-handler.js';
import type { PhotonMetadata } from './marketplace-manager.js';

export interface MarketplaceManifest {
  name: string;
  version?: string;
  description?: string;
  owner?: { name: string; email?: string; url?: string };
  photons: PhotonMetadata[];
}

export interface MarketplaceManifestCache {
  initialize(): Promise<void>;
  get(marketplaceName: string): Promise<MarketplaceManifest | null>;
  put(marketplaceName: string, manifest: MarketplaceManifest): Promise<void>;
}

export class FileMarketplaceManifestCache implements MarketplaceManifestCache {
  constructor(
    private readonly cacheDir: string,
    private readonly logger: Logger
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  async get(marketplaceName: string): Promise<MarketplaceManifest | null> {
    const cacheFile = this.cachePath(marketplaceName);
    if (!existsSync(cacheFile)) return null;
    try {
      return await readJSON<MarketplaceManifest>(cacheFile);
    } catch (error) {
      this.logger.warn(
        `Corrupted marketplace cache for ${marketplaceName}, removing: ${getErrorMessage(error)}`
      );
      await fs.unlink(cacheFile).catch(() => undefined);
      return null;
    }
  }

  async put(marketplaceName: string, manifest: MarketplaceManifest): Promise<void> {
    await writeJSON(this.cachePath(marketplaceName), manifest);
  }

  private cachePath(marketplaceName: string): string {
    return path.join(this.cacheDir, `${marketplaceName}.json`);
  }
}
