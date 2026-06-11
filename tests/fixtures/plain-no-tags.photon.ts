/**
 * Test fixture: plain photon without functional tags.
 * Loading it must not attach any middleware declarations.
 */

export default class PlainNoTags {
  /** Say hello */
  async hello(params: { name: string }) {
    return { greeting: `Hello, ${params.name}` };
  }

  /** List items */
  async list() {
    return { items: [] };
  }
}
