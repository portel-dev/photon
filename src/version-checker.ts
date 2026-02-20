/**
 * Version Checker - Check for MCP updates from marketplace
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { MarketplaceManager, type Marketplace } from './marketplace-manager.js';

export interface VersionInfo {
  local?: string;
  remote?: string;
  needsUpdate: boolean;
  hashDrift?: boolean;
  marketplace?: Marketplace;
}

export class VersionChecker {
  private marketplaceManager: MarketplaceManager;

  constructor(marketplaceManager?: MarketplaceManager) {
    this.marketplaceManager = marketplaceManager || new MarketplaceManager();
  }

  async initialize() {
    await this.marketplaceManager.initialize();
  }

  /**
   * Extract version from MCP source file
   */
  async extractVersion(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const versionMatch = content.match(/@version\s+(\d+\.\d+\.\d+)/);
      return versionMatch ? versionMatch[1] : null;
    } catch {
      return null; // file unreadable
    }
  }

  /**
   * Fetch remote version from marketplace
   */
  async fetchRemoteVersion(
    mcpName: string
  ): Promise<{ version: string; marketplace: Marketplace } | null> {
    return await this.marketplaceManager.fetchVersion(mcpName);
  }

  /**
   * Compare versions (semver-like)
   */
  compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }

    return 0;
  }

  /**
   * Check if MCP needs update
   */
  async checkForUpdate(mcpName: string, localPath: string): Promise<VersionInfo> {
    const local = await this.extractVersion(localPath);
    const remoteInfo = await this.fetchRemoteVersion(mcpName);

    if (!local || !remoteInfo) {
      return {
        local: local || undefined,
        remote: remoteInfo?.version,
        needsUpdate: false,
        marketplace: remoteInfo?.marketplace,
      };
    }

    const versionCmp = this.compareVersions(remoteInfo.version, local);

    if (versionCmp > 0) {
      return {
        local,
        remote: remoteInfo.version,
        needsUpdate: true,
        marketplace: remoteInfo.marketplace,
      };
    }

    // Versions match — check for hash drift (content changed without version bump)
    if (versionCmp === 0) {
      const fileName = path.basename(localPath);
      const installMeta = await this.marketplaceManager.getPhotonInstallMetadata(fileName);
      const remoteMeta = await this.marketplaceManager.getPhotonMetadata(
        fileName.replace('.photon.ts', '')
      );

      if (installMeta?.originalHash && remoteMeta?.metadata.hash) {
        if (installMeta.originalHash !== remoteMeta.metadata.hash) {
          return {
            local,
            remote: remoteInfo.version,
            needsUpdate: true,
            hashDrift: true,
            marketplace: remoteInfo.marketplace,
          };
        }
      }
    }

    return {
      local,
      remote: remoteInfo.version,
      needsUpdate: false,
      marketplace: remoteInfo.marketplace,
    };
  }

  /**
   * Check all MCPs in working directory for updates
   */
  async checkAllUpdates(workingDir: string): Promise<Map<string, VersionInfo>> {
    const updates = new Map<string, VersionInfo>();

    try {
      const entries = await fs.readdir(workingDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.photon.ts')) {
          const mcpName = entry.name.replace('.photon.ts', '');
          const filePath = path.join(workingDir, entry.name);
          const versionInfo = await this.checkForUpdate(mcpName, filePath);

          if (versionInfo.local || versionInfo.remote) {
            updates.set(mcpName, versionInfo);
          }
        }
      }
    } catch {
      // Directory doesn't exist or other error
    }

    return updates;
  }

  /**
   * Download and update MCP from marketplace (includes assets + metadata)
   */
  async updateMCP(mcpName: string, targetPath: string): Promise<boolean> {
    try {
      const result = await this.marketplaceManager.fetchMCP(mcpName);

      if (!result) {
        return false;
      }

      const workingDir = path.dirname(targetPath);
      await this.marketplaceManager.installPhoton(result, mcpName, workingDir);
      return true;
    } catch {
      return false; // update failed
    }
  }

  /**
   * Format version info for display
   */
  formatVersionInfo(info: VersionInfo): string {
    if (!info.local && !info.remote) {
      return 'unknown';
    }

    if (!info.local) {
      return `remote: ${info.remote}`;
    }

    if (!info.remote) {
      return `local: ${info.local}`;
    }

    if (info.needsUpdate && info.hashDrift) {
      return `${info.local} (content changed)`;
    }

    if (info.needsUpdate) {
      return `${info.local} → ${info.remote} (update available)`;
    }

    return `${info.local} (up to date)`;
  }
}
