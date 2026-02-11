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
 * Uses Photon Design System tokens (Material Design 3 + Apple HIG)
 */
export function generateComponentCSS(): string {
  return `
/* ==========================================================================
   Smart Rendering Components (using Photon Design Tokens)
   ========================================================================== */

/* List Component (iOS-style) */
.smart-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--color-outline-variant);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.smart-list.style-plain {
  background: transparent;
  gap: 0;
  border-radius: 0;
}

.smart-list.style-inset {
  margin: 0 var(--space-4);
  border-radius: var(--radius-md);
}

.smart-list.style-grouped {
  background: transparent;
  gap: var(--space-4);
}

/* List Item */
.list-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-container);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.list-item:hover {
  background: var(--color-surface-container-high);
}

.list-item:active {
  background: var(--color-surface-container-highest);
}

.style-plain .list-item {
  border-bottom: 1px solid var(--color-outline-variant);
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
  font-size: var(--text-title-lg);
  border-radius: var(--radius-sm);
  background: var(--color-surface-container-highest);
}

.list-item-leading img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-sm);
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
  font-size: var(--text-body-lg);
  font-weight: var(--weight-medium);
  color: var(--color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-item-subtitle {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* List Item: Trailing (detail + badge) */
.list-item-trailing {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-on-surface-variant);
  font-size: var(--text-body-sm);
}

.list-item-badge {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-label-sm);
  font-weight: var(--weight-medium);
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
}

.list-item-badge.status-active,
.list-item-badge.status-success {
  background: var(--color-success-container);
  color: var(--color-on-success-container);
}

.list-item-badge.status-inactive,
.list-item-badge.status-error {
  background: var(--color-error-container);
  color: var(--color-on-error-container);
}

.list-item-badge.status-pending,
.list-item-badge.status-warning {
  background: var(--color-warning-container);
  color: var(--color-on-warning-container);
}

/* List Item: Accessory */
.list-item-accessory {
  flex-shrink: 0;
  color: var(--color-on-surface-muted);
  font-size: var(--text-title-md);
}

.list-item-accessory.chevron::after {
  content: '›';
}

.list-item-accessory.disclosure::after {
  content: '▼';
  font-size: var(--text-label-sm);
}

/* Card Component */
.smart-card {
  background: var(--color-surface-container);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--color-outline-variant);
}

.smart-card-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-outline-variant);
}

.smart-card-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-headline-md);
  border-radius: var(--radius-md);
  background: var(--color-surface-container-highest);
}

.smart-card-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-md);
}

.smart-card-header-content {
  flex: 1;
  min-width: 0;
}

.smart-card-title {
  font-size: var(--text-title-lg);
  font-weight: var(--weight-semibold);
  color: var(--color-on-surface);
}

.smart-card-subtitle {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-variant);
  margin-top: 2px;
}

.smart-card-body {
  padding: 0;
}

.smart-card-row {
  display: flex;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-outline-variant);
}

.smart-card-row:last-child {
  border-bottom: none;
}

.smart-card-label {
  color: var(--color-on-surface-variant);
  font-size: var(--text-body-sm);
}

.smart-card-value {
  color: var(--color-on-surface);
  font-weight: var(--weight-medium);
  text-align: right;
}

/* Grid Component */
.smart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-4);
}

.smart-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
.smart-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
.smart-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }

.grid-item {
  background: var(--color-surface-container);
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--color-outline-variant);
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard);
}

.grid-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--elevation-2);
}

.grid-item-image {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: var(--color-surface-container-highest);
}

.grid-item-content {
  padding: var(--space-3);
}

.grid-item-title {
  font-weight: var(--weight-medium);
  color: var(--color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.grid-item-detail {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-variant);
  margin-top: var(--space-1);
}

/* Tree Component */
.smart-tree {
  font-family: var(--font-mono);
  font-size: var(--text-body-sm);
  line-height: 1.6;
}

.tree-node {
  margin-left: 0;
}

.tree-node-inner {
  margin-left: var(--space-5);
}

.tree-key {
  color: var(--color-on-surface-variant);
}

.tree-value {
  color: var(--color-on-surface);
}

.tree-value.string { color: var(--color-success); }
.tree-value.number { color: var(--color-primary); }
.tree-value.boolean { color: var(--color-error); }
.tree-value.null { color: var(--color-on-surface-muted); }

.tree-toggle {
  cursor: pointer;
  user-select: none;
}

.tree-toggle::before {
  content: '▼ ';
  font-size: var(--text-label-sm);
}

.tree-toggle.collapsed::before {
  content: '▶ ';
}

/* Chips Component */
.smart-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--color-surface-container-highest);
  color: var(--color-on-surface);
  font-size: var(--text-body-sm);
}

.chip.clickable {
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.chip.clickable:hover {
  background: var(--color-surface-container-high);
}

/* Text Component */
.smart-text {
  color: var(--color-on-surface);
  line-height: 1.6;
}

.smart-text.large {
  font-size: var(--text-display-sm);
  font-weight: var(--weight-semibold);
}

.smart-text.muted {
  color: var(--color-on-surface-variant);
}

/* Metric Component */
.smart-metric {
  text-align: center;
  padding: var(--space-5) var(--space-4);
}

.smart-metric-value {
  font-size: 3rem;
  font-weight: 700;
  color: var(--color-on-surface);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.smart-metric-label {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: var(--space-1);
}

.smart-metric-delta {
  display: inline-block;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  font-weight: 600;
  margin-top: var(--space-2);
}

.smart-metric-delta.up { color: var(--color-success); }
.smart-metric-delta.down { color: var(--color-error); }

/* Gauge Component */
.smart-gauge {
  text-align: center;
  padding: var(--space-4);
}

/* Timeline Component */
.smart-timeline {
  position: relative;
  padding-left: var(--space-6);
}

.smart-timeline::before {
  content: '';
  position: absolute;
  left: calc(var(--space-2) + 4px);
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-outline-variant);
}

.timeline-item {
  position: relative;
  padding: var(--space-2) 0 var(--space-2) var(--space-4);
}

.timeline-item::before {
  content: '';
  position: absolute;
  left: calc(-1 * var(--space-4));
  top: calc(var(--space-2) + 6px);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary);
  border: 2px solid var(--color-surface);
}

.timeline-item-title {
  font-weight: var(--weight-semibold);
  color: var(--color-on-surface);
}

.timeline-item-time {
  font-size: var(--text-label-sm);
  color: var(--color-on-surface-variant);
}

.timeline-item-description {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-variant);
  margin-top: var(--space-1);
}

/* Dashboard Component */
.smart-dashboard {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
}

.dashboard-panel {
  background: var(--color-surface-container);
  border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.dashboard-panel-header {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-label-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--color-outline-variant);
}

.dashboard-panel-content {
  padding: var(--space-2);
}

/* JSON Syntax Highlighting */
.json-highlighted {
  margin: 0;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
}

.json-key {
  color: #9cdcfe;
}

.json-string {
  color: #ce9178;
}

.json-number {
  color: #b5cea8;
}

.json-boolean {
  color: #569cd6;
}

.json-null {
  color: #808080;
}
`;
}

/**
 * Generate JavaScript for component renderers (to embed in HTML)
 */
export function generateComponentsJS(): string {
  return `
// Component Renderers

// JSON Syntax Highlighting
function syntaxHighlightJson(json) {
  if (typeof json !== 'string') {
    json = JSON.stringify(json, null, 2);
  }
  var result = '';
  var i = 0;
  while (i < json.length) {
    var ch = json[i];
    if (ch === '"') {
      var start = i;
      i++;
      while (i < json.length && !(json[i] === '"' && json[i-1] !== String.fromCharCode(92))) i++;
      i++;
      var str = json.substring(start, i);
      var rest = json.substring(i).trimStart();
      if (rest[0] === ':') {
        result += '<span class="json-key">' + escapeHtml(str) + '</span>';
      } else {
        result += '<span class="json-string">' + escapeHtml(str) + '</span>';
      }
    } else if (/[0-9-]/.test(ch)) {
      var start = i;
      while (i < json.length && /[0-9.eE+-]/.test(json[i])) i++;
      result += '<span class="json-number">' + json.substring(start, i) + '</span>';
    } else if (json.substring(i, i+4) === 'true') {
      result += '<span class="json-boolean">true</span>';
      i += 4;
    } else if (json.substring(i, i+5) === 'false') {
      result += '<span class="json-boolean">false</span>';
      i += 5;
    } else if (json.substring(i, i+4) === 'null') {
      result += '<span class="json-null">null</span>';
      i += 4;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

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
    case 'html':
      // Raw HTML - return as-is (assumes data is HTML string)
      return typeof data === 'string' ? data : (data?.html || String(data));
    case 'code':
      return '<pre class="code-block">' + escapeHtml(String(data)) + '</pre>';
    case 'metric':
      return renderMetric(data);
    case 'gauge':
      return renderGauge(data);
    case 'timeline':
      return renderTimeline(data);
    case 'dashboard':
      return renderDashboard(data);
    case 'chart':
      // Charts require Chart.js (only in Beam). Fallback to table/JSON in playground.
      return '<pre class="json-highlighted">' + syntaxHighlightJson(data) + '</pre>';
    case 'json':
    default:
      return '<pre class="json-highlighted">' + syntaxHighlightJson(data) + '</pre>';
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

  // Handle primitive items (strings, numbers, booleans)
  if (typeof item !== 'object' || item === null) {
    html += '<div class="list-item-content">';
    html += '<div class="list-item-title">' + escapeHtml(String(item)) + '</div>';
    html += '</div>';
    if (accessory && accessory !== 'none') {
      html += '<div class="list-item-accessory ' + accessory + '"></div>';
    }
    html += '</div>';
    return html;
  }

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

function renderMetric(data) {
  if (!data || typeof data !== 'object') {
    if (typeof data === 'number') {
      return '<div style="text-align:center;padding:24px;"><div style="font-size:3rem;font-weight:700;">' + data.toLocaleString() + '</div></div>';
    }
    return '<div>No metric data</div>';
  }
  var keys = Object.keys(data);
  var numericKey = keys.find(function(k) { return typeof data[k] === 'number'; });
  if (!numericKey) return '<pre class="json-highlighted">' + syntaxHighlightJson(data) + '</pre>';
  var value = data[numericKey];
  var label = data.label || data.name || data.title || (numericKey !== 'value' ? formatFieldLabel(numericKey) : '');
  var delta = data.delta || data.change || data.diff;
  var html = '<div style="text-align:center;padding:24px;">';
  html += '<div style="font-size:3rem;font-weight:700;">' + value.toLocaleString() + '</div>';
  if (label) html += '<div style="font-size:0.85rem;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">' + escapeHtml(label) + '</div>';
  if (delta) {
    var color = String(delta).startsWith('+') ? '#16a34a' : String(delta).startsWith('-') ? '#dc2626' : '#64748b';
    html += '<div style="display:inline-block;padding:2px 10px;border-radius:12px;margin-top:8px;font-weight:600;color:' + color + ';">' + escapeHtml(String(delta)) + '</div>';
  }
  html += '</div>';
  return html;
}

function renderGauge(data) {
  if (!data || typeof data !== 'object') return '<div>No gauge data</div>';
  var value, min = 0, max = 100, label;
  if ('progress' in data && typeof data.progress === 'number') {
    value = data.progress * 100;
    label = data.label || 'Progress';
  } else {
    value = data.value || 0;
    min = data.min || 0;
    max = data.max || 100;
    label = data.label;
  }
  var pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  var displayVal = data.progress !== undefined ? Math.round(value) + '%' : Math.round(value);
  var html = '<div style="text-align:center;padding:16px;">';
  html += '<div style="width:160px;margin:0 auto;">';
  html += '<div style="position:relative;width:160px;height:12px;background:#334155;border-radius:6px;overflow:hidden;">';
  html += '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444);border-radius:6px;transition:width 0.5s;"></div>';
  html += '</div>';
  html += '<div style="font-size:1.5rem;font-weight:700;margin-top:8px;">' + displayVal + '</div>';
  if (label) html += '<div style="font-size:0.8rem;color:#64748b;text-transform:uppercase;">' + escapeHtml(label) + '</div>';
  html += '</div></div>';
  return html;
}

function renderTimeline(data) {
  if (!Array.isArray(data) || data.length === 0) return '<div>No timeline data</div>';
  var datePattern = /^(date|time|createdAt|updatedAt|created|updated|timestamp)/i;
  var titlePattern = /^(title|event|name|label|subject|action)/i;
  var descPattern = /^(description|details|body|content|message|summary)/i;
  var sample = data[0];
  var dateField, titleField, descField;
  var fields = Object.keys(sample);
  for (var i = 0; i < fields.length; i++) {
    if (!dateField && datePattern.test(fields[i])) dateField = fields[i];
    if (!titleField && titlePattern.test(fields[i])) titleField = fields[i];
    if (!descField && descPattern.test(fields[i])) descField = fields[i];
  }
  var html = '<div style="position:relative;padding-left:24px;">';
  html += '<div style="position:absolute;left:9px;top:0;bottom:0;width:2px;background:#334155;"></div>';
  for (var j = 0; j < data.length; j++) {
    var item = data[j];
    html += '<div style="position:relative;padding:8px 0 8px 16px;">';
    html += '<div style="position:absolute;left:-4px;top:14px;width:10px;height:10px;border-radius:50%;background:#6366f1;border:2px solid #0f172a;z-index:1;"></div>';
    if (titleField) html += '<div style="font-weight:600;">' + escapeHtml(String(item[titleField])) + '</div>';
    if (dateField) {
      try { html += '<div style="font-size:0.75rem;color:#64748b;">' + new Date(item[dateField]).toLocaleString() + '</div>'; }
      catch(e) { html += '<div style="font-size:0.75rem;color:#64748b;">' + escapeHtml(String(item[dateField])) + '</div>'; }
    }
    if (descField && item[descField]) html += '<div style="font-size:0.85rem;color:#94a3b8;margin-top:4px;">' + escapeHtml(String(item[descField])) + '</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderDashboard(data) {
  if (!data || typeof data !== 'object') return '<div>No dashboard data</div>';
  var keys = Object.keys(data);
  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">';
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = data[key];
    html += '<div style="border:1px solid #334155;border-radius:8px;overflow:hidden;">';
    html += '<div style="padding:8px 12px;font-size:0.75rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #334155;">' + formatFieldLabel(key) + '</div>';
    html += '<div style="padding:8px;">';
    if (typeof val === 'number') {
      html += '<div style="text-align:center;padding:16px;font-size:2rem;font-weight:700;">' + val.toLocaleString() + '</div>';
    } else if (Array.isArray(val)) {
      html += renderSmartResult(val, null, null);
    } else if (typeof val === 'object' && val !== null) {
      if ('value' in val && typeof val.value === 'number') {
        html += renderMetric(val);
      } else if ('progress' in val && typeof val.progress === 'number') {
        html += renderGauge(val);
      } else {
        html += renderSmartResult(val, null, null);
      }
    } else {
      html += '<div style="padding:8px;">' + escapeHtml(String(val)) + '</div>';
    }
    html += '</div></div>';
  }
  html += '</div>';
  return html;
}
`;
}
