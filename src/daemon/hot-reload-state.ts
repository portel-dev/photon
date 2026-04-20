/**
 * Hot-reload state transfer helpers.
 *
 * Copying user-defined state from the old photon instance to the freshly
 * loaded one, while letting the loader's fresh values win for fields it
 * owns. Broken out into its own module so tests can import it without
 * booting the daemon entrypoint.
 */

/**
 * Loader-injected fields that must NOT be copied from the old instance
 * to the new instance during hot-reload. The fresh instance already
 * carries the latest schema and backing for these fields (reloaded from
 * source + disk); overwriting with stale values keeps the daemon serving
 * the pre-reload settings shape until a full restart.
 *
 * Function fields are filtered out by the `typeof value !== 'function'`
 * check in the copy loop, so we only list non-function injected fields.
 */
export const LOADER_INJECTED_SKIP = new Set<string>([
  '_settingsBacking',
  '_settingsPhotonName',
  '_settingsInstanceName',
  '_settingsSchema',
]);

/**
 * Copy user-defined state from `oldInstance` to `newInstance`. Skips
 * functions (re-wired by the loader), the constructor marker, and
 * loader-injected settings fields (fresh-instance values win). Swallows
 * per-field write errors so read-only proxies don't abort the transfer.
 */
export function transferHotReloadState(
  oldInstance: Record<string, unknown>,
  newInstance: Record<string, unknown>
): void {
  for (const key of Object.keys(oldInstance)) {
    if (LOADER_INJECTED_SKIP.has(key)) continue;
    if (key === 'constructor') continue;
    const value = oldInstance[key];
    if (typeof value === 'function') continue;
    try {
      newInstance[key] = value;
    } catch {
      // Read-only fields (e.g. settings proxy) — skip silently.
    }
  }
}
