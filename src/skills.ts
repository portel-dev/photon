import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PhotonSkillDescriptor {
  name: string;
  description: string;
  path: string;
}

/** Extract lightweight skill descriptors from a class-level JSDoc block. */
export function extractSkillDeclarations(source: string): PhotonSkillDescriptor[] {
  const results: PhotonSkillDescriptor[] = [];
  const re = /@skill\s+([^\s]+)\s+([^\s*]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    results.push({ name: match[1], description: '', path: match[2] });
  }
  return results;
}

const MAX_SKILL_BYTES = 256 * 1024;

export function parseSkillFile(filePath: string): PhotonSkillDescriptor & { body: string } {
  const absolute = path.resolve(filePath);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > MAX_SKILL_BYTES)
    throw new Error('Invalid or oversized skill file');
  const raw = fs.readFileSync(absolute, 'utf8');
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  const frontmatter = match?.[1] || '';
  const body = match?.[2] || raw;
  const name =
    frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || path.basename(path.dirname(absolute));
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || '';
  return { name, description, path: absolute, body };
}

export function readSkillWithin(
  rootDir: string,
  relativePath: string
): PhotonSkillDescriptor & { body: string } {
  const root = fs.realpathSync(rootDir);
  const resolved = path.resolve(root, relativePath);
  const real = fs.realpathSync(resolved);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
    throw new Error('Skill path escapes the Photon source tree');
  }
  return parseSkillFile(real);
}

export { MAX_SKILL_BYTES };
