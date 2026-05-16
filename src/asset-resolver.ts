/**
 * Asset discovery + binding for Photon instances.
 *
 * Wraps `discoverAssets` from photon-core with the runtime-specific bits:
 * method-level `@ui` linking, `ui://` URI generation for the MCP Apps
 * extension, and exposing the metadata on `this.assets` without breaking
 * the inherited `assets(subpath)` callable on Photon subclasses.
 *
 * Extracted from PhotonLoader so the loader doesn't need to know how
 * UI assets get woven onto an instance.
 */

import * as path from 'path';
import * as fs from 'fs';
import { discoverAssets as sharedDiscoverAssets, type PhotonAssets } from '@portel/photon-core';

type LogFn = (message: string, meta?: Record<string, any>) => void;

export class AssetResolver {
  constructor(private readonly log: LogFn) {}

  /**
   * Discover assets from a photon source. Delegates to photon-core for the
   * filesystem walk, then layers in method-level `@ui` links and `ui://` URIs.
   */
  async discover(photonPath: string, source: string): Promise<PhotonAssets | undefined> {
    const basename = path.basename(photonPath, '.photon.ts');

    const assets =
      (await sharedDiscoverAssets(photonPath, source)) ??
      this.discoverPathlessUIAssets(photonPath, source);
    if (!assets) {
      return undefined;
    }

    this.applyPathlessUIAssets(photonPath, source, assets);
    this.resolveDeclaredPaths(photonPath, assets);
    this.applyMethodUILinks(source, assets);
    this.generateAssetURIs(basename, assets);

    return assets;
  }

  /**
   * Expose discovered asset metadata on the instance without breaking
   * `Photon.assets(subpath)`.
   *
   * Photon subclasses inherit a callable `assets(subpath)` method. We bind
   * it to the instance and decorate the function object with metadata so
   * both `this.assets('templates')` and `this.assets.ui` work. Plain
   * classes with no inherited method receive the metadata object directly.
   */
  attachToInstance(instance: Record<string, unknown>, assets: PhotonAssets | undefined): void {
    if (!assets) {
      return;
    }

    const existingAssets = instance.assets;

    if (typeof existingAssets === 'function') {
      const boundAssets = existingAssets.bind(instance) as typeof existingAssets & PhotonAssets;
      Object.assign(boundAssets, assets);
      Object.defineProperty(instance, 'assets', {
        value: boundAssets,
        configurable: true,
        enumerable: false,
        writable: false,
      });
      return;
    }

    Object.defineProperty(instance, 'assets', {
      value: assets,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  /**
   * Generate ui:// URIs for all UI assets (MCP Apps Extension, SEP-1865).
   * URI format: ui://<photon-name>/<asset-id>
   */
  private generateAssetURIs(photonName: string, assets: PhotonAssets): void {
    for (const ui of assets.ui) {
      ui.uri = `ui://${photonName}/${ui.id}`;
      this.log(`  🔗 URI: ${ui.uri}`);
    }
  }

  private resolveDeclaredPaths(photonPath: string, assets: PhotonAssets): void {
    const baseDir = path.dirname(photonPath);
    const resolveAsset = (asset: { path?: string; resolvedPath?: string }) => {
      if (!asset.path || asset.resolvedPath) return;
      const resolvedPath = path.isAbsolute(asset.path)
        ? asset.path
        : path.resolve(baseDir, asset.path);
      if (fs.existsSync(resolvedPath)) {
        asset.resolvedPath = resolvedPath;
      }
    };

    for (const ui of assets.ui) resolveAsset(ui);
    for (const prompt of assets.prompts) resolveAsset(prompt);
    for (const resource of assets.resources) resolveAsset(resource);
  }

  private discoverPathlessUIAssets(photonPath: string, source: string): PhotonAssets | undefined {
    const ui = this.resolvePathlessUIAssets(photonPath, source);
    if (ui.length === 0) {
      return undefined;
    }
    return {
      ui,
      prompts: [],
      resources: [],
      assetFolder: path.dirname(photonPath),
    };
  }

  private applyPathlessUIAssets(photonPath: string, source: string, assets: PhotonAssets): void {
    for (const ui of this.resolvePathlessUIAssets(photonPath, source)) {
      const existingIndex = assets.ui.findIndex((existing) => existing.id === ui.id);
      if (existingIndex >= 0) {
        assets.ui[existingIndex] = { ...assets.ui[existingIndex], ...ui };
      } else {
        assets.ui.push(ui);
      }
    }
  }

  private resolvePathlessUIAssets(
    photonPath: string,
    source: string
  ): Array<{ id: string; path: string; resolvedPath: string }> {
    const ids = this.extractClassPathlessUIIds(source);
    if (ids.length === 0) return [];

    const baseDir = path.dirname(photonPath);
    const basename = path.basename(photonPath, '.photon.ts');
    const assetFolder = path.join(baseDir, basename);
    const roots = [path.join(assetFolder, 'assets'), assetFolder, baseDir];
    const suffixes = ['.photon.tsx', '.tsx', '.photon.html', '.html'];
    const resolved: Array<{ id: string; path: string; resolvedPath: string }> = [];

    for (const id of ids) {
      for (const root of roots) {
        for (const suffix of suffixes) {
          const relativePath = `./ui/${id}${suffix}`;
          const candidate = path.resolve(root, relativePath.replace(/^\.\//, ''));
          if (fs.existsSync(candidate)) {
            resolved.push({ id, path: relativePath, resolvedPath: candidate });
            this.log(`  🔎 UI ${id} resolved by convention → ${relativePath}`);
            break;
          }
        }
        if (resolved.find((ui) => ui.id === id)) break;
      }
    }

    return resolved;
  }

  private extractClassPathlessUIIds(source: string): string[] {
    const classJsdocMatch =
      source.match(/\/\*\*[\s\S]*?\*\/\s*(?=export\s+default\s+class)/) ||
      source.match(/^\/\*\*[\s\S]*?\*\//);
    if (!classJsdocMatch) return [];

    const ids: string[] = [];
    for (const rawLine of classJsdocMatch[0].split(/\r?\n/)) {
      const line = rawLine
        .replace(/^\s*\/\*\*\s?/, '')
        .replace(/^\s*\*\s?/, '')
        .replace(/\s*\*\/\s*$/, '')
        .trim();
      const match = line.match(/^@ui\s+(\w[\w-]*)$/);
      if (match && !ids.includes(match[1])) {
        ids.push(match[1]);
      }
    }
    return ids;
  }

  /**
   * Apply method-level `@ui` annotations to link UI assets to tools.
   * Called after auto-discovery so all UI assets are available to look up.
   */
  private applyMethodUILinks(source: string, assets: PhotonAssets): void {
    const methodUiRegex =
      /\/\*\*[\s\S]*?@ui\s+(\w[\w-]*)[\s\S]*?\*\/\s*(?:(?:public|private|protected|static|async)\s+)*\*?\s*(\w+)\s*\(/g;

    let match;
    while ((match = methodUiRegex.exec(source)) !== null) {
      const [, uiId, methodName] = match;
      const asset = assets.ui.find((u) => u.id === uiId);
      if (asset) {
        if (!asset.linkedTool) {
          asset.linkedTool = methodName;
          this.log(`  🔗 UI ${uiId} → ${methodName}`);
        }
        if (!asset.linkedTools) asset.linkedTools = [];
        if (!asset.linkedTools.includes(methodName)) {
          asset.linkedTools.push(methodName);
          if (asset.linkedTools.length > 1) {
            this.log(`  🔗 UI ${uiId} → ${methodName} (shared)`);
          }
        }
      } else {
        this.log(`  ⚠️ @ui ${uiId} on ${methodName}: asset not found (check file exists)`);
      }
    }
  }
}
