import type { ApplicationManifest, ApplicationScreen } from '../app-manifest.js';

export interface StandaloneNavigationItem {
  id: string;
  method: string;
  label: string;
  icon?: string;
  isSettings?: boolean;
}

export interface StandaloneToolCatalogEntry {
  name: string;
  description?: string;
  title?: string;
  annotations?: { title?: string };
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

function fallbackLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function standaloneMethodName(name: string): string {
  const slashless = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  return slashless.includes('.') ? slashless.slice(slashless.lastIndexOf('.') + 1) : slashless;
}

function isHostTool(name: string): boolean {
  return (
    name === 'photon_context_get' ||
    name === 'photon_navigate' ||
    name === 'photon_skill_read' ||
    name.startsWith('_')
  );
}

/**
 * Build generated navigation from the authorized MCP catalog.
 *
 * This intentionally does not consult ApplicationManifest. A build-time
 * manifest may contain methods that the current caller cannot see; the
 * returned tools/list catalog is the only source of generated screens.
 */
export function standaloneNavigationItemsFromTools(
  tools: ReadonlyArray<StandaloneToolCatalogEntry>
): StandaloneNavigationItem[] {
  return tools
    .filter((tool) => typeof tool.name === 'string' && !isHostTool(tool.name))
    .map((tool) => {
      const method = standaloneMethodName(tool.name);
      const renderMeta = tool._meta?.['photon/render'] as
        | { buttonLabel?: string; icon?: string }
        | undefined;
      const label =
        [tool.annotations?.title, tool.title, tool['x-button-label'], renderMeta?.buttonLabel].find(
          (candidate): candidate is string => typeof candidate === 'string'
        ) || fallbackLabel(method);
      const icon = [tool['x-icon'], renderMeta?.icon].find(
        (candidate): candidate is string => typeof candidate === 'string'
      );
      return {
        id: method,
        method,
        label: String(label),
        ...(icon ? { icon: String(icon) } : {}),
      };
    });
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
