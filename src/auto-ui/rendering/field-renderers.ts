/**
 * Field Renderers - Type-specific value rendering
 *
 * Provides specialized renderers for different field types:
 * - Email (mailto link)
 * - URL (clickable link)
 * - Date (formatted)
 * - Currency ($X.XX)
 * - Boolean (checkmark)
 * - Badge (status pill)
 * - Code (syntax highlighted)
 */

export type FieldRendererType =
  | 'text'
  | 'email'
  | 'url'
  | 'link'
  | 'date'
  | 'currency'
  | 'boolean'
  | 'badge'
  | 'code'
  | 'image';

export interface FieldRendererOptions {
  escapeHtml: (str: string) => string;
  locale?: string;
  currency?: string;
  dateFormat?: 'short' | 'medium' | 'long' | 'relative';
}

/**
 * Render a field value based on its type
 */
export function renderField(
  value: any,
  type: FieldRendererType,
  options: FieldRendererOptions
): string {
  const { escapeHtml, locale = 'en-US', currency = 'USD', dateFormat = 'medium' } = options;

  if (value === null || value === undefined) {
    return '<span class="field-empty">—</span>';
  }

  switch (type) {
    case 'email':
      return renderEmail(value, escapeHtml);
    case 'url':
    case 'link':
      return renderUrl(value, escapeHtml);
    case 'date':
      return renderDate(value, dateFormat, locale);
    case 'currency':
      return renderCurrency(value, currency, locale);
    case 'boolean':
      return renderBoolean(value);
    case 'badge':
      return renderBadge(value, escapeHtml);
    case 'code':
      return renderCode(value, escapeHtml);
    case 'image':
      return renderImage(value, escapeHtml);
    case 'text':
    default:
      return escapeHtml(String(value));
  }
}

/**
 * Render email as mailto link
 */
export function renderEmail(value: any, escapeHtml: (s: string) => string): string {
  const email = String(value);
  return `<a href="mailto:${escapeHtml(email)}" class="field-email">${escapeHtml(email)}</a>`;
}

/**
 * Render URL as clickable link
 */
export function renderUrl(value: any, escapeHtml: (s: string) => string): string {
  const url = String(value);
  // Add protocol if missing
  const href = url.startsWith('http') ? url : `https://${url}`;
  // Display shortened URL
  const display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="field-url">${escapeHtml(display)}</a>`;
}

/**
 * Render date with formatting
 */
export function renderDate(
  value: any,
  format: 'short' | 'medium' | 'long' | 'relative',
  locale: string
): string {
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return `<span class="field-date">${String(value)}</span>`;
    }

    if (format === 'relative') {
      const diff = Date.now() - date.getTime();
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      let text: string;
      if (days > 30) {
        text = date.toLocaleDateString(locale);
      } else if (days > 0) {
        text = `${days}d ago`;
      } else if (hours > 0) {
        text = `${hours}h ago`;
      } else if (minutes > 0) {
        text = `${minutes}m ago`;
      } else {
        text = 'just now';
      }
      return `<span class="field-date" title="${date.toISOString()}">${text}</span>`;
    }

    const options: Intl.DateTimeFormatOptions = format === 'short'
      ? { month: 'numeric', day: 'numeric', year: '2-digit' }
      : format === 'long'
        ? { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', year: 'numeric' };

    return `<span class="field-date">${date.toLocaleDateString(locale, options)}</span>`;
  } catch {
    return `<span class="field-date">${String(value)}</span>`;
  }
}

/**
 * Render number as currency
 */
export function renderCurrency(value: any, currency: string, locale: string): string {
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) {
    return `<span class="field-currency">${String(value)}</span>`;
  }

  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(num);

  return `<span class="field-currency">${formatted}</span>`;
}

/**
 * Render boolean as checkmark
 */
export function renderBoolean(value: any): string {
  const bool = Boolean(value);
  const icon = bool ? '✓' : '✗';
  const className = bool ? 'field-boolean true' : 'field-boolean false';
  return `<span class="${className}">${icon}</span>`;
}

/**
 * Render value as status badge
 */
export function renderBadge(value: any, escapeHtml: (s: string) => string): string {
  const text = String(value);
  const lower = text.toLowerCase();

  let statusClass = '';
  if (/active|success|complete|done|enabled|yes|true|approved/.test(lower)) {
    statusClass = 'status-success';
  } else if (/inactive|error|failed|disabled|no|false|rejected|cancelled/.test(lower)) {
    statusClass = 'status-error';
  } else if (/pending|warning|waiting|processing|review/.test(lower)) {
    statusClass = 'status-warning';
  } else if (/draft|new|created/.test(lower)) {
    statusClass = 'status-info';
  }

  return `<span class="field-badge ${statusClass}">${escapeHtml(text)}</span>`;
}

/**
 * Render value as code
 */
export function renderCode(value: any, escapeHtml: (s: string) => string): string {
  const code = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return `<code class="field-code">${escapeHtml(code)}</code>`;
}

/**
 * Render value as image
 */
export function renderImage(value: any, escapeHtml: (s: string) => string): string {
  const url = String(value);
  return `<img src="${escapeHtml(url)}" class="field-image" alt="" loading="lazy">`;
}

/**
 * Generate CSS for field renderers
 */
export function generateFieldRendererCSS(): string {
  return `
/* Field Renderers */
.field-empty {
  color: var(--text-tertiary);
}

.field-email,
.field-url {
  color: var(--accent-color);
  text-decoration: none;
}

.field-email:hover,
.field-url:hover {
  text-decoration: underline;
}

.field-date {
  color: var(--text-secondary);
}

.field-currency {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.field-boolean {
  font-weight: 600;
}

.field-boolean.true {
  color: #22c55e;
}

.field-boolean.false {
  color: #ef4444;
}

.field-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: capitalize;
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.field-badge.status-success {
  background: #dcfce7;
  color: #166534;
}

.field-badge.status-error {
  background: #fee2e2;
  color: #991b1b;
}

.field-badge.status-warning {
  background: #fef3c7;
  color: #92400e;
}

.field-badge.status-info {
  background: #dbeafe;
  color: #1e40af;
}

.field-code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: 4px;
}

.field-image {
  max-width: 100%;
  max-height: 200px;
  border-radius: 8px;
  object-fit: cover;
}
`;
}

/**
 * Generate JavaScript for field renderers (to embed in HTML)
 */
export function generateFieldRenderersJS(): string {
  return `
// Field Renderers

function renderFieldByType(value, type) {
  if (value === null || value === undefined) {
    return '<span class="field-empty">—</span>';
  }

  switch (type) {
    case 'email':
      return '<a href="mailto:' + escapeHtml(value) + '" class="field-email">' + escapeHtml(value) + '</a>';

    case 'url':
    case 'link':
      const href = String(value).startsWith('http') ? value : 'https://' + value;
      const display = String(value).replace(/^https?:\\/\\//, '').replace(/\\/$/, '');
      return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener" class="field-url">' + escapeHtml(display) + '</a>';

    case 'date':
      try {
        const date = new Date(value);
        if (isNaN(date.getTime())) return escapeHtml(String(value));
        return '<span class="field-date">' + date.toLocaleDateString() + '</span>';
      } catch {
        return escapeHtml(String(value));
      }

    case 'currency':
      const num = typeof value === 'number' ? value : parseFloat(value);
      if (isNaN(num)) return escapeHtml(String(value));
      return '<span class="field-currency">$' + num.toFixed(2) + '</span>';

    case 'boolean':
      const bool = Boolean(value);
      return '<span class="field-boolean ' + (bool ? 'true' : 'false') + '">' + (bool ? '✓' : '✗') + '</span>';

    case 'badge':
      const text = String(value);
      const lower = text.toLowerCase();
      let statusClass = '';
      if (/active|success|complete|done|enabled|yes|true|approved/.test(lower)) statusClass = 'status-success';
      else if (/inactive|error|failed|disabled|no|false|rejected|cancelled/.test(lower)) statusClass = 'status-error';
      else if (/pending|warning|waiting|processing|review/.test(lower)) statusClass = 'status-warning';
      else if (/draft|new|created/.test(lower)) statusClass = 'status-info';
      return '<span class="field-badge ' + statusClass + '">' + escapeHtml(text) + '</span>';

    case 'code':
      const code = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      return '<code class="field-code">' + escapeHtml(code) + '</code>';

    case 'image':
      return '<img src="' + escapeHtml(String(value)) + '" class="field-image" alt="" loading="lazy">';

    case 'text':
    default:
      return escapeHtml(String(value));
  }
}
`;
}
