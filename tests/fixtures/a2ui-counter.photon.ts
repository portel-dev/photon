/**
 * A2UI Round-Trip Counter — proves the action-back convention.
 *
 * The view() method returns an A2UI Card with two buttons whose names match
 * other methods on this same photon. When a Beam user clicks "Increment",
 * the renderer dispatches a2ui:action → result-viewer calls
 * `a2ui-counter/increment` → the new state is rendered in place.
 *
 * Persists via this.memory so state survives across calls regardless of
 * whether the daemon kept the instance warm.
 *
 * @stateful
 * @version 1.0.0
 */
export default class A2UICounter {
  /** @format a2ui */
  async view() {
    return this.surface(await this.read());
  }

  /** @format a2ui */
  async increment() {
    const next = (await this.read()) + 1;
    await this.memory.set('value', next);
    return this.surface(next);
  }

  /** @format a2ui */
  async decrement() {
    const next = (await this.read()) - 1;
    await this.memory.set('value', next);
    return this.surface(next);
  }

  /** @format a2ui */
  async reset() {
    await this.memory.set('value', 0);
    return this.surface(0);
  }

  private async read(): Promise<number> {
    const v = await this.memory.get<number>('value');
    return typeof v === 'number' ? v : 0;
  }

  private surface(value: number) {
    return {
      __a2ui: true as const,
      components: [
        { id: 'root', component: 'Card', child: 'col' },
        { id: 'col', component: 'Column', children: ['title', 'value', 'row'] },
        { id: 'title', component: 'Text', text: 'Counter', variant: 'h2' as const },
        {
          id: 'value',
          component: 'Text',
          text: { call: 'formatString', args: { value: 'Value: ${/value}' } },
          variant: 'h1' as const,
        },
        { id: 'row', component: 'Row', children: ['dec', 'inc', 'reset'] },
        {
          id: 'dec',
          component: 'Button',
          text: 'Decrement',
          variant: 'borderless' as const,
          action: { event: { name: 'decrement' } },
        },
        {
          id: 'inc',
          component: 'Button',
          text: 'Increment',
          variant: 'primary' as const,
          action: { event: { name: 'increment' } },
        },
        {
          id: 'reset',
          component: 'Button',
          text: 'Reset',
          variant: 'borderless' as const,
          action: { event: { name: 'reset' } },
        },
      ],
      data: { value },
    };
  }

  declare memory: {
    get<T>(key: string, scope?: string): Promise<T | null>;
    set<T>(key: string, value: T, scope?: string): Promise<void>;
  };
}
