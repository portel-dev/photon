import type { CapabilityContractV1 } from '../capability-contract.js';

export interface ApplicationScreen {
  id: string;
  method: string;
  label?: string;
  icon?: string;
  route?: string;
}

export interface ApplicationManifest {
  version: 1;
  name?: string;
  entry?: string;
  screens: ApplicationScreen[];
  settings?: string;
}

export interface ApplicationManifestMethod {
  name: string;
  label?: string;
  icon?: string;
  linkedUi?: string;
  title?: string;
  buttonLabel?: string;
  description?: string;
  internal?: boolean;
  isTemplate?: boolean;
  scheduled?: string;
  webhook?: string | boolean;
  visibility?: Array<'model' | 'app'>;
}

export interface ApplicationManifestOptions {
  entry?: string;
  settings?: boolean;
  name?: string;
  /** Derive navigable screens from ordinary methods when no @ui screen exists. */
  autoScreens?: boolean;
  /**
   * Methods that the current host may invoke through the existing MCP surface.
   * When supplied, automatic screens are limited to this set. Explicit @ui
   * screens remain unchanged and continue through their existing host path.
   */
  browserInvocableMethods?: ReadonlySet<string>;
}

const LIFECYCLE_METHODS = new Set(['onInitialize', 'onShutdown', 'constructor']);
const NON_SCREEN_METHODS = new Set(['_use', '_instances', 'settings']);

function isGeneratedScreenMethod(
  method: ApplicationManifestMethod,
  browserInvocableMethods?: ReadonlySet<string>
): boolean {
  if (LIFECYCLE_METHODS.has(method.name) || NON_SCREEN_METHODS.has(method.name)) return false;
  if (method.internal || method.isTemplate || method.scheduled || method.webhook) return false;
  if (method.description && /@internal\b/i.test(method.description)) return false;
  if (method.visibility && !method.visibility.includes('app')) return false;
  if (browserInvocableMethods && !browserInvocableMethods.has(method.name)) return false;
  return true;
}

/** Return the methods the existing MCP host can invoke for a capability set. */
export function browserInvocableMethodNames(
  contracts: ReadonlyArray<Pick<CapabilityContractV1, 'name' | 'exposure'>>
): ReadonlySet<string> {
  return new Set(
    contracts.filter((contract) => contract.exposure.has('mcp')).map((contract) => contract.name)
  );
}

function generatedScreenLabel(method: ApplicationManifestMethod): string {
  return (
    method.title ||
    method.label ||
    method.buttonLabel ||
    method.name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

/**
 * Build the application composition contract consumed by the existing PWA.
 * Business methods remain the source of truth; this only describes navigation.
 *
 * This is derived from the existing @ui-linked methods, main() convention,
 * and protected settings schema; it introduces no new user-facing tags.
 */
export function extractApplicationManifest(
  methods: ApplicationManifestMethod[],
  options?: ApplicationManifestOptions
): ApplicationManifest | undefined {
  const linkedMethods = methods.filter((method) => !!method.linkedUi);
  const screens: ApplicationScreen[] = [];
  const seenUi = new Set<string>();
  for (const method of linkedMethods) {
    const id = method.linkedUi!;
    if (seenUi.has(id)) continue;
    seenUi.add(id);
    screens.push({
      id,
      method: method.name,
      ...(method.label ? { label: method.label } : {}),
      ...(method.icon ? { icon: method.icon } : {}),
      route: id,
    });
  }

  const entry = options?.entry || methods.find((method) => method.name === 'main')?.name;

  if (options?.autoScreens && screens.length === 0) {
    const generatedMethods = methods.filter((method) =>
      isGeneratedScreenMethod(method, options.browserInvocableMethods)
    );
    const entryMethod = entry
      ? methods.find(
          (method) =>
            method.name === entry &&
            isGeneratedScreenMethod(method, options.browserInvocableMethods)
        )
      : undefined;

    if (entryMethod) {
      screens.push({
        id: 'home',
        method: entryMethod.name,
        label: generatedScreenLabel(entryMethod),
        ...(entryMethod.icon ? { icon: entryMethod.icon } : {}),
        route: entryMethod.name,
      });
    }

    for (const method of generatedMethods) {
      if (method.name === entryMethod?.name) continue;
      screens.push({
        id: method.name,
        method: method.name,
        label: generatedScreenLabel(method),
        ...(method.icon ? { icon: method.icon } : {}),
        route: method.name,
      });
    }
  }

  if (screens.length === 0 && !entry && !options?.settings) return undefined;

  if (screens.length === 0 && entry) {
    const method = methods.find((candidate) => candidate.name === entry);
    screens.push({
      id: 'home',
      method: entry,
      ...(method?.label ? { label: method.label } : {}),
      ...(method?.icon ? { icon: method.icon } : {}),
      ...(method?.linkedUi ? { route: method.linkedUi } : {}),
    });
  }

  return {
    version: 1,
    ...(options?.name ? { name: options.name } : {}),
    ...(entry ? { entry } : {}),
    screens,
    ...(options?.settings ? { settings: 'settings' } : {}),
  };
}
