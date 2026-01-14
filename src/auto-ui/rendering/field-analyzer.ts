/**
 * Field Analyzer - Smart detection of field semantics
 *
 * Analyzes object fields to determine their semantic meaning
 * for automatic UI rendering (iOS/React Admin inspired).
 */

export interface FieldMapping {
  title?: string;       // Primary display field (name, title, label)
  subtitle?: string;    // Secondary text field (description, email)
  icon?: string;        // Leading visual field (icon, avatar, image)
  badge?: string;       // Status badge field (status, state, type)
  detail?: string;      // Trailing detail field (count, value, role)
  link?: string;        // Clickable URL field (url, link, href)
  id?: string;          // Identifier field (id, key, code)
  date?: string;        // Date field (createdAt, updatedAt)
  boolean?: string;     // Boolean field (isActive, enabled)
  remaining: string[];  // Fields not mapped to slots
}

export interface FieldTypeHint {
  field: string;
  type: 'email' | 'url' | 'date' | 'currency' | 'boolean' | 'code' | 'image' | 'text';
}

// Patterns for semantic field detection
const FIELD_PATTERNS = {
  title: /^(name|title|label|displayName|heading|subject)$/i,
  subtitle: /^(description|subtitle|summary|bio|about|tagline)$/i,
  icon: /^(icon|avatar|image|photo|thumbnail|picture|logo)$/i,
  badge: /^(status|state|type|role|category|kind|tag|level)$/i,
  detail: /^(count|total|amount|price|value|size|quantity|score)$/i,
  link: /^(url|link|href|website|homepage|uri)$/i,
  id: /^(id|key|code|uuid|slug|_id)$/i,
  date: /^(date|time|createdAt|updatedAt|created|updated|timestamp|.*At|.*Date|.*Time)$/i,
  boolean: /^(is[A-Z]|has[A-Z]|can[A-Z]|should[A-Z]|enabled|disabled|active|visible|checked|selected)$/i,
};

// Patterns for type detection from field values
const VALUE_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^(https?:\/\/|www\.)/i,
  isoDate: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/,
  currency: /^\$?\d+(\.\d{2})?$/,
  image: /\.(jpg|jpeg|png|gif|webp|svg|ico)(\?.*)?$/i,
};

/**
 * Analyze an object's fields to determine semantic mapping
 */
export function analyzeFields(data: object | object[]): FieldMapping {
  const sample = Array.isArray(data) ? data[0] : data;
  if (!sample || typeof sample !== 'object') {
    return { remaining: [] };
  }

  const fields = Object.keys(sample);
  const mapping: FieldMapping = { remaining: [] };
  const assigned = new Set<string>();

  // First pass: match by field name patterns
  for (const [slot, pattern] of Object.entries(FIELD_PATTERNS)) {
    const match = fields.find(f => pattern.test(f) && !assigned.has(f));
    if (match) {
      (mapping as any)[slot] = match;
      assigned.add(match);
    }
  }

  // Special case: if no subtitle but we have email, use it
  if (!mapping.subtitle) {
    const emailField = fields.find(f => /email/i.test(f) && !assigned.has(f));
    if (emailField) {
      mapping.subtitle = emailField;
      assigned.add(emailField);
    }
  }

  // Collect remaining fields
  mapping.remaining = fields.filter(f => !assigned.has(f));

  return mapping;
}

/**
 * Detect field types from sample values
 */
export function detectFieldTypes(data: object | object[]): FieldTypeHint[] {
  const sample = Array.isArray(data) ? data[0] : data;
  if (!sample || typeof sample !== 'object') {
    return [];
  }

  const hints: FieldTypeHint[] = [];

  for (const [field, value] of Object.entries(sample)) {
    if (value === null || value === undefined) continue;

    // Boolean detection
    if (typeof value === 'boolean') {
      hints.push({ field, type: 'boolean' });
      continue;
    }

    // String-based detection
    if (typeof value === 'string') {
      if (VALUE_PATTERNS.email.test(value)) {
        hints.push({ field, type: 'email' });
      } else if (VALUE_PATTERNS.url.test(value)) {
        hints.push({ field, type: 'url' });
      } else if (VALUE_PATTERNS.image.test(value)) {
        hints.push({ field, type: 'image' });
      } else if (VALUE_PATTERNS.isoDate.test(value)) {
        hints.push({ field, type: 'date' });
      } else if (VALUE_PATTERNS.currency.test(value)) {
        hints.push({ field, type: 'currency' });
      } else {
        hints.push({ field, type: 'text' });
      }
      continue;
    }

    // Number with currency-like field name
    if (typeof value === 'number') {
      if (/price|cost|amount|total|fee/i.test(field)) {
        hints.push({ field, type: 'currency' });
      }
    }
  }

  return hints;
}

/**
 * Check if a field value looks like an image URL or emoji
 */
export function isVisualField(value: any): boolean {
  if (typeof value !== 'string') return false;

  // Emoji detection (single emoji character or common emoji patterns)
  const emojiRegex = /^[\p{Emoji}]$/u;
  if (emojiRegex.test(value) || value.length <= 2) {
    // Check if it's actually an emoji (simplified check)
    const codePoint = value.codePointAt(0) || 0;
    if (codePoint > 0x1F000) return true;
  }

  // Image URL detection
  return VALUE_PATTERNS.image.test(value) || VALUE_PATTERNS.url.test(value);
}

/**
 * Format a field name as a human-readable label
 * camelCase -> Title Case, snake_case -> Title Case
 */
export function formatFieldLabel(field: string): string {
  return field
    // camelCase to spaces
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // snake_case to spaces
    .replace(/_/g, ' ')
    // Capitalize first letter of each word
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/**
 * Get the best display value for a field
 */
export function getDisplayValue(value: any, typeHint?: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'object') return JSON.stringify(value);

  // Date formatting
  if (typeHint === 'date' && typeof value === 'string') {
    try {
      const date = new Date(value);
      return date.toLocaleDateString();
    } catch {
      return String(value);
    }
  }

  // Currency formatting
  if (typeHint === 'currency' && typeof value === 'number') {
    return `$${value.toFixed(2)}`;
  }

  return String(value);
}

/**
 * Generate JavaScript code for field analyzer (to embed in HTML)
 */
export function generateFieldAnalyzerJS(): string {
  return `
// Field Analyzer - Smart detection of field semantics
const FIELD_PATTERNS = {
  title: /^(name|title|label|displayName|heading|subject)$/i,
  subtitle: /^(description|subtitle|summary|bio|about|tagline)$/i,
  icon: /^(icon|avatar|image|photo|thumbnail|picture|logo)$/i,
  badge: /^(status|state|type|role|category|kind|tag|level)$/i,
  detail: /^(count|total|amount|price|value|size|quantity|score)$/i,
  link: /^(url|link|href|website|homepage|uri)$/i,
  id: /^(id|key|code|uuid|slug|_id)$/i,
  date: /^(date|time|createdAt|updatedAt|created|updated|timestamp|.*At|.*Date|.*Time)$/i,
  boolean: /^(is[A-Z]|has[A-Z]|can[A-Z]|should[A-Z]|enabled|disabled|active|visible|checked|selected)$/i,
};

const VALUE_PATTERNS = {
  email: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/,
  url: /^(https?:\\/\\/|www\\.)/i,
  isoDate: /^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2})?/,
  currency: /^\\$?\\d+(\\.\\d{2})?$/,
  image: /\\.(jpg|jpeg|png|gif|webp|svg|ico)(\\?.*)?$/i,
};

function analyzeFields(data) {
  const sample = Array.isArray(data) ? data[0] : data;
  if (!sample || typeof sample !== 'object') {
    return { remaining: [] };
  }

  const fields = Object.keys(sample);
  const mapping = { remaining: [] };
  const assigned = new Set();

  for (const [slot, pattern] of Object.entries(FIELD_PATTERNS)) {
    const match = fields.find(f => pattern.test(f) && !assigned.has(f));
    if (match) {
      mapping[slot] = match;
      assigned.add(match);
    }
  }

  if (!mapping.subtitle) {
    const emailField = fields.find(f => /email/i.test(f) && !assigned.has(f));
    if (emailField) {
      mapping.subtitle = emailField;
      assigned.add(emailField);
    }
  }

  mapping.remaining = fields.filter(f => !assigned.has(f));
  return mapping;
}

function detectFieldTypes(data) {
  const sample = Array.isArray(data) ? data[0] : data;
  if (!sample || typeof sample !== 'object') return [];

  const hints = [];
  for (const [field, value] of Object.entries(sample)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'boolean') {
      hints.push({ field, type: 'boolean' });
    } else if (typeof value === 'string') {
      if (VALUE_PATTERNS.email.test(value)) hints.push({ field, type: 'email' });
      else if (VALUE_PATTERNS.url.test(value)) hints.push({ field, type: 'url' });
      else if (VALUE_PATTERNS.image.test(value)) hints.push({ field, type: 'image' });
      else if (VALUE_PATTERNS.isoDate.test(value)) hints.push({ field, type: 'date' });
      else hints.push({ field, type: 'text' });
    } else if (typeof value === 'number' && /price|cost|amount|total|fee/i.test(field)) {
      hints.push({ field, type: 'currency' });
    }
  }
  return hints;
}

function isVisualField(value) {
  if (typeof value !== 'string') return false;
  const codePoint = value.codePointAt(0) || 0;
  if (codePoint > 0x1F000 && value.length <= 2) return true;
  return VALUE_PATTERNS.image.test(value) || VALUE_PATTERNS.url.test(value);
}

function formatFieldLabel(field) {
  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\\b\\w/g, c => c.toUpperCase())
    .trim();
}

function getDisplayValue(value, typeHint) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeHint === 'date' && typeof value === 'string') {
    try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
  }
  if (typeHint === 'currency' && typeof value === 'number') {
    return '$' + value.toFixed(2);
  }
  return String(value);
}
`;
}
