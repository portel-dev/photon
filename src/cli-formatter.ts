/**
 * CLI Output Formatter
 *
 * Shared formatting utilities for beautiful CLI output.
 * Used by both photon methods and Photon CLI commands.
 *
 * Format types:
 * - primitive: Single values (string, number, boolean)
 * - table: Flat objects or arrays of flat objects (bordered tables)
 * - tree: Nested/hierarchical structures (indented)
 * - list: Arrays of primitives (bullet points)
 * - none: No data to display
 */

export type OutputFormat = 'primitive' | 'table' | 'tree' | 'list' | 'none';

/**
 * Format and output data with optional format hint
 */
export function formatOutput(data: any, hint?: OutputFormat): void {
  const format = hint || detectFormat(data);
  formatDataWithHint(data, format);
}

/**
 * Format data using specified or detected format
 */
function formatDataWithHint(
  data: any,
  format: OutputFormat
): void {
  switch (format) {
    case 'primitive':
      renderPrimitive(data);
      break;
    case 'list':
      renderList(Array.isArray(data) ? data : [data]);
      break;
    case 'table':
      renderTable(data);
      break;
    case 'tree':
      renderTree(data);
      break;
    case 'none':
      renderNone();
      break;
  }
}

/**
 * Detect format type from data structure
 */
export function detectFormat(data: any): OutputFormat {
  // null/undefined = none
  if (data === null || data === undefined) {
    return 'none';
  }

  // Primitive types
  if (
    typeof data === 'string' ||
    typeof data === 'number' ||
    typeof data === 'boolean'
  ) {
    return 'primitive';
  }

  // Array handling
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return 'list';
    }

    // Check first element to determine list vs table
    const firstItem = data[0];

    // Array of primitives = list
    if (typeof firstItem !== 'object' || firstItem === null) {
      return 'list';
    }

    // Array of flat objects = table
    if (isFlatObject(firstItem)) {
      return 'table';
    }

    // Array of nested objects = tree
    return 'tree';
  }

  // Single object
  if (typeof data === 'object') {
    // Flat object = table
    if (isFlatObject(data)) {
      return 'table';
    }

    // Nested object = tree
    return 'tree';
  }

  // Default fallback
  return 'none';
}

/**
 * Check if an object is flat (no nested objects or arrays)
 */
function isFlatObject(obj: any): boolean {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      return false;
    }
  }

  return true;
}

/**
 * Render primitive value
 */
export function renderPrimitive(value: any): void {
  if (typeof value === 'boolean') {
    console.log(value ? 'yes' : 'no');
  } else {
    console.log(value);
  }
}

/**
 * Render list (array of primitives)
 */
export function renderList(data: any[]): void {
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }

  data.forEach(item => {
    console.log(`  * ${item}`);
  });
}

/**
 * Render table (flat object or array of flat objects)
 */
export function renderTable(data: any): void {
  // Single flat object - show as bordered key-value table
  if (!Array.isArray(data)) {
    const entries = Object.entries(data).filter(
      ([key, value]) => !(key === 'returnValue' && value === true)
    );

    if (entries.length === 0) {
      console.log('(empty)');
      return;
    }

    const maxKeyLength = Math.max(...entries.map(([k]) => formatKey(k).length));
    const maxValueLength = Math.max(
      ...entries.map(([_, v]) => String(formatValue(v)).length)
    );

    // Top border
    console.log(
      `┌─${'─'.repeat(maxKeyLength)}─┬─${'─'.repeat(maxValueLength)}─┐`
    );

    // Rows
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      const formattedKey = formatKey(key);
      const formattedValue = String(formatValue(value));
      const keyPadding = ' '.repeat(maxKeyLength - formattedKey.length);
      const valuePadding = ' '.repeat(maxValueLength - formattedValue.length);

      console.log(
        `│ ${formattedKey}${keyPadding} │ ${formattedValue}${valuePadding} │`
      );

      // Add separator between rows (not after last row)
      if (i < entries.length - 1) {
        console.log(
          `├─${'─'.repeat(maxKeyLength)}─┼─${'─'.repeat(maxValueLength)}─┤`
        );
      }
    }

    // Bottom border
    console.log(
      `└─${'─'.repeat(maxKeyLength)}─┴─${'─'.repeat(maxValueLength)}─┘`
    );
    return;
  }

  // Array of flat objects - show as bordered table
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }

  // Get all unique keys across all objects
  const allKeys = Array.from(
    new Set(data.flatMap(obj => Object.keys(obj)))
  ).filter(k => k !== 'returnValue');

  if (allKeys.length === 0) {
    console.log('(no data)');
    return;
  }

  // Calculate column widths
  const columnWidths = new Map<string, number>();
  for (const key of allKeys) {
    const headerWidth = formatKey(key).length;
    const maxValueWidth = Math.max(
      ...data.map(obj => String(formatValue(obj[key] ?? '')).length)
    );
    columnWidths.set(key, Math.max(headerWidth, maxValueWidth));
  }

  // Top border
  const topBorderParts = allKeys.map(
    key => '─'.repeat(columnWidths.get(key)! + 2)
  );
  console.log('┌' + topBorderParts.join('┬') + '┐');

  // Header
  const headerParts = allKeys.map(key => {
    const formattedKey = formatKey(key);
    const width = columnWidths.get(key)!;
    return ' ' + formattedKey.padEnd(width) + ' ';
  });
  console.log('│' + headerParts.join('│') + '│');

  // Header separator
  const separatorParts = allKeys.map(
    key => '─'.repeat(columnWidths.get(key)! + 2)
  );
  console.log('├' + separatorParts.join('┼') + '┤');

  // Rows
  for (const row of data) {
    const rowParts = allKeys.map(key => {
      const value = formatValue(row[key] ?? '');
      const width = columnWidths.get(key)!;
      return ' ' + String(value).padEnd(width) + ' ';
    });
    console.log('│' + rowParts.join('│') + '│');
  }

  // Bottom border
  const bottomBorderParts = allKeys.map(
    key => '─'.repeat(columnWidths.get(key)! + 2)
  );
  console.log('└' + bottomBorderParts.join('┴') + '┘');
}

/**
 * Render tree (nested/hierarchical structure)
 */
export function renderTree(data: any, indent: string = ''): void {
  // Array of objects
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(`${indent}(empty)`);
      return;
    }

    data.forEach((item, index) => {
      if (typeof item === 'object' && item !== null) {
        console.log(`${indent}[${index}]`);
        renderTree(item, indent + '  ');
      } else {
        console.log(`${indent}* ${item}`);
      }
    });
    return;
  }

  // Object
  if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data).filter(
      ([key, value]) => !(key === 'returnValue' && value === true)
    );

    for (const [key, value] of entries) {
      const formattedKey = formatKey(key);

      if (value === null || value === undefined) {
        console.log(`${indent}${formattedKey}: (none)`);
      } else if (Array.isArray(value)) {
        console.log(`${indent}${formattedKey}:`);
        renderTree(value, indent + '  ');
      } else if (typeof value === 'object') {
        console.log(`${indent}${formattedKey}:`);
        renderTree(value, indent + '  ');
      } else {
        console.log(`${indent}${formattedKey}: ${formatValue(value)}`);
      }
    }
    return;
  }

  // Primitive (shouldn't happen but handle it)
  console.log(`${indent}${formatValue(data)}`);
}

/**
 * Render none format (operation with no data)
 */
export function renderNone(): void {
  console.log('Done');
}

/**
 * Format a key for display (camelCase to Title Case)
 */
export function formatKey(key: string): string {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Format a value for display
 * Note: Uses ASCII characters only for alignment in tables
 */
export function formatValue(value: any): string | number | boolean {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return value;
}

/**
 * Status indicators for tables (ASCII only for proper alignment)
 */
export const STATUS = {
  OK: 'ok',
  UPDATE: 'update',
  ERROR: '!',
  OFF: 'off',
  UNKNOWN: '?',
} as const;

/**
 * Print a success message (emojis allowed outside tables)
 */
export function printSuccess(message: string): void {
  console.error(`✓ ${message}`);
}

/**
 * Print an error message (emojis allowed outside tables)
 */
export function printError(message: string): void {
  console.error(`✗ ${message}`);
}

/**
 * Print an info message
 */
export function printInfo(message: string): void {
  console.error(`${message}`);
}

/**
 * Print a warning message
 */
export function printWarning(message: string): void {
  console.error(`! ${message}`);
}

/**
 * Print a section header
 */
export function printHeader(title: string): void {
  console.error(`\n${title}`);
  console.error('─'.repeat(title.length));
}
