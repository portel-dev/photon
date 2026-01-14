/**
 * Component Renderers - iOS-inspired UI components
 *
 * Provides render functions for:
 * - List (iOS UITableView style)
 * - Card (single item display)
 * - Grid (visual grid layout)
 * - Tree (nested/hierarchical data)
 * - Chips (string array as tags)
 */

import { LayoutHints } from './layout-selector.js';
import { FieldMapping, FieldTypeHint } from './field-analyzer.js';

export interface RenderContext {
  mapping: FieldMapping;
  typeHints: FieldTypeHint[];
  layoutHints?: LayoutHints;
  escapeHtml: (str: string) => string;
  renderFieldValue: (value: any, field: string, typeHints: FieldTypeHint[]) => string;
}

/**
 * Generate CSS for all components
 */
export function generateComponentCSS(): string {
  return `
/* ==========================================================================
   Smart Rendering Components
   ========================================================================== */

/* List Component (iOS-style) */
.smart-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--border-color);
  border-radius: 10px;
  overflow: hidden;
}

.smart-list.style-plain {
  background: transparent;
  gap: 0;
  border-radius: 0;
}

.smart-list.style-inset {
  margin: 0 16px;
  border-radius: 10px;
}

.smart-list.style-grouped {
  background: transparent;
  gap: 16px;
}

/* List Item */
.list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: background 0.15s;
}

.list-item:hover {
  background: var(--bg-hover);
}

.list-item:active {
  background: var(--bg-active);
}

.style-plain .list-item {
  border-bottom: 1px solid var(--border-color);
}

.style-plain .list-item:last-child {
  border-bottom: none;
}

/* List Item: Leading (icon/avatar) */
.list-item-leading {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  border-radius: 8px;
  background: var(--bg-tertiary);
}

.list-item-leading img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
}

.list-item-leading.emoji {
  background: transparent;
}

/* List Item: Content (title + subtitle) */
.list-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.list-item-title {
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-item-subtitle {
  font-size: 0.875rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* List Item: Trailing (detail + badge) */
.list-item-trailing {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.list-item-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--accent-bg);
  color: var(--accent-color);
}

.list-item-badge.status-active,
.list-item-badge.status-success {
  background: #dcfce7;
  color: #166534;
}

.list-item-badge.status-inactive,
.list-item-badge.status-error {
  background: #fee2e2;
  color: #991b1b;
}

.list-item-badge.status-pending,
.list-item-badge.status-warning {
  background: #fef3c7;
  color: #92400e;
}

/* List Item: Accessory */
.list-item-accessory {
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 1.25rem;
}

.list-item-accessory.chevron::after {
  content: '›';
}

.list-item-accessory.disclosure::after {
  content: '▼';
  font-size: 0.75rem;
}

/* Card Component */
.smart-card {
  background: var(--bg-secondary);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.smart-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.smart-card-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  border-radius: 10px;
  background: var(--bg-tertiary);
}

.smart-card-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 10px;
}

.smart-card-header-content {
  flex: 1;
  min-width: 0;
}

.smart-card-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.smart-card-subtitle {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.smart-card-body {
  padding: 0;
}

.smart-card-row {
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.smart-card-row:last-child {
  border-bottom: none;
}

.smart-card-label {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.smart-card-value {
  color: var(--text-primary);
  font-weight: 500;
  text-align: right;
}

/* Grid Component */
.smart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}

.smart-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
.smart-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
.smart-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }

.grid-item {
  background: var(--bg-secondary);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.grid-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.grid-item-image {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: var(--bg-tertiary);
}

.grid-item-content {
  padding: 12px;
}

.grid-item-title {
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.grid-item-detail {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* Tree Component */
.smart-tree {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.6;
}

.tree-node {
  margin-left: 0;
}

.tree-node-inner {
  margin-left: 20px;
}

.tree-key {
  color: var(--text-secondary);
}

.tree-value {
  color: var(--text-primary);
}

.tree-value.string { color: #22863a; }
.tree-value.number { color: #005cc5; }
.tree-value.boolean { color: #d73a49; }
.tree-value.null { color: #6a737d; }

.tree-toggle {
  cursor: pointer;
  user-select: none;
}

.tree-toggle::before {
  content: '▼ ';
  font-size: 0.75rem;
}

.tree-toggle.collapsed::before {
  content: '▶ ';
}

/* Chips Component */
.smart-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 16px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.chip.clickable {
  cursor: pointer;
  transition: background 0.15s;
}

.chip.clickable:hover {
  background: var(--bg-hover);
}

/* Text Component */
.smart-text {
  color: var(--text-primary);
  line-height: 1.6;
}

.smart-text.large {
  font-size: 2rem;
  font-weight: 600;
}

.smart-text.muted {
  color: var(--text-secondary);
}
`;
}

/**
 * Generate JavaScript for component renderers (to embed in HTML)
 */
export function generateComponentsJS(): string {
  return `
// Component Renderers

function renderSmartResult(data, format, layoutHints) {
  // Get layout type
  const layout = selectLayout(data, format, layoutHints);

  // Get field analysis
  const mapping = analyzeFields(data);
  const typeHints = detectFieldTypes(data);

  // Merge with explicit hints
  const finalMapping = { ...mapping, ...layoutHints };

  // Render based on layout
  switch (layout) {
    case 'list':
      return renderList(data, finalMapping, typeHints, layoutHints?.style, layoutHints?.accessory);
    case 'card':
      return renderCard(data, finalMapping, typeHints);
    case 'grid':
      return renderGrid(data, finalMapping, typeHints, layoutHints?.columns);
    case 'tree':
      return renderTree(data);
    case 'chips':
      return renderChips(data);
    case 'kv':
      return renderKeyValueTable(data);
    case 'text':
      return renderText(data);
    case 'markdown':
      return renderMarkdown(data);
    case 'mermaid':
      // Handle in parent (needs async)
      return null;
    case 'code':
      return '<pre class="code-block">' + escapeHtml(String(data)) + '</pre>';
    case 'json':
    default:
      return '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
  }
}

function renderList(data, mapping, typeHints, style, accessory) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="smart-text muted">No items</div>';
  }

  const styleClass = style ? 'style-' + style : '';
  const items = data.map(item => renderListItem(item, mapping, typeHints, accessory)).join('');

  return '<div class="smart-list ' + styleClass + '">' + items + '</div>';
}

function renderListItem(item, mapping, typeHints, accessory) {
  let html = '<div class="list-item">';

  // Leading (icon/avatar)
  if (mapping.icon && item[mapping.icon] !== undefined) {
    const iconValue = item[mapping.icon];
    const isEmoji = typeof iconValue === 'string' && iconValue.length <= 2;
    const isImage = typeof iconValue === 'string' && /\\.(jpg|jpeg|png|gif|webp|svg)/i.test(iconValue);

    if (isImage) {
      html += '<div class="list-item-leading"><img src="' + escapeHtml(iconValue) + '" alt=""></div>';
    } else {
      html += '<div class="list-item-leading' + (isEmoji ? ' emoji' : '') + '">' + escapeHtml(String(iconValue)) + '</div>';
    }
  }

  // Content (title + subtitle)
  html += '<div class="list-item-content">';
  if (mapping.title && item[mapping.title] !== undefined) {
    html += '<div class="list-item-title">' + escapeHtml(String(item[mapping.title])) + '</div>';
  }
  if (mapping.subtitle && item[mapping.subtitle] !== undefined) {
    const subtitleValue = item[mapping.subtitle];
    const isEmail = typeHints.find(h => h.field === mapping.subtitle && h.type === 'email');
    if (isEmail) {
      html += '<div class="list-item-subtitle"><a href="mailto:' + escapeHtml(subtitleValue) + '">' + escapeHtml(subtitleValue) + '</a></div>';
    } else {
      html += '<div class="list-item-subtitle">' + escapeHtml(String(subtitleValue)) + '</div>';
    }
  }
  html += '</div>';

  // Trailing (detail + badge)
  html += '<div class="list-item-trailing">';
  if (mapping.detail && item[mapping.detail] !== undefined) {
    html += '<span>' + renderFieldValue(item[mapping.detail], mapping.detail, typeHints) + '</span>';
  }
  if (mapping.badge && item[mapping.badge] !== undefined) {
    const badgeValue = String(item[mapping.badge]).toLowerCase();
    const statusClass = getStatusClass(badgeValue);
    html += '<span class="list-item-badge ' + statusClass + '">' + escapeHtml(String(item[mapping.badge])) + '</span>';
  }
  html += '</div>';

  // Accessory
  if (accessory && accessory !== 'none') {
    html += '<div class="list-item-accessory ' + accessory + '"></div>';
  }

  html += '</div>';
  return html;
}

function renderCard(data, mapping, typeHints) {
  if (!data || typeof data !== 'object') {
    return renderText(data);
  }

  let html = '<div class="smart-card">';

  // Header (icon + title + subtitle)
  const hasHeader = mapping.icon || mapping.title || mapping.subtitle;
  if (hasHeader) {
    html += '<div class="smart-card-header">';

    if (mapping.icon && data[mapping.icon] !== undefined) {
      const iconValue = data[mapping.icon];
      const isImage = typeof iconValue === 'string' && /\\.(jpg|jpeg|png|gif|webp|svg)/i.test(iconValue);
      if (isImage) {
        html += '<div class="smart-card-icon"><img src="' + escapeHtml(iconValue) + '" alt=""></div>';
      } else {
        html += '<div class="smart-card-icon">' + escapeHtml(String(iconValue)) + '</div>';
      }
    }

    html += '<div class="smart-card-header-content">';
    if (mapping.title && data[mapping.title] !== undefined) {
      html += '<div class="smart-card-title">' + escapeHtml(String(data[mapping.title])) + '</div>';
    }
    if (mapping.subtitle && data[mapping.subtitle] !== undefined) {
      html += '<div class="smart-card-subtitle">' + escapeHtml(String(data[mapping.subtitle])) + '</div>';
    }
    html += '</div></div>';
  }

  // Body (remaining fields as key-value rows)
  const excludeFields = new Set([mapping.icon, mapping.title, mapping.subtitle, mapping.id].filter(Boolean));
  const bodyFields = Object.keys(data).filter(k => !excludeFields.has(k));

  if (bodyFields.length > 0) {
    html += '<div class="smart-card-body">';
    for (const field of bodyFields) {
      html += '<div class="smart-card-row">';
      html += '<span class="smart-card-label">' + formatFieldLabel(field) + '</span>';
      html += '<span class="smart-card-value">' + renderFieldValue(data[field], field, typeHints) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function renderGrid(data, mapping, typeHints, columns) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="smart-text muted">No items</div>';
  }

  const colsClass = columns ? 'cols-' + columns : '';
  let html = '<div class="smart-grid ' + colsClass + '">';

  for (const item of data) {
    html += '<div class="grid-item">';

    // Image
    const imageField = mapping.image || Object.keys(item).find(k => /image|photo|thumbnail/i.test(k));
    if (imageField && item[imageField]) {
      html += '<img class="grid-item-image" src="' + escapeHtml(item[imageField]) + '" alt="">';
    } else {
      html += '<div class="grid-item-image"></div>';
    }

    // Content
    html += '<div class="grid-item-content">';
    if (mapping.title && item[mapping.title] !== undefined) {
      html += '<div class="grid-item-title">' + escapeHtml(String(item[mapping.title])) + '</div>';
    }
    if (mapping.detail && item[mapping.detail] !== undefined) {
      html += '<div class="grid-item-detail">' + renderFieldValue(item[mapping.detail], mapping.detail, typeHints) + '</div>';
    }
    html += '</div></div>';
  }

  html += '</div>';
  return html;
}

function renderTree(data, depth = 0) {
  if (data === null) return '<span class="tree-value null">null</span>';
  if (data === undefined) return '<span class="tree-value null">undefined</span>';

  if (typeof data !== 'object') {
    const typeClass = typeof data;
    if (typeof data === 'string') {
      return '<span class="tree-value string">"' + escapeHtml(data) + '"</span>';
    }
    return '<span class="tree-value ' + typeClass + '">' + escapeHtml(String(data)) + '</span>';
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return '<span class="tree-value">[]</span>';
    let html = '<div class="tree-node">[';
    html += '<div class="tree-node-inner">';
    data.forEach((item, i) => {
      html += '<div>' + renderTree(item, depth + 1);
      if (i < data.length - 1) html += ',';
      html += '</div>';
    });
    html += '</div>]</div>';
    return html;
  }

  const keys = Object.keys(data);
  if (keys.length === 0) return '<span class="tree-value">{}</span>';

  let html = '<div class="tree-node">{';
  html += '<div class="tree-node-inner">';
  keys.forEach((key, i) => {
    html += '<div><span class="tree-key">' + escapeHtml(key) + '</span>: ' + renderTree(data[key], depth + 1);
    if (i < keys.length - 1) html += ',';
    html += '</div>';
  });
  html += '</div>}</div>';
  return html;
}

function renderChips(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="smart-text muted">No items</div>';
  }

  const chips = data.map(item => '<span class="chip">' + escapeHtml(String(item)) + '</span>').join('');
  return '<div class="smart-chips">' + chips + '</div>';
}

function renderText(data) {
  if (data === null || data === undefined) {
    return '<div class="smart-text muted">—</div>';
  }

  const text = String(data);

  // Large display for short text/numbers
  if (text.length < 20 && !text.includes('\\n')) {
    return '<div class="smart-text large">' + escapeHtml(text) + '</div>';
  }

  return '<div class="smart-text">' + escapeHtml(text) + '</div>';
}

function renderFieldValue(value, field, typeHints) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';

  const hint = typeHints.find(h => h.field === field);

  if (hint) {
    switch (hint.type) {
      case 'email':
        return '<a href="mailto:' + escapeHtml(value) + '">' + escapeHtml(value) + '</a>';
      case 'url':
        return '<a href="' + escapeHtml(value) + '" target="_blank">' + escapeHtml(value) + '</a>';
      case 'date':
        try {
          return new Date(value).toLocaleDateString();
        } catch {
          return escapeHtml(String(value));
        }
      case 'currency':
        if (typeof value === 'number') return '$' + value.toFixed(2);
        return escapeHtml(String(value));
    }
  }

  if (typeof value === 'object') {
    return escapeHtml(JSON.stringify(value));
  }

  return escapeHtml(String(value));
}

function getStatusClass(value) {
  const lower = value.toLowerCase();
  if (/active|success|complete|done|enabled|yes|true/.test(lower)) return 'status-active';
  if (/inactive|error|failed|disabled|no|false/.test(lower)) return 'status-inactive';
  if (/pending|warning|waiting|processing/.test(lower)) return 'status-pending';
  return '';
}
`;
}
