/**
 * Remove Photon/JSDoc control tags from the human-facing MCP description.
 * The structured annotations are emitted separately in tools/list; exposing
 * the source tags in the prose makes clients display implementation details
 * and can confuse intent parsers.
 */
export function cleanMcpToolDescription(description: string | undefined): string {
  if (!description) return '';

  const controlTag =
    /\s+@(class|auth|access|role|readOnly|destructive|idempotent|openWorld|closedWorld|audience|ui|internal|format|title|scope|deprecated|surface|expose|internal)\b.*$/g;

  return description
    .split('\n')
    .filter((line) => !line.trim().startsWith('@'))
    .join('\n')
    .replace(controlTag, '')
    .trim();
}
