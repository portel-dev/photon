/**
 * Pure dependency declaration parsing for Photon source files.
 *
 * Kept independent of compilation, filesystem, and installation so callers can
 * substitute or test dependency policy without constructing a PhotonLoader.
 */
export interface DependencySpec {
  name: string;
  version: string;
  optional?: boolean;
}

export interface DependencySpecParser {
  parse(source: string): DependencySpec[];
  merge(existing: DependencySpec[], additional: DependencySpec[]): DependencySpec[];
}

export class SourceDependencySpecParser implements DependencySpecParser {
  parse(source: string): DependencySpec[] {
    const deps: DependencySpec[] = [];
    const jsdocBlocks = source.match(/\/\*\*[\s\S]*?\*\//g) || [];
    const jsdocText = jsdocBlocks.join('\n');
    const regex = /@dependencies\s+([^\r\n]+)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(jsdocText)) !== null) {
      const entries = match[1]
        .replace(/\*\/$/, '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const entry of entries) {
        const atIndex = entry.lastIndexOf('@');
        const name = atIndex <= 0 ? entry : entry.slice(0, atIndex).trim();
        let version = atIndex <= 0 ? '*' : entry.slice(atIndex + 1).trim();
        if (name.includes(' ') || !/^(@[a-z0-9-]+\/)?[a-z0-9._-]+$/.test(name)) continue;
        const optional = version.endsWith('?');
        if (optional) version = version.slice(0, -1);
        if (name && version) deps.push({ name, version, ...(optional && { optional: true }) });
      }
    }
    return deps;
  }

  merge(existing: DependencySpec[], additional: DependencySpec[]): DependencySpec[] {
    const merged = new Map<string, DependencySpec>();
    for (const dependency of existing) merged.set(dependency.name, dependency);
    for (const dependency of additional) merged.set(dependency.name, dependency);
    return [...merged.values()];
  }
}

export const defaultDependencySpecParser = new SourceDependencySpecParser();
