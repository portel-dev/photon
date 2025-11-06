/**
 * Registry Manager - Manage multiple MCP registries
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';

export interface Registry {
  name: string;
  url: string;
  enabled: boolean;
}

export interface RegistryConfig {
  registries: Registry[];
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'photon');
const CONFIG_FILE = path.join(CONFIG_DIR, 'registries.json');

const DEFAULT_REGISTRY: Registry = {
  name: 'photons',
  url: 'https://raw.githubusercontent.com/portel-dev/photons/main',
  enabled: true,
};

export class RegistryManager {
  private config: RegistryConfig = { registries: [] };

  async initialize() {
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    if (existsSync(CONFIG_FILE)) {
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      this.config = JSON.parse(data);
    } else {
      // Initialize with default registry
      this.config = {
        registries: [DEFAULT_REGISTRY],
      };
      await this.save();
    }
  }

  async save() {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /**
   * Get all registries
   */
  getAll(): Registry[] {
    return this.config.registries;
  }

  /**
   * Get enabled registries
   */
  getEnabled(): Registry[] {
    return this.config.registries.filter((r) => r.enabled);
  }

  /**
   * Get registry by name
   */
  get(name: string): Registry | undefined {
    return this.config.registries.find((r) => r.name === name);
  }

  /**
   * Parse GitHub repo reference into registry info
   * Supports:
   * - username/repo
   * - https://github.com/username/repo
   * - https://github.com/username/repo.git
   */
  private parseGitHubRepo(input: string): { name: string; url: string } | null {
    // Pattern 1: username/repo
    const shorthandMatch = input.match(/^([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+)$/);
    if (shorthandMatch) {
      const [, username, repo] = shorthandMatch;
      return {
        name: repo,
        url: `https://raw.githubusercontent.com/${username}/${repo}/main`,
      };
    }

    // Pattern 2: https://github.com/username/repo or https://github.com/username/repo.git
    const urlMatch = input.match(/^https?:\/\/github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+?)(\.git)?$/);
    if (urlMatch) {
      const [, username, repo] = urlMatch;
      return {
        name: repo,
        url: `https://raw.githubusercontent.com/${username}/${repo}/main`,
      };
    }

    return null;
  }

  /**
   * Add a new registry from GitHub repo
   * Supports: username/repo or https://github.com/username/repo
   */
  async add(githubRepo: string): Promise<{ name: string; url: string }> {
    const parsed = this.parseGitHubRepo(githubRepo);

    if (!parsed) {
      throw new Error(
        'Invalid format. Use: username/repo or https://github.com/username/repo'
      );
    }

    // Check if already exists
    if (this.get(parsed.name)) {
      throw new Error(`Registry '${parsed.name}' already exists`);
    }

    this.config.registries.push({
      name: parsed.name,
      url: parsed.url,
      enabled: true,
    });

    await this.save();
    return parsed;
  }

  /**
   * Remove a registry
   */
  async remove(name: string): Promise<boolean> {
    const index = this.config.registries.findIndex((r) => r.name === name);

    if (index === -1) {
      return false;
    }

    // Prevent removing the default registry
    if (this.config.registries[index].url === DEFAULT_REGISTRY.url) {
      throw new Error('Cannot remove the default photons registry');
    }

    this.config.registries.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Enable/disable a registry
   */
  async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    const registry = this.get(name);

    if (!registry) {
      return false;
    }

    registry.enabled = enabled;
    await this.save();
    return true;
  }

  /**
   * Try to fetch MCP from all enabled registries
   */
  async fetchMCP(mcpName: string): Promise<{ content: string; registry: Registry } | null> {
    const enabled = this.getEnabled();

    for (const registry of enabled) {
      try {
        const url = `${registry.url}/${mcpName}.photon.ts`;
        const response = await fetch(url);

        if (response.ok) {
          const content = await response.text();
          return { content, registry };
        }
      } catch {
        // Try next registry
      }
    }

    return null;
  }

  /**
   * Fetch version from all enabled registries
   */
  async fetchVersion(mcpName: string): Promise<{ version: string; registry: Registry } | null> {
    const enabled = this.getEnabled();

    for (const registry of enabled) {
      try {
        const url = `${registry.url}/${mcpName}.photon.ts`;
        const response = await fetch(url);

        if (response.ok) {
          const content = await response.text();
          const versionMatch = content.match(/@version\s+(\d+\.\d+\.\d+)/);

          if (versionMatch) {
            return { version: versionMatch[1], registry };
          }
        }
      } catch {
        // Try next registry
      }
    }

    return null;
  }

  /**
   * Search for MCP in all registries
   */
  async search(query: string): Promise<Map<string, Registry[]>> {
    const results = new Map<string, Registry[]>();
    const enabled = this.getEnabled();

    // For now, we just check if the MCP exists by name
    // In the future, registries could provide a manifest/index file
    for (const registry of enabled) {
      try {
        const url = `${registry.url}/${query}.photon.ts`;
        const response = await fetch(url, { method: 'HEAD' });

        if (response.ok) {
          const existing = results.get(query) || [];
          existing.push(registry);
          results.set(query, existing);
        }
      } catch {
        // Skip this registry
      }
    }

    return results;
  }

  /**
   * List all available MCPs from a registry
   * Note: Requires registry to have an index.json file
   */
  async listFromRegistry(registryName: string): Promise<string[]> {
    const registry = this.get(registryName);

    if (!registry) {
      return [];
    }

    try {
      // Try to fetch index.json if it exists
      const indexUrl = `${registry.url}/index.json`;
      const response = await fetch(indexUrl);

      if (response.ok) {
        const data: any = await response.json();
        return data.mcps || [];
      }
    } catch {
      // No index file available
    }

    return [];
  }
}
