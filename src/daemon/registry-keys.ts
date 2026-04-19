/**
 * Composite-key helpers for daemon registries.
 *
 * Every daemon-side map keyed on "a photon" in a multi-PHOTON_DIR world needs
 * to be keyed on (photon, base) instead — otherwise two workspaces hosting
 * photons with the same name clobber each other. The schedule regression
 * cascade that came out of the v1.22.1→main post-release review traced
 * directly to photon-name-only keys in scattered Map<string, ...>s. This
 * module centralizes every key producer the daemon uses so call sites can't
 * drift apart.
 *
 * Keep this module pure (no daemon side-effects, no cross-module state).
 * It's safe to import from tests without starting the daemon.
 */

import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Branded key types. `ScopedKey<'...'>` is structurally a string, but
 * TypeScript refuses to assign a plain `string` to it. That means any
 * `Map<ScopedKey<'schedule'>, V>` can ONLY be indexed by the result of
 * `declaredKey(...)`. Bare-string lookups — the cause of the whole
 * multi-base cascade — stop compiling.
 *
 * The brand is erased at runtime; this is purely a compile-time guardrail.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __brand: unique symbol;
export type ScopedKey<Tag extends string> = string & { readonly [__brand]: Tag };

export type ScheduleKey = ScopedKey<'schedule'>;
export type WebhookRouteKey = ScopedKey<'webhook'>;
export type LocationKey = ScopedKey<'location'>;
export type PhotonCompositeKey = ScopedKey<'photon'>;

/**
 * Composite cache/session key: `<photon>` for the default base, else
 * `<photon>:<hash8>` where hash8 is sha256(baseDir) truncated. Preserves
 * legacy behavior when the workingDir matches the supplied default base,
 * so single-base deployments keep their existing key shape.
 */
export function compositeKey(
  photonName: string,
  workingDir: string | undefined,
  defaultBase: string
): PhotonCompositeKey {
  if (!workingDir || workingDir === defaultBase) return photonName as PhotonCompositeKey;
  const dirHash = crypto.createHash('sha256').update(workingDir).digest('hex').slice(0, 8);
  return `${photonName}:${dirHash}` as PhotonCompositeKey;
}

/**
 * Identity key for declared schedules / scheduled-job timers:
 * `<resolved-base>::<photon>:<method>`. `<resolved-base>` is the absolute
 * path of the owning PHOTON_DIR, `-` when no base is available (legacy
 * callers predating multi-base).
 *
 * Unlike compositeKey, this ALWAYS includes the base segment. The
 * scheduled-job maps use the base segment as discriminator so same-named
 * photon methods in different bases don't collide.
 */
export function declaredKey(photon: string, method: string, workingDir?: string): ScheduleKey {
  const base = workingDir ? path.resolve(workingDir) : '-';
  return `${base}::${photon}:${method}` as ScheduleKey;
}

/**
 * Identity key for the webhookRoutes map: `<resolved-base>::<photon>`.
 * Webhook lookups from the HTTP handler pass only a photon name (they don't
 * know the base), so callers that need cross-base search use
 * `findMatching(map, photon)` over the values instead of a direct .get().
 */
export function webhookKey(photon: string, workingDir?: string): WebhookRouteKey {
  const base = workingDir ? path.resolve(workingDir) : '-';
  return `${base}::${photon}` as WebhookRouteKey;
}

/**
 * Identity key for proactivePhotonLocations — same shape as webhookKey,
 * intentionally kept separate because the two maps hold different value
 * types and could drift in the future.
 */
export function locationKey(photon: string, workingDir?: string): LocationKey {
  const base = workingDir ? path.resolve(workingDir) : '-';
  return `${base}::${photon}` as LocationKey;
}

/**
 * Narrow signature for entries that carry a `photon` field — every value
 * stored in a base-scoped map must expose it so cross-base search works.
 */
export interface PhotonScoped {
  photon: string;
  workingDir?: string;
}

/**
 * Iterate a base-scoped map and return every entry whose photon matches.
 * Used by callers that only have a photon name in scope (HTTP webhook
 * handler, IPC clients that don't pre-know the base).
 */
export function findByPhoton<V extends PhotonScoped>(
  map: Map<ScopedKey<string>, V> | Map<string, V>,
  photon: string
): V[] {
  const out: V[] = [];
  for (const entry of map.values()) {
    if (entry.photon === photon) out.push(entry);
  }
  return out;
}
