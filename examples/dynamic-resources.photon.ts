/**
 * Dynamic Resources
 *
 * Demonstrates method-level `@resource <uri-template>` — the photon
 * exposes URIs the host can read like files. Each tagged method is
 * the resolver for its URI scheme. Templates with `{params}` get
 * matched and bound at request time.
 *
 * Try it from a host that supports MCP resources:
 *   - resources/list           → returns `team://about` (static)
 *   - resources/templates/list → returns `person://{slug}` (template)
 *   - resources/read person://alice → resolves via getPerson({slug:'alice'})
 *
 * @stateful
 */
export default class DynamicResources {
  private people: Record<string, { name: string; role: string }> = {
    alice: { name: 'Alice Chen', role: 'CEO' },
    bob: { name: 'Bob Patel', role: 'CTO' },
  };

  /**
   * Resolve a person record by slug. Hosts that subscribe to this
   * URI template will receive notifications when the underlying state
   * changes (subscriptions land in a follow-up).
   * @resource person://{slug}
   * @mimeType application/json
   * @param slug The person's identifier (e.g., 'alice')
   */
  async getPerson(params: { slug: string }): Promise<string> {
    const record = this.people[params.slug];
    if (!record) return JSON.stringify({ error: `unknown: ${params.slug}` });
    return JSON.stringify(record, null, 2);
  }

  /**
   * Static "about the team" page. Single URI, no parameters.
   * @resource team://about
   * @mimeType text/markdown
   */
  async aboutTeam(_params: Record<string, never>): Promise<string> {
    const lines = [
      '# Team',
      '',
      ...Object.entries(this.people).map(
        ([slug, p]) => `- **${p.name}** (${p.role}) — \`person://${slug}\``
      ),
    ];
    return lines.join('\n');
  }

  /**
   * Add or update a person record. Used to demonstrate that resource
   * URIs can change over time; once subscriptions land, this method
   * will trigger `notifications/resources/updated`.
   * @param slug Slug to assign
   * @param name Full name
   * @param role Role/title
   */
  async upsertPerson(params: { slug: string; name: string; role: string }) {
    this.people[params.slug] = { name: params.name, role: params.role };
    return { ok: true, uri: `person://${params.slug}` };
  }
}
