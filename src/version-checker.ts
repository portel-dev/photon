/**
 * Version Checker - Check for MCP updates from registry
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { RegistryManager, Registry } from './registry-manager.js';

interface VersionInfo {
  local?: string;
  remote?: string;
  needsUpdate: boolean;
  registry?: Registry;
}

export class VersionChecker {
  private registryManager: RegistryManager;

  constructor(registryManager?: RegistryManager) {
    this.registryManager = registryManager || new RegistryManager();
  }

  async initialize() {
    await this.registryManager.initialize();
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
      return null;
    }
  }

  /**
   * Fetch remote version from registry
   */
  async fetchRemoteVersion(mcpName: string): Promise<{ version: string; registry: Registry } | null> {
    return await this.registryManager.fetchVersion(mcpName);
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
        registry: remoteInfo?.registry,
      };
    }

    const needsUpdate = this.compareVersions(remoteInfo.version, local) > 0;

    return {
      local,
      remote: remoteInfo.version,
      needsUpdate,
      registry: remoteInfo.registry,
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
   * Download and update MCP from registry
   */
  async updateMCP(mcpName: string, targetPath: string): Promise<boolean> {
    try {
      const result = await this.registryManager.fetchMCP(mcpName);

      if (!result) {
        return false;
      }

      await fs.writeFile(targetPath, result.content, 'utf-8');
      return true;
    } catch {
      return false;
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

    if (info.needsUpdate) {
      return `${info.local} → ${info.remote} (update available)`;
    }

    return `${info.local} (up to date)`;
  }
}
