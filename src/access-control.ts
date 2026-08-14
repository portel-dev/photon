/**
 * Property-based Photon tool exposure.
 *
 * The metadata is deliberately small and transport-neutral.  Both the local
 * runtime and generated Workers use this module's parser/evaluator contract.
 */

export interface AccessCondition {
  property: string;
  value: string;
}

export interface ToolAccessMetadata {
  className: string;
  conditions: AccessCondition[];
}

export interface AccessCaller {
  id?: string;
  anonymous?: boolean;
  /** Server-assigned coarse role, normally sourced from a verified token. */
  role?: string;
  /** Granted OAuth scopes normalized by the transport. */
  scopes?: string[];
  claims?: Record<string, unknown>;
}

export interface AccessRequestContext {
  caller?: AccessCaller;
  request?: unknown;
}

/** Parse `@class Appointments {@role host @plan pro}` from one docblock. */
export function parseAccessMetadata(docblock: string): ToolAccessMetadata | undefined {
  const match = docblock.match(/@class\s+([A-Za-z_$][\w$]*)\s*\{([\s\S]*?)\}/i);
  if (!match) {
    const invalid = docblock.match(/@class\s+([A-Za-z_$][\w$]*)/i);
    return invalid ? { className: invalid[1], conditions: [] } : undefined;
  }

  const conditions: AccessCondition[] = [];
  const body = match[2];
  const conditionRe = /@(\w+)\s+([^\s@}]+)/g;
  let condition: RegExpExecArray | null;
  while ((condition = conditionRe.exec(body)) !== null) {
    const property = condition[1];
    const value = condition[2];
    if (!property || !value) return { className: match[1], conditions: [] };
    conditions.push({ property, value });
  }
  return { className: match[1], conditions };
}

/** Extract method-level access metadata keyed by the actual method name. */
export function extractAccessMetadata(source: string): Record<string, ToolAccessMetadata> {
  const result: Record<string, ToolAccessMetadata> = {};
  const methodRe =
    /\/\*\*([\s\S]*?)\*\/\s*(?:public\s+|protected\s+|private\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = methodRe.exec(source)) !== null) {
    const access = parseAccessMetadata(match[1]);
    if (access) result[match[2]] = access;
  }
  return result;
}

/** Return class names referenced by access metadata, including the current class. */
export function extractAccessClassNames(source: string): string[] {
  const names = new Set<string>();
  for (const access of Object.values(extractAccessMetadata(source))) names.add(access.className);
  const classRe = /(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = classRe.exec(source)) !== null) {
    if (names.has(match[1])) names.add(match[1]);
  }
  return [...names];
}

/** Make referenced local/imported policy bindings observable on the module. */
export function exposeAccessClasses(source: string): string {
  const names = extractAccessClassNames(source);
  const additions = names.filter((name) => {
    if (new RegExp(`export\\s+(?:default\\s+)?class\\s+${name}\\b`).test(source)) return false;
    if (new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source)) return false;
    return new RegExp(`(?:import|class)\\s+(?:[^;\\n]*\\b)?${name}\\b`).test(source);
  });
  return additions.length > 0 ? `${source}\nexport { ${additions.join(', ')} };\n` : source;
}

export function accessMetadataAllows(
  metadata: ToolAccessMetadata | undefined,
  photon: any,
  accessClasses: Record<string, any> | undefined,
  context: AccessRequestContext
): boolean {
  if (!metadata) return true;
  if (metadata.conditions.length === 0) return false;
  const isCurrentPhoton = photon?.constructor?.name === metadata.className;
  const accessClass =
    accessClasses?.[metadata.className] ?? (isCurrentPhoton ? photon?.constructor : undefined);
  if (!accessClass) return false;

  // The proxy makes `this.caller` and `this.request` request-scoped even when
  // the policy is a getter on the Photon instance or an imported class.
  const target = isCurrentPhoton ? photon : new accessClass();
  const scoped = new Proxy(target, {
    get(object, property, receiver) {
      if (property === 'caller') return context.caller ?? { id: 'anonymous', anonymous: true };
      if (property === 'request') return context.request;
      return Reflect.get(object, property, receiver);
    },
  });

  try {
    return metadata.conditions.every(({ property, value }) => {
      const actual = Reflect.get(scoped, property, scoped);
      return actual !== undefined && String(actual) === value;
    });
  } catch {
    return false;
  }
}

export function accessClassMapFromModule(module: Record<string, unknown>): Record<string, any> {
  const classes: Record<string, any> = {};
  for (const [name, value] of Object.entries(module)) {
    if (typeof value === 'function' && /^class\s/.test(Function.prototype.toString.call(value))) {
      classes[name] = value;
    }
  }
  return classes;
}
