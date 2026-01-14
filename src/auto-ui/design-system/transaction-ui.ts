/**
 * Photon Transaction UI System
 *
 * A focused UI system for completing decisions in AI+Human workflows.
 * Not a general UI framework - purpose-built for the 4 transaction states:
 *
 * 1. SELECT  - Pick from options (AI narrowed down, human selects visually)
 * 2. CONFIRM - Review before action (summary of what will happen)
 * 3. INPUT   - Fill required details (smart form with validation)
 * 4. RESULT  - Show outcome (success/error status + receipt)
 */

// =============================================================================
// TRANSACTION STATE TYPES
// =============================================================================

export type TransactionState = 'select' | 'confirm' | 'input' | 'result';

export interface SelectionItem {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  icon?: string;
  badge?: string;
  detail?: string;
  metadata?: Record<string, any>;
}

export interface ConfirmationData {
  title: string;
  description?: string;
  items: Array<{ label: string; value: string }>;
  warning?: string;
  actions: {
    confirm: string;
    cancel?: string;
  };
}

export interface InputField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'password' | 'date' | 'select' | 'textarea';
  placeholder?: string;
  hint?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
}

export interface ResultData {
  status: 'success' | 'error' | 'pending';
  title: string;
  message?: string;
  details?: Array<{ label: string; value: string }>;
  actions?: Array<{ label: string; action: string }>;
}

// =============================================================================
// CSS GENERATION
// =============================================================================

export function generateTransactionCSS(): string {
  return `
/* ==========================================================================
   Photon Transaction UI
   Purpose-built for AI+Human decision workflows
   ========================================================================== */

/* -----------------------------------------------------------------------------
   Base Reset & Foundation
   ----------------------------------------------------------------------------- */

.photon-tx {
  font-family: var(--font-sans);
  font-size: var(--text-body-md);
  line-height: var(--leading-body-md);
  color: var(--color-on-surface);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.photon-tx * {
  box-sizing: border-box;
}

/* -----------------------------------------------------------------------------
   SELECT State - Pick from options
   ----------------------------------------------------------------------------- */

/* Selection Grid - for visual items (images) */
.tx-select-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-4);
}

.tx-select-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
.tx-select-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
.tx-select-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }

/* Selection Card */
.tx-select-card {
  display: flex;
  flex-direction: column;
  background: var(--color-surface-container);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-standard);
}

.tx-select-card:hover {
  background: var(--color-surface-container-high);
  box-shadow: var(--elevation-2);
  transform: translateY(-2px);
}

.tx-select-card:active {
  transform: translateY(0);
}

.tx-select-card.selected {
  border-color: var(--color-primary);
  background: var(--color-surface-container-high);
}

.tx-select-card-image {
  width: 100%;
  aspect-ratio: 4/3;
  object-fit: cover;
  background: var(--color-surface-container-highest);
}

.tx-select-card-image.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-display-sm);
  color: var(--color-on-surface-muted);
}

.tx-select-card-body {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.tx-select-card-title {
  font-size: var(--text-title-md);
  font-weight: var(--weight-medium);
  color: var(--color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-select-card-subtitle {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-select-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-2);
}

.tx-select-card-detail {
  font-size: var(--text-title-md);
  font-weight: var(--weight-semibold);
  color: var(--color-on-surface);
}

.tx-select-card-badge {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-label-sm);
  font-weight: var(--weight-medium);
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
}

/* Selection List - for text-focused items */
.tx-select-list {
  display: flex;
  flex-direction: column;
  background: var(--color-surface-container);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tx-select-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  min-height: var(--touch-min);
  border-bottom: 1px solid var(--color-outline-variant);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.tx-select-item:last-child {
  border-bottom: none;
}

.tx-select-item:hover {
  background: var(--color-surface-container-high);
}

.tx-select-item:active {
  background: var(--color-surface-container-highest);
}

.tx-select-item.selected {
  background: var(--color-primary-container);
}

.tx-select-item-leading {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-surface-container-highest);
  font-size: var(--text-title-lg);
}

.tx-select-item-leading img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-sm);
}

.tx-select-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tx-select-item-title {
  font-size: var(--text-body-lg);
  font-weight: var(--weight-medium);
  color: var(--color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-select-item-subtitle {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-select-item-trailing {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.tx-select-item-detail {
  font-size: var(--text-body-md);
  font-weight: var(--weight-medium);
  color: var(--color-on-surface);
}

.tx-select-item-chevron {
  color: var(--color-on-surface-muted);
  font-size: var(--text-title-md);
}

/* Status Badges */
.tx-badge {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-label-sm);
  font-weight: var(--weight-medium);
}

.tx-badge-success {
  background: var(--color-success-container);
  color: var(--color-on-success-container);
}

.tx-badge-warning {
  background: var(--color-warning-container);
  color: var(--color-on-warning-container);
}

.tx-badge-error {
  background: var(--color-error-container);
  color: var(--color-on-error-container);
}

.tx-badge-neutral {
  background: var(--color-surface-container-highest);
  color: var(--color-on-surface-variant);
}

/* -----------------------------------------------------------------------------
   CONFIRM State - Review before action
   ----------------------------------------------------------------------------- */

.tx-confirm {
  background: var(--color-surface-container);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.tx-confirm-header {
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-outline-variant);
}

.tx-confirm-title {
  font-size: var(--text-headline-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-on-surface);
  margin: 0;
}

.tx-confirm-description {
  font-size: var(--text-body-md);
  color: var(--color-on-surface-variant);
  margin-top: var(--space-2);
}

.tx-confirm-body {
  padding: 0;
}

.tx-confirm-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-outline-variant);
}

.tx-confirm-row:last-child {
  border-bottom: none;
}

.tx-confirm-label {
  font-size: var(--text-body-md);
  color: var(--color-on-surface-variant);
}

.tx-confirm-value {
  font-size: var(--text-body-md);
  font-weight: var(--weight-medium);
  color: var(--color-on-surface);
  text-align: right;
}

.tx-confirm-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--color-warning-container);
  color: var(--color-on-warning-container);
  font-size: var(--text-body-sm);
}

.tx-confirm-warning-icon {
  flex-shrink: 0;
  font-size: var(--text-title-md);
}

.tx-confirm-actions {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  border-top: 1px solid var(--color-outline-variant);
}

/* -----------------------------------------------------------------------------
   INPUT State - Fill required details
   ----------------------------------------------------------------------------- */

.tx-input-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.tx-input-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.tx-input-label {
  font-size: var(--text-label-lg);
  font-weight: var(--weight-medium);
  color: var(--color-on-surface);
}

.tx-input-label .required {
  color: var(--color-error);
  margin-left: var(--space-1);
}

.tx-input-control {
  width: 100%;
  padding: var(--space-3);
  min-height: var(--touch-min);
  font-family: inherit;
  font-size: var(--text-body-lg);
  color: var(--color-on-surface);
  background: var(--color-surface-container);
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard);
}

.tx-input-control::placeholder {
  color: var(--color-on-surface-muted);
}

.tx-input-control:hover {
  border-color: var(--color-on-surface-variant);
}

.tx-input-control:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-container);
}

.tx-input-control.error {
  border-color: var(--color-error);
}

.tx-input-control.error:focus {
  box-shadow: 0 0 0 3px var(--color-error-container);
}

.tx-input-hint {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-muted);
}

.tx-input-error {
  font-size: var(--text-body-sm);
  color: var(--color-error);
}

textarea.tx-input-control {
  min-height: 100px;
  resize: vertical;
}

select.tx-input-control {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23808080' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--space-3) center;
  padding-right: var(--space-8);
}

/* -----------------------------------------------------------------------------
   RESULT State - Show outcome
   ----------------------------------------------------------------------------- */

.tx-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-8) var(--space-4);
  background: var(--color-surface-container);
  border-radius: var(--radius-lg);
}

.tx-result-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  font-size: var(--text-display-sm);
  margin-bottom: var(--space-4);
}

.tx-result-icon.success {
  background: var(--color-success-container);
  color: var(--color-success);
}

.tx-result-icon.error {
  background: var(--color-error-container);
  color: var(--color-error);
}

.tx-result-icon.pending {
  background: var(--color-warning-container);
  color: var(--color-warning);
}

.tx-result-title {
  font-size: var(--text-headline-md);
  font-weight: var(--weight-semibold);
  color: var(--color-on-surface);
  margin: 0;
}

.tx-result-message {
  font-size: var(--text-body-lg);
  color: var(--color-on-surface-variant);
  margin-top: var(--space-2);
  max-width: 400px;
}

.tx-result-details {
  width: 100%;
  max-width: 400px;
  margin-top: var(--space-6);
  background: var(--color-surface-container-high);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tx-result-detail-row {
  display: flex;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-outline-variant);
}

.tx-result-detail-row:last-child {
  border-bottom: none;
}

.tx-result-detail-label {
  font-size: var(--text-body-sm);
  color: var(--color-on-surface-muted);
}

.tx-result-detail-value {
  font-size: var(--text-body-sm);
  font-weight: var(--weight-medium);
  color: var(--color-on-surface);
}

.tx-result-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-6);
}

/* -----------------------------------------------------------------------------
   Buttons
   ----------------------------------------------------------------------------- */

.tx-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: var(--touch-min);
  padding: 0 var(--space-5);
  font-family: inherit;
  font-size: var(--text-label-lg);
  font-weight: var(--weight-medium);
  border-radius: var(--radius-full);
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-standard);
}

.tx-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.tx-btn-primary {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.tx-btn-primary:hover {
  box-shadow: var(--elevation-1);
  filter: brightness(1.1);
}

.tx-btn-primary:active {
  filter: brightness(0.95);
}

.tx-btn-secondary {
  background: var(--color-surface-container-high);
  color: var(--color-on-surface);
  border: 1px solid var(--color-outline);
}

.tx-btn-secondary:hover {
  background: var(--color-surface-container-highest);
}

.tx-btn-ghost {
  background: transparent;
  color: var(--color-primary);
}

.tx-btn-ghost:hover {
  background: var(--color-primary-container);
}

.tx-btn-danger {
  background: var(--color-error);
  color: var(--color-on-error);
}

.tx-btn-danger:hover {
  filter: brightness(1.1);
}

.tx-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tx-btn.full-width {
  width: 100%;
}

/* -----------------------------------------------------------------------------
   Empty State
   ----------------------------------------------------------------------------- */

.tx-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
  text-align: center;
  color: var(--color-on-surface-muted);
}

.tx-empty-icon {
  font-size: var(--text-display-md);
  margin-bottom: var(--space-4);
  opacity: 0.5;
}

.tx-empty-title {
  font-size: var(--text-title-md);
  font-weight: var(--weight-medium);
  color: var(--color-on-surface-variant);
}

.tx-empty-message {
  font-size: var(--text-body-md);
  margin-top: var(--space-2);
}

/* -----------------------------------------------------------------------------
   Loading State
   ----------------------------------------------------------------------------- */

.tx-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
}

.tx-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--color-outline-variant);
  border-top-color: var(--color-primary);
  border-radius: var(--radius-full);
  animation: tx-spin 1s linear infinite;
}

@keyframes tx-spin {
  to { transform: rotate(360deg); }
}

.tx-loading-text {
  font-size: var(--text-body-md);
  color: var(--color-on-surface-variant);
  margin-top: var(--space-4);
}
`;
}

// =============================================================================
// JAVASCRIPT GENERATION (for embedded HTML)
// =============================================================================

export function generateTransactionJS(): string {
  return `
// Photon Transaction UI JavaScript

/**
 * Detect transaction state from data
 */
function detectTransactionState(data, method) {
  // Check for result patterns
  if (data && typeof data === 'object') {
    if ('status' in data && ('success' in data || 'error' in data || 'message' in data)) {
      return 'result';
    }
    if ('confirm' in data || 'warning' in data || 'actions' in data) {
      return 'confirm';
    }
  }

  // Arrays with selectable items -> select state
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    return 'select';
  }

  // Default to showing as data
  return null;
}

/**
 * Render Selection Grid (for visual items)
 */
function renderSelectGrid(items, mapping, columns) {
  if (!items || items.length === 0) {
    return renderEmpty('No items to select');
  }

  const colClass = columns ? 'cols-' + columns : '';

  return '<div class="tx-select-grid ' + colClass + '">' +
    items.map((item, i) => renderSelectCard(item, mapping, i)).join('') +
    '</div>';
}

/**
 * Render Selection Card
 */
function renderSelectCard(item, mapping, index) {
  const id = item[mapping.id] || item.id || index;
  const title = item[mapping.title] || item.title || item.name || 'Item ' + (index + 1);
  const subtitle = item[mapping.subtitle] || item.subtitle || item.description || '';
  const image = item[mapping.image] || item.image || item.photo || item.thumbnail;
  const icon = item[mapping.icon] || item.icon || item.avatar;
  const detail = item[mapping.detail] || item.detail || item.price;
  const badge = item[mapping.badge] || item.badge || item.status;

  let imageHtml = '';
  if (image) {
    imageHtml = '<img class="tx-select-card-image" src="' + escapeHtml(image) + '" alt="" loading="lazy">';
  } else if (icon) {
    imageHtml = '<div class="tx-select-card-image placeholder">' + escapeHtml(icon) + '</div>';
  } else {
    imageHtml = '<div class="tx-select-card-image placeholder">📦</div>';
  }

  let footerHtml = '';
  if (detail || badge) {
    footerHtml = '<div class="tx-select-card-footer">';
    if (detail) {
      footerHtml += '<span class="tx-select-card-detail">' + escapeHtml(formatValue(detail)) + '</span>';
    }
    if (badge) {
      footerHtml += '<span class="tx-select-card-badge ' + getBadgeClass(badge) + '">' + escapeHtml(badge) + '</span>';
    }
    footerHtml += '</div>';
  }

  return '<div class="tx-select-card" data-id="' + escapeHtml(String(id)) + '" onclick="handleSelect(this)">' +
    imageHtml +
    '<div class="tx-select-card-body">' +
      '<div class="tx-select-card-title">' + escapeHtml(title) + '</div>' +
      (subtitle ? '<div class="tx-select-card-subtitle">' + escapeHtml(subtitle) + '</div>' : '') +
      footerHtml +
    '</div>' +
  '</div>';
}

/**
 * Render Selection List (for text-focused items)
 */
function renderSelectList(items, mapping) {
  if (!items || items.length === 0) {
    return renderEmpty('No items to select');
  }

  return '<div class="tx-select-list">' +
    items.map((item, i) => renderSelectItem(item, mapping, i)).join('') +
    '</div>';
}

/**
 * Render Selection List Item
 */
function renderSelectItem(item, mapping, index) {
  const id = item[mapping.id] || item.id || index;
  const title = item[mapping.title] || item.title || item.name || 'Item ' + (index + 1);
  const subtitle = item[mapping.subtitle] || item.subtitle || item.description || item.email || '';
  const icon = item[mapping.icon] || item.icon || item.avatar;
  const detail = item[mapping.detail] || item.detail;
  const badge = item[mapping.badge] || item.badge || item.status;

  let leadingHtml = '';
  if (icon) {
    if (icon.startsWith('http') || icon.startsWith('/')) {
      leadingHtml = '<div class="tx-select-item-leading"><img src="' + escapeHtml(icon) + '" alt=""></div>';
    } else {
      leadingHtml = '<div class="tx-select-item-leading">' + escapeHtml(icon) + '</div>';
    }
  }

  let trailingHtml = '<div class="tx-select-item-trailing">';
  if (detail) {
    trailingHtml += '<span class="tx-select-item-detail">' + escapeHtml(formatValue(detail)) + '</span>';
  }
  if (badge) {
    trailingHtml += '<span class="tx-badge ' + getBadgeClass(badge) + '">' + escapeHtml(badge) + '</span>';
  }
  trailingHtml += '<span class="tx-select-item-chevron">›</span></div>';

  return '<div class="tx-select-item" data-id="' + escapeHtml(String(id)) + '" onclick="handleSelect(this)">' +
    leadingHtml +
    '<div class="tx-select-item-content">' +
      '<div class="tx-select-item-title">' + escapeHtml(title) + '</div>' +
      (subtitle ? '<div class="tx-select-item-subtitle">' + escapeHtml(subtitle) + '</div>' : '') +
    '</div>' +
    trailingHtml +
  '</div>';
}

/**
 * Render Confirmation Card
 */
function renderConfirm(data) {
  let html = '<div class="tx-confirm">';

  // Header
  html += '<div class="tx-confirm-header">';
  html += '<h3 class="tx-confirm-title">' + escapeHtml(data.title || 'Confirm') + '</h3>';
  if (data.description) {
    html += '<p class="tx-confirm-description">' + escapeHtml(data.description) + '</p>';
  }
  html += '</div>';

  // Body
  if (data.items && data.items.length > 0) {
    html += '<div class="tx-confirm-body">';
    data.items.forEach(function(item) {
      html += '<div class="tx-confirm-row">' +
        '<span class="tx-confirm-label">' + escapeHtml(item.label) + '</span>' +
        '<span class="tx-confirm-value">' + escapeHtml(item.value) + '</span>' +
      '</div>';
    });
    html += '</div>';
  }

  // Warning
  if (data.warning) {
    html += '<div class="tx-confirm-warning">' +
      '<span class="tx-confirm-warning-icon">⚠️</span>' +
      '<span>' + escapeHtml(data.warning) + '</span>' +
    '</div>';
  }

  // Actions
  html += '<div class="tx-confirm-actions">';
  if (data.actions?.cancel) {
    html += '<button class="tx-btn tx-btn-secondary" onclick="handleCancel()">' + escapeHtml(data.actions.cancel) + '</button>';
  }
  html += '<button class="tx-btn tx-btn-primary" onclick="handleConfirm()">' + escapeHtml(data.actions?.confirm || 'Confirm') + '</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

/**
 * Render Result Card
 */
function renderResult(data) {
  const status = data.status || (data.success ? 'success' : data.error ? 'error' : 'pending');
  const icons = { success: '✓', error: '✗', pending: '⏳' };

  let html = '<div class="tx-result">';

  // Icon
  html += '<div class="tx-result-icon ' + status + '">' + icons[status] + '</div>';

  // Title
  html += '<h3 class="tx-result-title">' + escapeHtml(data.title || (status === 'success' ? 'Success' : status === 'error' ? 'Error' : 'Processing')) + '</h3>';

  // Message
  if (data.message) {
    html += '<p class="tx-result-message">' + escapeHtml(data.message) + '</p>';
  }

  // Details
  if (data.details && data.details.length > 0) {
    html += '<div class="tx-result-details">';
    data.details.forEach(function(item) {
      html += '<div class="tx-result-detail-row">' +
        '<span class="tx-result-detail-label">' + escapeHtml(item.label) + '</span>' +
        '<span class="tx-result-detail-value">' + escapeHtml(item.value) + '</span>' +
      '</div>';
    });
    html += '</div>';
  }

  // Actions
  if (data.actions && data.actions.length > 0) {
    html += '<div class="tx-result-actions">';
    data.actions.forEach(function(action, i) {
      const btnClass = i === 0 ? 'tx-btn-primary' : 'tx-btn-secondary';
      html += '<button class="tx-btn ' + btnClass + '" onclick="handleAction(\\'' + escapeHtml(action.action) + '\\')">' + escapeHtml(action.label) + '</button>';
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Render Empty State
 */
function renderEmpty(message) {
  return '<div class="tx-empty">' +
    '<div class="tx-empty-icon">📭</div>' +
    '<div class="tx-empty-title">Nothing here</div>' +
    '<div class="tx-empty-message">' + escapeHtml(message || 'No items available') + '</div>' +
  '</div>';
}

/**
 * Render Loading State
 */
function renderLoading(message) {
  return '<div class="tx-loading">' +
    '<div class="tx-spinner"></div>' +
    '<div class="tx-loading-text">' + escapeHtml(message || 'Loading...') + '</div>' +
  '</div>';
}

/**
 * Format value for display
 */
function formatValue(value) {
  if (typeof value === 'number') {
    // Check if it looks like currency
    if (value > 0 && value < 100000) {
      return '$' + value.toFixed(2);
    }
    return value.toLocaleString();
  }
  return String(value);
}

/**
 * Get badge class based on value
 */
function getBadgeClass(value) {
  const lower = String(value).toLowerCase();
  if (/success|complete|active|available|yes|true|done/.test(lower)) return 'tx-badge-success';
  if (/error|failed|inactive|unavailable|no|false/.test(lower)) return 'tx-badge-error';
  if (/pending|warning|waiting|processing/.test(lower)) return 'tx-badge-warning';
  return 'tx-badge-neutral';
}

/**
 * Handle selection
 */
function handleSelect(element) {
  // Remove previous selection
  document.querySelectorAll('.tx-select-card.selected, .tx-select-item.selected').forEach(function(el) {
    el.classList.remove('selected');
  });

  // Add selection
  element.classList.add('selected');

  // Get selected ID
  const id = element.dataset.id;
  console.log('Selected:', id);

  // Dispatch event for parent to handle
  window.dispatchEvent(new CustomEvent('photon-select', { detail: { id: id } }));
}

/**
 * Handle confirm action
 */
function handleConfirm() {
  window.dispatchEvent(new CustomEvent('photon-confirm'));
}

/**
 * Handle cancel action
 */
function handleCancel() {
  window.dispatchEvent(new CustomEvent('photon-cancel'));
}

/**
 * Handle custom action
 */
function handleAction(action) {
  window.dispatchEvent(new CustomEvent('photon-action', { detail: { action: action } }));
}
`;
}
