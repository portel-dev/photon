/**
 * Marketplace Manager - Manage multiple MCP marketplaces
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import * as crypto from 'crypto';
import { createLogger, Logger } from './shared/logger.js';

export type MarketplaceSourceType = 'github' | 'git-ssh' | 'url' | 'local';

export interface Marketplace {
  name: string;
  repo: string; // For GitHub sources
  url: string; // Base URL for fetching
  sourceType: MarketplaceSourceType;
  source: string; // Original input (for display)
  enabled: boolean;
  lastUpdated?: string;
}

export interface MarketplaceConfig {
  marketplaces: Marketplace[];
}

/**
 * Photon metadata from photons.json manifest
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
  hash?: string; // SHA-256 hash of the file content
  tools?: string[];
}

/**
 * Local installation metadata for tracking Photon origins
 */
export interface PhotonInstallMetadata {
  marketplace: string;
  marketplaceRepo: string;
  version: string;
  originalHash: string;
  installedAt: string;
  lastChecked?: string;
}

/**
 * Local metadata file structure
 */
export interface LocalMetadata {
  photons: Record<string, PhotonInstallMetadata>;
}

/**
 * Marketplace manifest (.marketplace/photons.json)
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
const METADATA_FILE = path.join(CONFIG_DIR, '.metadata.json');

// Cache is considered stale after 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MARKETPLACE: Marketplace = {
  name: 'photons',
  repo: 'portel-dev/photons',
  url: 'https://raw.githubusercontent.com/portel-dev/photons/main',
  sourceType: 'github',
  source: 'portel-dev/photons',
  enabled: true,
};

/**
 * Calculate SHA-256 hash of file content
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Calculate SHA-256 hash of string content
 */
export function calculateHash(content: string): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Read local installation metadata
 */
export async function readLocalMetadata(): Promise<LocalMetadata> {
  try {
    if (existsSync(METADATA_FILE)) {
      const data = await fs.readFile(METADATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return { photons: {} };
}

/**
 * Write local installation metadata
 */
export async function writeLocalMetadata(metadata: LocalMetadata): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
}

export class MarketplaceManager {
  private config: MarketplaceConfig = { marketplaces: [] };
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createLogger({ component: 'marketplace-manager', minimal: true });
  }

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
   * Parse marketplace source into structured info
   * Supports:
   * 1. GitHub shorthand: username/repo
   * 2. GitHub HTTPS: https://github.com/username/repo[.git]
   * 3. GitHub SSH: git@github.com:username/repo.git
   * 4. Direct URL: https://example.com/photons.json
   * 5. Local path: ./path/to/marketplace or /absolute/path
   */
  private parseMarketplaceSource(input: string): Omit<Marketplace, 'enabled' | 'lastUpdated'> | null {
    // Pattern 1: username/repo (GitHub shorthand)
    const shorthandMatch = input.match(/^([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+)$/);
    if (shorthandMatch) {
      const [, username, repo] = shorthandMatch;
      return {
        name: repo,
        repo: input,
        url: `https://raw.githubusercontent.com/${username}/${repo}/main`,
        sourceType: 'github',
        source: input,
      };
    }

    // Pattern 2: https://github.com/username/repo[.git] (GitHub HTTPS)
    const httpsMatch = input.match(/^https?:\/\/github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+?)(\.git)?$/);
    if (httpsMatch) {
      const [, username, repo] = httpsMatch;
      return {
        name: repo,
        repo: `${username}/${repo}`,
        url: `https://raw.githubusercontent.com/${username}/${repo}/main`,
        sourceType: 'github',
        source: input,
      };
    }

    // Pattern 3: git@github.com:username/repo.git (GitHub SSH)
    const sshMatch = input.match(/^git@github\.com:([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+?)(\.git)?$/);
    if (sshMatch) {
      const [, username, repo] = sshMatch;
      const repoName = repo.replace(/\.git$/, '');
      return {
        name: repoName,
        repo: `${username}/${repoName}`,
        url: `https://raw.githubusercontent.com/${username}/${repoName}/main`,
        sourceType: 'git-ssh',
        source: input,
      };
    }

    // Pattern 4: https://example.com/photons.json (Direct URL)
    if (input.startsWith('http://') || input.startsWith('https://')) {
      // Extract name from URL
      const urlObj = new URL(input);
      const pathParts = urlObj.pathname.split('/');
      const fileName = pathParts[pathParts.length - 1];
      const name = fileName.replace(/\.(json|ts)$/, '') || urlObj.hostname;

      // Base URL is the directory containing the photons.json
      const baseUrl = input.replace(/\/[^/]*$/, '');

      return {
        name,
        repo: '', // Not a repo
        url: baseUrl,
        sourceType: 'url',
        source: input,
      };
    }

    // Pattern 5: Local filesystem (Unix and Windows paths)
    // Unix: ./path, ../path, /absolute, ~/path
    // Windows: C:\path, D:\Users\..., etc.
    const isLocalPath =
      input.startsWith('./') ||
      input.startsWith('../') ||
      input.startsWith('/') ||
      input.startsWith('~') ||
      /^[A-Za-z]:[\\/]/.test(input); // Windows drive letter (C:\, D:\, etc.)

    if (isLocalPath) {
      // Resolve to absolute path (handles ~ expansion)
      const absolutePath = path.resolve(input.replace(/^~/, os.homedir()));
      const name = path.basename(absolutePath);

      // Normalize path separators for file:// URL
      // On Windows, path.resolve returns backslashes, but file:// needs forward slashes
      const normalizedPath = absolutePath.replace(/\\/g, '/');

      return {
        name,
        repo: '', // Not a repo
        url: `file://${normalizedPath}`,
        sourceType: 'local',
        source: input,
      };
    }

    return null;
  }

  /**
   * Get next available name with numeric suffix if name already exists
   * e.g., if 'photon-mcps' exists, returns 'photon-mcps-2'
   * if 'photon-mcps' and 'photon-mcps-2' exist, returns 'photon-mcps-3'
   */
  private getUniqueName(baseName: string): string {
    // If base name doesn't exist, use it as-is
    if (!this.get(baseName)) {
      return baseName;
    }

    // Find next available number
    let suffix = 2;
    while (this.get(`${baseName}-${suffix}`)) {
      suffix++;
    }

    return `${baseName}-${suffix}`;
  }

  /**
   * Check if a marketplace with the same source already exists
   */
  private findBySource(source: string): Marketplace | undefined {
    return this.config.marketplaces.find((m) => m.source === source);
  }

  /**
   * Add a new marketplace
   * Supports:
   * - GitHub: username/repo, https://github.com/username/repo, git@github.com:username/repo.git
   * - Direct URL: https://example.com/photons.json
   * - Local path: ./path/to/marketplace, /absolute/path
   *
   * If a marketplace with the same name already exists, automatically appends a numeric suffix (-2, -3, etc.)
   * If the exact same source already exists, returns the existing marketplace without creating a duplicate.
   *
   * @returns Object with marketplace info and 'added' flag (false if already existed)
   */
  async add(source: string): Promise<{ marketplace: Omit<Marketplace, 'enabled' | 'lastUpdated'>; added: boolean }> {
    const parsed = this.parseMarketplaceSource(source);

    if (!parsed) {
      throw new Error(
        `Invalid marketplace source format. Supported formats:
- GitHub: username/repo
- GitHub HTTPS: https://github.com/username/repo
- GitHub SSH: git@github.com:username/repo.git
- Direct URL: https://example.com/photons.json
- Local path: ./path/to/marketplace or /absolute/path`
      );
    }

    // Check if this exact source is already added
    const existing = this.findBySource(parsed.source);
    if (existing) {
      return {
        marketplace: {
          name: existing.name,
          repo: existing.repo,
          url: existing.url,
          sourceType: existing.sourceType,
          source: existing.source,
        },
        added: false,
      };
    }

    // Get unique name (adds numeric suffix if name already exists)
    const uniqueName = this.getUniqueName(parsed.name);
    const finalParsed = { ...parsed, name: uniqueName };

    const marketplace: Marketplace = {
      ...finalParsed,
      enabled: true,
      lastUpdated: new Date().toISOString(),
    };

    this.config.marketplaces.push(marketplace);
    await this.save();

    return {
      marketplace: finalParsed,
      added: true,
    };
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
   * Fetch photons.json manifest from various sources
   */
  async fetchManifest(marketplace: Marketplace): Promise<MarketplaceManifest | null> {
    try {
      if (marketplace.sourceType === 'local') {
        // Local filesystem
        const localPath = marketplace.url.replace('file://', '');
        const manifestPath = path.join(localPath, '.marketplace', 'photons.json');

        if (existsSync(manifestPath)) {
          const data = await fs.readFile(manifestPath, 'utf-8');
          return JSON.parse(data) as MarketplaceManifest;
        }
      } else if (marketplace.sourceType === 'url') {
        // Direct URL - the source already points to photons.json
        const url = marketplace.source;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          return await response.json() as MarketplaceManifest;
        }
      } else {
        // GitHub sources (github, git-ssh)
        const url = `${marketplace.url}/.marketplace/photons.json`;
        const response = await fetch(url, {
          // Add timeout to prevent hanging
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          return await response.json() as MarketplaceManifest;
        } else {
          this.logger.warn(`Manifest fetch returned ${response.status} for ${marketplace.name}`);
        }
      }
    } catch (error) {
      // Marketplace doesn't have a manifest or fetch failed
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to fetch manifest from ${marketplace.name}`, {
        source: marketplace.source,
        error: message,
        hint: error instanceof Error && error.name === 'TimeoutError' 
          ? 'Network timeout - check your internet connection'
          : 'Marketplace may be unavailable',
      });
    }

    return null;
  }

  /**
   * Update marketplace cache (fetch and save photons.json manifest)
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
   * Returns content, marketplace info, and metadata (version, hash)
   */
  async fetchMCP(mcpName: string): Promise<{ content: string; marketplace: Marketplace; metadata?: PhotonMetadata } | null> {
    const enabled = this.getEnabled();

    for (const marketplace of enabled) {
      try {
        let content: string | null = null;

        if (marketplace.sourceType === 'local') {
          // Local filesystem
          const localPath = marketplace.url.replace('file://', '');
          const mcpPath = path.join(localPath, `${mcpName}.photon.ts`);

          if (existsSync(mcpPath)) {
            content = await fs.readFile(mcpPath, 'utf-8');
          }
        } else {
          // Remote fetch (GitHub, URL)
          const url = `${marketplace.url}/${mcpName}.photon.ts`;
          const response = await fetch(url);

          if (response.ok) {
            content = await response.text();
          }
        }

        if (content) {
          // Try to fetch metadata from manifest
          const manifest = await this.getCachedManifest(marketplace.name);
          const metadata = manifest?.photons.find(p => p.name === mcpName);

          return { content, marketplace, metadata };
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
        let content: string | null = null;

        if (marketplace.sourceType === 'local') {
          // Local filesystem
          const localPath = marketplace.url.replace('file://', '');
          const mcpPath = path.join(localPath, `${mcpName}.photon.ts`);

          if (existsSync(mcpPath)) {
            content = await fs.readFile(mcpPath, 'utf-8');
          }
        } else {
          // Remote fetch (GitHub, URL)
          const url = `${marketplace.url}/${mcpName}.photon.ts`;
          const response = await fetch(url);

          if (response.ok) {
            content = await response.text();
          }
        }

        if (content) {
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
   * Note: Requires marketplace to have a .marketplace/photons.json file
   */
  async listFromMarketplace(marketplaceName: string): Promise<string[]> {
    const marketplace = this.get(marketplaceName);

    if (!marketplace) {
      return [];
    }

    try {
      // Try to fetch photons.json manifest
      const manifest = await this.fetchManifest(marketplace);
      if (manifest) {
        return manifest.photons.map(p => p.name);
      }
    } catch {
      // No manifest file available
    }

    return [];
  }

  /**
   * Save installation metadata for a Photon
   */
  async savePhotonMetadata(
    fileName: string,
    marketplace: Marketplace,
    metadata: PhotonMetadata,
    contentHash: string
  ): Promise<void> {
    const localMetadata = await readLocalMetadata();

    localMetadata.photons[fileName] = {
      marketplace: marketplace.name,
      marketplaceRepo: marketplace.repo,
      version: metadata.version,
      originalHash: metadata.hash || contentHash,
      installedAt: new Date().toISOString(),
    };

    await writeLocalMetadata(localMetadata);
  }

  /**
   * Get local installation metadata for a Photon
   */
  async getPhotonInstallMetadata(fileName: string): Promise<PhotonInstallMetadata | null> {
    const localMetadata = await readLocalMetadata();
    return localMetadata.photons[fileName] || null;
  }

  /**
   * Check if a Photon file has been modified since installation
   */
  async isPhotonModified(filePath: string, fileName: string): Promise<boolean> {
    const metadata = await this.getPhotonInstallMetadata(fileName);
    if (!metadata) {
      return false; // No metadata, can't determine
    }

    try {
      const currentHash = await calculateFileHash(filePath);
      return currentHash !== metadata.originalHash;
    } catch {
      return false;
    }
  }

  /**
   * Find all marketplaces that have a specific MCP (for conflict detection)
   */
  async findAllSources(mcpName: string): Promise<Array<{ marketplace: Marketplace; metadata?: PhotonMetadata; content?: string }>> {
    const sources = [];
    const enabled = this.getEnabled();

    for (const marketplace of enabled) {
      try {
        let content: string | null = null;

        if (marketplace.sourceType === 'local') {
          // Local filesystem
          const localPath = marketplace.url.replace('file://', '');
          const mcpPath = path.join(localPath, `${mcpName}.photon.ts`);

          if (existsSync(mcpPath)) {
            content = await fs.readFile(mcpPath, 'utf-8');
          }
        } else {
          // Remote fetch (GitHub, URL)
          const url = `${marketplace.url}/${mcpName}.photon.ts`;
          const response = await fetch(url);

          if (response.ok) {
            content = await response.text();
          }
        }

        if (content) {
          // Try to fetch metadata from manifest
          const manifest = await this.getCachedManifest(marketplace.name);
          const metadata = manifest?.photons.find(p => p.name === mcpName);

          sources.push({
            marketplace,
            metadata,
            content,
          });
        }
      } catch {
        // Skip marketplace on error
      }
    }

    return sources;
  }

  /**
   * Detect all MCP conflicts across marketplaces
   */
  async detectAllConflicts(): Promise<Map<string, Array<{ marketplace: Marketplace; metadata?: PhotonMetadata }>>> {
    const conflicts = new Map<string, Array<{ marketplace: Marketplace; metadata?: PhotonMetadata }>>();
    const enabled = this.getEnabled();

    if (enabled.length <= 1) {
      return conflicts; // No conflicts possible with 0 or 1 marketplace
    }

    // Collect all MCPs from all marketplaces
    const mcpsByName = new Map<string, Array<{ marketplace: Marketplace; metadata?: PhotonMetadata }>>();

    for (const marketplace of enabled) {
      const manifest = await this.getCachedManifest(marketplace.name);

      if (manifest && manifest.photons) {
        for (const photon of manifest.photons) {
          if (!mcpsByName.has(photon.name)) {
            mcpsByName.set(photon.name, []);
          }
          mcpsByName.get(photon.name)!.push({
            marketplace,
            metadata: photon,
          });
        }
      }
    }

    // Find MCPs that appear in multiple marketplaces
    for (const [name, sources] of mcpsByName.entries()) {
      if (sources.length > 1) {
        conflicts.set(name, sources);
      }
    }

    return conflicts;
  }

  /**
   * Check if adding/upgrading an MCP would create a conflict
   */
  async checkConflict(mcpName: string, targetMarketplace?: string): Promise<{
    hasConflict: boolean;
    sources: Array<{ marketplace: Marketplace; metadata?: PhotonMetadata }>;
    recommendation?: string;
  }> {
    const sources = await this.findAllSources(mcpName);

    if (sources.length === 0) {
      return { hasConflict: false, sources: [] };
    }

    if (sources.length === 1) {
      return { hasConflict: false, sources };
    }

    // Multiple sources found - determine recommendation
    let recommendation: string | undefined;

    // If target marketplace specified, recommend it
    if (targetMarketplace) {
      const targetSource = sources.find(s => s.marketplace.name === targetMarketplace);
      if (targetSource) {
        recommendation = targetMarketplace;
      }
    }

    // Otherwise, recommend based on priority: version, then marketplace order
    if (!recommendation) {
      // Sort by version (semver) if available
      const withVersions = sources
        .filter(s => s.metadata?.version)
        .sort((a, b) => {
          const vA = a.metadata!.version;
          const vB = b.metadata!.version;
          return this.compareVersions(vB, vA); // Descending (newest first)
        });

      if (withVersions.length > 0) {
        recommendation = withVersions[0].marketplace.name;
      } else {
        // Default to first enabled marketplace
        recommendation = sources[0].marketplace.name;
      }
    }

    return {
      hasConflict: true,
      sources,
      recommendation,
    };
  }

  /**
   * Compare two semver versions
   * Returns: positive if v1 > v2, negative if v1 < v2, 0 if equal
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }
}
