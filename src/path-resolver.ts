/**
 * Path Resolver for Photon MCPs
 *
 * Re-exports from @portel/photon-core for backward compatibility.
 * All path resolution logic is now in the core package.
 */

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
export { DEFAULT_PHOTON_DIR as DEFAULT_WORKING_DIR } from '@portel/photon-core';
export { listPhotonFiles as listPhotonMCPs } from '@portel/photon-core';
export { ensurePhotonDir as ensureWorkingDir } from '@portel/photon-core';
