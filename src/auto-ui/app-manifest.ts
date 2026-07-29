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

/**
 * Build the application composition contract consumed by the existing PWA.
 * Business methods remain the source of truth; this only describes navigation.
 *
 * This is derived from the existing @ui-linked methods, main() convention,
 * and protected settings schema; it introduces no new user-facing tags.
 */
export function extractApplicationManifest(
  methods: Array<{ name: string; label?: string; icon?: string; linkedUi?: string }>,
  options?: { entry?: string; settings?: boolean; name?: string }
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
