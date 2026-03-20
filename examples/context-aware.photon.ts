/**
 * Context-Aware Photon
 *
 * Demonstrates bidirectional state exposure where frontend
 * widget state flows into photon methods via this._clientState.
 *
 * @version 1.0.0
 * @runtime ^1.9.0
 */

export default class ContextAware {
  /**
   * Suggest items based on frontend widget state
   *
   * The bridge auto-injects widgetState as _clientState in tool args.
   * The loader extracts it onto this._clientState before method execution.
   *
   * @param query Search query from the user
   */
  async suggest(params: { query: string }) {
    const state = (this as any)._clientState;

    if (state?.selectedItems?.length > 0) {
      return {
        query: params.query,
        contextual: true,
        suggestions: state.selectedItems.map((item: string) => ({
          item,
          relevance: `Related to "${params.query}"`,
        })),
        viewMode: state.viewMode || 'list',
      };
    }

    return {
      query: params.query,
      contextual: false,
      suggestions: [
        { item: 'default-1', relevance: 'General result' },
        { item: 'default-2', relevance: 'General result' },
      ],
    };
  }

  /**
   * Return the full client state for debugging
   *
   * Useful for verifying what the frontend is sending.
   */
  async context() {
    const state = (this as any)._clientState;
    return {
      hasClientState: state != null,
      clientState: state || null,
      timestamp: new Date().toISOString(),
    };
  }
}
