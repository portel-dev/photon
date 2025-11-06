/**
 * Marketplace Manager - Manage multiple MCP marketplaces
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';

export interface Marketplace {
  name: string;
  repo: string;
  url: string;
  enabled: boolean;
  lastUpdated?: string;
}

export interface MarketplaceConfig {
  marketplaces: Marketplace[];
}

const CONFIG_DIR = path.join(os.homedir(), '.photon');
const CONFIG_FILE = path.join(CONFIG_DIR, 'marketplaces.json');

const DEFAULT_MARKETPLACE: Marketplace = {
  name: 'photons',
  repo: 'portel-dev/photons',
  url: 'https://raw.githubusercontent.com/portel-dev/photons/main',
  enabled: true,
};

export class MarketplaceManager {
  private config: MarketplaceConfig = { marketplaces: [] };

  async initialize() {
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    if (existsSync(CONFIG_FILE)) {
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      this.config = JSON.parse(data);
    } else {
      // Initialize with default marketplace
      this.config = {
        marketplaces: [DEFAULT_MARKETPLACE],
      };
      await this.save();
    }
  }

  async save() {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /**
   * Get all marketplaces
   */
  getAll(): Marketplace[] {
    return this.config.marketplaces;
  }

  /**
   * Get enabled marketplaces
   */
  getEnabled(): Marketplace[] {
    return this.config.marketplaces.filter((m) => m.enabled);
  }

  /**
   * Get marketplace by name
   */
  get(name: string): Marketplace | undefined {
    return this.config.marketplaces.find((m) => m.name === name);
  }

  /**
   * Parse GitHub repo reference into marketplace info
   * Supports:
   * - username/repo
   * - https://github.com/username/repo
   * - https://github.com/username/repo.git
   */
  private parseGitHubRepo(input: string): { name: string; repo: string; url: string } | null {
    // Pattern 1: username/repo
    const shorthandMatch = input.match(/^([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+)$/);
    if (shorthandMatch) {
      const [, username, repo] = shorthandMatch;
      return {
        name: repo,
        repo: input,
        url: `https://raw.githubusercontent.com/${username}/${repo}/main`,
      };
    }

    // Pattern 2: https://github.com/username/repo or https://github.com/username/repo.git
    const urlMatch = input.match(/^https?:\/\/github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+?)(\.git)?$/);
    if (urlMatch) {
      const [, username, repo] = urlMatch;
      return {
        name: repo,
        repo: `${username}/${repo}`,
        url: `https://raw.githubusercontent.com/${username}/${repo}/main`,
      };
    }

    return null;
  }

  /**
   * Add a new marketplace from GitHub repo
   * Supports: username/repo or https://github.com/username/repo
   */
  async add(githubRepo: string): Promise<{ name: string; repo: string; url: string }> {
    const parsed = this.parseGitHubRepo(githubRepo);

    if (!parsed) {
      throw new Error(
        'Invalid format. Use: username/repo or https://github.com/username/repo'
      );
    }

    // Check if already exists
    if (this.get(parsed.name)) {
      throw new Error(`Marketplace '${parsed.name}' already exists`);
    }

    this.config.marketplaces.push({
      name: parsed.name,
      repo: parsed.repo,
      url: parsed.url,
      enabled: true,
      lastUpdated: new Date().toISOString(),
    });

    await this.save();
    return parsed;
  }

  /**
   * Remove a marketplace
   */
  async remove(name: string): Promise<boolean> {
    const index = this.config.marketplaces.findIndex((m) => m.name === name);

    if (index === -1) {
      return false;
    }

    // Prevent removing the default marketplace
    if (this.config.marketplaces[index].url === DEFAULT_MARKETPLACE.url) {
      throw new Error('Cannot remove the default photons marketplace');
    }

    this.config.marketplaces.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Enable/disable a marketplace
   */
  async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    const marketplace = this.get(name);

    if (!marketplace) {
      return false;
    }

    marketplace.enabled = enabled;
    await this.save();
    return true;
  }

  /**
   * Try to fetch MCP from all enabled marketplaces
   */
  async fetchMCP(mcpName: string): Promise<{ content: string; marketplace: Marketplace } | null> {
    const enabled = this.getEnabled();

    for (const marketplace of enabled) {
      try {
        const url = `${marketplace.url}/${mcpName}.photon.ts`;
        const response = await fetch(url);

        if (response.ok) {
          const content = await response.text();
          return { content, marketplace };
        }
      } catch {
        // Try next marketplace
      }
    }

    return null;
  }

  /**
   * Fetch version from all enabled marketplaces
   */
  async fetchVersion(mcpName: string): Promise<{ version: string; marketplace: Marketplace } | null> {
    const enabled = this.getEnabled();

    for (const marketplace of enabled) {
      try {
        const url = `${marketplace.url}/${mcpName}.photon.ts`;
        const response = await fetch(url);

        if (response.ok) {
          const content = await response.text();
          const versionMatch = content.match(/@version\s+(\d+\.\d+\.\d+)/);

          if (versionMatch) {
            return { version: versionMatch[1], marketplace };
          }
        }
      } catch {
        // Try next marketplace
      }
    }

    return null;
  }

  /**
   * Search for MCP in all marketplaces
   */
  async search(query: string): Promise<Map<string, Marketplace[]>> {
    const results = new Map<string, Marketplace[]>();
    const enabled = this.getEnabled();

    // For now, we just check if the MCP exists by name
    // In the future, marketplaces could provide a manifest/index file
    for (const marketplace of enabled) {
      try {
        const url = `${marketplace.url}/${query}.photon.ts`;
        const response = await fetch(url, { method: 'HEAD' });

        if (response.ok) {
          const existing = results.get(query) || [];
          existing.push(marketplace);
          results.set(query, existing);
        }
      } catch {
        // Skip this marketplace
      }
    }

    return results;
  }

  /**
   * List all available MCPs from a marketplace
   * Note: Requires marketplace to have a .photon/marketplace.json file
   */
  async listFromMarketplace(marketplaceName: string): Promise<string[]> {
    const marketplace = this.get(marketplaceName);

    if (!marketplace) {
      return [];
    }

    try {
      // Try to fetch marketplace.json if it exists
      const manifestUrl = `${marketplace.url}/.photon/marketplace.json`;
      const response = await fetch(manifestUrl);

      if (response.ok) {
        const data: any = await response.json();
        return data.mcps || [];
      }
    } catch {
      // No manifest file available
    }

    return [];
  }
}
