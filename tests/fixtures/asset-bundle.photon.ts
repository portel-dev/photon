/**
 * Fixture for the v1.29 `<photon>/assets/` companion-folder convention.
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track E.
 *
 * Layout:
 *   asset-bundle.photon.ts
 *   asset-bundle/
 *     assets/
 *       ui/form.html              ← @ui form ./ui/form.html
 *       dashboard/bundle/index.html ← @ui dashboard ./dashboard/bundle/index.html
 *       dashboard/bundle/chunks/main.js (sibling auto-served, no @ui)
 *       prompts/system.md         (auto-discovered)
 *       resources/config.json     (auto-discovered)
 *
 * The runtime should resolve every declared @ui under <photon>/assets/.
 */
export default class AssetBundle {
  /**
   * @ui form ./ui/form.html
   * @ui dashboard ./dashboard/bundle/index.html
   */
  greet(name: string): string {
    return `hello ${name}`;
  }
}
