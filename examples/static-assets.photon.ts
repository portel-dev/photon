/**
 * Static Assets
 *
 * Demonstrates *class-level* `@resource <id> <path>` and
 * `@prompt <id> <path>` — the photon ships bundled files (markdown,
 * JSON, etc.) as MCP resources that the host can list and read.
 *
 * Disambiguation from method-level `@resource <uri-template>`:
 * the second argument here is a path (starts with `./` or `/`),
 * not a URI. The class-level extractor only matches the path form.
 *
 * URIs surfaced to the host:
 *   - photon://static-assets/prompts/system    (text/markdown)
 *   - photon://static-assets/resources/config  (application/json)
 *
 * @prompt system ./static-assets/prompts/system.md
 * @resource config ./static-assets/resources/config.json
 */
export default class StaticAssets {
  /**
   * No-op tool — the photon's value lives in its bundled assets.
   * Hosts call `resources/list` and `resources/read` to use them.
   */
  async ping(_params: Record<string, never>): Promise<string> {
    return 'pong';
  }
}
