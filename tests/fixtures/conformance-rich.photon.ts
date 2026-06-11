/**
 * Conformance Rich Formats — fixture for the schema-driven conformance matrix
 *
 * Deterministic methods spanning rich @format values so the generated
 * matrix exercises parity beyond the basic formats in promise-test.
 * Every method here is auto-discovered by tests/conformance/matrix.ts;
 * adding one adds its cross-transport checks with no test edits.
 *
 * @version 1.0.0
 */
export default class ConformanceRich {
  /**
   * Disk usage as a gauge
   * @format gauge
   * @readOnly
   */
  async disk() {
    return { value: 72, min: 0, max: 100, label: 'Disk %' };
  }

  /**
   * Single headline number
   * @format metric
   * @readOnly
   */
  async revenue() {
    return { value: 1234, label: 'Revenue', unit: 'USD' };
  }

  /**
   * Key-value pairs
   * @format kv
   * @readOnly
   */
  async config() {
    return { region: 'eu-west-1', tier: 'pro', replicas: 3 };
  }

  /**
   * Tag chips
   * @format chips
   * @readOnly
   */
  async tags() {
    return ['alpha', 'beta', 'stable'];
  }

  /**
   * Nested tree
   * @format tree
   * @readOnly
   */
  async outline() {
    return {
      name: 'root',
      children: [
        { name: 'docs', children: [{ name: 'intro.md' }] },
        { name: 'src', children: [{ name: 'index.ts' }] },
      ],
    };
  }

  /**
   * Event timeline
   * @format timeline
   * @readOnly
   */
  async history() {
    return [
      { date: '2026-01-01', title: 'Created', description: 'Project created' },
      { date: '2026-02-01', title: 'Shipped', description: 'First release' },
    ];
  }

  /**
   * Echo with constrained input
   * @param count {@min 1} {@max 5} How many times to repeat
   * @readOnly
   */
  async repeat({ count }: { count: number }): Promise<string[]> {
    return Array.from({ length: count }, (_, i) => `item-${i + 1}`);
  }
}
