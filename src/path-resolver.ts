/**
 * Path Resolver for Photon files
 *
 * Re-exports from @portel/photon-core for consolidation.
 * All path resolution utilities are now in the shared core library.
 */

// Re-export everything from photon-core's path-resolver
export {
  resolvePath,
  listFiles,
  ensureDir,
  resolvePhotonPath,
  listPhotonFiles,
  ensurePhotonDir,
  DEFAULT_PHOTON_DIR,
  type ResolverOptions,
} from '@portel/photon-core';

// Backward compatibility aliases
export const DEFAULT_WORKING_DIR = DEFAULT_PHOTON_DIR;
export const ensureWorkingDir = ensurePhotonDir;
export const listPhotonMCPs = listPhotonFiles;

// Need to import for the aliases
import { DEFAULT_PHOTON_DIR, ensurePhotonDir, listPhotonFiles } from '@portel/photon-core';
