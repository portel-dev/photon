import type { ApplicationManifest, ApplicationScreen } from '../app-manifest.js';

export interface StandaloneNavigationItem {
  id: string;
  method: string;
  label: string;
  icon?: string;
  isSettings?: boolean;
}

function fallbackLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function standaloneScreenLabel(screen: ApplicationScreen): string {
  return screen.label || fallbackLabel(screen.id || screen.method);
}

/**
 * Apply the browser's already-authorized MCP catalog to a manifest. The shell
 * never turns a manifest entry into a new HTTP route; a screen must also be
 * present in tools/list for this browser session before it is rendered.
 */
export function filterStandaloneManifest(
  manifest: ApplicationManifest | undefined,
  browserMethods: ReadonlySet<string>
): ApplicationManifest | undefined {
  if (!manifest) return undefined;
  return {
    ...manifest,
    screens: manifest.screens.filter((screen) => browserMethods.has(screen.method)),
    ...(manifest.settings && browserMethods.has(manifest.settings)
      ? { settings: manifest.settings }
      : { settings: undefined }),
  };
}

export function standaloneNavigationItems(
  manifest: ApplicationManifest | undefined
): StandaloneNavigationItem[] {
  if (!manifest) return [];
  const items: StandaloneNavigationItem[] = manifest.screens.map((screen) => ({
    id: screen.id,
    method: screen.method,
    label: standaloneScreenLabel(screen),
    ...(screen.icon ? { icon: screen.icon } : {}),
  }));
  if (manifest.settings && !items.some((item) => item.id === manifest.settings)) {
    items.push({
      id: manifest.settings,
      method: manifest.settings,
      label: 'Settings',
      isSettings: true,
    });
  }
  return items;
}

export function standaloneScreenHref(screenId: string): string {
  return `?screen=${encodeURIComponent(screenId)}`;
}

export function initialStandaloneScreen(
  manifest: ApplicationManifest | undefined,
  requestedScreen?: string | null
): string | undefined {
  const items = standaloneNavigationItems(manifest);
  if (requestedScreen && items.some((item) => item.id === requestedScreen)) {
    return requestedScreen;
  }
  if (manifest?.entry) {
    const entry = items.find((item) => item.method === manifest.entry);
    if (entry) return entry.id;
  }
  return items[0]?.id;
}
