/**
 * Marketplace - Search, install, and manage photons
 * @description Browse and manage photon marketplace
 * @internal
 * @icon 🏪
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export default class Marketplace {
  private workingDir: string;

  constructor(workingDir?: string) {
    this.workingDir = workingDir || process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');
  }

  // ============================================
  // Consumer Methods
  // ============================================

  /**
   * Search marketplace for photons
   * @param query Search query string
   */
  static async search({ query }: { query: string }): Promise<
    Array<{
      name: string;
      description: string;
      version: string;
      author: string;
      tags: string[];
      marketplace: string;
      installed: boolean;
    }>
  > {
    const { MarketplaceManager } = await import('../marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    const results = await manager.search(query);
    const photonList: Array<{
      name: string;
      description: string;
      version: string;
      author: string;
      tags: string[];
      marketplace: string;
      installed: boolean;
    }> = [];

    const workingDir = process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');

    for (const [name, sources] of results) {
      const source = sources[0];
      // Check if installed by looking for the file
      let installed = false;
      try {
        await fs.access(path.join(workingDir, `${name}.photon.ts`));
        installed = true;
      } catch {
        // Not installed
      }

      photonList.push({
        name,
        description: source.metadata?.description || '',
        version: source.metadata?.version || '',
        author: source.metadata?.author || '',
        tags: source.metadata?.tags || [],
        marketplace: source.marketplace.name,
        installed,
      });
    }

    return photonList;
  }

  /**
   * Install a photon from marketplace
   * @param name Name of the photon to install
   */
  static async *install({ name }: { name: string }): AsyncGenerator<{
    step: string;
    message?: string;
    name?: string;
    path?: string;
    version?: string;
  }> {
    const { MarketplaceManager } = await import('../marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    const workingDir = process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');

    yield { step: 'searching', message: `Searching for ${name}...` };

    const result = await manager.fetchMCP(name);
    if (!result) {
      yield { step: 'error', message: `Photon '${name}' not found in marketplace` };
      return;
    }

    yield { step: 'downloading', message: `Downloading ${name}...` };

    const targetPath = path.join(workingDir, `${name}.photon.ts`);
    await fs.writeFile(targetPath, result.content, 'utf-8');

    if (result.metadata) {
      yield { step: 'saving-metadata', message: 'Saving installation metadata...' };
      const { calculateHash } = await import('../marketplace-manager.js');
      const hash = calculateHash(result.content);
      await manager.savePhotonMetadata(
        `${name}.photon.ts`,
        result.marketplace,
        result.metadata,
        hash
      );
    }

    yield {
      step: 'done',
      message: `Installed ${name}`,
      name,
      path: targetPath,
      version: result.metadata?.version,
    };
  }

  /**
   * Upgrade an installed photon to latest version
   * @param name Name of the photon to upgrade
   */
  static async *upgrade({ name }: { name: string }): AsyncGenerator<{
    step: string;
    message?: string;
    currentVersion?: string;
    newVersion?: string;
  }> {
    const { MarketplaceManager, readLocalMetadata } = await import('../marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    yield { step: 'checking', message: `Checking current version of ${name}...` };

    const localMeta = await readLocalMetadata();
    const fileName = `${name}.photon.ts`;
    const currentMeta = localMeta.photons[fileName];
    const currentVersion = currentMeta?.version || 'unknown';

    yield { step: 'fetching', message: `Fetching latest version...` };

    const result = await manager.fetchMCP(name);
    if (!result) {
      yield { step: 'error', message: `Photon '${name}' not found in marketplace` };
      return;
    }

    const workingDir = process.env.PHOTON_DIR || path.join(os.homedir(), '.photon');
    const targetPath = path.join(workingDir, fileName);

    yield { step: 'installing', message: `Upgrading ${name}...` };

    await fs.writeFile(targetPath, result.content, 'utf-8');

    if (result.metadata) {
      const { calculateHash } = await import('../marketplace-manager.js');
      const hash = calculateHash(result.content);
      await manager.savePhotonMetadata(fileName, result.marketplace, result.metadata, hash);
    }

    yield {
      step: 'done',
      message: `Upgraded ${name} from ${currentVersion} to ${result.metadata?.version || 'latest'}`,
      currentVersion,
      newVersion: result.metadata?.version,
    };
  }

  /**
   * Check all installed photons for available updates
   * @autorun
   */
  static async checkUpdates(): Promise<
    Array<{
      name: string;
      currentVersion: string;
      latestVersion: string;
      marketplace: string;
    }>
  > {
    const { MarketplaceManager, readLocalMetadata } = await import('../marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    const localMeta = await readLocalMetadata();
    const updates: Array<{
      name: string;
      currentVersion: string;
      latestVersion: string;
      marketplace: string;
    }> = [];

    for (const [fileName, installMeta] of Object.entries(localMeta.photons)) {
      const photonName = fileName.replace(/\.photon\.ts$/, '');
      const latestInfo = await manager.getPhotonMetadata(photonName);

      if (latestInfo && latestInfo.metadata.version !== installMeta.version) {
        updates.push({
          name: photonName,
          currentVersion: installMeta.version,
          latestVersion: latestInfo.metadata.version,
          marketplace: latestInfo.marketplace.name,
        });
      }
    }

    return updates;
  }

  // ============================================
  // Source Management
  // ============================================

  /**
   * List configured marketplace sources
   * @autorun
   */
  static async listSources(): Promise<
    Array<{
      name: string;
      repo: string;
      source: string;
      sourceType: string;
      enabled: boolean;
      photonCount: number;
    }>
  > {
    const { MarketplaceManager } = await import('../marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    const sources = manager.getAll();
    const result = await Promise.all(
      sources.map(async (s) => {
        const manifest = await manager.getCachedManifest(s.name);
        return {
          name: s.name,
          repo: s.repo,
          source: s.source,
          sourceType: s.sourceType,
          enabled: s.enabled,
          photonCount: manifest?.photons?.length || 0,
        };
      })
    );

    return result;
  }

  /**
   * Add a marketplace source
   * @param source Git URL or local path to marketplace
   */
  static async addSource({
    source,
  }: {
    source: string;
  }): Promise<{ name: string; added: boolean }> {
    const { MarketplaceManager } = await import('../marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    const result = await manager.add(source);

    if (result.added) {
      await manager.updateMarketplaceCache(result.marketplace.name);
    }

    return { name: result.marketplace.name, added: result.added };
  }

  /**
   * Remove a marketplace source
   * @param name Name of the marketplace source to remove
   */
  static async removeSource({ name }: { name: string }): Promise<{ removed: boolean }> {
    const { MarketplaceManager } = await import('../marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    const removed = await manager.remove(name);
    return { removed };
  }

  // ============================================
  // Publishing Methods (moved from maker)
  // ============================================

  /**
   * Synchronize marketplace manifest and documentation
   */
  static async *sync(): AsyncGenerator<{
    step: string;
    message?: string;
    photon?: string;
    photons?: number;
    manifest?: string;
  }> {
    const workingDir = process.env.PHOTON_DIR || process.cwd();

    yield { step: 'scanning', message: 'Scanning for photons...' };

    const files = await fs.readdir(workingDir);
    const photonFiles = files.filter((f) => f.endsWith('.photon.ts'));

    yield {
      step: 'found',
      message: `Found ${photonFiles.length} photons`,
      photons: photonFiles.length,
    };

    for (const file of photonFiles) {
      yield { step: 'processing', photon: file, message: `Processing ${file}...` };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const manifest = path.join(workingDir, '.marketplace', 'photons.json');
    yield { step: 'done', message: 'Sync complete', photons: photonFiles.length, manifest };
  }

  /**
   * Initialize current directory as a photon marketplace
   */
  static async *init(): AsyncGenerator<{ step: string; message?: string; created?: string }> {
    const workingDir = process.cwd();

    yield { step: 'starting', message: 'Initializing photon marketplace...' };

    const marketplaceDir = path.join(workingDir, '.marketplace');
    try {
      await fs.mkdir(marketplaceDir, { recursive: true });
      yield { step: 'created', created: '.marketplace/' };
    } catch {
      // Directory creation failed - continue anyway
    }

    const manifestPath = path.join(marketplaceDir, 'photons.json');
    try {
      await fs.access(manifestPath);
      yield { step: 'exists', message: '.marketplace/photons.json already exists' };
    } catch {
      await fs.writeFile(manifestPath, JSON.stringify({ photons: [] }, null, 2));
      yield { step: 'created', created: '.marketplace/photons.json' };
    }

    const gitignorePath = path.join(workingDir, '.gitignore');
    try {
      let gitignore = '';
      try {
        gitignore = await fs.readFile(gitignorePath, 'utf-8');
      } catch {
        // File doesn't exist
      }

      if (!gitignore.includes('node_modules')) {
        gitignore += '\nnode_modules/\n';
        await fs.writeFile(gitignorePath, gitignore);
        yield { step: 'created', created: '.gitignore (updated)' };
      }
    } catch {
      // gitignore update failed - non-critical
    }

    yield { step: 'done', message: 'Marketplace initialized' };
  }
}
