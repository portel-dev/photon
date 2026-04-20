/**
 * Peer-photon session resolution for the daemon's dispatch path.
 *
 * When kith-sync (in `/workspace/kith/`) invokes `this.call('lookout.x')`
 * and lookout is installed globally under `~/.photon` (not in kith),
 * the composite key for (lookout, kith) misses — lookout's session lives
 * under (lookout, global). This helper centralizes the "caller's
 * marketplace first, then global" walk so cross-marketplace peer calls
 * work the same way the outer CLI's name resolution does.
 */

import { compositeKey, type PhotonCompositeKey } from './registry-keys.js';

/**
 * Find an existing entry in a photon-scoped map, walking:
 *   1. caller's marketplace (`workingDir` as supplied)
 *   2. global / default base (`workingDir` undefined → `defaultBase`)
 *
 * Returns the resolved key alongside the value so callers can decide
 * whether to mirror it into a local-key entry for deduplication.
 *
 * Pure: no side effects, no module-global state. Takes the map read
 * method as a callback so `sessionManagers`, `photonPaths`, or any
 * PhotonCompositeKey-keyed structure can reuse the walk.
 */
export function resolveWithGlobalFallback<V>(
  photonName: string,
  workingDir: string | undefined,
  defaultBase: string,
  get: (key: PhotonCompositeKey) => V | undefined
): { key: PhotonCompositeKey; value: V } | null {
  const localKey = compositeKey(photonName, workingDir, defaultBase);
  const local = get(localKey);
  if (local !== undefined) {
    return { key: localKey, value: local };
  }
  if (workingDir) {
    const globalKey = compositeKey(photonName, undefined, defaultBase);
    if (globalKey !== localKey) {
      const global = get(globalKey);
      if (global !== undefined) {
        return { key: globalKey, value: global };
      }
    }
  }
  return null;
}
