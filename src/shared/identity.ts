/**
 * Photon identity strings — single source of truth.
 *
 * Compound identifiers appear in several wire and registry formats:
 *
 *   composite key   photon | photon:hash8         daemon registries
 *                                                 (built by daemon/registry-keys.ts)
 *   ps target       <compositeKey>:<method>       CLI ps disable/pause
 *   channel         <photon>:<topic>              event broker, Beam subscriptions
 *   circuit key     <photon>:<instance>:<tool>    circuit breaker state
 *   cache key       <path>::<instance>            loader module cache
 *
 * The rule that kills the recurring bug class: method and topic segments
 * are simple names that never contain colons, while the photon part MAY
 * be colon-qualified (instance hash). Therefore method-suffixed ids parse
 * from the LAST colon and channels parse from the FIRST colon. Splitting
 * on the wrong end is exactly how `ps disable photon:hash:method` became
 * a silent no-op.
 *
 * Never hand-roll split(':') on a photon identity — add a helper here.
 */

/* eslint-disable no-restricted-syntax -- this module is the designated owner of identity parsing */

export interface PsTarget {
  photon: string;
  method: string;
}

/**
 * Parse a ps enrollment target `<photon[:hash]>:<method>`.
 * Splits on the LAST colon: method names are JS identifiers (no colons),
 * but the photon id may be instance-qualified (`photon:hash`).
 */
export function parsePsTarget(target: string): PsTarget {
  const idx = target.lastIndexOf(':');
  if (idx <= 0 || idx === target.length - 1) {
    throw new Error(`Expected <photon>:<method>, got "${target}"`);
  }
  return { photon: target.slice(0, idx), method: target.slice(idx + 1) };
}

export interface ChannelId {
  photon: string;
  topic: string;
}

/**
 * Parse a namespaced channel `<photon>:<topic>`. First colon: photon
 * names never contain colons, topics may (`photon:item:123`, `photon:*`).
 * Returns null for unqualified names.
 */
export function parseChannel(channel: string): ChannelId | null {
  const idx = channel.indexOf(':');
  if (idx <= 0 || idx === channel.length - 1) return null;
  return { photon: channel.slice(0, idx), topic: channel.slice(idx + 1) };
}

/** Namespace an unqualified channel with the photon; qualified pass through. */
export function qualifyChannel(photonName: string, channel: string): string {
  return channel.includes(':') ? channel : `${photonName}:${channel}`;
}

/** Circuit-breaker state key for one tool on one instance. */
export function circuitKey(photon: string, instance: string, tool: string): string {
  return `${photon}:${instance}:${tool}`;
}

/** Loader module-cache key; `::` keeps instance names with colons unambiguous. */
export function instanceCacheKey(resolvedPath: string, instanceName?: string): string {
  return instanceName ? `${resolvedPath}::${instanceName}` : resolvedPath;
}

/** Cache key for preloaded (compiled-binary) photon modules. */
export function preloadedCacheKey(name: string, instanceName?: string): string {
  return instanceName ? `preloaded:${name}::${instanceName}` : `preloaded:${name}`;
}
