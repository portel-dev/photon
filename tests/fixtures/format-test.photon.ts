/**
 * Format Test Photon - exercises every @format type
 * @version 1.0.0
 */
export default class FormatTest {
  /** @format table */
  async table() {
    return [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
  }

  /** @format markdown */
  async markdown() {
    return '# Hello\n\n- Item one\n- Item two';
  }

  /** @format card */
  async card() {
    return { title: 'Test Card', value: 42, status: 'active' };
  }

  /** @format kv */
  async kv() {
    return { key1: 'value1', key2: 'value2' };
  }

  /** @format json */
  async json() {
    return { nested: { data: [1, 2, 3] } };
  }

  /** @format primitive */
  async primitive() {
    return 42;
  }

  /** @format list */
  async list() {
    return ['alpha', 'beta', 'gamma'];
  }

  /** @format tree */
  async tree() {
    return { root: { child1: { leaf: 'value' }, child2: 'direct' } };
  }

  /** @format heatmap (unknown - should fallback gracefully) */
  async unknown() {
    return [{ x: 1, y: 2, value: 10 }];
  }
}
