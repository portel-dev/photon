/**
 * Test fixture for custom middleware via @use tag
 *
 * NOTE: We define middleware as plain objects (matching MiddlewareDefinition shape)
 * instead of using defineMiddleware() since the cached npm @portel/photon-core
 * may not have the export yet during development. The loader accepts both.
 */

// Custom middleware definitions exported for loader discovery
export const middleware = [
  {
    name: 'audit',
    phase: 5, // outermost
    create(config: Record<string, any>, state: any) {
      return async (ctx: any, next: () => Promise<any>) => {
        const calls = state.get('calls') || [];
        calls.push(`${ctx.tool}:${config.level || 'info'}`);
        state.set('calls', calls);
        const result = await next();
        return { ...result, _auditLevel: config.level || 'info' };
      };
    },
  },
  {
    name: 'transform',
    phase: 75, // between timeout and retryable
    create(config: Record<string, any>) {
      return async (_ctx: any, next: () => Promise<any>) => {
        const result = await next();
        if (config.uppercase && typeof result === 'string') {
          return result.toUpperCase();
        }
        return result;
      };
    },
  },
];

export default class CustomMiddlewareTest {
  private counter = 0;

  /**
   * Method with custom audit middleware
   * @use audit {@level debug}
   */
  async audited(params: { value: string }) {
    return { value: params.value };
  }

  /**
   * Method with custom + built-in middleware
   * @use audit {@level warn}
   * @cached 10s
   */
  async cachedAudited() {
    this.counter++;
    return { count: this.counter };
  }

  /**
   * Reset counter for testing
   */
  async resetCounter() {
    this.counter = 0;
    return { ok: true };
  }

  /**
   * Method with multiple custom middleware
   * @use audit {@level info}
   * @timeout 5s
   */
  async multiMiddleware() {
    return { ok: true };
  }
}
