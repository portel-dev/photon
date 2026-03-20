/**
 * Discoverable Service
 *
 * Demonstrates Server Cards and A2A Agent Cards.
 * Both card types are auto-generated from the same photon metadata —
 * rich docblocks, @stateful tag, and method descriptions map directly
 * to MCP Server Card tools and A2A Agent Card skills.
 *
 * @version 2.0.0
 * @stateful
 * @label Discovery Demo
 * @icon magnifying-glass
 */

export default class Discoverable {
  private searchIndex: Map<string, string[]> = new Map([
    ['typescript', ['generics', 'decorators', 'type guards', 'mapped types']],
    ['rust', ['ownership', 'lifetimes', 'traits', 'macros']],
    ['python', ['decorators', 'generators', 'context managers', 'metaclasses']],
  ]);

  /**
   * Search the knowledge base for topics
   *
   * Returns matching entries from the indexed knowledge base.
   * Supports partial matching on language names.
   *
   * @param query Search term
   * @readOnly
   */
  async search(params: { query: string }) {
    const query = params.query.toLowerCase();
    const results: Array<{ language: string; topics: string[] }> = [];

    for (const [lang, topics] of this.searchIndex) {
      if (lang.includes(query) || topics.some((t) => t.includes(query))) {
        results.push({ language: lang, topics });
      }
    }

    return { query: params.query, results, total: results.length };
  }

  /**
   * Get detailed information about a specific topic
   *
   * Returns structured data about a programming concept.
   *
   * @param language Programming language
   * @param topic Specific topic to look up
   * @readOnly
   */
  async detail(params: { language: string; topic: string }) {
    const topics = this.searchIndex.get(params.language.toLowerCase());
    if (!topics || !topics.includes(params.topic.toLowerCase())) {
      return { found: false, language: params.language, topic: params.topic };
    }

    return {
      found: true,
      language: params.language,
      topic: params.topic,
      description: `${params.topic} in ${params.language} — a core language feature`,
    };
  }

  /**
   * List all available languages and topic counts
   *
   * Provides a summary of what's in the knowledge base.
   *
   * @readOnly
   */
  async catalog() {
    const entries: Array<{ language: string; topicCount: number }> = [];
    for (const [lang, topics] of this.searchIndex) {
      entries.push({ language: lang, topicCount: topics.length });
    }
    return { languages: entries, total: entries.length };
  }
}
