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

/**
 * Photon metadata from marketplace.json
 */
export interface PhotonMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  tags?: string[];
  category?: string;
  source: string;
  tools?: string[];
}

/**
 * Marketplace manifest (.photon/marketplace.json)
 */
export interface MarketplaceManifest {
  name: string;
  version?: string;
  description?: string;
  owner?: {
    name: string;
    email?: string;
    url?: string;
  };
  photons: PhotonMetadata[];
}

const CONFIG_DIR = path.join(os.homedir(), '.photon');
const CONFIG_FILE = path.join(CONFIG_DIR, 'marketplaces.json');
const CACHE_DIR = path.join(CONFIG_DIR, '.cache', 'marketplaces');

// Cache is considered stale after 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
    await fs.mkdir(CACHE_DIR, { recursive: true });

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
   * Get cache file path for marketplace
   */
  private getCacheFile(marketplaceName: string): string {
    return path.join(CACHE_DIR, `${marketplaceName}.json`);
  }

  /**
   * Fetch marketplace.json from remote
   */
  async fetchManifest(marketplace: Marketplace): Promise<MarketplaceManifest | null> {
    try {
      const manifestUrl = `${marketplace.url}/.photon/marketplace.json`;
      const response = await fetch(manifestUrl);

      if (response.ok) {
        const data = await response.json() as MarketplaceManifest;
        return data;
      }
    } catch {
      // Marketplace doesn't have a manifest
    }

    return null;
  }

  /**
   * Update marketplace cache (fetch and save marketplace.json)
   */
  async updateMarketplaceCache(name: string): Promise<boolean> {
    const marketplace = this.get(name);

    if (!marketplace) {
      return false;
    }

    const manifest = await this.fetchManifest(marketplace);

    if (manifest) {
      // Save to cache
      const cacheFile = this.getCacheFile(name);
      await fs.writeFile(cacheFile, JSON.stringify(manifest, null, 2), 'utf-8');

      // Update lastUpdated timestamp
      marketplace.lastUpdated = new Date().toISOString();
      await this.save();

      return true;
    }

    return false;
  }

  /**
   * Update all enabled marketplace caches
   */
  async updateAllCaches(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const enabled = this.getEnabled();

    for (const marketplace of enabled) {
      const success = await this.updateMarketplaceCache(marketplace.name);
      results.set(marketplace.name, success);
    }

    return results;
  }

  /**
   * Get cached marketplace manifest
   */
  async getCachedManifest(marketplaceName: string): Promise<MarketplaceManifest | null> {
    try {
      const cacheFile = this.getCacheFile(marketplaceName);

      if (existsSync(cacheFile)) {
        const data = await fs.readFile(cacheFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // Cache doesn't exist or is invalid
    }

    return null;
  }

  /**
   * Get Photon metadata from cached manifest
   */
  async getPhotonMetadata(photonName: string): Promise<{ metadata: PhotonMetadata; marketplace: Marketplace } | null> {
    const enabled = this.getEnabled();

    for (const marketplace of enabled) {
      const manifest = await this.getCachedManifest(marketplace.name);

      if (manifest) {
        const photon = manifest.photons.find((p) => p.name === photonName);
        if (photon) {
          return { metadata: photon, marketplace };
        }
      }
    }

    return null;
  }

  /**
   * Get all Photons with metadata from all enabled marketplaces
   */
  async getAllPhotons(): Promise<Map<string, { metadata: PhotonMetadata; marketplace: Marketplace }>> {
    const photons = new Map<string, { metadata: PhotonMetadata; marketplace: Marketplace }>();
    const enabled = this.getEnabled();

    for (const marketplace of enabled) {
      const manifest = await this.getCachedManifest(marketplace.name);

      if (manifest) {
        for (const photon of manifest.photons) {
          // First marketplace wins if Photon exists in multiple
          if (!photons.has(photon.name)) {
            photons.set(photon.name, { metadata: photon, marketplace });
          }
        }
      }
    }

    return photons;
  }

  /**
   * Get count of available Photons per marketplace
   */
  async getMarketplaceCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const all = this.getAll();

    for (const marketplace of all) {
      const manifest = await this.getCachedManifest(marketplace.name);
      counts.set(marketplace.name, manifest?.photons.length || 0);
    }

    return counts;
  }

  /**
   * Check if marketplace cache is stale
   */
  private isCacheStale(marketplace: Marketplace): boolean {
    if (!marketplace.lastUpdated) {
      return true;
    }

    const lastUpdate = new Date(marketplace.lastUpdated).getTime();
    const now = Date.now();
    return (now - lastUpdate) > CACHE_TTL_MS;
  }

  /**
   * Auto-update stale caches
   * Returns true if any updates were performed
   */
  async autoUpdateStaleCaches(): Promise<boolean> {
    const enabled = this.getEnabled();
    let updated = false;

    for (const marketplace of enabled) {
      if (this.isCacheStale(marketplace)) {
        const success = await this.updateMarketplaceCache(marketplace.name);
        if (success) {
          updated = true;
        }
      }
    }

    return updated;
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
   * Search for Photon in all marketplaces
   * Searches in name, description, tags, and author fields
   */
  async search(query: string): Promise<Map<string, { metadata?: PhotonMetadata; marketplace: Marketplace }[]>> {
    const results = new Map<string, { metadata?: PhotonMetadata; marketplace: Marketplace }[]>();
    const enabled = this.getEnabled();
    const lowerQuery = query.toLowerCase();

    for (const marketplace of enabled) {
      // First, try to search in cached manifest
      const manifest = await this.getCachedManifest(marketplace.name);

      if (manifest) {
        // Search in manifest metadata
        for (const photon of manifest.photons) {
          const nameMatch = photon.name.toLowerCase().includes(lowerQuery);
          const descMatch = photon.description?.toLowerCase().includes(lowerQuery);
          const tagMatch = photon.tags?.some(tag => tag.toLowerCase().includes(lowerQuery));
          const authorMatch = photon.author?.toLowerCase().includes(lowerQuery);

          if (nameMatch || descMatch || tagMatch || authorMatch) {
            const existing = results.get(photon.name) || [];
            existing.push({ metadata: photon, marketplace });
            results.set(photon.name, existing);
          }
        }
      } else {
        // Fallback: check if exact filename exists (for marketplaces without manifest)
        try {
          const url = `${marketplace.url}/${query}.photon.ts`;
          const response = await fetch(url, { method: 'HEAD' });

          if (response.ok) {
            const existing = results.get(query) || [];
            existing.push({ marketplace });
            results.set(query, existing);
          }
        } catch {
          // Skip this marketplace
        }
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
