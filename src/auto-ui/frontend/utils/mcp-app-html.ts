/**
 * Return an inline script suitable for inserting into an MCP App document.
 *
 * Beam deployments have historically returned the platform bridge both as
 * raw JavaScript and as a `<script>...</script>` document fragment.  MCP App
 * resources need the latter shape; nesting one script tag inside another
 * makes the iframe fail before it paints.
 */
export function normalizeInlineScript(script: string): string {
  const trimmed = script.trim();
  if (/^<script(?:\s[^>]*)?>[\s\S]*<\/script>$/i.test(trimmed)) {
    return trimmed;
  }
  return `<script>\n${trimmed}\n</script>`;
}
