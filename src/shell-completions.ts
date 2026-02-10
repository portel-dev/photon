/**
 * Shell completion cache generator.
 *
 * Scans installed photons and writes a grep-friendly cache file
 * at ~/.photon/cache/completions.cache. The shell hook reads this
 * file directly (no Node.js spawn) for fast tab completion.
 *
 * Cache format (line-delimited, grep-friendly):
 *   photon:<name>:<description>
 *   method:<photon>:<method>:<description>
 *   param:<photon>:<method>:<name>:<type>:<required>
 *   instance:<photon>:<name>
 *   stateful:<photon>
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export const CACHE_DIR = path.join(os.homedir(), '.photon', 'cache');
export const CACHE_FILE = path.join(CACHE_DIR, 'completions.cache');

/**
 * Extract a brief description from a photon source file.
 * Grabs the first line of the file-level JSDoc comment.
 */
function extractDescription(source: string): string {
  const match = source.match(/\/\*\*\s*\n\s*\*\s*(.+?)\s*\n/);
  if (match) {
    return match[1].replace(/\s*\*\s*/g, ' ').trim();
  }
  return '';
}

/**
 * Check if a photon is marked @stateful.
 */
function isStateful(source: string): boolean {
  return /@stateful/.test(source);
}

/**
 * Generate the completions cache file by scanning all installed photons.
 */
export async function generateCompletionCache(): Promise<string> {
  const { SchemaExtractor } = await import('@portel/photon-core');
  const { InstanceStore } = await import('./context-store.js');

  const photonDir = path.join(os.homedir(), '.photon');
  const instanceStore = new InstanceStore();

  let entries: string[] = [];
  try {
    entries = await fs.readdir(photonDir);
  } catch {
    return '';
  }

  const photonFiles = entries.filter((e) => /\.photon\.(ts|js)$/.test(e));
  const lines: string[] = [
    '# Photon completions cache',
    `# Generated: ${new Date().toISOString()}`,
  ];

  for (const file of photonFiles) {
    const name = file.replace(/\.photon\.(ts|js)$/, '');
    const filePath = path.join(photonDir, file);

    try {
      const source = await fs.readFile(filePath, 'utf-8');
      const description = extractDescription(source);
      const stateful = isStateful(source);

      // Photon entry
      lines.push(`photon:${name}:${description}`);

      if (stateful) {
        lines.push(`stateful:${name}`);

        // Instance entries
        const instances = instanceStore.listInstances(name);
        for (const inst of instances) {
          lines.push(`instance:${name}:${inst}`);
        }
      }

      // Method entries
      const extractor = new SchemaExtractor();
      const metadata = extractor.extractAllFromSource(source);

      for (const tool of metadata.tools) {
        const desc = tool.description !== 'No description' ? tool.description : '';
        lines.push(`method:${name}:${tool.name}:${desc}`);

        // Param entries
        const schema = tool.inputSchema;
        if (schema?.properties) {
          for (const [paramName, prop] of Object.entries(schema.properties) as [string, any][]) {
            const required = schema.required?.includes(paramName) ? '1' : '0';
            const type = prop.type || 'any';
            lines.push(`param:${name}:${tool.name}:${paramName}:${type}:${required}`);
          }
        }
      }
    } catch {
      // Skip photons that fail to parse
      lines.push(`photon:${name}:`);
    }
  }

  const content = lines.join('\n') + '\n';

  // Write cache file
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, content);

  return content;
}
