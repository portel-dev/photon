/**
 * Layout Selector - Auto-detect best layout for data
 *
 * Determines the optimal component/layout to render data based on:
 * 1. Explicit @format annotation (highest priority)
 * 2. Data shape (array vs object vs primitive)
 * 3. Data content (has images -> grid, etc.)
 */

export type LayoutType =
  | 'text' // Simple text/markdown display
  | 'card' // Single object as card with header + fields
  | 'list' // Array of objects as iOS-style list
  | 'grid' // Array of objects as visual grid
  | 'tree' // Nested object as collapsible tree
  | 'kv' // Flat object as key-value table
  | 'chips' // Array of strings as chips/tags
  | 'table' // Legacy: grid table (backward compat)
  | 'markdown' // Legacy: markdown rendering
  | 'mermaid' // Legacy: mermaid diagrams
  | 'code' // Code block with syntax highlighting
  | 'json' // Raw JSON display
  | 'html'; // Raw HTML (for custom UIs)

export interface LayoutHints {
  title?: string; // Field to use as title
  subtitle?: string; // Field to use as subtitle
  icon?: string; // Field to use as icon
  badge?: string; // Field to use as badge
  detail?: string; // Field to use as detail
  image?: string; // Field to use as image (grid)
  style?: string; // List style (plain, grouped, inset, etc.)
  accessory?: string; // Accessory type (chevron, switch, etc.)
  columns?: number; // Grid columns
  fields?: string[]; // Specific fields to show
}

// Map legacy @format values to new layout types
const FORMAT_TO_LAYOUT: Record<string, LayoutType> = {
  table: 'list', // table -> list (smart rendering)
  list: 'list',
  grid: 'grid',
  card: 'card',
  kv: 'kv',
  tree: 'tree',
  json: 'json',
  markdown: 'markdown',
  mermaid: 'mermaid',
  code: 'code',
  text: 'text',
  primitive: 'text',
  chips: 'chips',
  html: 'html',
};

/**
 * Select the best layout type for given data
 */
export function selectLayout(data: any, format?: string, hints?: LayoutHints): LayoutType {
  // 1. Explicit format takes precedence (backward compat)
  if (format) {
    // Handle code:language format
    if (format.startsWith('code:')) return 'code';

    const layout = FORMAT_TO_LAYOUT[format] || 'json';

    // Smart fallback: if list/table format but data is not an array, use card
    if (
      (layout === 'list' || format === 'table') &&
      !Array.isArray(data) &&
      typeof data === 'object' &&
      data !== null
    ) {
      return 'card';
    }

    return layout;
  }

  // 2. Null/undefined
  if (data === null || data === undefined) {
    return 'text';
  }

  // 3. Primitives
  if (typeof data === 'string') {
    // Check if it looks like markdown
    if (hasMarkdownSyntax(data)) return 'markdown';
    // Check if it looks like mermaid
    if (data.trim().startsWith('graph ') || data.trim().startsWith('flowchart ')) {
      return 'mermaid';
    }
    return 'text';
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return 'text';
  }

  // 4. Arrays
  if (Array.isArray(data)) {
    if (data.length === 0) return 'text'; // Empty array

    const first = data[0];

    // Array of strings -> chips
    if (typeof first === 'string') {
      return 'chips';
    }

    // Array of objects
    if (typeof first === 'object' && first !== null) {
      // Check if items have image fields -> grid
      if (hasImageFields(first)) {
        return 'grid';
      }
      // Default: list
      return 'list';
    }

    // Mixed or primitive arrays
    return 'chips';
  }

  // 5. Objects
  if (typeof data === 'object') {
    // Check for special fields
    if ('diagram' in data && typeof data.diagram === 'string') {
      return 'mermaid';
    }

    // Check if deeply nested -> tree
    if (isNested(data)) {
      return 'tree';
    }

    // Flat object -> card (or kv for many fields)
    const fieldCount = Object.keys(data).length;
    if (fieldCount > 10) {
      return 'kv'; // Too many fields for card
    }

    return 'card';
  }

  // Fallback
  return 'json';
}

/**
 * Check if object has fields that look like actual images (not just icon characters)
 * We need to verify the VALUE looks like an image URL, not just the field name
 */
export function hasImageFields(obj: object): boolean {
  const imageFieldNames = /^(image|photo|thumbnail|picture|poster|cover)$/i;
  const avatarFieldName = /^(avatar)$/i;
  const imageUrlPattern = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;
  const dataUrlPattern = /^data:image\//i;

  for (const [key, value] of Object.entries(obj)) {
    // Skip non-string values
    if (typeof value !== 'string') continue;

    // Check for image URL patterns in value
    if (imageUrlPattern.test(value) || dataUrlPattern.test(value)) return true;

    // For image field names (not avatar), check if value looks like a URL
    if (imageFieldNames.test(key) && (value.startsWith('http') || value.startsWith('/'))) {
      return true;
    }

    // For avatar fields specifically, only treat as image if it's actually a URL
    // Single characters or short strings are icons, not images
    if (
      avatarFieldName.test(key) &&
      value.length > 10 &&
      (value.startsWith('http') || value.startsWith('/'))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if object is nested (has object/array values)
 */
export function isNested(obj: object, depth: number = 0): boolean {
  if (depth > 2) return true; // Max depth check

  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      return true;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (isNested(value, depth + 1)) return true;
    }
  }

  return false;
}

/**
 * Check if string contains markdown syntax
 */
export function hasMarkdownSyntax(text: string): boolean {
  // Check for common markdown patterns
  const patterns = [
    /^#{1,6}\s/m, // Headers
    /\*\*[^*]+\*\*/, // Bold
    /\*[^*]+\*/, // Italic
    /\[[^\]]+\]\([^)]+\)/, // Links
    /```[\s\S]*```/, // Code blocks
    /^\s*[-*+]\s/m, // Lists
    /^\s*\d+\.\s/m, // Numbered lists
  ];

  return patterns.some((p) => p.test(text));
}

/**
 * Parse layout hints from nested JSDoc syntax
 * Example: {@title name, @subtitle email, @style inset}
 */
export function parseLayoutHints(hintsString: string): LayoutHints {
  const hints: LayoutHints = {};

  if (!hintsString) return hints;

  // Split by comma and parse each hint
  const parts = hintsString.split(',').map((s) => s.trim());

  for (const part of parts) {
    // Match @key value or @key value:renderer
    const match = part.match(/@(\w+)\s+([^:]+)(?::(\w+))?/);
    if (match) {
      const [, key, value, renderer] = match;
      const cleanValue = value.trim();

      switch (key) {
        case 'title':
          hints.title = cleanValue;
          break;
        case 'subtitle':
          hints.subtitle = cleanValue;
          break;
        case 'icon':
          hints.icon = cleanValue;
          break;
        case 'badge':
          hints.badge = cleanValue;
          break;
        case 'detail':
          hints.detail = cleanValue;
          break;
        case 'image':
          hints.image = cleanValue;
          break;
        case 'style':
          hints.style = cleanValue;
          break;
        case 'accessory':
          hints.accessory = cleanValue;
          break;
        case 'columns':
          hints.columns = parseInt(cleanValue, 10);
          break;
        case 'fields':
          hints.fields = cleanValue.split(/\s+/);
          break;
      }
    }
  }

  return hints;
}

/**
 * Generate JavaScript code for layout selector (to embed in HTML)
 */
export function generateLayoutSelectorJS(): string {
  return `
// Layout Selector - Auto-detect best layout for data
const FORMAT_TO_LAYOUT = {
  'table': 'list',
  'list': 'list',
  'grid': 'grid',
  'card': 'card',
  'kv': 'kv',
  'tree': 'tree',
  'json': 'json',
  'markdown': 'markdown',
  'mermaid': 'mermaid',
  'code': 'code',
  'text': 'text',
  'primitive': 'text',
  'chips': 'chips',
  'html': 'html',
};

function selectLayout(data, format, hints) {
  if (format) {
    if (format.startsWith('code:')) return 'code';
    var layout = FORMAT_TO_LAYOUT[format] || 'json';
    // Smart fallback: if list/table format but data is not an array, use card
    if ((layout === 'list' || format === 'table') && !Array.isArray(data) && typeof data === 'object' && data !== null) {
      return 'card';
    }
    return layout;
  }

  if (data === null || data === undefined) return 'text';

  if (typeof data === 'string') {
    if (hasMarkdownSyntax(data)) return 'markdown';
    if (data.trim().startsWith('graph ') || data.trim().startsWith('flowchart ')) {
      return 'mermaid';
    }
    return 'text';
  }

  if (typeof data === 'number' || typeof data === 'boolean') return 'text';

  if (Array.isArray(data)) {
    if (data.length === 0) return 'text';
    const first = data[0];
    if (typeof first === 'string') return 'chips';
    if (typeof first === 'object' && first !== null) {
      if (hasImageFields(first)) return 'grid';
      return 'list';
    }
    return 'chips';
  }

  if (typeof data === 'object') {
    if ('diagram' in data && typeof data.diagram === 'string') return 'mermaid';
    if (isNested(data)) return 'tree';
    const fieldCount = Object.keys(data).length;
    if (fieldCount > 10) return 'kv';
    return 'card';
  }

  return 'json';
}

function hasImageFields(obj) {
  const imageFieldNames = /^(image|photo|thumbnail|picture|poster|cover)$/i;
  const avatarFieldName = /^(avatar)$/i;
  const imageUrlPattern = /\\.(jpg|jpeg|png|gif|webp|svg)(\\?.*)?$/i;
  const dataUrlPattern = /^data:image\\//i;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'string') continue;
    if (imageUrlPattern.test(value) || dataUrlPattern.test(value)) return true;
    if (imageFieldNames.test(key) && (value.startsWith('http') || value.startsWith('/'))) return true;
    if (avatarFieldName.test(key) && value.length > 10 && (value.startsWith('http') || value.startsWith('/'))) return true;
  }
  return false;
}

function isNested(obj, depth = 0) {
  if (depth > 2) return true;
  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') return true;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (isNested(value, depth + 1)) return true;
    }
  }
  return false;
}

function hasMarkdownSyntax(text) {
  const patterns = [
    /^#{1,6}\\s/m,
    /\\*\\*[^*]+\\*\\*/,
    /\\*[^*]+\\*/,
    /\\[[^\\]]+\\]\\([^)]+\\)/,
    /\`\`\`[\\s\\S]*\`\`\`/,
    /^\\s*[-*+]\\s/m,
    /^\\s*\\d+\\.\\s/m,
  ];
  return patterns.some(p => p.test(text));
}

function parseLayoutHints(hintsString) {
  const hints = {};
  if (!hintsString) return hints;
  const parts = hintsString.split(',').map(s => s.trim());
  for (const part of parts) {
    const match = part.match(/@(\\w+)\\s+([^:]+)(?::(\\w+))?/);
    if (match) {
      const [, key, value, renderer] = match;
      const cleanValue = value.trim();
      switch (key) {
        case 'title': hints.title = cleanValue; break;
        case 'subtitle': hints.subtitle = cleanValue; break;
        case 'icon': hints.icon = cleanValue; break;
        case 'badge': hints.badge = cleanValue; break;
        case 'detail': hints.detail = cleanValue; break;
        case 'image': hints.image = cleanValue; break;
        case 'style': hints.style = cleanValue; break;
        case 'accessory': hints.accessory = cleanValue; break;
        case 'columns': hints.columns = parseInt(cleanValue, 10); break;
        case 'fields': hints.fields = cleanValue.split(/\\s+/); break;
      }
    }
  }
  return hints;
}
`;
}
