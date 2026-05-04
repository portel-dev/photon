/**
 * ResourcesParity - test fixture covering every resource/prompt surface
 * the runtime exposes. Used by tests/transport-parity-resources.test.ts
 * to assert STDIO and streamable-HTTP transports surface the same set.
 *
 * Class-level annotations are intentionally absent here: this fixture
 * exercises the *method-level* canonical forms (`@resource <uri>` and
 * `@prompt`) plus their legacy aliases (`@Static`, `@Template`).
 */
type Template = string & { __brand: 'Template' };
type Static = string & { __brand: 'Static' };
const asTemplate = (s: string): Template => s as Template;
const asStatic = (s: string): Static => s as Static;

export default class ResourcesParity {
  /**
   * Echo a value back.
   * @param value Value to echo
   */
  async echo(params: { value: string }): Promise<string> {
    return `Echo: ${params.value}`;
  }

  /**
   * @resource api://docs
   * Static API documentation (canonical method-level form, exact URI).
   * @mimeType text/markdown
   */
  async apiDocs(_params: Record<string, never>): Promise<Static> {
    return asStatic('# API Docs');
  }

  /**
   * @resource person://{slug}
   * Dynamic resource resolver with a URI template.
   * @param slug Person slug
   */
  async getPerson(params: { slug: string }): Promise<Static> {
    return asStatic(`person:${params.slug}`);
  }

  /**
   * @Static legacy://thing
   * Legacy uppercase form must still resolve via the back-compat alias.
   * @mimeType text/plain
   */
  async legacyStatic(_params: Record<string, never>): Promise<Static> {
    return asStatic('legacy ok');
  }

  /**
   * @prompt
   * Code review prompt template (canonical method-level form).
   * @param language Programming language
   */
  async codeReview(params: { language: string }): Promise<Template> {
    return asTemplate(`Review this ${params.language} code.`);
  }

  /**
   * @Template
   * Legacy uppercase prompt template form.
   * @param subject Subject
   */
  async legacyPrompt(params: { subject: string }): Promise<Template> {
    return asTemplate(`Prompt about ${params.subject}.`);
  }
}
