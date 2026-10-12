import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { readText, writeJSON } from './shared/io.js';
import { getErrorMessage } from './shared/error-handler.js';
import type { Logger } from './shared/logger.js';
import type { Marketplace } from './marketplace-manager.js';

export interface MarketplaceConfig {
  marketplaces: Marketplace[];
}

export interface MarketplaceConfigStore {
  initialize(): Promise<void>;
  load(defaults: Marketplace[]): Promise<MarketplaceConfig>;
  save(config: MarketplaceConfig): Promise<void>;
}

/** Filesystem adapter for marketplace configuration persistence. */
export class FileMarketplaceConfigStore implements MarketplaceConfigStore {
  constructor(
    private readonly configDir: string,
    private readonly configFile: string,
    private readonly logger: Logger
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
  }

  async load(defaults: Marketplace[]): Promise<MarketplaceConfig> {
    if (!existsSync(this.configFile)) return { marketplaces: defaults };
    try {
      return JSON.parse(await readText(this.configFile)) as MarketplaceConfig;
    } catch (error) {
      this.logger.warn(
        `Corrupted marketplaces.json, resetting to defaults: ${getErrorMessage(error)}`
      );
      const config = { marketplaces: defaults };
      await this.save(config);
      return config;
    }
  }

  async save(config: MarketplaceConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.configFile), { recursive: true });
    await writeJSON(this.configFile, config);
  }
}
