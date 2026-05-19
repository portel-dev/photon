/**
 * Shared UI asset resolution logic — used by Beam and api-browse routes.
 *
 * Resolves a UI asset ID to a file path, respecting the priority order:
 *   .photon.html > .photon.tsx > .photon.md > .html > .tsx
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export interface ResolvedUI {
  path: string;
  isPhotonTemplate: boolean;
  isPhotonMarkdown: boolean;
}

/**
 * Resolve a UI asset by probing candidate extensions in priority order.
 */
export async function resolveUIAssetPath(
  photonDir: string,
  photonBaseName: string,
  uiId: string
): Promise<ResolvedUI> {
  const uiBase = path.join(photonDir, photonBaseName, 'ui');
  const candidates: ResolvedUI[] = [
    {
      path: path.join(uiBase, `${uiId}.photon.html`),
      isPhotonTemplate: true,
      isPhotonMarkdown: false,
    },
    {
      path: path.join(uiBase, `${uiId}.photon.tsx`),
      isPhotonTemplate: true,
      isPhotonMarkdown: false,
    },
    {
      path: path.join(uiBase, `${uiId}.photon.md`),
      isPhotonTemplate: false,
      isPhotonMarkdown: true,
    },
    { path: path.join(uiBase, `${uiId}.html`), isPhotonTemplate: false, isPhotonMarkdown: false },
    { path: path.join(uiBase, `${uiId}.tsx`), isPhotonTemplate: false, isPhotonMarkdown: false },
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate.path);
      return candidate;
    } catch {
      // try next
    }
  }

  // Default fallback to last candidate (lowest priority)
  return candidates[candidates.length - 1];
}

/**
 * If a resolved path points to .html, check for higher-priority siblings
 * (.photon.html, .photon.tsx, .photon.md).
 */
export async function upgradeToSibling(resolvedPath: string): Promise<ResolvedUI> {
  if (!resolvedPath.endsWith('.html')) {
    return {
      path: resolvedPath,
      isPhotonTemplate:
        resolvedPath.endsWith('.photon.html') || resolvedPath.endsWith('.photon.tsx'),
      isPhotonMarkdown: resolvedPath.endsWith('.photon.md'),
    };
  }

  const siblings: ResolvedUI[] = [
    {
      path: resolvedPath.replace(/\.html$/, '.photon.html'),
      isPhotonTemplate: true,
      isPhotonMarkdown: false,
    },
    {
      path: resolvedPath.replace(/\.html$/, '.photon.tsx'),
      isPhotonTemplate: true,
      isPhotonMarkdown: false,
    },
    {
      path: resolvedPath.replace(/\.html$/, '.photon.md'),
      isPhotonTemplate: false,
      isPhotonMarkdown: true,
    },
  ];

  for (const sibling of siblings) {
    try {
      await fs.access(sibling.path);
      return sibling;
    } catch {
      // try next
    }
  }

  return { path: resolvedPath, isPhotonTemplate: false, isPhotonMarkdown: false };
}

/**
 * Read a UI file, compiling TSX if needed. Returns a self-contained
 * document for .tsx (bundle inlined). Use this for auxiliary surfaces
 * that have no sibling-asset route (format renderers, api-browse).
 */
export async function readUIContent(filePath: string): Promise<string> {
  if (filePath.endsWith('.tsx')) {
    const { compileTsxCached, inlineHtml } = await import('../tsx-compiler.js');
    const compiled = await compileTsxCached(filePath);
    return compiled.js ? inlineHtml(compiled.js) : compiled.html;
  }
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Read a UI file for an app mount that CAN serve sibling assets. For
 * .tsx this returns the tiny cache-busting shell plus the compiled
 * descriptor so the caller can serve `<base>.<hash>.js` immutably.
 */
export async function readUICompiled(
  filePath: string
): Promise<{ content: string; compiled?: import('../tsx-compiler.js').CompiledTsx }> {
  if (filePath.endsWith('.tsx')) {
    const { compileTsxCached } = await import('../tsx-compiler.js');
    const compiled = await compileTsxCached(filePath);
    return { content: compiled.html, compiled };
  }
  return { content: await fs.readFile(filePath, 'utf-8') };
}
