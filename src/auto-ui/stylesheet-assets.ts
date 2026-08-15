/**
 * Resolve optional Photon-owned stylesheets from the existing companion asset
 * layout.
 *
 * Canonical layout:
 *   <photon>/<name>/assets/photon.css
 *   <photon>/<name>/assets/oauth.css
 *   <photon>/<name>/assets/formats/<format>.css
 *
 * The legacy companion root is also searched when the canonical `assets/`
 * root is absent (or when a stylesheet is not present in the canonical root),
 * matching photon-core's existing dual-layout asset discovery behaviour.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { AssetResolver } from '../asset-resolver.js';

export type PhotonStylesheetKind = 'photon' | 'oauth' | 'format';

/** A stylesheet that exists inside a Photon companion folder. */
export interface PhotonStylesheetAsset {
  readonly kind: PhotonStylesheetKind;
  readonly format?: string;
  /** Path relative to the directory next to `<name>.photon.ts`. */
  readonly relativePath: string;
  /** Absolute path suitable for local serving or Worker asset codegen. */
  readonly resolvedPath: string;
  readonly mimeType: 'text/css';
}

/** Optional stylesheets discovered for one Photon. */
export interface PhotonStylesheetAssets {
  /** The asset root selected by Photon asset discovery, when present. */
  readonly assetRoot?: string;
  readonly photon?: PhotonStylesheetAsset;
  readonly oauth?: PhotonStylesheetAsset;
  readonly formats: Readonly<Record<string, PhotonStylesheetAsset>>;
}

export interface ResolvePhotonStylesheetOptions {
  /**
   * Resolve only these format names. When omitted, discover every safe
   * `formats/*.css` file in the companion roots.
   */
  readonly formats?: readonly string[];
}

const SAFE_FORMAT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

interface CompanionRoot {
  /** Path spelling preserved for compatibility with AssetResolver. */
  readonly path: string;
  /** Canonical path used for containment checks. */
  readonly realPath: string;
}

/**
 * Resolve optional Photon stylesheet assets without making them mandatory.
 * Missing files, missing companion folders, and malformed format names all
 * produce an empty or partial result rather than an exception.
 */
export async function resolvePhotonStylesheetAssets(
  photonPath: string,
  source: string,
  options: ResolvePhotonStylesheetOptions = {}
): Promise<PhotonStylesheetAssets> {
  let discovered;
  try {
    // Reuse the runtime resolver so symlinked Photons and both companion
    // layouts follow the same rules as @ui, prompts, and resources.
    discovered = await new AssetResolver(() => {}).discover(photonPath, source);
  } catch {
    return emptyStylesheetAssets();
  }

  const roots = await companionRoots(photonPath);
  const discoveredRoot = discovered?.assetFolder;
  const discoveredRealRoot = discoveredRoot
    ? await realPathOrUndefined(discoveredRoot, true)
    : undefined;

  // AssetResolver has a pathless-UI fallback that intentionally points at the
  // Photon source directory. Stylesheets must only come from a named companion
  // folder, so reject any discovery root outside the established roots.
  if (
    !discoveredRoot ||
    !discoveredRealRoot ||
    !roots.some((root) => root.realPath === discoveredRealRoot)
  ) {
    return emptyStylesheetAssets();
  }

  const result: {
    assetRoot: string;
    photon?: PhotonStylesheetAsset;
    oauth?: PhotonStylesheetAsset;
    formats: Record<string, PhotonStylesheetAsset>;
  } = {
    assetRoot: discoveredRoot,
    formats: {},
  };

  result.photon = await findStylesheet(roots, photonPath, 'photon');
  result.oauth = await findStylesheet(roots, photonPath, 'oauth');

  const formatNames =
    options.formats === undefined
      ? await discoverFormatNames(roots)
      : uniqueSafeFormatNames(options.formats);

  for (const format of formatNames) {
    const asset = await findStylesheet(roots, photonPath, 'format', format);
    if (asset) {
      result.formats[format] = asset;
    }
  }

  return result;
}

function emptyStylesheetAssets(): PhotonStylesheetAssets {
  return { formats: {} };
}

async function companionRoots(photonPath: string): Promise<CompanionRoot[]> {
  const sourcePath = await sourcePathFor(photonPath);
  const photonDir = path.dirname(sourcePath);
  const photonName = path.basename(sourcePath, '.photon.ts');
  const companionDir = path.join(photonDir, photonName);
  const candidates = [path.join(companionDir, 'assets'), companionDir];
  const roots: CompanionRoot[] = [];

  for (const candidate of candidates) {
    const realPath = await realPathOrUndefined(candidate, true);
    if (realPath && !roots.some((root) => root.realPath === realPath)) {
      roots.push({ path: candidate, realPath });
    }
  }

  return roots;
}

async function findStylesheet(
  roots: readonly CompanionRoot[],
  photonPath: string,
  kind: Exclude<PhotonStylesheetKind, 'format'> | 'format',
  format?: string
): Promise<PhotonStylesheetAsset | undefined> {
  const relativeSegments = kind === 'format' ? ['formats', `${format}.css`] : [`${kind}.css`];

  for (const root of roots) {
    const candidate = path.resolve(root.path, ...relativeSegments);
    const asset = await inspectStylesheet(candidate, root, photonPath, kind, format);
    if (asset) return asset;
  }

  return undefined;
}

async function inspectStylesheet(
  candidate: string,
  root: CompanionRoot,
  photonPath: string,
  kind: PhotonStylesheetKind,
  format?: string
): Promise<PhotonStylesheetAsset | undefined> {
  if (!isWithin(root.path, candidate)) return undefined;

  const resolvedPath = await realPathOrUndefined(candidate);
  if (!resolvedPath || !isWithin(root.realPath, resolvedPath)) return undefined;

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) return undefined;
  } catch {
    return undefined;
  }

  const relativePath = path.relative(path.dirname(photonPath), candidate).split(path.sep).join('/');

  return {
    kind,
    ...(format === undefined ? {} : { format }),
    relativePath,
    resolvedPath,
    mimeType: 'text/css',
  };
}

async function discoverFormatNames(roots: readonly CompanionRoot[]): Promise<string[]> {
  const names = new Set<string>();

  for (const root of roots) {
    try {
      const entries = await fs.readdir(path.join(root.path, 'formats'), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
        const format = entry.name.slice(0, -'.css'.length);
        if (isSafeFormatName(format)) names.add(format);
      }
    } catch {
      // Optional directory: absence and unreadable directories fail safely.
    }
  }

  return [...names];
}

function uniqueSafeFormatNames(formats: readonly string[]): string[] {
  const names = new Set<string>();
  for (const format of formats) {
    if (isSafeFormatName(format)) names.add(format);
  }
  return [...names];
}

function isSafeFormatName(format: string): boolean {
  return SAFE_FORMAT_NAME.test(format) && format !== '.' && format !== '..';
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function realPathOrUndefined(
  filePath: string,
  directory = false
): Promise<string | undefined> {
  try {
    const stat = await fs.stat(filePath);
    if (directory && !stat.isDirectory()) return undefined;
    return await fs.realpath(filePath);
  } catch {
    return undefined;
  }
}

async function sourcePathFor(photonPath: string): Promise<string> {
  const absolutePath = path.resolve(photonPath);
  try {
    const stat = await fs.lstat(absolutePath);
    return stat.isSymbolicLink() ? await fs.realpath(absolutePath) : absolutePath;
  } catch {
    return absolutePath;
  }
}
