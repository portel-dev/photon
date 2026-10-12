import type { AccessCaller, ToolAccessMetadata } from './access-control.js';

export interface AccessPolicyFactory {
  create(className: string, constructor: new (...args: any[]) => any): any;
}

export interface AccessPolicyEvaluationContext {
  caller?: AccessCaller;
  request?: unknown;
}

/** Pure runtime access evaluator with an injectable policy-class factory. */
export function evaluateAccessPolicy(
  metadata: ToolAccessMetadata | undefined,
  photon: any,
  accessClasses: Record<string, any> | undefined,
  context: AccessPolicyEvaluationContext,
  factory: AccessPolicyFactory = defaultAccessPolicyFactory
): boolean {
  if (!metadata) return true;
  if (metadata.conditions.length === 0) return false;
  const isCurrentPhoton = photon?.constructor?.name === metadata.className;
  const constructor =
    accessClasses?.[metadata.className] ?? (isCurrentPhoton ? photon?.constructor : undefined);
  if (!constructor) return false;

  const target = isCurrentPhoton ? photon : factory.create(metadata.className, constructor);
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

export const defaultAccessPolicyFactory: AccessPolicyFactory = {
  create: (_className, constructor) => new constructor(),
};
