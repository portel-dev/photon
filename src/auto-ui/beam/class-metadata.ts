/**
 * Class Metadata Extraction — JSDoc tag parsing for photon source files.
 *
 * Extracts @icon, @internal, @version, @author, @label, @description,
 * @visibility, and @csp annotations from source code.
 */

import type { MethodInfo } from '../types.js';

/** Extract class-level metadata from JSDoc comments in photon source */
export function extractClassMetadataFromSource(content: string): {
  description?: string;
  icon?: string;
  internal?: boolean;
  version?: string;
  author?: string;
  label?: string;
} {
  try {
    const classDocRegex = /\/\*\*([\s\S]*?)\*\/\s*\n?(?:export\s+)?(?:default\s+)?class\s+\w+/;
    const match = content.match(classDocRegex) || content.match(/^\/\*\*([\s\S]*?)\*\//);

    if (!match) return {};

    const docContent = match[1];
    const metadata: {
      description?: string;
      icon?: string;
      internal?: boolean;
      version?: string;
      author?: string;
      label?: string;
    } = {};

    const iconMatch = docContent.match(/@icon\s+(\S+)/);
    if (iconMatch) metadata.icon = iconMatch[1];

    if (/@internal\b/.test(docContent)) metadata.internal = true;

    const versionMatch = docContent.match(/@version\s+(\S+)/);
    if (versionMatch) metadata.version = versionMatch[1];

    const authorMatch = docContent.match(/@author\s+([^\n@]+)/);
    if (authorMatch) metadata.author = authorMatch[1].trim();

    const labelMatch = docContent.match(/@label\s+([^\n@]+)/);
    if (labelMatch) metadata.label = labelMatch[1].trim();

    const descMatch = docContent.match(/@description\s+([^\n@]+)/);
    if (descMatch) {
      metadata.description = descMatch[1].trim();
    } else {
      const lines = docContent
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
        .filter((l) => l && !l.startsWith('@'));
      if (lines.length > 0) metadata.description = lines[0];
    }

    return metadata;
  } catch {
    return {};
  }
}

/**
 * Apply @visibility annotations from method-level JSDoc to method objects.
 * @visibility model,app → ['model', 'app']
 */
export function applyMethodVisibility(source: string, methods: MethodInfo[]): void {
  const regex = /\/\*\*[\s\S]*?@visibility\s+([\w,\s]+)[\s\S]*?\*\/\s*(?:async\s+)?\*?\s*(\w+)/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const [, visibilityStr, methodName] = match;
    const method = methods.find((m) => m.name === methodName);
    if (method) {
      method.visibility = visibilityStr
        .split(',')
        .map((v) => v.trim())
        .filter((v): v is 'model' | 'app' => v === 'model' || v === 'app');
    }
  }
}

/**
 * Extract @csp annotations from class-level JSDoc.
 * @csp connect domain1,domain2
 * @csp resource cdn.example.com
 */
export function extractCspFromSource(source: string): Record<
  string,
  {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  }
> {
  const result: Record<string, any> = {};

  const classDocRegex = /\/\*\*([\s\S]*?)\*\/\s*\n?(?:export\s+)?(?:default\s+)?class\s+(\w+)/g;
  let classMatch;
  while ((classMatch = classDocRegex.exec(source)) !== null) {
    const docContent = classMatch[1];
    const csp: any = {};
    let hasCsp = false;

    const cspRegex = /@csp\s+(connect|resource|frame|base-uri)\s+([^\n@]+)/g;
    let cspMatch;
    while ((cspMatch = cspRegex.exec(docContent)) !== null) {
      hasCsp = true;
      const directive = cspMatch[1].trim();
      const domains = cspMatch[2]
        .trim()
        .split(/[,\s]+/)
        .filter(Boolean);
      const key = directive === 'base-uri' ? 'baseUriDomains' : `${directive}Domains`;
      csp[key] = (csp[key] || []).concat(domains);
    }

    if (hasCsp) result['__class__'] = csp;
  }

  return result;
}

/**
 * Convert a kebab-case name to a display label.
 * e.g. "filesystem" → "Filesystem", "git-box" → "Git Box"
 */
export function prettifyName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Convert a tool name to a display label.
 */
export function prettifyToolName(name: string): string {
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * After loading a photon, backfill env vars for constructor params that used
 * their TypeScript defaults. Ensures the env var always reflects the effective
 * value so other consumers (e.g. /api/browse) can read it.
 */
export function backfillEnvDefaults(
  instance: any,
  params: Array<{ name: string; envVar: string; hasDefault: boolean }>
): void {
  for (const param of params) {
    if (!process.env[param.envVar] && param.hasDefault) {
      const value = (instance as Record<string, unknown>)[param.name];
      if (value !== undefined && value !== null) {
        process.env[param.envVar] = String(value);
      }
    }
  }
}
