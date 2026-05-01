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
      // Mixed-case brand spellings (return as-is regardless of input case)
      const lower = word.toLowerCase();
      const mixedCase: Record<string, string> = {
        oauth: 'OAuth',
        whatsapp: 'WhatsApp',
        github: 'GitHub',
        gitlab: 'GitLab',
        bitbucket: 'Bitbucket',
        macos: 'macOS',
        ios: 'iOS',
        ipad: 'iPad',
        iphone: 'iPhone',
        npm: 'npm',
        npx: 'npx',
      };
      if (lower in mixedCase) return mixedCase[lower];

      // Uppercase known acronyms
      const upper = word.toUpperCase();
      if (
        [
          'AI',
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
          'MD',
          'PR',
          'CI',
          'CD',
          'ENV',
          'SDK',
          'OS',
          'DB',
          'IO',
          'GIT',
          'CPU',
          'GPU',
          'RAM',
          'RPC',
          'TCP',
          'UDP',
          'DNS',
          'JWT',
          'TLS',
          'SSL',
          'CDN',
          'SVG',
          'PNG',
          'JPG',
          'PDF',
          'YAML',
          'TOML',
          'CSV',
          'TSV',
          'UUID',
          'CRUD',
          'REST',
          'GRPC',
          'MIME',
          'PATH',
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
