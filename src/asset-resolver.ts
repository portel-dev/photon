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

    const assets = await sharedDiscoverAssets(photonPath, source);
    if (!assets) {
      return undefined;
    }

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
