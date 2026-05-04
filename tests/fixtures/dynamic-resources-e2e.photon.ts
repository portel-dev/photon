/**
 * E2E test fixture for streamable-HTTP subscribe/notify.
 *
 * Mirrors `examples/dynamic-resources.photon.ts` but without `@stateful`
 * so the SSE transport stays in single-instance mode (no daemon) — the
 * daemon path adds complexity that's tested separately and would
 * obscure failures here.
 */
export default class DynamicResourcesE2E {
  private people: Record<string, { name: string; role: string }> = {
    alice: { name: 'Alice', role: 'CEO' },
  };

  /**
   * @resource person://{slug}
   * @mimeType application/json
   * @param slug Person slug
   */
  async getPerson(params: { slug: string }): Promise<string> {
    const r = this.people[params.slug];
    return JSON.stringify(r ?? { error: 'unknown' });
  }

  /**
   * Add or update a person record and notify subscribers.
   * @param slug Slug
   * @param name Name
   * @param role Role
   */
  async upsertPerson(params: { slug: string; name: string; role: string }) {
    this.people[params.slug] = { name: params.name, role: params.role };
    const uri = `person://${params.slug}`;
    (this as { notifyResourceUpdated?: (uri: string) => void }).notifyResourceUpdated?.(uri);
    return { ok: true, uri };
  }
}
