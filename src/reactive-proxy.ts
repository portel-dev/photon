export type ReactiveMutation = 'add' | 'replace' | 'remove';
export type ReactiveMutationHandler = (
  path: string,
  value: unknown,
  operation: ReactiveMutation
) => void;

const PHOTON_PROXY = Symbol.for('__is_photon_proxy');

export function makeReactiveProxy(
  value: unknown,
  onMutation: ReactiveMutationHandler,
  currentPath: string
): any {
  if (!value || typeof value !== 'object') return value;
  if ((value as Record<PropertyKey, unknown>)[PHOTON_PROXY]) return value;

  const object = value as Record<PropertyKey, unknown>;
  for (const key of Object.keys(object)) {
    object[key] = makeReactiveProxy(
      object[key],
      onMutation,
      `${currentPath}/${encodeJsonPointerSegment(key)}`
    );
  }

  return new Proxy(object, {
    get(target, property, receiver) {
      if (property === PHOTON_PROXY) return true;
      return Reflect.get(target, property, receiver);
    },
    set(target, property, nextValue, receiver) {
      if (typeof property === 'symbol') return Reflect.set(target, property, nextValue, receiver);
      if (Array.isArray(target) && property === 'length') {
        return Reflect.set(target, property, nextValue, receiver);
      }
      const isNew = !(property in target);
      const propertyPath = `${currentPath}/${encodeJsonPointerSegment(property)}`;
      const reactiveValue = makeReactiveProxy(nextValue, onMutation, propertyPath);
      const result = Reflect.set(target, property, reactiveValue, receiver);
      onMutation(propertyPath, nextValue, isNew ? 'add' : 'replace');
      return result;
    },
    deleteProperty(target, property) {
      if (typeof property === 'symbol') return Reflect.deleteProperty(target, property);
      const propertyPath = `${currentPath}/${encodeJsonPointerSegment(property)}`;
      const result = Reflect.deleteProperty(target, property);
      onMutation(propertyPath, undefined, 'remove');
      return result;
    },
  });
}

function encodeJsonPointerSegment(value: string | number): string {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}
