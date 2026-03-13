import { createRequire } from 'module';

let pkg: { version: string; dependencies?: Record<string, string> };
try {
  const require = createRequire(import.meta.url);
  pkg = require('../package.json');
} catch {
  // Compiled binary — package.json not on disk; use build-time constant
  pkg = { version: '0.0.0-compiled' };
}

export const PHOTON_VERSION: string = pkg.version;
export const PHOTON_CORE_VERSION: string =
  pkg.dependencies?.['@portel/photon-core'] || `^${pkg.version}`;

/**
 * Get the actual installed version of @portel/photon-core
 * Unlike PHOTON_CORE_VERSION which is a semver range (e.g., "^2.5.0"),
 * this returns the resolved version (e.g., "2.5.4").
 * Used for cache invalidation — detects npm link changes that don't alter the range.
 */
export function getResolvedPhotonCoreVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const corePkg = require('@portel/photon-core/package.json');
    return corePkg.version;
  } catch {
    return PHOTON_CORE_VERSION; // Fallback to range
  }
}
