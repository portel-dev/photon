/**
 * Convert camelCase or snake_case identifiers to human-readable labels.
 * Examples:
 *   repoPath       -> "Repo Path"
 *   branchName     -> "Branch Name"
 *   noFastForward  -> "No Fast Forward"
 *   includeUntracked -> "Include Untracked"
 *   cartId         -> "Cart ID"
 *   autoReleaseMinutes -> "Auto Release Minutes"
 *   firstName      -> "First Name"
 *   _use           -> "Use"
 *   taskIds        -> "Task IDs"
 *   boardCreate    -> "Board Create"
 *   commitDiff     -> "Commit Diff"
 *   repoAdd        -> "Repo Add"
 */
export function formatLabel(name: string): string {
  if (!name) return name;

  // Strip leading underscores
  let cleaned = name.replace(/^_+/, '');

  // Insert space before uppercase letters (camelCase splitting)
  // Also handle sequences like "taskIds" -> "task Ids"
  let spaced = cleaned
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Replace underscores and hyphens with spaces
  spaced = spaced.replace(/[_-]+/g, ' ');

  // Capitalize first letter of each word
  let result = spaced
    .split(/\s+/)
    .map((word) => {
      if (!word) return '';
      // Uppercase known acronyms
      const upper = word.toUpperCase();
      if (
        [
          'ID',
          'IDS',
          'URL',
          'API',
          'UI',
          'IP',
          'HTTP',
          'HTTPS',
          'JSON',
          'XML',
          'HTML',
          'CSS',
          'SQL',
          'MCP',
          'SSH',
          'CLI',
        ].includes(upper)
      ) {
        // Special case: "Ids" -> "IDs"
        if (upper === 'IDS') return 'IDs';
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

  return result;
}
