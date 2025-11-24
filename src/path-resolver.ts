import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ResolverOptions {
  dir?: string;
}

export const DEFAULT_PHOTON_DIR = path.join(os.homedir(), '.photon');
export const DEFAULT_WORKING_DIR = DEFAULT_PHOTON_DIR;

export async function resolvePath(relativePath: string, options?: ResolverOptions): Promise<string> {
  const base = options?.dir || process.cwd();
  return path.resolve(base, relativePath);
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries;
  } catch {
    return [];
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensurePhotonDir(dir: string = DEFAULT_PHOTON_DIR): Promise<void> {
  await ensureDir(dir);
}

export async function ensureWorkingDir(dir: string = DEFAULT_WORKING_DIR): Promise<void> {
  await ensurePhotonDir(dir);
}

export async function listPhotonFiles(dir: string = DEFAULT_PHOTON_DIR): Promise<string[]> {
  const files = await listFiles(dir);
  return files
    .filter(name => name.endsWith('.photon.ts'))
    .map(name => name.replace(/\.photon\.ts$/, ''));
}

export async function listPhotonMCPs(dir: string = DEFAULT_PHOTON_DIR): Promise<string[]> {
  return listPhotonFiles(dir);
}

export async function resolvePhotonPath(name: string, dir: string = DEFAULT_PHOTON_DIR): Promise<string | null> {
  const candidate = path.join(dir, `${name}.photon.ts`);
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}
