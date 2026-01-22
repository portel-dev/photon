import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';

type LayoutType = 'table' | 'list' | 'card' | 'tree' | 'json' | 'markdown' | 'mermaid' | 'code' | 'text' | 'chips';

interface LayoutHints {
  title?: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  detail?: string;
  style?: string;
  columns?: string;
  filter?: string;
}

@customElement('result-viewer')
export class ResultViewer extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        margin-top: var(--space-md);
      }

      .container {
        padding: var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        position: relative;
        overflow: hidden;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-sm);
        padding-bottom: var(--space-sm);
        border-bottom: 1px solid var(--border-glass);
      }

      .title {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--t-muted);
        font-weight: 600;
      }

      .format-badge {
        font-size: 0.7rem;
        padding: 2px 8px;
        background: var(--bg-glass-strong);
        border: 1px solid var(--border-glass);
        border-radius: 10px;
        color: var(--accent-secondary);
      }

      .actions {
        display: flex;
        gap: var(--space-sm);
      }

      button {
        background: transparent;
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        border-radius: var(--radius-sm);
        cursor: pointer;
        padding: 4px 8px;
        font-size: 0.75rem;
        transition: all 0.2s;
      }

      button:hover {
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-primary);
      }

      .content {
        font-family: var(--font-mono);
        font-size: 0.9rem;
        color: var(--t-primary);
        white-space: pre-wrap;
        overflow-x: auto;
        max-height: 500px;
        line-height: 1.5;
      }

      /* JSON Syntax Highlighting */
      .json-key { color: var(--accent-secondary); }
      .json-string { color: #a5d6ff; }
      .json-number { color: #ff9e64; }
      .json-boolean { color: #ff007c; }
      .json-null { color: #79c0ff; }

      /* Table Styles */
      .smart-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-sans);
        font-size: 0.9rem;
      }

      .smart-table th {
        text-align: left;
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-glass-strong);
        border-bottom: 1px solid var(--border-glass);
        color: var(--t-muted);
        font-weight: 600;
        text-transform: capitalize;
      }

      .smart-table td {
        padding: var(--space-sm) var(--space-md);
        border-bottom: 1px solid var(--border-glass);
        color: var(--t-primary);
      }

      .smart-table tr:hover td {
        background: hsla(220, 10%, 80%, 0.05);
      }

      /* List Styles */
      .smart-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        background: var(--border-glass);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }

      .list-item {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-panel);
        font-family: var(--font-sans);
      }

      .list-item-leading {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-glass);
        border-radius: var(--radius-sm);
        font-size: 1rem;
        flex-shrink: 0;
      }

      .list-item-leading img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--radius-sm);
      }

      .list-item-content {
        flex: 1;
        min-width: 0;
      }

      .list-item-title {
        font-weight: 500;
        color: var(--t-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .list-item-subtitle {
        font-size: 0.85rem;
        color: var(--t-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .list-item-trailing {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex-shrink: 0;
      }

      .status-badge {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 0.75rem;
        font-weight: 500;
      }

      .status-success, .status-active, .status-completed, .status-online {
        background: hsla(120, 60%, 50%, 0.15);
        color: hsl(120, 60%, 50%);
      }

      .status-error, .status-failed, .status-offline, .status-inactive {
        background: hsla(0, 60%, 50%, 0.15);
        color: hsl(0, 60%, 50%);
      }

      .status-warning, .status-pending, .status-processing {
        background: hsla(45, 80%, 50%, 0.15);
        color: hsl(45, 80%, 50%);
      }

      /* Card Styles */
      .smart-card {
        padding: var(--space-md);
        font-family: var(--font-sans);
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        margin-bottom: var(--space-md);
        padding-bottom: var(--space-md);
        border-bottom: 1px solid var(--border-glass);
      }

      .card-icon {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-glass);
        border-radius: var(--radius-md);
        font-size: 1.5rem;
      }

      .card-title {
        font-size: 1.2rem;
        font-weight: 600;
        color: var(--t-primary);
      }

      .card-subtitle {
        color: var(--t-muted);
        font-size: 0.9rem;
      }

      .card-fields {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--space-md);
      }

      .card-field {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .card-field-label {
        font-size: 0.75rem;
        color: var(--t-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .card-field-value {
        color: var(--t-primary);
      }

      /* Chips Styles */
      .smart-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-sm);
        font-family: var(--font-sans);
      }

      .chip {
        padding: var(--space-xs) var(--space-md);
        background: var(--bg-glass-strong);
        border: 1px solid var(--border-glass);
        border-radius: 20px;
        font-size: 0.85rem;
        color: var(--t-primary);
      }

      /* Markdown Styles */
      .markdown-body {
        font-family: var(--font-sans);
        line-height: 1.6;
      }

      .markdown-body p { margin-bottom: 0.5em; }
      .markdown-body code { background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; }
      .markdown-body pre { background: rgba(0,0,0,0.3); padding: 1em; border-radius: 8px; overflow-x: auto; }
      .markdown-body ul, .markdown-body ol { margin-left: 1.5em; margin-bottom: 0.5em; }
      .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 1em; margin-bottom: 0.5em; color: var(--t-primary); }
      .markdown-body a { color: var(--accent-primary); text-decoration: none; }
      .markdown-body a:hover { text-decoration: underline; }
      .markdown-body table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      .markdown-body th, .markdown-body td { border: 1px solid var(--border-glass); padding: 8px; text-align: left; }
      .markdown-body th { background: rgba(255,255,255,0.05); }

      /* Empty State */
      .empty-state {
        text-align: center;
        padding: var(--space-lg);
        color: var(--t-muted);
        font-style: italic;
      }

      /* Filter Input */
      .filter-container {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex: 1;
        max-width: 300px;
      }

      .filter-input {
        flex: 1;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        padding: 4px 10px;
        color: var(--t-primary);
        font-size: 0.8rem;
        font-family: var(--font-sans);
      }

      .filter-input:focus {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      .filter-input::placeholder {
        color: var(--t-muted);
        opacity: 0.6;
      }

      .filter-count {
        font-size: 0.75rem;
        color: var(--t-muted);
        white-space: nowrap;
      }

      .filter-count.filtered {
        color: var(--accent-secondary);
      }

      /* Highlight matching text */
      .highlight {
        background: hsla(45, 80%, 50%, 0.3);
        border-radius: 2px;
        padding: 0 1px;
      }

      /* Sortable Table Headers */
      .smart-table th.sortable {
        cursor: pointer;
        user-select: none;
        transition: background 0.2s;
      }

      .smart-table th.sortable:hover {
        background: var(--bg-glass);
      }

      .sort-indicator {
        margin-left: 4px;
        opacity: 0.5;
        font-size: 0.8em;
      }

      .smart-table th.sorted .sort-indicator {
        opacity: 1;
        color: var(--accent-secondary);
      }

      /* Pagination */
      .pagination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-sm) 0;
        margin-top: var(--space-sm);
        border-top: 1px solid var(--border-glass);
        font-family: var(--font-sans);
        font-size: 0.85rem;
      }

      .pagination-info {
        color: var(--t-muted);
      }

      .pagination-controls {
        display: flex;
        gap: var(--space-xs);
      }

      .pagination-btn {
        padding: 4px 10px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        color: var(--t-primary);
        cursor: pointer;
        font-size: 0.8rem;
      }

      .pagination-btn:hover:not(:disabled) {
        background: var(--bg-glass-strong);
        border-color: var(--accent-secondary);
      }

      .pagination-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .pagination-btn.active {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      /* Tree Component */
      .tree-container {
        font-family: var(--font-sans);
        font-size: 0.9rem;
      }

      .tree-node {
        margin-left: var(--space-md);
        position: relative;
      }

      .tree-node::before {
        content: '';
        position: absolute;
        left: -12px;
        top: 0;
        height: 100%;
        border-left: 1px dashed var(--border-glass);
      }

      .tree-node:last-child::before {
        height: 12px;
      }

      .tree-node::after {
        content: '';
        position: absolute;
        left: -12px;
        top: 12px;
        width: 12px;
        border-bottom: 1px dashed var(--border-glass);
      }

      .tree-item {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-xs) var(--space-sm);
        margin: 2px 0;
        border-radius: var(--radius-sm);
        cursor: default;
      }

      .tree-item:hover {
        background: hsla(220, 10%, 80%, 0.1);
      }

      .tree-toggle {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--t-muted);
        font-size: 0.7rem;
        flex-shrink: 0;
      }

      .tree-toggle:hover {
        color: var(--accent-secondary);
      }

      .tree-key {
        color: var(--accent-secondary);
        font-weight: 500;
      }

      .tree-value {
        color: var(--t-primary);
      }

      .tree-value.string { color: #a5d6ff; }
      .tree-value.number { color: #ff9e64; }
      .tree-value.boolean { color: #ff007c; }
      .tree-value.null { color: #79c0ff; }

      .tree-type {
        color: var(--t-muted);
        font-size: 0.75rem;
        opacity: 0.7;
      }

      .tree-root {
        margin-left: 0;
      }

      .tree-root::before,
      .tree-root::after {
        display: none;
      }
    `
  ];

  @property({ type: Object })
  result: any = null;

  @property({ type: String })
  outputFormat?: string;

  @property({ type: Object })
  layoutHints?: LayoutHints;

  @state()
  private _filterQuery = '';

  @state()
  private _sortColumn: string | null = null;

  @state()
  private _sortDirection: 'asc' | 'desc' = 'asc';

  @state()
  private _currentPage = 0;

  @state()
  private _expandedNodes = new Set<string>();

  private _pageSize = 20;

  @query('.filter-input')
  private _filterInput!: HTMLInputElement;

  render() {
    if (this.result === null || this.result === undefined) return html``;

    const layout = this._selectLayout();
    const filteredData = this._getFilteredData();
    const totalCount = this._getTotalCount();
    const filteredCount = this._getFilteredCount(filteredData);
    const isFiltered = this._filterQuery.trim() !== '';

    return html`
      <div class="container glass-panel">
        <div class="header">
          <span class="title">Result</span>
          <div class="filter-container">
            <input
              type="text"
              class="filter-input"
              placeholder="Filter results..."
              .value=${this._filterQuery}
              @input=${this._handleFilterInput}
              @keydown=${this._handleFilterKeydown}
            >
            ${isFiltered ? html`
              <span class="filter-count filtered">${filteredCount} / ${totalCount}</span>
            ` : ''}
          </div>
          <div class="actions">
            ${layout !== 'json' ? html`<span class="format-badge">${layout}</span>` : ''}
            <button @click=${this._copy}>Copy</button>
          </div>
        </div>
        <div class="content">${this._renderContent(layout, filteredData)}</div>
      </div>
    `;
  }

  private _handleFilterInput(e: Event) {
    this._filterQuery = (e.target as HTMLInputElement).value;
  }

  private _handleFilterKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this._filterQuery = '';
      this._filterInput.blur();
    }
  }

  private _getTotalCount(): number {
    if (Array.isArray(this.result)) return this.result.length;
    if (typeof this.result === 'object' && this.result !== null) return Object.keys(this.result).length;
    return 1;
  }

  private _getFilteredCount(data: any): number {
    if (Array.isArray(data)) return data.length;
    if (typeof data === 'object' && data !== null) return Object.keys(data).length;
    return data !== null ? 1 : 0;
  }

  private _getFilteredData(): any {
    if (!this._filterQuery.trim()) return this.result;

    const query = this._filterQuery.toLowerCase();
    const data = this.result;

    // Array filtering
    if (Array.isArray(data)) {
      return data.filter(item => this._itemMatchesFilter(item, query));
    }

    // Object filtering (card view)
    if (typeof data === 'object' && data !== null) {
      const filtered: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        if (key.toLowerCase().includes(query) || this._valueMatchesFilter(value, query)) {
          filtered[key] = value;
        }
      }
      return Object.keys(filtered).length > 0 ? filtered : null;
    }

    // String/primitive filtering
    if (typeof data === 'string' && data.toLowerCase().includes(query)) {
      return data;
    }

    return String(data).toLowerCase().includes(query) ? data : null;
  }

  private _itemMatchesFilter(item: any, query: string): boolean {
    if (typeof item === 'string') return item.toLowerCase().includes(query);
    if (typeof item === 'object' && item !== null) {
      return Object.values(item).some(v => this._valueMatchesFilter(v, query));
    }
    return String(item).toLowerCase().includes(query);
  }

  private _valueMatchesFilter(value: any, query: string): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.toLowerCase().includes(query);
    if (typeof value === 'object') {
      return JSON.stringify(value).toLowerCase().includes(query);
    }
    return String(value).toLowerCase().includes(query);
  }

  private _highlightText(text: string): TemplateResult | string {
    if (!this._filterQuery.trim() || typeof text !== 'string') return text;

    const query = this._filterQuery.toLowerCase();
    const lower = text.toLowerCase();
    const index = lower.indexOf(query);

    if (index === -1) return text;

    const before = text.slice(0, index);
    const match = text.slice(index, index + query.length);
    const after = text.slice(index + query.length);

    return html`${before}<span class="highlight">${match}</span>${this._highlightText(after)}`;
  }

  private _selectLayout(): LayoutType {
    // 1. Explicit format from docblock
    if (this.outputFormat) {
      const format = this.outputFormat.toLowerCase();
      if (['table', 'list', 'card', 'tree', 'json', 'markdown', 'mermaid', 'code', 'text', 'chips', 'grid'].includes(format)) {
        return format as LayoutType;
      }
      // Content formats
      if (format === 'md') return 'markdown';
    }

    // 2. Detect from data shape
    const data = this.result;

    // String detection
    if (typeof data === 'string') {
      // Check for markdown indicators
      if (data.includes('```') || data.includes('##') || data.includes('**')) {
        return 'markdown';
      }
      return 'text';
    }

    // Primitives
    if (typeof data !== 'object' || data === null) {
      return 'text';
    }

    // Arrays
    if (Array.isArray(data)) {
      if (data.length === 0) return 'json';

      // Array of strings → chips
      if (data.every(item => typeof item === 'string')) {
        return 'chips';
      }

      // Array of objects → table or list
      if (data.every(item => typeof item === 'object' && item !== null)) {
        // Check if we have semantic fields for list
        const hasListFields = this._hasSemanticFields(data[0], ['name', 'title', 'status', 'state', 'description']);
        return hasListFields ? 'list' : 'table';
      }
    }

    // Single object → card
    if (typeof data === 'object') {
      return 'card';
    }

    return 'json';
  }

  private _hasSemanticFields(obj: any, fields: string[]): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj).map(k => k.toLowerCase());
    return fields.some(f => keys.includes(f.toLowerCase()));
  }

  private _renderContent(layout: LayoutType, filteredData: any): TemplateResult | string {
    if (filteredData === null) {
      return html`<div class="empty-state">No matches found</div>`;
    }

    switch (layout) {
      case 'table':
        return this._renderTable(filteredData);
      case 'list':
        return this._renderList(filteredData);
      case 'card':
        return this._renderCard(filteredData);
      case 'chips':
        return this._renderChips(filteredData);
      case 'tree':
        return this._renderTree(filteredData);
      case 'markdown':
        return this._renderMarkdown();
      case 'text':
        return this._renderText(filteredData);
      case 'json':
      default:
        return this._renderJson(filteredData);
    }
  }

  private _renderTable(data: any[]): TemplateResult {
    if (!Array.isArray(data) || data.length === 0) {
      return html`<div class="empty-state">No data</div>`;
    }

    // Get columns from first item of original result for consistency
    const originalData = Array.isArray(this.result) && this.result.length > 0 ? this.result : data;
    const columns = Object.keys(originalData[0]);

    // Apply sorting
    let sortedData = [...data];
    if (this._sortColumn) {
      sortedData.sort((a, b) => {
        const aVal = a[this._sortColumn!];
        const bVal = b[this._sortColumn!];

        // Handle null/undefined
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        // Compare based on type
        let comparison = 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }

        return this._sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    // Apply pagination
    const totalItems = sortedData.length;
    const totalPages = Math.ceil(totalItems / this._pageSize);
    const startIndex = this._currentPage * this._pageSize;
    const endIndex = Math.min(startIndex + this._pageSize, totalItems);
    const pageData = sortedData.slice(startIndex, endIndex);

    return html`
      <table class="smart-table">
        <thead>
          <tr>
            ${columns.map(col => html`
              <th
                class="sortable ${this._sortColumn === col ? 'sorted' : ''}"
                @click=${() => this._toggleSort(col)}
              >
                ${this._formatColumnName(col)}
                <span class="sort-indicator">
                  ${this._sortColumn === col
                    ? (this._sortDirection === 'asc' ? '↑' : '↓')
                    : '↕'}
                </span>
              </th>
            `)}
          </tr>
        </thead>
        <tbody>
          ${pageData.map(row => html`
            <tr>
              ${columns.map(col => html`<td>${this._formatCellValue(row[col], col, true)}</td>`)}
            </tr>
          `)}
        </tbody>
      </table>
      ${totalItems > this._pageSize ? this._renderPagination(totalItems, totalPages) : ''}
    `;
  }

  private _toggleSort(column: string) {
    if (this._sortColumn === column) {
      this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortColumn = column;
      this._sortDirection = 'asc';
    }
    this._currentPage = 0; // Reset to first page when sorting
  }

  private _renderPagination(totalItems: number, totalPages: number): TemplateResult {
    const startItem = this._currentPage * this._pageSize + 1;
    const endItem = Math.min((this._currentPage + 1) * this._pageSize, totalItems);

    // Calculate visible page buttons (max 5)
    let startPage = Math.max(0, this._currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 5);
    if (endPage - startPage < 5) {
      startPage = Math.max(0, endPage - 5);
    }

    return html`
      <div class="pagination">
        <span class="pagination-info">
          Showing ${startItem}-${endItem} of ${totalItems}
        </span>
        <div class="pagination-controls">
          <button
            class="pagination-btn"
            ?disabled=${this._currentPage === 0}
            @click=${() => this._currentPage = 0}
          >«</button>
          <button
            class="pagination-btn"
            ?disabled=${this._currentPage === 0}
            @click=${() => this._currentPage--}
          >‹</button>
          ${Array.from({ length: endPage - startPage }, (_, i) => startPage + i).map(page => html`
            <button
              class="pagination-btn ${this._currentPage === page ? 'active' : ''}"
              @click=${() => this._currentPage = page}
            >${page + 1}</button>
          `)}
          <button
            class="pagination-btn"
            ?disabled=${this._currentPage >= totalPages - 1}
            @click=${() => this._currentPage++}
          >›</button>
          <button
            class="pagination-btn"
            ?disabled=${this._currentPage >= totalPages - 1}
            @click=${() => this._currentPage = totalPages - 1}
          >»</button>
        </div>
      </div>
    `;
  }

  private _renderList(data: any[]): TemplateResult {
    if (!Array.isArray(data) || data.length === 0) {
      return html`<div class="empty-state">No items</div>`;
    }

    return html`
      <ul class="smart-list">
        ${data.map(item => this._renderListItem(item))}
      </ul>
    `;
  }

  private _renderListItem(item: any): TemplateResult {
    if (typeof item !== 'object' || item === null) {
      return html`<li class="list-item"><span class="list-item-title">${this._highlightText(String(item))}</span></li>`;
    }

    const mapping = this._analyzeFields(item);

    return html`
      <li class="list-item">
        ${mapping.icon ? html`
          <div class="list-item-leading">
            ${this._isImageUrl(item[mapping.icon])
              ? html`<img src="${item[mapping.icon]}" alt="">`
              : item[mapping.icon]}
          </div>
        ` : ''}
        <div class="list-item-content">
          ${mapping.title ? html`<div class="list-item-title">${this._highlightText(String(item[mapping.title]))}</div>` : ''}
          ${mapping.subtitle ? html`<div class="list-item-subtitle">${this._highlightText(String(item[mapping.subtitle]))}</div>` : ''}
        </div>
        <div class="list-item-trailing">
          ${mapping.detail ? html`<span>${this._highlightText(String(item[mapping.detail]))}</span>` : ''}
          ${mapping.badge ? html`
            <span class="status-badge ${this._getStatusClass(item[mapping.badge])}">${item[mapping.badge]}</span>
          ` : ''}
        </div>
      </li>
    `;
  }

  private _renderCard(data: any): TemplateResult {
    if (!data || typeof data !== 'object') {
      return this._renderText(data);
    }

    const mapping = this._analyzeFields(data);
    const displayFields = Object.keys(data).filter(k =>
      ![mapping.title, mapping.subtitle, mapping.icon].includes(k)
    );

    return html`
      <div class="smart-card">
        ${(mapping.icon || mapping.title || mapping.subtitle) ? html`
          <div class="card-header">
            ${mapping.icon ? html`
              <div class="card-icon">
                ${this._isImageUrl(data[mapping.icon])
                  ? html`<img src="${data[mapping.icon]}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
                  : data[mapping.icon]}
              </div>
            ` : ''}
            <div>
              ${mapping.title ? html`<div class="card-title">${this._highlightText(String(data[mapping.title]))}</div>` : ''}
              ${mapping.subtitle ? html`<div class="card-subtitle">${this._highlightText(String(data[mapping.subtitle]))}</div>` : ''}
            </div>
          </div>
        ` : ''}
        <div class="card-fields">
          ${displayFields.map(key => html`
            <div class="card-field">
              <div class="card-field-label">${this._formatColumnName(key)}</div>
              <div class="card-field-value">${this._formatCellValue(data[key], key, true)}</div>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  private _renderChips(data: any): TemplateResult {
    if (!Array.isArray(data)) {
      return html`<div class="chip">${this._highlightText(String(data))}</div>`;
    }

    return html`
      <div class="smart-chips">
        ${data.map(item => html`<span class="chip">${this._highlightText(String(item))}</span>`)}
      </div>
    `;
  }

  private _renderTree(data: any, path = 'root', isRoot = true): TemplateResult {
    if (data === null || data === undefined) {
      return html`<span class="tree-value null">null</span>`;
    }

    if (typeof data !== 'object') {
      return this._renderTreeValue(data);
    }

    const isArray = Array.isArray(data);
    const entries = isArray
      ? data.map((v, i) => [i, v] as [number, any])
      : Object.entries(data);

    const isExpanded = this._expandedNodes.has(path);
    const hasChildren = entries.length > 0;

    return html`
      <div class="tree-node ${isRoot ? 'tree-root' : ''}">
        <div class="tree-item">
          ${hasChildren ? html`
            <span class="tree-toggle" @click=${() => this._toggleNode(path)}>
              ${isExpanded ? '▼' : '▶'}
            </span>
          ` : html`<span class="tree-toggle"></span>`}
          ${!isRoot ? html`<span class="tree-key">${path.split('.').pop()}</span>` : ''}
          <span class="tree-type">${isArray ? `Array[${entries.length}]` : `Object{${entries.length}}`}</span>
        </div>
        ${isExpanded || isRoot ? html`
          <div class="tree-container">
            ${entries.map(([key, value]) => {
              const childPath = `${path}.${key}`;
              const isChildObject = value !== null && typeof value === 'object';

              if (isChildObject) {
                return this._renderTree(value, childPath, false);
              }

              return html`
                <div class="tree-node">
                  <div class="tree-item">
                    <span class="tree-toggle"></span>
                    <span class="tree-key">${key}:</span>
                    ${this._renderTreeValue(value)}
                  </div>
                </div>
              `;
            })}
          </div>
        ` : ''}
      </div>
    `;
  }

  private _renderTreeValue(value: any): TemplateResult {
    if (value === null) {
      return html`<span class="tree-value null">null</span>`;
    }
    if (value === undefined) {
      return html`<span class="tree-value null">undefined</span>`;
    }
    if (typeof value === 'string') {
      const display = value.length > 50 ? value.slice(0, 50) + '...' : value;
      return html`<span class="tree-value string">"${this._highlightText(display)}"</span>`;
    }
    if (typeof value === 'number') {
      return html`<span class="tree-value number">${value}</span>`;
    }
    if (typeof value === 'boolean') {
      return html`<span class="tree-value boolean">${value}</span>`;
    }
    return html`<span class="tree-value">${String(value)}</span>`;
  }

  private _toggleNode(path: string) {
    const newExpanded = new Set(this._expandedNodes);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    this._expandedNodes = newExpanded;
  }

  private _renderMarkdown(): TemplateResult {
    const str = String(this.result);

    if ((window as any).marked) {
      const htmlContent = (window as any).marked.parse(str);

      // Handle mermaid after render
      if ((window as any).mermaid) {
        setTimeout(async () => {
          try {
            const mermaidBlocks = this.shadowRoot?.querySelectorAll('.language-mermaid');
            if (mermaidBlocks) {
              for (const block of Array.from(mermaidBlocks)) {
                const code = block.textContent || '';
                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
                const parent = block.parentElement;
                if (parent) {
                  const div = document.createElement('div');
                  div.id = id;
                  div.className = 'mermaid';
                  div.textContent = code;
                  parent.replaceWith(div);
                }
              }
              await (window as any).mermaid.run();
            }
          } catch (e) {
            console.error('Mermaid render error:', e);
          }
        }, 0);
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      return html`<div class="markdown-body">${Array.from(doc.body.childNodes)}</div>`;
    }

    return html`<pre>${str}</pre>`;
  }

  private _renderText(data: any): TemplateResult | string {
    const text = String(data);
    return this._highlightText(text);
  }

  private _renderJson(data: any): TemplateResult {
    const jsonStr = JSON.stringify(data, null, 2);

    const highlighted = jsonStr.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<pre>${highlighted}</pre>`, 'text/html');
    return html`${doc.body.children[0]}`;
  }

  private _analyzeFields(obj: any): { title?: string; subtitle?: string; icon?: string; badge?: string; detail?: string } {
    const keys = Object.keys(obj);
    const result: any = {};

    // Use layout hints if provided
    if (this.layoutHints) {
      if (this.layoutHints.title && keys.includes(this.layoutHints.title)) result.title = this.layoutHints.title;
      if (this.layoutHints.subtitle && keys.includes(this.layoutHints.subtitle)) result.subtitle = this.layoutHints.subtitle;
      if (this.layoutHints.icon && keys.includes(this.layoutHints.icon)) result.icon = this.layoutHints.icon;
      if (this.layoutHints.badge && keys.includes(this.layoutHints.badge)) result.badge = this.layoutHints.badge;
      if (this.layoutHints.detail && keys.includes(this.layoutHints.detail)) result.detail = this.layoutHints.detail;
    }

    // Auto-detect from field names
    const titleFields = ['name', 'title', 'label', 'displayName', 'heading', 'subject'];
    const subtitleFields = ['description', 'email', 'summary', 'bio', 'address', 'subtitle'];
    const iconFields = ['icon', 'avatar', 'image', 'photo', 'thumbnail', 'picture'];
    const badgeFields = ['status', 'state', 'type', 'role', 'category', 'priority'];
    const detailFields = ['count', 'total', 'amount', 'price', 'value', 'size'];

    if (!result.title) result.title = keys.find(k => titleFields.includes(k.toLowerCase()));
    if (!result.subtitle) result.subtitle = keys.find(k => subtitleFields.includes(k.toLowerCase()));
    if (!result.icon) result.icon = keys.find(k => iconFields.includes(k.toLowerCase()));
    if (!result.badge) result.badge = keys.find(k => badgeFields.includes(k.toLowerCase()));
    if (!result.detail) result.detail = keys.find(k => detailFields.includes(k.toLowerCase()));

    return result;
  }

  private _formatColumnName(name: string): string {
    // Convert camelCase/snake_case to Title Case
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\s/, '')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private _formatCellValue(value: any, key: string, highlight = false): TemplateResult | string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? '✓' : '✗';

    // Check for date fields
    if (this._isDateField(key) && (typeof value === 'string' || typeof value === 'number')) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        const dateStr = date.toLocaleString();
        return highlight ? this._highlightText(dateStr) : dateStr;
      }
    }

    // Check for URL fields
    if (this._isUrlField(key) && typeof value === 'string' && value.startsWith('http')) {
      return html`<a href="${value}" target="_blank" style="color: var(--accent-primary);">Link ↗</a>`;
    }

    // Check for status fields
    if (this._isStatusField(key) && typeof value === 'string') {
      return html`<span class="status-badge ${this._getStatusClass(value)}">${value}</span>`;
    }

    if (typeof value === 'object') {
      const str = JSON.stringify(value);
      return highlight ? this._highlightText(str) : str;
    }

    const str = String(value);
    return highlight ? this._highlightText(str) : str;
  }

  private _isDateField(key: string): boolean {
    const lower = key.toLowerCase();
    return lower.endsWith('at') || lower.endsWith('date') || lower.endsWith('time') ||
           lower === 'created' || lower === 'updated' || lower === 'timestamp';
  }

  private _isUrlField(key: string): boolean {
    const lower = key.toLowerCase();
    return lower === 'url' || lower === 'link' || lower === 'href' || lower === 'website';
  }

  private _isStatusField(key: string): boolean {
    const lower = key.toLowerCase();
    return lower === 'status' || lower === 'state' || lower === 'priority';
  }

  private _isImageUrl(value: any): boolean {
    if (typeof value !== 'string') return false;
    return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(value) || value.startsWith('data:image/');
  }

  private _getStatusClass(status: any): string {
    const lower = String(status).toLowerCase();
    if (['success', 'active', 'completed', 'online', 'done', 'enabled', 'yes', 'true'].includes(lower)) {
      return 'status-success';
    }
    if (['error', 'failed', 'offline', 'inactive', 'disabled', 'no', 'false', 'blocked'].includes(lower)) {
      return 'status-error';
    }
    if (['warning', 'pending', 'processing', 'in_progress', 'todo', 'waiting'].includes(lower)) {
      return 'status-warning';
    }
    return '';
  }

  private _copy() {
    const text = typeof this.result === 'object'
      ? JSON.stringify(this.result, null, 2)
      : String(this.result);

    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  }
}
