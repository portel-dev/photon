import { LitElement, html, css, svg, TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';

type LayoutType =
  | 'table'
  | 'list'
  | 'card'
  | 'kv'
  | 'tree'
  | 'json'
  | 'markdown'
  | 'mermaid'
  | 'code'
  | 'text'
  | 'chips'
  | 'grid'
  | 'html'
  | 'chart'
  | 'metric'
  | 'gauge'
  | 'timeline'
  | 'dashboard'
  | 'cart'
  | 'panels'
  | 'tabs'
  | 'accordion'
  | 'stack'
  | 'columns';

interface LayoutHints {
  title?: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  detail?: string;
  style?: string;
  columns?: string;
  filter?: string;
  // Chart hints
  label?: string;
  value?: string;
  x?: string;
  y?: string;
  series?: string;
  chartType?: string;
  // Gauge hints
  min?: string;
  max?: string;
  // Timeline hints
  date?: string;
  description?: string;
  // Dashboard/grouping hints
  group?: string;
  // Composable container hints
  inner?: string;
}

// Chart palette for dark/light themes
const CHART_PALETTE = {
  dark: ['#6366f1', '#22c55e', '#f97316', '#06b6d4', '#a855f7', '#ec4899', '#eab308', '#14b8a6'],
  light: ['#4f46e5', '#16a34a', '#ea580c', '#0891b2', '#9333ea', '#db2777', '#ca8a04', '#0d9488'],
};

// Lazy-loaded Chart.js module reference
let ChartModule: any = null;
let chartLoadPromise: Promise<any> | null = null;

async function loadChartJS(): Promise<any> {
  if (ChartModule) return ChartModule;
  if (chartLoadPromise) return chartLoadPromise;
  chartLoadPromise = import('chart.js').then((mod) => {
    const { Chart, registerables } = mod;
    Chart.register(...registerables);
    ChartModule = Chart;
    return Chart;
  });
  return chartLoadPromise;
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
        font-size: 0.65rem;
        padding: 2px 8px;
        background: transparent;
        border: none;
        border-radius: var(--radius-full);
        color: var(--t-muted);
        opacity: 0.6;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 500;
        pointer-events: none;
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
        font-size: 0.9rem;
        color: var(--t-primary);
        line-height: 1.5;
      }

      /* Text-based formats: JSON, text, code, mermaid — preserve whitespace */
      .content-text {
        font-family: var(--font-mono);
        white-space: pre-wrap;
        overflow-x: auto;
        overflow-y: auto;
        max-height: 600px;
      }

      /* Structured formats: list, table, card, metric, etc. — normal flow */
      .content-structured {
        font-family: var(--font-sans);
        white-space: normal;
        overflow: hidden;
      }

      /* JSON Syntax Highlighting - Theme Aware */
      .json-key {
        color: var(--syntax-key, var(--accent-secondary));
      }
      .json-string {
        color: var(--syntax-string, #a5d6ff);
      }
      .json-number {
        color: var(--syntax-number, #ff9e64);
      }
      .json-boolean {
        color: var(--syntax-boolean, #ff007c);
      }
      .json-null {
        color: var(--syntax-null, #79c0ff);
      }

      /* Syntax Highlighting Colors - Dark Theme (default) */
      :host {
        --syntax-key: var(--accent-secondary);
        --syntax-string: #a5d6ff;
        --syntax-number: #ff9e64;
        --syntax-boolean: #ff007c;
        --syntax-null: #79c0ff;
        --syntax-comment: #6a737d;
        --syntax-keyword: #ff7b72;
        --syntax-function: #d2a8ff;
        --syntax-operator: #79c0ff;
        --syntax-punctuation: #8b949e;
        --code-bg: rgba(0, 0, 0, 0.3);
      }

      /* Syntax Highlighting Colors - Light Theme */
      :host([data-theme='light']) {
        --syntax-key: #0550ae;
        --syntax-string: #0a3069;
        --syntax-number: #953800;
        --syntax-boolean: #cf222e;
        --syntax-null: #0550ae;
        --syntax-comment: #57606a;
        --syntax-keyword: #cf222e;
        --syntax-function: #8250df;
        --syntax-operator: #0550ae;
        --syntax-punctuation: #24292f;
        --code-bg: rgba(0, 0, 0, 0.04);
      }

      /* Prism.js Code Highlighting Overrides */
      .token.comment,
      .token.prolog,
      .token.doctype,
      .token.cdata {
        color: var(--syntax-comment);
      }
      .token.punctuation {
        color: var(--syntax-punctuation);
      }
      .token.property,
      .token.tag,
      .token.constant,
      .token.symbol,
      .token.deleted {
        color: var(--syntax-key);
      }
      .token.boolean,
      .token.number {
        color: var(--syntax-number);
      }
      .token.selector,
      .token.attr-name,
      .token.string,
      .token.char,
      .token.builtin,
      .token.inserted {
        color: var(--syntax-string);
      }
      .token.operator,
      .token.entity,
      .token.url,
      .language-css .token.string,
      .style .token.string {
        color: var(--syntax-operator);
      }
      .token.atrule,
      .token.attr-value,
      .token.keyword {
        color: var(--syntax-keyword);
      }
      .token.function,
      .token.class-name {
        color: var(--syntax-function);
      }
      .token.regex,
      .token.important,
      .token.variable {
        color: var(--syntax-boolean);
      }

      /* Table Styles */
      .smart-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-sans);
        font-size: 0.9rem;
      }

      .smart-table th {
        text-align: left;
        padding: 6px var(--space-md);
        background: var(--bg-glass-strong);
        border-bottom: 1px solid var(--border-glass);
        color: var(--t-muted);
        font-weight: 600;
        text-transform: capitalize;
        vertical-align: top;
        line-height: 1.2;
      }

      .smart-table td {
        padding: 6px var(--space-md);
        border-bottom: 1px solid var(--border-glass);
        color: var(--t-primary);
      }

      .smart-table tr:hover td {
        background: hsla(220, 10%, 80%, 0.05);
      }

      /* Key-Value Table (single object) */
      .kv-table {
        max-width: 600px;
      }

      .kv-table th:first-child,
      .kv-table .kv-key {
        width: 140px;
        font-weight: 600;
        color: var(--t-muted);
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.05em;
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
        padding: var(--space-xs) var(--space-md);
        background: var(--bg-panel);
        font-family: var(--font-sans);
        transition:
          background 0.3s ease,
          transform 0.3s ease,
          opacity 0.3s ease;
      }

      /* Animation for newly added items */
      @keyframes item-added {
        0% {
          opacity: 0;
          transform: translateX(-20px);
          background: hsla(120, 60%, 50%, 0.2);
        }
        50% {
          background: hsla(120, 60%, 50%, 0.15);
        }
        100% {
          opacity: 1;
          transform: translateX(0);
          background: var(--bg-panel);
        }
      }

      @keyframes item-removed {
        0% {
          opacity: 1;
          transform: translateX(0);
        }
        100% {
          opacity: 0;
          transform: translateX(20px);
          background: hsla(0, 60%, 50%, 0.2);
        }
      }

      .list-item.item-added {
        animation: item-added 0.5s ease-out forwards;
      }

      .list-item.item-removed {
        animation: item-removed 0.3s ease-in forwards;
      }

      /* Highlight for updated items */
      .list-item.item-updated {
        animation: item-highlight 0.8s ease-out;
      }

      @keyframes item-highlight {
        0% {
          background: hsla(45, 80%, 50%, 0.3);
        }
        100% {
          background: var(--bg-panel);
        }
      }

      /* Table row animations */
      .smart-table tbody tr {
        transition:
          background 0.3s ease,
          opacity 0.3s ease;
      }

      .smart-table tbody tr.item-added {
        animation: item-added 0.5s ease-out forwards;
      }

      .smart-table tbody tr.item-removed {
        animation: item-removed 0.3s ease-in forwards;
      }

      .smart-table tbody tr.item-updated {
        animation: item-highlight 0.8s ease-out;
      }

      /* Warm Data: recency heat indicators */
      .list-item.warmth-hot,
      .smart-table tbody tr.warmth-hot {
        border-left: 3px solid #ff6b6b;
        transition: border-left-color 2s ease-out;
      }
      .list-item.warmth-warm,
      .smart-table tbody tr.warmth-warm {
        border-left: 3px solid #ffa94d;
        transition: border-left-color 2s ease-out;
      }
      .list-item.warmth-cool,
      .smart-table tbody tr.warmth-cool {
        border-left: 3px solid #ffe066;
        transition: border-left-color 2s ease-out;
      }

      /* Light theme warmth */
      :host([data-theme='light']) .warmth-hot {
        border-left-color: #e03131;
      }
      :host([data-theme='light']) .warmth-warm {
        border-left-color: #f76707;
      }
      :host([data-theme='light']) .warmth-cool {
        border-left-color: #f59f00;
      }

      .timeline-item.warmth-hot,
      .cart-item.warmth-hot {
        border-left: 3px solid #ff6b6b;
        transition: border-left-color 2s ease-out;
      }
      .timeline-item.warmth-warm,
      .cart-item.warmth-warm {
        border-left: 3px solid #ffa94d;
        transition: border-left-color 2s ease-out;
      }
      .timeline-item.warmth-cool,
      .cart-item.warmth-cool {
        border-left: 3px solid #ffe066;
        transition: border-left-color 2s ease-out;
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
        border-radius: var(--radius-full);
        font-size: 0.75rem;
        font-weight: 500;
      }

      .status-success,
      .status-active,
      .status-completed,
      .status-online {
        background: hsla(120, 60%, 50%, 0.15);
        color: hsl(120, 60%, 50%);
      }

      .status-error,
      .status-failed,
      .status-offline,
      .status-inactive {
        background: hsla(0, 60%, 50%, 0.15);
        color: hsl(0, 60%, 50%);
      }

      .status-warning,
      .status-pending,
      .status-processing {
        background: hsla(45, 80%, 50%, 0.15);
        color: hsl(45, 80%, 50%);
      }

      /* Link Styles */
      .result-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        color: white;
        text-decoration: none;
        border-radius: var(--radius-sm);
        font-weight: 500;
        font-size: 0.9rem;
        word-break: break-all;
        transition:
          opacity 0.2s,
          transform 0.2s;
      }

      .result-link:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }

      .result-link .link-icon {
        font-size: 0.8em;
        opacity: 0.8;
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
        border-radius: var(--radius-full);
        font-size: 0.85rem;
        color: var(--t-primary);
        transition:
          background 0.3s ease,
          transform 0.3s ease,
          opacity 0.3s ease;
      }

      .chip.item-added {
        animation: chip-added 0.4s ease-out forwards;
      }

      .chip.item-removed {
        animation: chip-removed 0.3s ease-in forwards;
      }

      .chip.item-updated {
        animation: item-highlight 0.8s ease-out;
      }

      @keyframes chip-added {
        0% {
          opacity: 0;
          transform: scale(0.6);
          background: hsla(120, 60%, 50%, 0.25);
        }
        60% {
          transform: scale(1.05);
        }
        100% {
          opacity: 1;
          transform: scale(1);
          background: var(--bg-glass-strong);
        }
      }

      @keyframes chip-removed {
        0% {
          opacity: 1;
          transform: scale(1);
        }
        100% {
          opacity: 0;
          transform: scale(0.6);
          background: hsla(0, 60%, 50%, 0.2);
        }
      }

      /* Markdown Styles */
      .markdown-body {
        font-family: var(--font-sans);
        line-height: 1.6;
      }

      .markdown-body p {
        margin-bottom: 0.5em;
      }
      .markdown-body code {
        background: var(--code-bg);
        padding: 2px 6px;
        border-radius: var(--radius-xs);
        font-family: var(--font-mono);
        font-size: 0.9em;
      }
      .markdown-body pre {
        background: var(--code-bg);
        padding: 1em;
        border-radius: var(--radius-sm);
        overflow-x: auto;
        border: 1px solid var(--border-glass);
      }
      .markdown-body pre code {
        background: transparent;
        padding: 0;
        font-size: 0.85em;
        line-height: 1.5;
      }
      .markdown-body ul,
      .markdown-body ol {
        margin-left: 1.5em;
        margin-bottom: 0.5em;
      }
      .markdown-body h1,
      .markdown-body h2,
      .markdown-body h3 {
        margin-top: 1em;
        margin-bottom: 0.5em;
        color: var(--t-primary);
      }
      .markdown-body a {
        color: var(--accent-primary);
        text-decoration: none;
      }
      .markdown-body a:hover {
        text-decoration: underline;
      }
      .markdown-body table {
        border-collapse: collapse;
        width: 100%;
        margin: 1em 0;
      }
      .markdown-body th,
      .markdown-body td {
        border: 1px solid var(--border-glass);
        padding: 8px;
        text-align: left;
      }
      .markdown-body th {
        background: var(--code-bg);
      }

      /* Code block language label */
      .code-block-wrapper {
        position: relative;
        margin: 1em 0;
      }
      .code-block-wrapper .language-label {
        position: absolute;
        top: 0;
        right: 0;
        padding: 2px 8px;
        font-size: 0.7rem;
        text-transform: uppercase;
        color: var(--t-muted);
        background: var(--bg-glass-strong);
        border-radius: 0 8px 0 4px;
        font-family: var(--font-mono);
      }

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

      .filter-input:focus-visible {
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
        display: inline;
        margin-left: 4px;
        opacity: 0.5;
        font-size: 0.8em;
        white-space: nowrap;
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

      .tree-value.string {
        color: #a5d6ff;
      }
      .tree-value.number {
        color: #ff9e64;
      }
      .tree-value.boolean {
        color: #ff007c;
      }
      .tree-value.null {
        color: #79c0ff;
      }

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

      /* Fullscreen Modal */
      .fullscreen-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.95);
        backdrop-filter: blur(8px);
        z-index: 10000;
        display: flex;
        flex-direction: column;
      }

      .fullscreen-toolbar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 20px;
        background: linear-gradient(to bottom, rgba(0, 0, 0, 0.8), transparent);
        z-index: 10;
      }

      .fullscreen-toolbar-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .fullscreen-toolbar-center {
        display: flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: var(--radius-sm);
        padding: 4px;
      }

      .fullscreen-toolbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .fullscreen-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        width: 36px;
        height: 36px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 1.1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .fullscreen-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .fullscreen-btn:active {
        transform: scale(0.95);
      }

      .fullscreen-btn.close-btn {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.3);
      }

      .fullscreen-btn.close-btn:hover {
        background: rgba(239, 68, 68, 0.4);
      }

      .zoom-level {
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.8rem;
        min-width: 50px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      .fullscreen-hint {
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.75rem;
      }

      .fullscreen-viewport {
        flex: 1;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        position: relative;
      }

      .fullscreen-viewport.dragging {
        cursor: grabbing;
      }

      .fullscreen-viewport.zoom-1 {
        cursor: default;
      }

      .fullscreen-content {
        transform-origin: center center;
        transition: transform 0.1s ease-out;
        will-change: transform;
      }

      .fullscreen-content.no-transition {
        transition: none;
      }

      .fullscreen-content img {
        max-width: 90vw;
        max-height: 85vh;
        object-fit: contain;
        border-radius: var(--radius-md);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        user-select: none;
        -webkit-user-drag: none;
      }

      .fullscreen-content .mermaid-container {
        background: #1e293b;
        padding: var(--space-xl);
        border-radius: var(--radius-md);
        min-width: 300px;
        min-height: 200px;
        max-width: 95vw;
        max-height: 85vh;
        overflow: visible;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      :host([data-theme='light']) .fullscreen-content .mermaid-container {
        background: #f4f6f8;
      }

      .fullscreen-content .mermaid-container svg {
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
      }

      .fullscreen-content .markdown-container {
        background: var(--bg-glass);
        padding: var(--space-xl);
        border-radius: var(--radius-md);
        width: 90vw;
        max-width: 900px;
        max-height: 85vh;
        overflow: auto;
        color: var(--t-default);
      }

      :host([data-theme='light']) .fullscreen-content .markdown-container {
        background: var(--bg-panel);
      }

      .fullscreen-close {
        position: absolute;
        top: -40px;
        right: 0;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 1.2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .fullscreen-close:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      /* Clickable image in results */
      .clickable-image {
        cursor: pointer;
        transition:
          transform 0.2s,
          box-shadow 0.2s;
        max-width: 100%;
        border-radius: var(--radius-sm);
      }

      .clickable-image:hover {
        transform: scale(1.02);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .expand-hint {
        font-size: 0.75rem;
        color: var(--t-muted);
        margin-top: 4px;
        opacity: 0.7;
      }

      /* Expand button for markdown/mermaid */
      .markdown-body-wrapper,
      .mermaid-wrapper {
        position: relative;
      }

      .expand-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        width: 28px;
        height: 28px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        opacity: 0;
        z-index: 5;
      }

      .markdown-body-wrapper:hover .expand-btn,
      .mermaid-wrapper:hover .expand-btn {
        opacity: 1;
      }

      .expand-btn:hover {
        background: var(--primary);
        color: white;
        border-color: var(--primary);
      }

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .container {
          max-height: none;
        }

        .content {
          max-height: 50vh;
          overflow-y: auto;
        }

        .header {
          flex-wrap: wrap;
          gap: var(--space-sm);
        }

        .filter-container {
          order: 3;
          flex-basis: 100%;
          max-width: 100%;
        }

        .actions {
          flex-wrap: wrap;
        }

        .kv-table {
          display: block;
          max-width: 100%;
        }

        .kv-table tr {
          display: flex;
          flex-direction: column;
          border-bottom: 1px solid var(--border-glass);
          padding: var(--space-xs) 0;
        }

        .kv-table td:first-child,
        .kv-table .kv-key {
          width: 100%;
          font-weight: 600;
          margin-bottom: var(--space-xs);
        }

        .kv-table td:last-child {
          width: 100%;
        }

        .card-fields {
          grid-template-columns: 1fr;
        }

        button {
          min-height: 44px;
        }
      }

      @media (max-width: 480px) {
        .container {
          padding: var(--space-sm);
        }

        .actions button {
          padding: 4px 6px;
          font-size: 0.7rem;
          min-height: 32px;
        }

        .format-badge {
          display: none;
        }

        pre {
          font-size: 12px;
          padding: var(--space-sm);
        }

        .smart-table th,
        .smart-table td {
          padding: var(--space-xs) var(--space-sm);
          font-size: 0.85rem;
        }

        .pagination {
          flex-direction: column;
          gap: var(--space-sm);
          align-items: center;
        }

        .pagination-controls {
          flex-wrap: wrap;
          justify-content: center;
        }

        .fullscreen-toolbar {
          flex-direction: column;
          gap: var(--space-sm);
          padding: var(--space-sm);
        }

        .fullscreen-toolbar-left,
        .fullscreen-toolbar-center,
        .fullscreen-toolbar-right {
          width: 100%;
          justify-content: center;
        }
      }

      /* ===== HTML UI Mode ===== */
      .html-ui-container {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 400px;
      }

      .html-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        border-radius: var(--radius-md);
        /* Theme-aware: transparent bg lets the HTML content define its own styling */
        background: transparent;
      }

      /* Ensure iframe/custom-ui fills the container */
      .html-content custom-ui-renderer {
        flex: 1;
        min-height: 400px;
      }

      /* ═══════════════════════════════════════════════════════════════
         Chart Component
         ═══════════════════════════════════════════════════════════════ */
      .chart-container {
        position: relative;
        width: 100%;
        max-height: 400px;
        padding: var(--space-sm);
      }

      .chart-container canvas {
        width: 100% !important;
        max-height: 380px;
      }

      /* ═══════════════════════════════════════════════════════════════
         Metric/KPI Component
         ═══════════════════════════════════════════════════════════════ */
      .metric-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--space-sm) var(--space-md);
        gap: var(--space-xs);
      }

      .metric-value {
        font-size: 3rem;
        font-weight: 700;
        color: var(--t-primary);
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        transition: color 0.3s ease-out;
      }

      .metric-label {
        font-size: 0.85rem;
        color: var(--t-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 500;
      }

      .metric-delta {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.9rem;
        font-weight: 600;
        padding: 2px 10px;
        border-radius: var(--radius-full);
        transition:
          color 0.3s ease-out,
          background 0.3s ease-out;
      }

      .metric-delta-arrow {
        display: inline-flex;
        align-items: center;
        line-height: 1;
      }

      .metric-delta-value {
        display: inline-flex;
        align-items: center;
        line-height: 1;
      }

      .metric-delta.up {
        color: #16a34a;
        background: rgba(22, 163, 74, 0.12);
      }

      .metric-delta.down {
        color: #dc2626;
        background: rgba(220, 38, 38, 0.12);
      }

      .metric-delta.neutral {
        color: var(--t-muted);
        background: rgba(128, 128, 128, 0.12);
      }

      .metric-sparkline {
        width: 120px;
        height: 32px;
        margin-top: var(--space-xs);
      }

      /* ═══════════════════════════════════════════════════════════════
         Gauge Component
         ═══════════════════════════════════════════════════════════════ */
      .gauge-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px;
      }

      .gauge-svg {
        width: 160px;
        height: 100px;
        overflow: visible;
      }

      .gauge-label {
        font-size: 0.85rem;
        color: var(--t-muted);
        margin-top: var(--space-xs);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 500;
      }

      /* Value change flash animation for metric/gauge */
      .value-flash .metric-value,
      .value-flash text {
        animation: value-pulse 0.6s ease-out;
      }
      @keyframes value-pulse {
        0% {
          transform: scale(1.05);
          opacity: 0.7;
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      .gauge-svg path {
        transition:
          stroke-dasharray 0.6s ease-out,
          stroke 0.3s ease-out;
      }

      /* ═══════════════════════════════════════════════════════════════
         Timeline Component
         ═══════════════════════════════════════════════════════════════ */
      .timeline-container {
        position: relative;
        padding: var(--space-sm) var(--space-md);
        padding-left: calc(var(--space-md) + 20px);
      }

      .timeline-container::before {
        content: '';
        position: absolute;
        left: calc(var(--space-md) + 7px);
        top: var(--space-sm);
        bottom: var(--space-sm);
        width: 2px;
        background: var(--border-glass);
      }

      .timeline-group-header {
        position: relative;
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--t-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin: var(--space-md) 0 var(--space-xs) 0;
      }

      .timeline-group-header:first-child {
        margin-top: 0;
      }

      .timeline-item {
        position: relative;
        padding: 6px 0 6px 16px;
        animation: fadeInUp 0.3s ease-out both;
      }

      .timeline-item::before {
        content: '';
        position: absolute;
        left: -17px;
        top: 10px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--accent-primary, #6366f1);
        border: 2px solid var(--bg-primary);
        z-index: 1;
      }

      .timeline-title {
        font-weight: 600;
        color: var(--t-primary);
        font-size: 0.9rem;
        line-height: 1.3;
      }

      .timeline-time {
        font-size: 0.75rem;
        color: var(--accent-primary);
        margin-bottom: 2px;
      }

      .timeline-description {
        font-size: 0.85rem;
        color: var(--t-secondary);
        margin-top: 2px;
        line-height: 1.4;
      }

      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* ═══════════════════════════════════════════════════════════════
         Dashboard Component
         ═══════════════════════════════════════════════════════════════ */
      .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
        padding: var(--space-sm);
      }

      .dashboard-panel {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .dashboard-panel-header {
        padding: 6px var(--space-md);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--t-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        border-bottom: 1px solid var(--border-glass);
      }

      .dashboard-panel-content {
        padding: var(--space-xs);
      }

      .dashboard-panel .chart-container {
        max-height: 250px;
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .dashboard-panel .chart-container canvas {
        max-width: 100%;
        max-height: 230px;
      }

      .dashboard-panel .metric-container {
        padding: var(--space-xs);
      }

      .dashboard-panel .metric-value {
        font-size: 2rem;
      }

      /* ═══════════════════════════════════════════════════════════════
         Cart Component
         ═══════════════════════════════════════════════════════════════ */
      .cart-container {
        font-family: var(--font-sans);
      }

      .cart-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px var(--space-md);
        border-bottom: 1px solid var(--border-glass);
      }

      .cart-item:last-of-type {
        border-bottom: none;
      }

      .cart-item-image {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-sm);
        object-fit: cover;
        flex-shrink: 0;
        background: var(--bg-glass);
      }

      .cart-item-info {
        flex: 1;
        min-width: 0;
      }

      .cart-item-name {
        font-weight: 500;
        color: var(--t-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .cart-item-meta {
        font-size: 0.8rem;
        color: var(--t-muted);
      }

      .cart-qty {
        padding: 2px 8px;
        background: var(--bg-glass-strong);
        border-radius: var(--radius-sm);
        font-size: 0.8rem;
        color: var(--t-muted);
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
      }

      .cart-line-total {
        font-weight: 600;
        color: var(--t-primary);
        font-variant-numeric: tabular-nums;
        text-align: right;
        min-width: 60px;
        flex-shrink: 0;
      }

      .cart-divider {
        height: 1px;
        background: var(--border-glass);
        margin: 4px 0;
      }

      .cart-summary {
        padding: var(--space-xs) var(--space-md);
      }

      .cart-summary-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 0.9rem;
        color: var(--t-secondary);
      }

      .cart-summary-row.total {
        font-weight: 700;
        font-size: 1rem;
        color: var(--t-primary);
        padding-top: var(--space-sm);
        border-top: 1px solid var(--border-glass);
        margin-top: var(--space-xs);
      }

      .cart-summary-label {
        text-transform: capitalize;
      }

      .cart-summary-value {
        font-variant-numeric: tabular-nums;
      }

      /* ═══════════════════════════════════════════════════════════════
         Composable Container Components
         ═══════════════════════════════════════════════════════════════ */
      /* Panels */
      .panels-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
        gap: var(--space-md);
        padding: var(--space-sm);
      }

      .panels-grid.cols-2 {
        grid-template-columns: repeat(2, 1fr);
      }
      .panels-grid.cols-3 {
        grid-template-columns: repeat(3, 1fr);
      }
      .panels-grid.cols-4 {
        grid-template-columns: repeat(4, 1fr);
      }

      .panel-item {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .panel-header {
        padding: 6px var(--space-md);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--t-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        border-bottom: 1px solid var(--border-glass);
      }

      .panel-content {
        padding: var(--space-xs) var(--space-sm);
      }

      /* Tabs */
      .tabs-container {
        font-family: var(--font-sans);
      }

      .tabs-bar {
        display: inline-flex;
        gap: 0;
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        overflow: hidden;
        margin-bottom: var(--space-xs);
      }

      .tab-btn {
        padding: 6px 16px;
        background: transparent;
        border: none;
        border-right: 1px solid var(--border-glass);
        color: var(--t-muted);
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s;
        font-family: var(--font-sans);
      }

      .tab-btn:last-child {
        border-right: none;
      }

      .tab-btn:hover {
        color: var(--t-primary);
        background: var(--bg-glass);
      }

      .tab-btn.active {
        color: var(--accent-primary);
        background: var(--bg-glass-strong);
      }

      .tab-content {
        padding: var(--space-sm);
      }

      /* Accordion */
      .accordion-container {
        font-family: var(--font-sans);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .accordion-container.bordered .accordion-section {
        border-bottom: 1px solid var(--border-glass);
      }

      .accordion-container.bordered .accordion-section:last-child {
        border-bottom: none;
      }

      .accordion-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        cursor: pointer;
        user-select: none;
        background: var(--bg-glass);
        transition: background 0.2s;
        font-weight: 500;
        font-size: 0.9rem;
      }

      .accordion-header:hover {
        background: var(--bg-glass-strong);
      }

      .accordion-chevron {
        font-size: 0.7rem;
        color: var(--t-muted);
        transition: transform 0.2s;
      }

      .accordion-chevron.expanded {
        transform: rotate(90deg);
      }

      .accordion-body {
        padding: 6px 12px;
        display: none;
      }

      .accordion-body.expanded {
        display: block;
      }

      /* Stack */
      .stack-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px;
      }

      .stack-item {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: 6px;
      }

      .stack-item .metric-container {
        padding: 0;
      }
      .stack-item .metric-value {
        font-size: 2rem;
      }

      /* Columns */
      .columns-grid {
        display: grid;
        gap: var(--space-md);
        padding: var(--space-sm);
      }

      .columns-grid.cols-2 {
        grid-template-columns: repeat(2, 1fr);
      }
      .columns-grid.cols-3 {
        grid-template-columns: repeat(3, 1fr);
      }
      .columns-grid.cols-4 {
        grid-template-columns: repeat(4, 1fr);
      }

      .column-item {
        min-width: 0;
        overflow: hidden;
      }
    `,
  ];

  @property({ type: Object })
  result: any = null;

  @property({ type: String })
  outputFormat?: string;

  @property({ type: Object })
  layoutHints?: LayoutHints;

  @property({ type: String, reflect: true, attribute: 'data-theme' })
  theme: Theme = 'dark';

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

  @state()
  private _fullscreenImage: string | null = null;

  @state()
  private _fullscreenMermaid: string | null = null;

  @state()
  private _fullscreenMarkdown: string | null = null;

  @state()
  private _zoomLevel = 1;

  @state()
  private _panX = 0;

  @state()
  private _panY = 0;

  private _isPanning = false;
  private _panStartX = 0;
  private _panStartY = 0;
  private _lastPanX = 0;
  private _lastPanY = 0;

  // Composable container state
  @state()
  private _activeTab = '';

  @state()
  private _expandedSections = new Set<string>();

  private _accordionInitialized = false;

  // Flash animation for object-based format changes (metric/gauge)
  @state()
  private _objectJustChanged = false;

  // Track animated items for collection events
  @state()
  private _animatedItems = new Map<string, 'added' | 'removed' | 'updated'>();

  // Internal result copy for incremental updates
  @state()
  private _internalResult: any = null;

  // Bridge old result across null-gap during execute cycles
  private _previousResult: any = null;

  // Recency heat: track when items were last added/updated
  private _itemHeatTimestamps = new Map<string, number>();
  private _warmthTimer: number | undefined;

  // The detected ID field for the current result (shared across diff, animation, warmth)
  private _activeIdField = 'id';

  // Chart.js instance for reactive updates
  private _chartInstance: any = null;
  private _chartInstances: Map<string, any> = new Map(); // Track multiple charts by canvas ID
  private _chartCanvasId = `chart-${Math.random().toString(36).slice(2, 9)}`;

  // Property name for event subscriptions (set by parent)
  @property({ type: String })
  collectionProperty?: string;

  // Whether this result is receiving live updates
  @property({ type: Boolean })
  live = false;

  // Key for persisting heat timestamps across refresh (e.g. "photonName/methodName")
  @property({ type: String })
  resultKey?: string;

  private _pageSize = 20;

  @query('.filter-input')
  private _filterInput!: HTMLInputElement;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._handleGlobalKeydown);
    // Periodically re-render to decay warmth classes
    this._warmthTimer = window.setInterval(() => {
      if (this._itemHeatTimestamps.size > 0) this.requestUpdate();
    }, 60_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._handleGlobalKeydown);
    if (this._warmthTimer) clearInterval(this._warmthTimer);
    if (this._chartInstance) {
      this._chartInstance.destroy();
      this._chartInstance = null;
    }
    // Clean up all chart instances
    this._chartInstances.forEach((chart) => chart.destroy());
    this._chartInstances.clear();
  }

  private _handleGlobalKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this._closeFullscreen();
    }
    // Zoom with + and - keys when fullscreen is open
    if (this._fullscreenImage || this._fullscreenMermaid) {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this._zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        this._zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        this._resetZoom();
      }
    }
  };

  private _closeFullscreen() {
    this._fullscreenImage = null;
    this._fullscreenMermaid = null;
    this._fullscreenMarkdown = null;
    this._resetZoom();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API: Incremental Updates for Collection Events
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle a collection event (e.g., items:added, items:removed)
   * Call this when receiving events from ReactiveArray/ReactiveMap/ReactiveSet
   *
   * @example
   * ```typescript
   * // Subscribe to collection events
   * kanban.onTasksAdded((task) => {
   *   resultViewer.handleCollectionEvent('added', task, 'id');
   * });
   * ```
   */
  handleCollectionEvent(
    type: 'added' | 'removed' | 'updated' | 'changed',
    data: unknown,
    idField?: string
  ): void {
    // Auto-detect ID field if not provided
    if (!idField) {
      const effective = this._getEffectiveResult();
      idField = Array.isArray(effective) ? this._detectIdField(effective) : 'id';
    }
    this._activeIdField = idField;

    // Initialize internal result if needed
    if (this._internalResult === null) {
      this._internalResult = Array.isArray(this.result) ? [...this.result] : this.result;
    }

    if (!Array.isArray(this._internalResult)) {
      // For non-array results, replace and trigger flash animation
      if (type === 'changed') {
        this._internalResult = data;
        this._objectJustChanged = true;
        this.requestUpdate();
        setTimeout(() => {
          this._objectJustChanged = false;
          this.requestUpdate();
        }, 600);
      }
      return;
    }

    const itemId =
      data && typeof data === 'object' ? (data as Record<string, unknown>)[idField] : String(data);
    const stringId = String(itemId);

    switch (type) {
      case 'added':
        // Add item and track for animation
        this._internalResult = [...this._internalResult, data];
        this._animatedItems.set(stringId, 'added');
        this._itemHeatTimestamps.set(stringId, Date.now());
        // Clear animation class after animation completes
        setTimeout(() => {
          this._animatedItems.delete(stringId);
          this.requestUpdate();
        }, 500);
        break;

      case 'removed':
        // Mark for removal animation, then remove
        this._animatedItems.set(stringId, 'removed');
        this.requestUpdate();
        setTimeout(() => {
          this._internalResult = this._internalResult.filter((item: unknown) => {
            const id =
              item && typeof item === 'object' ? (item as Record<string, unknown>)[idField] : item;
            return String(id) !== stringId;
          });
          this._animatedItems.delete(stringId);
          this._itemHeatTimestamps.delete(stringId);
          this.requestUpdate();
        }, 300);
        break;

      case 'updated':
        // Update item and highlight
        const updateData = data as { index?: number; value?: unknown };
        if (updateData.index !== undefined && updateData.value !== undefined) {
          this._internalResult = this._internalResult.map((item: unknown, i: number) =>
            i === updateData.index ? updateData.value : item
          );
        } else {
          // Find and replace by ID
          this._internalResult = this._internalResult.map((item: unknown) => {
            const id =
              item && typeof item === 'object' ? (item as Record<string, unknown>)[idField] : item;
            return String(id) === stringId ? data : item;
          });
        }
        this._animatedItems.set(stringId, 'updated');
        this._itemHeatTimestamps.set(stringId, Date.now());
        setTimeout(() => {
          this._animatedItems.delete(stringId);
          this.requestUpdate();
        }, 800);
        break;

      case 'changed':
        // Full replacement
        this._internalResult = Array.isArray(data) ? [...(data as unknown[])] : data;
        break;
    }

    this._persistHeatTimestamps();
  }

  /**
   * Add an item with animation
   */
  addItem(item: unknown, idField: string = 'id'): void {
    this.handleCollectionEvent('added', item, idField);
  }

  /**
   * Remove an item with animation
   */
  removeItem(item: unknown, idField: string = 'id'): void {
    this.handleCollectionEvent('removed', item, idField);
  }

  /**
   * Update an item with highlight animation
   */
  updateItem(item: unknown, idField: string = 'id'): void {
    this.handleCollectionEvent('updated', item, idField);
  }

  /**
   * Get the animation class for an item
   */
  private _getItemAnimationClass(item: unknown): string {
    const idField = this._activeIdField;
    const itemId =
      item && typeof item === 'object' ? (item as Record<string, unknown>)[idField] : item;
    const animation = this._animatedItems.get(String(itemId));
    return animation ? `item-${animation}` : '';
  }

  /**
   * Get the effective result (internal copy if available, otherwise prop)
   */
  private _getEffectiveResult(): unknown {
    return this._internalResult !== null ? this._internalResult : this.result;
  }

  /**
   * Detect the best ID field from an array of objects
   */
  private _detectIdField(arr: any[]): string {
    if (!arr.length || typeof arr[0] !== 'object') return 'id';
    if ('id' in arr[0]) return 'id';
    if ('_id' in arr[0]) return '_id';
    if ('uuid' in arr[0]) return 'uuid';
    if ('name' in arr[0]) return 'name';
    return Object.keys(arr[0])[0] || 'id';
  }

  /**
   * Diff two arrays and set animation + heat timestamps for changes.
   * Handles added, removed (ghost exit animation), updated, and reordered items.
   */
  private _applyDiff(oldArr: any[], newArr: any[]): void {
    const idField = this._detectIdField(newArr.length ? newArr : oldArr);
    this._activeIdField = idField;

    const key = (item: any): string =>
      item && typeof item === 'object' ? String(item[idField]) : String(item);

    const oldMap = new Map(oldArr.map((item) => [key(item), item]));
    const newMap = new Map(newArr.map((item) => [key(item), item]));

    // Build old position index for reorder detection
    const oldPositions = new Map(oldArr.map((item, i) => [key(item), i]));
    const newPositions = new Map(newArr.map((item, i) => [key(item), i]));

    // Clear previous animations, keep heat timestamps
    this._animatedItems.clear();

    const removedItems: any[] = [];

    // Added items
    for (const [id] of newMap) {
      if (!oldMap.has(id)) {
        this._animatedItems.set(id, 'added');
        this._itemHeatTimestamps.set(id, Date.now());
        setTimeout(() => {
          this._animatedItems.delete(id);
          this.requestUpdate();
        }, 500);
      }
    }

    // Removed items — keep as ghosts for exit animation
    for (const [id, item] of oldMap) {
      if (!newMap.has(id)) {
        this._animatedItems.set(id, 'removed');
        this._itemHeatTimestamps.delete(id);
        removedItems.push(item);
      }
    }

    // Updated items
    for (const [id, newItem] of newMap) {
      const oldItem = oldMap.get(id);
      if (oldItem && JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
        this._animatedItems.set(id, 'updated');
        this._itemHeatTimestamps.set(id, Date.now());
        setTimeout(() => {
          this._animatedItems.delete(id);
          this.requestUpdate();
        }, 800);
      }
    }

    // Reordered items — same content but different position
    for (const [id, newItem] of newMap) {
      if (this._animatedItems.has(id)) continue; // already animated
      const oldPos = oldPositions.get(id);
      const newPos = newPositions.get(id);
      if (oldPos !== undefined && newPos !== undefined && oldPos !== newPos) {
        this._animatedItems.set(id, 'updated'); // reuse highlight animation
        setTimeout(() => {
          this._animatedItems.delete(id);
          this.requestUpdate();
        }, 800);
      }
    }

    // If items were removed, build a merged list with ghosts at their original positions
    if (removedItems.length > 0) {
      // Merge: start from new array, insert ghosts at original indices
      const merged = [...newArr];
      for (const item of removedItems) {
        const oldIdx = oldPositions.get(key(item)) ?? merged.length;
        // Clamp to current length
        const insertAt = Math.min(oldIdx, merged.length);
        merged.splice(insertAt, 0, item);
      }
      this._internalResult = merged;

      // After exit animation, purge ghosts
      setTimeout(() => {
        this._internalResult = null; // fall back to result prop (no ghosts)
        for (const item of removedItems) {
          this._animatedItems.delete(key(item));
        }
        this.requestUpdate();
      }, 300);
    }

    // Persist heat timestamps so warmth survives browser refresh
    this._persistHeatTimestamps();

    // Trigger re-render so animation classes appear (we're called from updated(), post-render)
    if (this._animatedItems.size > 0) {
      this.requestUpdate();
    }
  }

  private static _TIMESTAMP_FIELDS = [
    'updatedAt',
    'updated_at',
    'lastModified',
    'last_modified',
    'modifiedAt',
    'modified_at',
    '_updatedAt', // ReactiveArray auto-stamp (fallback for updates)
    'createdAt',
    'created_at',
    '_addedAt', // ReactiveArray auto-stamp (fallback for creation)
  ];

  /**
   * Get the warmth class based on recency heat.
   * Reads timestamp from item data first (survives refresh), falls back to in-memory map.
   */
  private _getItemWarmthClass(item: unknown): string {
    const idField = this._activeIdField;
    let timestamp: number | undefined;

    // Try to read timestamp from item data (persisted, survives refresh)
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      for (const field of ResultViewer._TIMESTAMP_FIELDS) {
        const val = rec[field];
        if (val !== undefined && val !== null) {
          const parsed = typeof val === 'number' ? val : new Date(String(val)).getTime();
          if (!isNaN(parsed)) {
            timestamp = parsed;
            break;
          }
        }
      }
    }

    // Fall back to in-memory heat map (populated from sessionStorage or live events)
    if (timestamp === undefined) {
      const itemId =
        item && typeof item === 'object' ? (item as Record<string, unknown>)[idField] : item;
      timestamp = this._itemHeatTimestamps.get(String(itemId));
    }

    if (!timestamp) return '';

    const age = Date.now() - timestamp;
    if (age < 5 * 60_000) return 'warmth-hot'; // < 5 min
    if (age < 30 * 60_000) return 'warmth-warm'; // < 30 min
    if (age < 2 * 3600_000) return 'warmth-cool'; // < 2 hr
    return '';
  }

  /**
   * Persist heat timestamps to sessionStorage so warmth survives browser refresh.
   */
  private _persistHeatTimestamps(): void {
    if (!this.resultKey || this._itemHeatTimestamps.size === 0) return;
    try {
      const key = `photon-heat:${this.resultKey}`;
      const data = Object.fromEntries(this._itemHeatTimestamps);
      sessionStorage.setItem(key, JSON.stringify(data));
    } catch {
      // sessionStorage full or unavailable — ignore
    }
  }

  /**
   * Restore heat timestamps from sessionStorage on load.
   */
  private _restoreHeatTimestamps(): void {
    if (!this.resultKey) return;
    try {
      const key = `photon-heat:${this.resultKey}`;
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, number>;
      const now = Date.now();
      const maxAge = 2 * 3600_000; // 2 hours — matches warmth-cool cutoff
      for (const [id, ts] of Object.entries(data)) {
        if (now - ts < maxAge) {
          this._itemHeatTimestamps.set(id, ts);
        }
      }
    } catch {
      // corrupt data — ignore
    }
  }

  private _resetZoom() {
    this._zoomLevel = 1;
    this._panX = 0;
    this._panY = 0;
  }

  private _zoomIn() {
    this._zoomLevel = Math.min(10, this._zoomLevel * 1.25);
  }

  private _zoomOut() {
    this._zoomLevel = Math.max(0.1, this._zoomLevel / 1.25);
  }

  private _handleWheel = (e: WheelEvent) => {
    if (!this._fullscreenImage && !this._fullscreenMermaid) return;
    e.preventDefault();

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, this._zoomLevel * factor));

    if (newZoom !== this._zoomLevel) {
      this._zoomLevel = newZoom;
      if (this._zoomLevel === 1) {
        this._panX = 0;
        this._panY = 0;
      }
    }
  };

  private _handlePanStart = (e: MouseEvent) => {
    if (this._zoomLevel <= 1) return;
    e.preventDefault();
    this._isPanning = true;
    this._panStartX = e.clientX;
    this._panStartY = e.clientY;
    this._lastPanX = this._panX;
    this._lastPanY = this._panY;
  };

  private _handlePanMove = (e: MouseEvent) => {
    if (!this._isPanning) return;
    e.preventDefault();
    const dx = e.clientX - this._panStartX;
    const dy = e.clientY - this._panStartY;
    this._panX = this._lastPanX + dx;
    this._panY = this._lastPanY + dy;
  };

  private _handlePanEnd = () => {
    this._isPanning = false;
  };

  private _autoFitFullscreen() {
    // Wait for SVG to be in DOM
    requestAnimationFrame(() => {
      const viewport = this.shadowRoot?.querySelector('.fullscreen-viewport');
      const content = this.shadowRoot?.querySelector('.fullscreen-content');
      const svg = content?.querySelector('svg');
      const mermaidContainer = content?.querySelector('.mermaid-container');

      if (!viewport || !content) return;

      const viewportRect = viewport.getBoundingClientRect();
      const viewportWidth = viewportRect.width * 0.9; // 90% of viewport
      const viewportHeight = viewportRect.height * 0.85; // 85% of viewport (account for toolbar)

      let contentWidth: number;
      let contentHeight: number;

      if (svg) {
        // Get SVG dimensions
        const svgRect = svg.getBoundingClientRect();
        contentWidth = svgRect.width || parseFloat(svg.getAttribute('width') || '400');
        contentHeight = svgRect.height || parseFloat(svg.getAttribute('height') || '300');
      } else if (mermaidContainer) {
        const containerRect = mermaidContainer.getBoundingClientRect();
        contentWidth = containerRect.width;
        contentHeight = containerRect.height;
      } else {
        return; // No content to fit
      }

      if (contentWidth > 0 && contentHeight > 0) {
        // Calculate zoom to fit
        const scaleX = viewportWidth / contentWidth;
        const scaleY = viewportHeight / contentHeight;
        const fitZoom = Math.min(scaleX, scaleY);

        // Use fit zoom, but ensure it's at least 1x if content is small
        this._zoomLevel = Math.max(1, fitZoom);
        this._panX = 0;
        this._panY = 0;
      }
    });
  }

  render() {
    if (this.result === null || this.result === undefined) return html``;

    const layout = this._selectLayout();
    const filteredData = this._getFilteredData();
    const totalCount = this._getTotalCount();
    const filteredCount = this._getFilteredCount(filteredData);
    const isFiltered = this._filterQuery.trim() !== '';
    const isHtmlUiMode = layout === 'html';

    // HTML UI mode: minimal chrome, full-height interactive content
    if (isHtmlUiMode) {
      return html`
        <div class="html-ui-container">${this._renderContent(layout, filteredData)}</div>
      `;
    }

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
            />
            ${isFiltered
              ? html` <span class="filter-count filtered">${filteredCount} / ${totalCount}</span> `
              : ''}
          </div>
          <div class="actions">
            ${layout !== 'json' ? html`<span class="format-badge">${layout}</span>` : ''}
            <button @click=${this._copy}>Copy</button>
            <button @click=${() => this._downloadSmart(layout)}>
              ↓ ${this._getDownloadLabel(layout)}
            </button>
            ${this._isTabularData()
              ? html`<button @click=${() => this._download('csv')}>↓ CSV</button>`
              : ''}
            <button @click=${this._share} title="Share link to this result">🔗 Share</button>
          </div>
        </div>
        <div class="content ${this._isTextLayout(layout) ? 'content-text' : 'content-structured'}">
          ${this._renderContent(layout, filteredData)}
        </div>
      </div>

      ${this._fullscreenImage
        ? html`
            <div class="fullscreen-overlay">
              <div class="fullscreen-toolbar">
                <div class="fullscreen-toolbar-left">
                  <span class="fullscreen-hint">Scroll to zoom • Drag to pan • Esc to close</span>
                </div>
                <div class="fullscreen-toolbar-center">
                  <button class="fullscreen-btn" @click=${this._zoomOut} title="Zoom out (-)">
                    −
                  </button>
                  <span class="zoom-level">${Math.round(this._zoomLevel * 100)}%</span>
                  <button class="fullscreen-btn" @click=${this._zoomIn} title="Zoom in (+)">
                    +
                  </button>
                  <button class="fullscreen-btn" @click=${this._resetZoom} title="Reset zoom (0)">
                    ⟲
                  </button>
                </div>
                <div class="fullscreen-toolbar-right">
                  <button
                    class="fullscreen-btn close-btn"
                    @click=${this._closeFullscreen}
                    title="Close (Esc)"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div
                class="fullscreen-viewport ${this._isPanning ? 'dragging' : ''} ${this._zoomLevel <=
                1
                  ? 'zoom-1'
                  : ''}"
                @wheel=${this._handleWheel}
                @mousedown=${this._handlePanStart}
                @mousemove=${this._handlePanMove}
                @mouseup=${this._handlePanEnd}
                @mouseleave=${this._handlePanEnd}
              >
                <div
                  class="fullscreen-content ${this._isPanning ? 'no-transition' : ''}"
                  style="transform: scale(${this._zoomLevel}) translate(${this._panX /
                  this._zoomLevel}px, ${this._panY / this._zoomLevel}px)"
                >
                  <img src="${this._fullscreenImage}" alt="Fullscreen image" draggable="false" />
                </div>
              </div>
            </div>
          `
        : ''}
      ${this._fullscreenMermaid
        ? html`
            <div class="fullscreen-overlay">
              <div class="fullscreen-toolbar">
                <div class="fullscreen-toolbar-left">
                  <span class="fullscreen-hint">Scroll to zoom • Drag to pan • Esc to close</span>
                </div>
                <div class="fullscreen-toolbar-center">
                  <button class="fullscreen-btn" @click=${this._zoomOut} title="Zoom out (-)">
                    −
                  </button>
                  <span class="zoom-level">${Math.round(this._zoomLevel * 100)}%</span>
                  <button class="fullscreen-btn" @click=${this._zoomIn} title="Zoom in (+)">
                    +
                  </button>
                  <button class="fullscreen-btn" @click=${this._resetZoom} title="Reset zoom (0)">
                    ⟲
                  </button>
                </div>
                <div class="fullscreen-toolbar-right">
                  <button
                    class="fullscreen-btn close-btn"
                    @click=${this._closeFullscreen}
                    title="Close (Esc)"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div
                class="fullscreen-viewport ${this._isPanning ? 'dragging' : ''} ${this._zoomLevel <=
                1
                  ? 'zoom-1'
                  : ''}"
                @wheel=${this._handleWheel}
                @mousedown=${this._handlePanStart}
                @mousemove=${this._handlePanMove}
                @mouseup=${this._handlePanEnd}
                @mouseleave=${this._handlePanEnd}
              >
                <div
                  class="fullscreen-content ${this._isPanning ? 'no-transition' : ''}"
                  style="transform: scale(${this._zoomLevel}) translate(${this._panX /
                  this._zoomLevel}px, ${this._panY / this._zoomLevel}px)"
                >
                  <div class="mermaid-container" id="fullscreen-mermaid"></div>
                </div>
              </div>
            </div>
          `
        : ''}
      ${this._fullscreenMarkdown
        ? html`
            <div class="fullscreen-overlay">
              <div class="fullscreen-toolbar">
                <div class="fullscreen-toolbar-left">
                  <span class="fullscreen-hint">Esc to close</span>
                </div>
                <div class="fullscreen-toolbar-center"></div>
                <div class="fullscreen-toolbar-right">
                  <button
                    class="fullscreen-btn close-btn"
                    @click=${this._closeFullscreen}
                    title="Close (Esc)"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div class="fullscreen-viewport zoom-1" style="padding-top: 60px;">
                <div class="fullscreen-content">
                  <div class="markdown-container markdown-content">
                    ${unsafeHTML(this._fullscreenMarkdown)}
                  </div>
                </div>
              </div>
            </div>
          `
        : ''}
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
    if (typeof this.result === 'object' && this.result !== null)
      return Object.keys(this.result).length;
    return 1;
  }

  private _getFilteredCount(data: any): number {
    if (Array.isArray(data)) return data.length;
    if (typeof data === 'object' && data !== null) return Object.keys(data).length;
    return data !== null ? 1 : 0;
  }

  private _getFilteredData(): any {
    const effectiveResult = this._getEffectiveResult();
    if (!this._filterQuery.trim()) return effectiveResult;

    const query = this._filterQuery.toLowerCase();
    const data = effectiveResult;

    // Array filtering
    if (Array.isArray(data)) {
      return data.filter((item) => this._itemMatchesFilter(item, query));
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
      return Object.values(item).some((v) => this._valueMatchesFilter(v, query));
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

  private _isTextLayout(layout: LayoutType): boolean {
    return (
      layout === 'json' ||
      layout === 'text' ||
      layout === 'code' ||
      layout === 'mermaid' ||
      layout === 'tree'
    );
  }

  private _selectLayout(): LayoutType {
    // 1. Explicit format from docblock
    if (this.outputFormat) {
      const format = this.outputFormat.toLowerCase();
      // Handle chart:subtype format (e.g., chart:bar, chart:pie)
      if (format.startsWith('chart:')) return 'chart';

      if (
        [
          'table',
          'list',
          'card',
          'tree',
          'json',
          'markdown',
          'mermaid',
          'code',
          'text',
          'chips',
          'grid',
          'html',
          'chart',
          'metric',
          'gauge',
          'timeline',
          'dashboard',
          'cart',
          'panels',
          'tabs',
          'accordion',
          'stack',
          'columns',
        ].includes(format)
      ) {
        return format as LayoutType;
      }
      // Content formats
      if (format === 'md') return 'markdown';
    }

    // 2. Collection rendering hint (from Collection.as())
    const data = this.result;
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      typeof (data as any)._photonType === 'string' &&
      (data as any)._photonType.startsWith('collection:')
    ) {
      const hint = (data as any)._photonType.replace('collection:', '') as string;
      // Extract items for rendering, replace result reference
      this.result = (data as any).items ?? [];
      // Map collection format names to layout types
      const formatMap: Record<string, LayoutType> = {
        table: 'table',
        cards: 'card',
        list: 'list',
        chart: 'chart',
        grid: 'grid',
        chips: 'chips',
      };
      return formatMap[hint] ?? 'table';
    }

    // 3. Detect from data shape

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
      if (data.every((item) => typeof item === 'string')) {
        return 'chips';
      }

      // Array of objects → check for chart/timeline/table/list
      if (data.every((item) => typeof item === 'object' && item !== null)) {
        const sample = data[0];

        // Cart: items with price + quantity
        if (this._isCartShaped(data)) return 'cart';

        // Timeline: date + title/event field, 3+ items
        if (data.length >= 3) {
          const hasDate = this._hasDateLikeFields(sample);
          const hasTitleLike = this._hasSemanticFields(sample, [
            'title',
            'event',
            'name',
            'label',
            'subject',
            'action',
            'activity',
          ]);
          const hasDescLike = this._hasSemanticFields(sample, [
            'description',
            'details',
            'body',
            'content',
            'message',
            'summary',
          ]);
          if (hasDate && (hasTitleLike || hasDescLike)) return 'timeline';
        }

        // Chart: predominantly numeric data patterns
        if (this._isChartShaped(data)) return 'chart';

        // Check if we have semantic fields for list
        const hasListFields = this._hasSemanticFields(data[0], [
          'name',
          'title',
          'status',
          'state',
          'description',
        ]);
        return hasListFields ? 'list' : 'table';
      }
    }

    // Single object checks
    if (typeof data === 'object') {
      // Cart: object with items array containing price+quantity
      if (this._isCartShaped(data)) return 'cart';

      // Gauge: { value: N, max: N } or { progress: N }
      if (
        ('progress' in data && typeof data.progress === 'number') ||
        ('value' in data && typeof data.value === 'number' && ('max' in data || 'min' in data))
      ) {
        return 'gauge';
      }

      // Metric: 1 numeric + few string fields
      const keys = Object.keys(data);
      if (keys.length >= 1 && keys.length <= 5) {
        const numericKeys = keys.filter((k) => typeof data[k] === 'number');
        if (numericKeys.length === 1) {
          const nonNumeric = keys.filter((k) => typeof data[k] !== 'number');
          if (
            nonNumeric.every((k) => typeof data[k] === 'string' || typeof data[k] === 'boolean')
          ) {
            return 'metric';
          }
        }
      }

      // Dashboard: 3+ keys with mix of arrays, objects, numbers
      if (keys.length >= 3) {
        let hasArray = false;
        let hasMetricLike = false;
        for (const k of keys) {
          if (Array.isArray(data[k])) hasArray = true;
          else if (typeof data[k] === 'number') hasMetricLike = true;
          else if (typeof data[k] === 'object' && data[k] !== null) hasMetricLike = true;
        }
        if (hasArray && hasMetricLike) return 'dashboard';
      }

      return 'card';
    }

    return 'json';
  }

  private _hasSemanticFields(obj: any, fields: string[]): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj).map((k) => k.toLowerCase());
    return fields.some((f) => keys.includes(f.toLowerCase()));
  }

  private _hasDateLikeFields(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const datePattern =
      /^(date|time|createdAt|updatedAt|created|updated|timestamp|.*At|.*Date|.*Time)$/i;
    const isoPattern = /^\d{4}-\d{2}-\d{2}/;
    for (const [key, value] of Object.entries(obj)) {
      if (datePattern.test(key)) return true;
      if (typeof value === 'string' && isoPattern.test(value)) return true;
    }
    return false;
  }

  private _isChartShaped(data: any[]): boolean {
    if (data.length < 2) return false;
    const sample = data[0];
    if (!sample || typeof sample !== 'object') return false;

    const keys = Object.keys(sample);
    const numFields = keys.filter((k) => typeof sample[k] === 'number').length;
    const strFields = keys.filter((k) => typeof sample[k] === 'string').length;

    // Pattern 1: exactly 1 string + 1 numeric → pie/bar
    if (keys.length === 2 && strFields === 1 && numFields === 1) return true;
    // Pattern 2: date field + numeric → time series
    if (this._hasDateLikeFields(sample) && numFields >= 1) return true;
    // Pattern 3: 1 string label + 2+ numerics → grouped bar
    if (strFields === 1 && numFields >= 2 && keys.length <= 6) return true;

    return false;
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
      case 'kv':
      case 'grid':
        return this._renderCard(filteredData);
      case 'chips':
        return this._renderChips(filteredData);
      case 'tree':
        return this._renderTree(filteredData);
      case 'markdown':
        return this._renderMarkdown();
      case 'html':
        return this._renderHtml();
      case 'text':
        return this._renderText(filteredData);
      case 'chart':
        return this._renderChart(filteredData);
      case 'metric':
        return this._renderMetric(filteredData);
      case 'gauge':
        return this._renderGauge(filteredData);
      case 'timeline':
        return this._renderTimeline(filteredData);
      case 'dashboard':
        return this._renderDashboard(filteredData);
      case 'cart':
        return this._renderCart(filteredData);
      case 'panels':
        return this._renderPanels(filteredData);
      case 'tabs':
        return this._renderTabs(filteredData);
      case 'accordion':
        return this._renderAccordion(filteredData);
      case 'stack':
        return this._renderStack(filteredData);
      case 'columns':
        return this._renderColumns(filteredData);
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
            ${columns.map(
              (col) =>
                html`<th
                  class="sortable ${this._sortColumn === col ? 'sorted' : ''}"
                  @click=${() => this._toggleSort(col)}
                >
                  ${this._formatColumnName(col)}<span class="sort-indicator"
                    >${this._sortColumn === col
                      ? this._sortDirection === 'asc'
                        ? '↑'
                        : '↓'
                      : '⇅'}</span
                  >
                </th>`
            )}
          </tr>
        </thead>
        <tbody>
          ${pageData.map(
            (row) => html`
              <tr class="${this._getItemAnimationClass(row)} ${this._getItemWarmthClass(row)}">
                ${columns.map(
                  (col) => html`<td>${this._formatCellValue(row[col], col, true)}</td>`
                )}
              </tr>
            `
          )}
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
        <span class="pagination-info"> Showing ${startItem}-${endItem} of ${totalItems} </span>
        <div class="pagination-controls">
          <button
            class="pagination-btn"
            ?disabled=${this._currentPage === 0}
            @click=${() => (this._currentPage = 0)}
          >
            «
          </button>
          <button
            class="pagination-btn"
            ?disabled=${this._currentPage === 0}
            @click=${() => this._currentPage--}
          >
            ‹
          </button>
          ${Array.from({ length: endPage - startPage }, (_, i) => startPage + i).map(
            (page) => html`
              <button
                class="pagination-btn ${this._currentPage === page ? 'active' : ''}"
                @click=${() => (this._currentPage = page)}
              >
                ${page + 1}
              </button>
            `
          )}
          <button
            class="pagination-btn"
            ?disabled=${this._currentPage >= totalPages - 1}
            @click=${() => this._currentPage++}
          >
            ›
          </button>
          <button
            class="pagination-btn"
            ?disabled=${this._currentPage >= totalPages - 1}
            @click=${() => (this._currentPage = totalPages - 1)}
          >
            »
          </button>
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
        ${data.map((item) => this._renderListItem(item))}
      </ul>
    `;
  }

  private _renderListItem(item: any): TemplateResult {
    const animClass = this._getItemAnimationClass(item);
    const warmthClass = this._getItemWarmthClass(item);

    if (typeof item !== 'object' || item === null) {
      return html`<li class="list-item ${animClass} ${warmthClass}">
        <span class="list-item-title">${this._highlightText(String(item))}</span>
      </li>`;
    }

    const mapping = this._analyzeFields(item);

    return html`
      <li class="list-item ${animClass} ${warmthClass}">
        ${mapping.icon
          ? html`
              <div class="list-item-leading">
                ${this._isImageUrl(item[mapping.icon])
                  ? html`<img src="${item[mapping.icon]}" alt="" />`
                  : item[mapping.icon]}
              </div>
            `
          : ''}
        <div class="list-item-content">
          ${mapping.title
            ? html`<div class="list-item-title">
                ${this._highlightText(String(item[mapping.title]))}
              </div>`
            : ''}
          ${mapping.subtitle
            ? html`<div class="list-item-subtitle">
                ${this._highlightText(String(item[mapping.subtitle]))}
              </div>`
            : ''}
        </div>
        <div class="list-item-trailing">
          ${mapping.detail
            ? html`<span>${this._highlightText(String(item[mapping.detail]))}</span>`
            : ''}
          ${mapping.badge
            ? html`<span class="status-badge ${this._getStatusClass(item[mapping.badge])}"
                >${item[mapping.badge]}</span
              >`
            : ''}
        </div>
      </li>
    `;
  }

  private _renderCard(data: any): TemplateResult {
    if (!data || typeof data !== 'object') {
      const text = this._renderText(data);
      return html`${text}`;
    }

    // Separate scalar fields from nested arrays/objects
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    const scalarKeys = keys.filter((k) => !this._isNestedValue(data[k]));
    const nestedKeys = keys.filter((k) => this._isNestedValue(data[k]));

    return html`
      ${scalarKeys.length > 0
        ? html`
            <table class="smart-table kv-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                ${scalarKeys.map(
                  (key) => html`
                    <tr>
                      <td class="kv-key">${this._formatColumnName(key)}</td>
                      <td>${this._formatCellValue(data[key], key, true)}</td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          `
        : ''}
      ${nestedKeys.map(
        (key) => html`
          <div style="margin-top:var(--space-sm);">
            ${this._formatCellValue(data[key], key, true)}
          </div>
        `
      )}
    `;
  }

  /** Returns true for arrays of objects or large nested objects that deserve their own section */
  private _isNestedValue(value: any): boolean {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.some((v) => typeof v === 'object' && v !== null)
    )
      return true;
    if (typeof value === 'object' && value !== null && Object.keys(value).length > 4) return true;
    return false;
  }

  private _renderChips(data: any): TemplateResult {
    if (!Array.isArray(data)) {
      return html`<div class="chip">${this._highlightText(String(data))}</div>`;
    }

    return html`
      <div class="smart-chips">
        ${data.map(
          (item) =>
            html`<span class="chip ${this._getItemAnimationClass(item)}"
              >${this._highlightText(String(item))}</span
            >`
        )}
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
    const entries = isArray ? data.map((v, i) => [i, v] as [number, any]) : Object.entries(data);

    const isExpanded = this._expandedNodes.has(path);
    const hasChildren = entries.length > 0;

    return html`
      <div class="tree-node ${isRoot ? 'tree-root' : ''}">
        <div class="tree-item">
          ${hasChildren
            ? html`
                <span class="tree-toggle" @click=${() => this._toggleNode(path)}>
                  ${isExpanded ? '▼' : '▶'}
                </span>
              `
            : html`<span class="tree-toggle"></span>`}
          ${!isRoot ? html`<span class="tree-key">${path.split('.').pop()}</span>` : ''}
          <span class="tree-type"
            >${isArray ? `Array[${entries.length}]` : `Object{${entries.length}}`}</span
          >
        </div>
        ${isExpanded || isRoot
          ? html`
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
            `
          : ''}
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

  // Non-reactive property to avoid infinite update loops
  private _pendingMermaidBlocks: { id: string; code: string }[] = [];

  // Store code blocks for Prism highlighting after DOM update
  private _pendingCodeBlocks: { id: string; code: string; language: string }[] = [];

  private _renderMarkdown(): TemplateResult {
    const str = String(this.result);

    if ((window as any).marked) {
      // Extract mermaid blocks before parsing to handle them separately
      const mermaidBlocks: { id: string; code: string }[] = [];
      const codeBlocks: { id: string; code: string; language: string }[] = [];

      // First extract mermaid blocks
      let processedStr = str.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_match, code) => {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        mermaidBlocks.push({ id, code: code.trim() });
        return `<div class="mermaid-placeholder" data-mermaid-id="${id}" style="min-height: 100px; display: flex; align-items: center; justify-content: center; color: var(--t-muted);">Loading diagram...</div>`;
      });

      // Extract other code blocks for Prism highlighting
      processedStr = processedStr.replace(/```(\w+)?\s*\n([\s\S]*?)```/g, (_match, lang, code) => {
        const id = `code-${Math.random().toString(36).substr(2, 9)}`;
        const language = lang || 'text';
        codeBlocks.push({ id, code: code.trimEnd(), language });
        return `<div class="code-block-wrapper"><span class="language-label">${language}</span><pre data-code-id="${id}" class="language-${language}"><code class="language-${language}">Loading...</code></pre></div>`;
      });

      // Store blocks for rendering after DOM update (non-reactive)
      this._pendingMermaidBlocks = mermaidBlocks;
      this._pendingCodeBlocks = codeBlocks;

      const htmlContent = (window as any).marked.parse(processedStr);

      return html`
        <div class="markdown-body-wrapper">
          <button class="expand-btn" @click=${this._openMarkdownFullscreen} title="View fullscreen">
            ⤢
          </button>
          <div class="markdown-body">${unsafeHTML(htmlContent)}</div>
        </div>
      `;
    }

    return html`<pre>${str}</pre>`;
  }

  private _renderHtml(): TemplateResult {
    const htmlContent = String(this.result);
    return html` <div class="html-content">${unsafeHTML(htmlContent)}</div> `;
  }

  private _openMarkdownFullscreen = () => {
    // Capture the rendered markdown (including mermaid SVGs) from the DOM
    const markdownBody = this.shadowRoot?.querySelector('.markdown-body');
    if (markdownBody) {
      this._fullscreenMarkdown = markdownBody.innerHTML;
    }
  };

  private _openImageFullscreen(src: string) {
    this._resetZoom();
    this._fullscreenImage = src;
    // Auto-fit image after it loads
    setTimeout(() => {
      const img = this.shadowRoot?.querySelector('.fullscreen-content img') as HTMLImageElement;
      if (img && img.complete) {
        this._autoFitImage(img);
      } else if (img) {
        img.onload = () => this._autoFitImage(img);
      }
    }, 50);
  }

  private _autoFitImage(img: HTMLImageElement) {
    const viewport = this.shadowRoot?.querySelector('.fullscreen-viewport');
    if (!viewport) return;

    const viewportRect = viewport.getBoundingClientRect();
    const viewportWidth = viewportRect.width * 0.9;
    const viewportHeight = viewportRect.height * 0.85;

    const imgWidth = img.naturalWidth || img.width;
    const imgHeight = img.naturalHeight || img.height;

    if (imgWidth > 0 && imgHeight > 0) {
      const scaleX = viewportWidth / imgWidth;
      const scaleY = viewportHeight / imgHeight;
      const fitZoom = Math.min(scaleX, scaleY);
      // Use fit zoom, ensure at least 1x for small images
      this._zoomLevel = Math.max(1, fitZoom);
    }
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);

    // Diff-aware result handling: detect changes across null-gap and direct updates
    if (changedProperties.has('result')) {
      const oldResult = changedProperties.get('result');

      if (this.result === null || this.result === undefined) {
        // Clearing (e.g., before execute) — save old for diffing when new result arrives
        if (Array.isArray(oldResult)) {
          this._previousResult = oldResult;
        }
        this._internalResult = null;
        this._animatedItems.clear();
      } else if (Array.isArray(this.result)) {
        // New array result — try to diff against baseline
        const baseline = this._previousResult ?? (Array.isArray(oldResult) ? oldResult : null);
        this._previousResult = null;

        if (baseline) {
          this._applyDiff(baseline, this.result);
          // _applyDiff may set _internalResult for ghost removal animation — don't overwrite
          if (this._internalResult === null) {
            // No ghosts, fall through to result property
          }
        } else {
          // First load — no diff, clean slate. Detect ID field and restore persisted heat.
          this._activeIdField = this._detectIdField(this.result);
          this._internalResult = null;
          this._animatedItems.clear();
          this._restoreHeatTimestamps();
        }
      } else {
        // Non-array result — reset
        this._previousResult = null;
        this._internalResult = null;
        this._animatedItems.clear();
      }
    }

    // Render mermaid blocks after DOM update (only if there are pending blocks)
    if (this._pendingMermaidBlocks.length > 0 && (window as any).mermaid) {
      const blocks = this._pendingMermaidBlocks;
      this._pendingMermaidBlocks = []; // Clear before async render to prevent re-entry
      this._renderMermaidBlocks(blocks);
    }

    // Highlight code blocks with Prism after DOM update
    if (this._pendingCodeBlocks.length > 0 && (window as any).Prism) {
      const codeBlocks = this._pendingCodeBlocks;
      this._pendingCodeBlocks = []; // Clear before render to prevent re-entry
      this._highlightCodeBlocks(codeBlocks);
    }

    // Re-render mermaid if theme changed
    if (changedProperties.has('theme') && changedProperties.get('theme') !== undefined) {
      this._reRenderMermaidOnThemeChange();
    }
  }

  private _highlightCodeBlocks(blocks: { id: string; code: string; language: string }[]) {
    const Prism = (window as any).Prism;
    if (!Prism) return;

    for (const { id, code, language } of blocks) {
      const preElement = this.shadowRoot?.querySelector(`[data-code-id="${id}"]`);
      if (!preElement) continue;

      const codeElement = preElement.querySelector('code');
      if (!codeElement) continue;

      // Map common language aliases
      const langMap: Record<string, string> = {
        ts: 'typescript',
        js: 'javascript',
        py: 'python',
        sh: 'bash',
        shell: 'bash',
        yml: 'yaml',
        md: 'markdown',
      };
      const prismLang = langMap[language] || language;

      // Check if Prism has the language, fall back to text
      const grammar = Prism.languages[prismLang] || Prism.languages['text'];

      try {
        const highlighted = Prism.highlight(code, grammar, prismLang);
        codeElement.innerHTML = highlighted;
      } catch (e) {
        // Fall back to plain text
        codeElement.textContent = code;
      }
    }
  }

  private _reRenderMermaidOnThemeChange() {
    // Find all existing mermaid wrappers and re-render them
    const wrappers = this.shadowRoot?.querySelectorAll('.mermaid-wrapper');
    if (!wrappers || wrappers.length === 0) return;

    const mermaid = (window as any).mermaid;
    if (!mermaid) return;

    // Update background color for existing wrappers
    const bgColor = this.theme === 'light' ? '#F4F6F8' : '#1e293b';
    wrappers.forEach((wrapper) => {
      (wrapper as HTMLElement).style.background = bgColor;
    });

    // Note: Full re-render of mermaid diagrams would require storing the original code
    // For now, we just update the background color. Full re-render happens on next result.
  }

  private async _renderMermaidBlocks(blocks: { id: string; code: string }[]) {
    const mermaid = (window as any).mermaid;
    if (!mermaid) return;

    // Configure mermaid theme based on current theme
    const mermaidTheme = this.theme === 'light' ? 'default' : 'dark';
    mermaid.initialize({
      startOnLoad: false,
      theme: mermaidTheme,
      themeVariables:
        this.theme === 'light'
          ? {
              primaryColor: '#e0e7ff',
              primaryTextColor: '#1e293b',
              primaryBorderColor: '#6366f1',
              lineColor: '#64748b',
              secondaryColor: '#f1f5f9',
              tertiaryColor: '#F4F6F8',
              background: '#F9FAFB',
              mainBkg: '#F4F6F8',
              textColor: '#1F2937',
              nodeBorder: '#cbd5e1',
            }
          : {
              primaryColor: '#3730a3',
              primaryTextColor: '#e2e8f0',
              primaryBorderColor: '#6366f1',
              lineColor: '#64748b',
              secondaryColor: '#1e293b',
              tertiaryColor: '#0f172a',
              background: '#0f172a',
              mainBkg: '#1e293b',
              textColor: '#e2e8f0',
              nodeBorder: '#334155',
            },
    });

    for (const { id, code } of blocks) {
      const placeholder = this.shadowRoot?.querySelector(`[data-mermaid-id="${id}"]`);
      if (!placeholder) {
        console.warn('Mermaid placeholder not found:', id);
        continue;
      }

      try {
        // Create mermaid container with theme-aware background
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-wrapper';
        const bgColor = this.theme === 'light' ? '#F4F6F8' : '#1e293b';
        wrapper.style.cssText = `position: relative; background: ${bgColor}; border-radius: var(--radius-sm); padding: 16px; margin: 16px 0;`;

        const diagramDiv = document.createElement('div');
        diagramDiv.id = id;

        // Render mermaid
        const { svg } = await mermaid.render(id + '-svg', code);
        diagramDiv.innerHTML = svg;

        // Add expand button
        const expandBtn = document.createElement('button');
        expandBtn.innerHTML = '⤢';
        expandBtn.title = 'View fullscreen';
        expandBtn.className = 'expand-btn';
        expandBtn.style.opacity = '0'; // Start hidden, show on hover via CSS
        expandBtn.onclick = () => {
          this._resetZoom();
          this._fullscreenMermaid = code;
          setTimeout(async () => {
            const fullscreenContainer = this.shadowRoot?.querySelector('#fullscreen-mermaid');
            if (fullscreenContainer && mermaid) {
              const fsId = 'fullscreen-' + id;
              const { svg: fsSvg } = await mermaid.render(fsId + '-svg', code);
              fullscreenContainer.innerHTML = fsSvg;
              // Auto-fit: calculate zoom to fill viewport
              this._autoFitFullscreen();
            }
          }, 50);
        };

        wrapper.appendChild(diagramDiv);
        wrapper.appendChild(expandBtn);
        placeholder.replaceWith(wrapper);
      } catch (e) {
        console.error('Mermaid render error:', e);
        (placeholder as HTMLElement).innerHTML =
          `<pre style="color: #ff6b6b; background: rgba(255,0,0,0.1); padding: 8px; border-radius: var(--radius-xs);">Mermaid Error: ${e}\n\n${code}</pre>`;
      }
    }
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

  private _analyzeFields(obj: any): {
    title?: string;
    subtitle?: string;
    icon?: string;
    badge?: string;
    detail?: string;
  } {
    const keys = Object.keys(obj);
    const result: any = {};

    // Use layout hints if provided
    if (this.layoutHints) {
      if (this.layoutHints.title && keys.includes(this.layoutHints.title))
        result.title = this.layoutHints.title;
      if (this.layoutHints.subtitle && keys.includes(this.layoutHints.subtitle))
        result.subtitle = this.layoutHints.subtitle;
      if (this.layoutHints.icon && keys.includes(this.layoutHints.icon))
        result.icon = this.layoutHints.icon;
      if (this.layoutHints.badge && keys.includes(this.layoutHints.badge))
        result.badge = this.layoutHints.badge;
      if (this.layoutHints.detail && keys.includes(this.layoutHints.detail))
        result.detail = this.layoutHints.detail;
    }

    // Auto-detect from field names
    const titleFields = ['name', 'title', 'label', 'displayName', 'heading', 'subject'];
    const subtitleFields = ['description', 'email', 'summary', 'bio', 'address', 'subtitle'];
    const iconFields = ['icon', 'avatar', 'image', 'photo', 'thumbnail', 'picture'];
    const badgeFields = ['status', 'state', 'type', 'role', 'category', 'priority'];
    const detailFields = ['count', 'total', 'amount', 'price', 'value', 'size'];

    if (!result.title) result.title = keys.find((k) => titleFields.includes(k.toLowerCase()));
    if (!result.subtitle)
      result.subtitle = keys.find((k) => subtitleFields.includes(k.toLowerCase()));
    if (!result.icon) result.icon = keys.find((k) => iconFields.includes(k.toLowerCase()));
    if (!result.badge) result.badge = keys.find((k) => badgeFields.includes(k.toLowerCase()));
    if (!result.detail) result.detail = keys.find((k) => detailFields.includes(k.toLowerCase()));

    return result;
  }

  private _formatColumnName(name: string): string {
    // Convert camelCase/snake_case to Title Case
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\s/, '')
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private _formatCellValue(value: any, key: string, highlight = false): TemplateResult | string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? '✓' : '✗';

    // Check for image URLs - make them clickable for fullscreen
    if (this._isImageUrl(value)) {
      return html`
        <div>
          <img
            src="${value}"
            alt="${key}"
            class="clickable-image"
            style="max-height: 80px; max-width: 150px;"
            @click=${() => this._openImageFullscreen(value)}
          />
          <div class="expand-hint">Click to expand</div>
        </div>
      `;
    }

    // Check for date fields
    if (this._isDateField(key) && (typeof value === 'string' || typeof value === 'number')) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        const dateStr = date.toLocaleString();
        return highlight ? this._highlightText(dateStr) : dateStr;
      }
    }

    // Check for URL fields - render as clickable link with full URL visible
    if (this._isUrlField(key) && typeof value === 'string' && value.startsWith('http')) {
      return html`
        <a href="${value}" target="_blank" rel="noopener" class="result-link">
          ${value} <span class="link-icon">↗</span>
        </a>
      `;
    }

    // Check for status fields
    if (this._isStatusField(key) && typeof value === 'string') {
      return html`<span class="status-badge ${this._getStatusClass(value)}">${value}</span>`;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return '—';
      // Array of primitives → inline chips
      if (value.every((v) => typeof v !== 'object' || v === null)) {
        return html`<span style="display:flex;flex-wrap:wrap;gap:3px;"
          >${value.map(
            (v) =>
              html`<span
                style="font-size:0.75rem;padding:1px 6px;border-radius:3px;background:hsla(220,10%,80%,0.08);color:var(--t-muted);font-family:var(--font-mono);"
                >${String(v)}</span
              >`
          )}</span
        >`;
      }
      // Array of objects → collapsible nested table
      const nodeKey = `cell-${key}`;
      const isExpanded = this._expandedNodes.has(nodeKey);
      const columns = Object.keys(value[0]).filter((k) => value[0][k] !== undefined);
      return html`
        <div>
          <button
            style="background:none;border:none;color:var(--accent-secondary);cursor:pointer;font-size:0.8rem;padding:2px 0;font-family:inherit;"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggleNode(nodeKey);
            }}
          >
            ${isExpanded ? '▾' : '▸'} ${value.length} items
          </button>
          ${isExpanded
            ? html`
                <table class="smart-table" style="margin-top:6px;font-size:0.8rem;">
                  <thead>
                    <tr>
                      ${columns.map(
                        (c) =>
                          html`<th style="white-space:nowrap;">${this._formatColumnName(c)}</th>`
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    ${value.slice(0, 100).map(
                      (row) => html`
                        <tr>
                          ${columns.map(
                            (c) =>
                              html`<td
                                style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                              >
                                ${this._formatCellValue(row[c], c, highlight)}
                              </td>`
                          )}
                        </tr>
                      `
                    )}
                    ${value.length > 100
                      ? html`<tr>
                          <td
                            colspan="${columns.length}"
                            style="text-align:center;color:var(--t-muted);font-style:italic;"
                          >
                            …and ${value.length - 100} more
                          </td>
                        </tr>`
                      : ''}
                  </tbody>
                </table>
              `
            : ''}
        </div>
      `;
    }

    if (typeof value === 'object' && value !== null) {
      // Single nested object → inline key-value pairs
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length <= 4) {
        return html`<span style="display:flex;flex-wrap:wrap;gap:4px 10px;"
          >${entries.map(
            ([k, v]) =>
              html`<span
                ><span style="color:var(--t-muted);font-size:0.75rem;text-transform:uppercase;"
                  >${k}</span
                >
                <span>${typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></span
              >`
          )}</span
        >`;
      }
      const nodeKey = `cell-${key}`;
      const isExpanded = this._expandedNodes.has(nodeKey);
      return html`
        <div>
          <button
            style="background:none;border:none;color:var(--accent-secondary);cursor:pointer;font-size:0.8rem;padding:2px 0;font-family:inherit;"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggleNode(nodeKey);
            }}
          >
            ${isExpanded ? '▾' : '▸'} ${entries.length} fields
          </button>
          ${isExpanded
            ? html`
                <table
                  class="smart-table kv-table"
                  style="margin-top:6px;font-size:0.8rem;max-width:100%;"
                >
                  <tbody>
                    ${entries.map(
                      ([k, v]) => html`
                        <tr>
                          <td class="kv-key">${this._formatColumnName(k)}</td>
                          <td>${this._formatCellValue(v, k, highlight)}</td>
                        </tr>
                      `
                    )}
                  </tbody>
                </table>
              `
            : ''}
        </div>
      `;
    }

    const str = String(value);
    return highlight ? this._highlightText(str) : str;
  }

  private _isDateField(key: string): boolean {
    const lower = key.toLowerCase();
    return (
      lower.endsWith('at') ||
      lower.endsWith('date') ||
      lower.endsWith('time') ||
      lower === 'created' ||
      lower === 'updated' ||
      lower === 'modified' ||
      lower === 'timestamp' ||
      lower === 'expires' ||
      lower === 'since'
    );
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
    // Only match actual URLs, not bare file paths
    if (
      !value.startsWith('http://') &&
      !value.startsWith('https://') &&
      !value.startsWith('data:image/')
    )
      return false;
    // Standard image file extensions
    if (/\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|avif)(\?.*)?$/i.test(value)) return true;
    // Data URIs
    if (value.startsWith('data:image/')) return true;
    // Common avatar/image CDN patterns (URLs with no extension but known to serve images)
    // Check both path segments and domain names
    if (/\/(avatar|image|photo|img|thumb|pic|gravatar|pravatar)\b/i.test(value)) return true;
    if (/\b(avatar|image|photo|img|thumb|pic|gravatar|pravatar)\.(cc|com|io|net)\b/i.test(value))
      return true;
    return false;
  }

  private _getStatusClass(status: any): string {
    const lower = String(status).toLowerCase();
    if (
      ['success', 'active', 'completed', 'online', 'done', 'enabled', 'yes', 'true'].includes(lower)
    ) {
      return 'status-success';
    }
    if (
      ['error', 'failed', 'offline', 'inactive', 'disabled', 'no', 'false', 'blocked'].includes(
        lower
      )
    ) {
      return 'status-error';
    }
    if (['warning', 'pending', 'processing', 'in_progress', 'todo', 'waiting'].includes(lower)) {
      return 'status-warning';
    }
    return '';
  }

  private _copy() {
    const text =
      typeof this.result === 'object' ? JSON.stringify(this.result, null, 2) : String(this.result);

    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  }

  private _share() {
    this.dispatchEvent(
      new CustomEvent('share', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _isTabularData(): boolean {
    return (
      Array.isArray(this.result) &&
      this.result.length > 0 &&
      typeof this.result[0] === 'object' &&
      this.result[0] !== null
    );
  }

  private _getDownloadLabel(layout: LayoutType): string {
    switch (layout) {
      case 'markdown':
        return 'MD';
      case 'mermaid':
        return 'MMD';
      case 'text':
        return 'TXT';
      case 'code':
        return 'TXT';
      default:
        return 'JSON';
    }
  }

  private _downloadSmart(layout: LayoutType) {
    let content: string;
    let mimeType: string;
    let extension: string;
    const timestamp = new Date().toISOString().slice(0, 10);

    switch (layout) {
      case 'markdown':
        content = String(this.result);
        mimeType = 'text/markdown';
        extension = 'md';
        break;
      case 'mermaid':
        // Extract mermaid code from result
        content = String(this.result);
        mimeType = 'text/plain';
        extension = 'mmd';
        break;
      case 'text':
      case 'code':
        content = String(this.result);
        mimeType = 'text/plain';
        extension = 'txt';
        break;
      case 'chips':
        // Array of strings - save as newline-separated
        content = Array.isArray(this.result) ? this.result.join('\n') : String(this.result);
        mimeType = 'text/plain';
        extension = 'txt';
        break;
      default:
        // JSON for table, list, card, tree, json
        content = JSON.stringify(this.result, null, 2);
        mimeType = 'application/json';
        extension = 'json';
    }

    const filename = `result-${timestamp}.${extension}`;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Downloaded as ${filename}`, 'success');
  }

  private _download(format: 'json' | 'csv') {
    let content: string;
    let mimeType: string;
    let filename: string;
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv' && this._isTabularData()) {
      content = this._convertToCsv(this.result);
      mimeType = 'text/csv';
      filename = `result-${timestamp}.csv`;
    } else {
      content = JSON.stringify(this.result, null, 2);
      mimeType = 'application/json';
      filename = `result-${timestamp}.json`;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Downloaded as ${filename}`, 'success');
  }

  private _convertToCsv(data: any[]): string {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const rows = data.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          if (value === null || value === undefined) return '';
          const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
          // Escape quotes and wrap in quotes if contains comma/newline/quote
          if (str.includes(',') || str.includes('\n') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Chart Rendering (Chart.js)
  // ═══════════════════════════════════════════════════════════════════════════

  private _renderChart(data: any): TemplateResult {
    if (!data) return html`<div class="empty-state">No chart data</div>`;

    // Generate unique canvas ID for each chart instance (fixes columns format with multiple charts)
    const canvasId = `chart-${Math.random().toString(36).slice(2, 9)}`;

    // Schedule chart creation after render
    this.updateComplete.then(() => this._initChart(data, canvasId));

    return html`
      <div class="chart-container">
        <canvas id="${canvasId}"></canvas>
      </div>
    `;
  }

  private async _initChart(data: any, canvasId?: string) {
    const Chart = await loadChartJS();
    const id = canvasId || this._chartCanvasId;
    const canvas = this.shadowRoot?.querySelector<HTMLCanvasElement>(`#${id}`);
    if (!canvas) return;

    const isDark = this.theme !== 'light';
    const palette = isDark ? CHART_PALETTE.dark : CHART_PALETTE.light;
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(100, 116, 139, 0.1)';

    // Determine chart type and build config
    const config = this._buildChartConfig(data, palette, textColor, gridColor);
    if (!config) return;

    // Handle multiple charts (for columns format) or single chart (backward compatible)
    if (canvasId) {
      // Multiple charts mode: track by canvas ID
      const existingChart = this._chartInstances.get(id);
      if (existingChart && existingChart.canvas === canvas) {
        existingChart.data = config.data;
        if (config.options) existingChart.options = config.options;
        existingChart.update('active');
        return;
      }
      if (existingChart) {
        existingChart.destroy();
      }
      this._chartInstances.set(id, new Chart(canvas, config));
    } else {
      // Single chart mode (backward compatible with existing code)
      if (this._chartInstance && this._chartInstance.canvas === canvas) {
        this._chartInstance.data = config.data;
        if (config.options) this._chartInstance.options = config.options;
        this._chartInstance.update('active');
        return;
      }
      if (this._chartInstance) {
        this._chartInstance.destroy();
        this._chartInstance = null;
      }
      this._chartInstance = new Chart(canvas, config);
    }
  }

  private _buildChartConfig(
    data: any,
    palette: string[],
    textColor: string,
    gridColor: string
  ): any {
    const chartType = this._getChartType(data);
    const items = Array.isArray(data) ? data : [data];
    if (items.length === 0) return null;

    const sample = items[0];
    if (!sample || typeof sample !== 'object') return null;

    const keys = Object.keys(sample);
    const numericKeys = keys.filter((k) => typeof sample[k] === 'number');
    const stringKeys = keys.filter((k) => typeof sample[k] === 'string');
    const dateKeys = keys.filter(
      (k) =>
        /^(date|time|createdAt|updatedAt|created|updated|timestamp|.*At|.*Date|.*Time)$/i.test(k) ||
        (typeof sample[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sample[k]))
    );

    // Resolve label/x/y from hints or auto-detect
    const labelField =
      this.layoutHints?.label || this.layoutHints?.x || dateKeys[0] || stringKeys[0];
    const valueFields = this.layoutHints?.y
      ? [this.layoutHints.y]
      : this.layoutHints?.value
        ? [this.layoutHints.value]
        : numericKeys;

    if (!labelField || valueFields.length === 0) return null;

    const labels = items.map((item: any) => {
      const val = item[labelField];
      // Format dates nicely
      if (dateKeys.includes(labelField) && typeof val === 'string') {
        try {
          return new Date(val).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          });
        } catch {
          return String(val);
        }
      }
      return String(val);
    });

    const datasets = valueFields.map((field, i) => ({
      label: this._formatColumnName(field),
      data: items.map((item: any) => item[field] ?? 0),
      backgroundColor:
        chartType === 'pie' || chartType === 'doughnut'
          ? palette.slice(0, items.length)
          : this._hexToRgba(palette[i % palette.length], 0.7),
      borderColor: palette[i % palette.length],
      borderWidth: chartType === 'pie' || chartType === 'doughnut' ? 0 : 2,
      tension: 0.3,
      fill: chartType === 'line' && valueFields.length === 1 ? 'origin' : false,
      pointRadius: chartType === 'scatter' ? 5 : 3,
      pointHoverRadius: chartType === 'scatter' ? 8 : 5,
    }));

    const isPolar = chartType === 'pie' || chartType === 'doughnut' || chartType === 'radar';

    return {
      type: chartType === 'area' ? 'line' : chartType,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 600, easing: 'easeOutQuart' as const },
        plugins: {
          legend: {
            display: datasets.length > 1 || isPolar,
            position: 'bottom' as const,
            labels: {
              color: textColor,
              padding: 16,
              usePointStyle: true,
              pointStyle: 'rect',
              pointStyleWidth: 10,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleColor: '#e2e8f0',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(99, 102, 241, 0.3)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
          },
        },
        scales: isPolar
          ? {}
          : {
              x: {
                grid: { color: gridColor },
                ticks: { color: textColor, maxRotation: 45 },
              },
              y: {
                grid: { color: gridColor },
                ticks: { color: textColor },
                beginAtZero: chartType === 'bar',
              },
            },
      },
    };
  }

  private _getChartType(data: any): string {
    // Explicit from @format chart:type
    if (this.outputFormat?.startsWith('chart:')) {
      const sub = this.outputFormat.split(':')[1];
      if (sub === 'donut') return 'doughnut';
      if (sub === 'area') return 'line'; // area is line with fill
      return sub;
    }

    // From layout hints
    if (this.layoutHints?.chartType) {
      const sub = this.layoutHints.chartType;
      if (sub === 'donut') return 'doughnut';
      if (sub === 'area') return 'line';
      return sub;
    }

    // Auto-detect
    const items = Array.isArray(data) ? data : [data];
    if (items.length === 0) return 'bar';
    const sample = items[0];
    if (!sample || typeof sample !== 'object') return 'bar';

    const keys = Object.keys(sample);
    const numericKeys = keys.filter((k) => typeof sample[k] === 'number');
    const hasDate = this._hasDateLikeFields(sample);

    // Time series → line
    if (hasDate && numericKeys.length >= 1) return 'line';
    // 2 fields (label + value) with few items → pie
    if (keys.length === 2 && numericKeys.length === 1 && items.length <= 8) return 'pie';
    // Default → bar
    return 'bar';
  }

  private _hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Metric/KPI Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  private _renderMetric(data: any): TemplateResult {
    if (!data || typeof data !== 'object') {
      // If it's a raw number, render as metric
      if (typeof data === 'number') {
        return this._renderMetricCard(data, undefined, undefined, undefined);
      }
      return html`<div class="empty-state">No metric data</div>`;
    }

    const keys = Object.keys(data);
    // Find the numeric field
    const numericKey = keys.find((k) => typeof data[k] === 'number');
    if (!numericKey) return this._renderJson(data);

    const value = data[numericKey];
    const label =
      data.label || data.name || data.title || (numericKey !== 'value' ? numericKey : undefined);
    const delta = data.delta || data.change || data.diff;
    const trend = data.trend || (delta ? this._detectTrend(delta) : undefined);

    return this._renderMetricCard(value, label, delta, trend);
  }

  private _renderMetricCard(
    value: number,
    label?: string,
    delta?: string | number,
    trend?: string
  ): TemplateResult {
    const formattedValue = this._formatMetricValue(value);
    const deltaStr = delta !== undefined ? String(delta) : undefined;
    const trendClass = trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'neutral';

    return html`
      <div class="metric-container ${this._objectJustChanged ? 'value-flash' : ''}">
        <div class="metric-value">${formattedValue}</div>
        ${label ? html`<div class="metric-label">${label}</div>` : ''}
        ${deltaStr
          ? html`
              <div class="metric-delta ${trendClass}">
                <span class="metric-delta-arrow"
                  >${trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}</span
                >
                <span class="metric-delta-value">${deltaStr}</span>
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _formatMetricValue(value: number): string {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  private _detectTrend(delta: string | number): string {
    const str = String(delta);
    if (str.startsWith('+') || str.startsWith('↑')) return 'up';
    if (str.startsWith('-') || str.startsWith('↓')) return 'down';
    if (typeof delta === 'number') return delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
    return 'neutral';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gauge Rendering (SVG)
  // ═══════════════════════════════════════════════════════════════════════════

  private _renderGauge(data: any): TemplateResult {
    if (!data || typeof data !== 'object')
      return html`<div class="empty-state">No gauge data</div>`;

    let value: number;
    let min = 0;
    let max = 100;
    let label: string | undefined;

    if ('progress' in data && typeof data.progress === 'number') {
      value = data.progress * 100;
      label = data.label || 'Progress';
    } else {
      value = data.value ?? 0;
      min = parseFloat(this.layoutHints?.min ?? String(data.min ?? 0));
      max = parseFloat(this.layoutHints?.max ?? String(data.max ?? 100));
      label = data.label || this.layoutHints?.title;
    }

    // Normalize to 0-1 range
    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));

    // SVG arc parameters (semicircle)
    const cx = 80;
    const cy = 80;
    const r = 60;
    const startAngle = Math.PI; // 180 degrees (left)
    const endAngle = 0; // 0 degrees (right)
    const sweepAngle = startAngle - (startAngle - endAngle) * normalized;

    const startX = cx + r * Math.cos(startAngle);
    const startY = cy - r * Math.sin(startAngle);
    const endX = cx + r * Math.cos(sweepAngle);
    const endY = cy - r * Math.sin(sweepAngle);
    // For a semicircle gauge (180° max), arc is always < 180°, so largeArcFlag = 0
    const largeArcFlag = 0;

    // Color gradient: green → yellow → red
    const color = this._getGaugeColor(normalized);

    const displayValue =
      data.progress !== undefined ? `${Math.round(value)}%` : String(Math.round(value));

    return html`
      <div class="gauge-container ${this._objectJustChanged ? 'value-flash' : ''}">
        <svg class="gauge-svg" viewBox="0 0 160 100">
          <!-- Background arc -->
          <path
            d="M ${startX} ${startY} A ${r} ${r} 0 1 1 ${cx + r * Math.cos(endAngle)} ${cy -
            r * Math.sin(endAngle)}"
            fill="none"
            stroke="${this.theme === 'light' ? '#e2e8f0' : '#334155'}"
            stroke-width="12"
            stroke-linecap="round"
          />
          <!-- Value arc -->
          ${normalized > 0.01
            ? svg`<path
                d="M ${startX} ${startY} A ${r} ${r} 0 ${largeArcFlag} 1 ${endX} ${endY}"
                fill="none"
                stroke="${color}"
                stroke-width="12"
                stroke-linecap="round"
              />`
            : ''}
          <!-- Center value -->
          <text
            x="${cx}"
            y="${cy - 8}"
            text-anchor="middle"
            font-size="22"
            font-weight="700"
            fill="${this.theme === 'light' ? '#1e293b' : '#e2e8f0'}"
            font-variant-numeric="tabular-nums"
          >
            ${displayValue}
          </text>
        </svg>
        ${label ? html`<div class="gauge-label">${label}</div>` : ''}
      </div>
    `;
  }

  private _getGaugeColor(normalized: number): string {
    if (normalized < 0.5) {
      // Green to Yellow
      const r = Math.round(34 + (234 - 34) * (normalized * 2));
      const g = Math.round(197 + (179 - 197) * (normalized * 2));
      const b = Math.round(94 + (8 - 94) * (normalized * 2));
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Yellow to Red
      const t = (normalized - 0.5) * 2;
      const r = Math.round(234 + (239 - 234) * t);
      const g = Math.round(179 + (68 - 179) * t);
      const b = Math.round(8 + (68 - 8) * t);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Timeline Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  private _renderTimeline(data: any): TemplateResult {
    if (!Array.isArray(data) || data.length === 0)
      return html`<div class="empty-state">No timeline data</div>`;

    // Resolve field names
    const sample = data[0];
    const dateField = this._resolveTimelineField(
      sample,
      this.layoutHints?.date,
      /^(date|time|createdAt|updatedAt|created|updated|timestamp|.*At|.*Date|.*Time)$/i
    );
    const titleField = this._resolveTimelineField(
      sample,
      this.layoutHints?.title,
      /^(title|event|name|label|subject|heading|action|activity)$/i
    );
    const descField = this._resolveTimelineField(
      sample,
      this.layoutHints?.description,
      /^(description|details|body|content|message|summary|text|note)$/i
    );

    // Sort by date (newest first)
    const sorted = [...data].sort((a, b) => {
      if (!dateField) return 0;
      const da = new Date(a[dateField]).getTime();
      const db = new Date(b[dateField]).getTime();
      return db - da;
    });

    // Group by day
    const groups = new Map<string, any[]>();
    for (const item of sorted) {
      const dateVal = dateField ? item[dateField] : '';
      let dayKey: string;
      try {
        dayKey = new Date(dateVal).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        });
      } catch {
        dayKey = String(dateVal);
      }
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey)!.push(item);
    }

    return html`
      <div class="timeline-container">
        ${[...groups.entries()].map(
          ([day, items]) => html`
            <div class="timeline-group-header">${day}</div>
            ${items.map(
              (item, i) => html`
                <div
                  class="timeline-item ${this._getItemAnimationClass(
                    item
                  )} ${this._getItemWarmthClass(item)}"
                  style="animation-delay: ${i * 60}ms"
                >
                  ${dateField
                    ? html`<div class="timeline-time">
                        ${this._formatTimelineTime(item[dateField])}
                      </div>`
                    : ''}
                  <div class="timeline-title">
                    ${titleField ? item[titleField] : JSON.stringify(item)}
                  </div>
                  ${descField && item[descField]
                    ? html`<div class="timeline-description">${item[descField]}</div>`
                    : ''}
                </div>
              `
            )}
          `
        )}
      </div>
    `;
  }

  private _resolveTimelineField(
    sample: any,
    hint: string | undefined,
    pattern: RegExp
  ): string | undefined {
    if (hint && hint in sample) return hint;
    return Object.keys(sample).find((k) => pattern.test(k));
  }

  private _formatTimelineTime(dateVal: any): string {
    try {
      return new Date(dateVal).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(dateVal);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Dashboard Rendering (Composite)
  // ═══════════════════════════════════════════════════════════════════════════

  private _renderDashboard(data: any): TemplateResult {
    if (!data || typeof data !== 'object')
      return html`<div class="empty-state">No dashboard data</div>`;

    const entries = Object.entries(data);

    return html`
      <div class="dashboard-grid">
        ${entries.map(
          ([key, value]) => html`
            <div class="dashboard-panel">
              <div class="dashboard-panel-header">${this._formatColumnName(key)}</div>
              <div class="dashboard-panel-content">${this._renderDashboardPanel(value)}</div>
            </div>
          `
        )}
      </div>
    `;
  }

  private _renderDashboardPanel(value: any): TemplateResult | string {
    // Metric: single number
    if (typeof value === 'number') {
      return this._renderMetricCard(value);
    }

    // Metric object: { value, label, delta }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'value' in value &&
      typeof value.value === 'number'
    ) {
      const keys = Object.keys(value);
      const numericKeys = keys.filter((k) => typeof value[k] === 'number');
      if (numericKeys.length === 1 || keys.length <= 5) {
        return this._renderMetric(value);
      }
    }

    // Gauge: { value, max } or { progress }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (('progress' in value && typeof value.progress === 'number') ||
        ('value' in value && typeof value.value === 'number' && ('max' in value || 'min' in value)))
    ) {
      return this._renderGauge(value);
    }

    // Array of objects → try chart first, then table
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      if (this._isChartShaped(value)) {
        // Inline chart for dashboard panel
        const canvasId = `dash-chart-${Math.random().toString(36).slice(2, 9)}`;
        this.updateComplete.then(async () => {
          const Chart = await loadChartJS();
          const canvas = this.shadowRoot?.querySelector<HTMLCanvasElement>(`#${canvasId}`);
          if (!canvas) return;

          const isDark = this.theme !== 'light';
          const palette = isDark ? CHART_PALETTE.dark : CHART_PALETTE.light;
          const textColor = isDark ? '#94a3b8' : '#64748b';
          const gridColor = isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(100, 116, 139, 0.1)';

          // Build config using existing helper
          const config = this._buildChartConfig(value, palette, textColor, gridColor);
          if (config) {
            // Make dashboard charts smaller
            config.options.plugins.legend.display = false;
            new Chart(canvas, config);
          }
        });

        return html`
          <div class="chart-container">
            <canvas id="${canvasId}"></canvas>
          </div>
        `;
      }

      // Fallback: render as mini-list
      return html`
        <div style="max-height: 200px; overflow-y: auto; font-size: 0.85rem;">
          ${value.slice(0, 5).map(
            (item: any) => html`
              <div
                style="padding: 6px 8px; border-bottom: 1px solid var(--border-glass); display:flex; gap:8px;"
              >
                ${Object.entries(item)
                  .slice(0, 3)
                  .map(
                    ([, v]) =>
                      html`<span
                        style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                        >${String(v)}</span
                      >`
                  )}
              </div>
            `
          )}
          ${value.length > 5
            ? html`<div
                style="padding:6px 8px;color:var(--t-muted);text-align:center;font-style:italic;"
              >
                +${value.length - 5} more
              </div>`
            : ''}
        </div>
      `;
    }

    // Array of primitives → chips
    if (Array.isArray(value)) {
      return html`
        <div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px;">
          ${value.map(
            (v: any) =>
              html`<span
                style="padding:2px 8px;border-radius:12px;background:var(--bg-glass);font-size:0.8rem;"
                >${String(v)}</span
              >`
          )}
        </div>
      `;
    }

    // Nested object → mini key-value
    if (value && typeof value === 'object') {
      return html`
        <div style="font-size: 0.85rem;">
          ${Object.entries(value).map(
            ([k, v]) => html`
              <div
                style="display:flex; justify-content:space-between; padding:4px 8px; border-bottom:1px solid var(--border-glass);"
              >
                <span style="color:var(--t-muted);">${this._formatColumnName(k)}</span>
                <span>${String(v)}</span>
              </div>
            `
          )}
        </div>
      `;
    }

    // Fallback: text
    return html`<div style="padding:8px; font-size:0.9rem;">${String(value)}</div>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cart Detection & Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  private _isCartShaped(data: any): boolean {
    if (Array.isArray(data)) {
      return (
        data.length > 0 &&
        data.every(
          (item: any) =>
            item &&
            typeof item === 'object' &&
            'price' in item &&
            ('quantity' in item || 'qty' in item)
        )
      );
    }
    if (data && typeof data === 'object' && data.items && Array.isArray(data.items)) {
      return (
        data.items.length > 0 &&
        data.items.every(
          (item: any) =>
            item &&
            typeof item === 'object' &&
            'price' in item &&
            ('quantity' in item || 'qty' in item)
        )
      );
    }
    return false;
  }

  private _renderCart(data: any): TemplateResult {
    if (!data) return html`<div class="empty-state">No cart data</div>`;

    // Extract items and summary fields
    let items: any[];
    let summary: Record<string, number> = {};

    if (Array.isArray(data)) {
      items = data;
    } else {
      items = data.items || [];
      // Collect non-items numeric fields as summary
      for (const [key, value] of Object.entries(data)) {
        if (key !== 'items' && typeof value === 'number') {
          summary[key] = value as number;
        }
      }
    }

    if (items.length === 0) return html`<div class="empty-state">Cart is empty</div>`;

    // Calculate totals if not provided
    const computedSubtotal = items.reduce((sum: number, item: any) => {
      const qty = item.quantity ?? item.qty ?? 1;
      return sum + (item.price ?? 0) * qty;
    }, 0);

    // If no summary provided, calculate it
    if (Object.keys(summary).length === 0) {
      summary = { total: computedSubtotal };
    }

    return html`
      <div class="cart-container">
        ${items.map((item: any) => {
          const qty = item.quantity ?? item.qty ?? 1;
          const lineTotal = (item.price ?? 0) * qty;
          const nameField =
            item.name ?? item.title ?? item.label ?? item.product ?? item.description ?? 'Item';
          return html`
            <div
              class="cart-item ${this._getItemAnimationClass(item)} ${this._getItemWarmthClass(
                item
              )}"
            >
              ${item.image ? html`<img class="cart-item-image" src="${item.image}" alt="" />` : ''}
              <div class="cart-item-info">
                <div class="cart-item-name">${nameField}</div>
                ${item.variant || item.sku
                  ? html`<div class="cart-item-meta">${item.variant ?? item.sku}</div>`
                  : ''}
              </div>
              <span class="cart-qty">${qty > 1 ? `×${qty}` : ''}</span>
              <span class="cart-line-total">$${lineTotal.toFixed(2)}</span>
            </div>
          `;
        })}
        <div class="cart-divider"></div>
        <div class="cart-summary">
          ${Object.entries(summary).map(
            ([key, value]) => html`
              <div class="cart-summary-row ${key.toLowerCase() === 'total' ? 'total' : ''}">
                <span class="cart-summary-label">${this._formatColumnName(key)}</span>
                <span class="cart-summary-value"
                  >${typeof value === 'number' ? `$${value.toFixed(2)}` : String(value)}</span
                >
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Composable Container Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Render a value using a specific layout type (for composable containers).
   * Falls back to auto-detection if no layout specified.
   */
  private _renderInner(data: any, layout?: string): TemplateResult | string {
    if (data === null || data === undefined) {
      return html`<div class="empty-state">No data</div>`;
    }

    // If explicit layout specified, use it
    if (layout) {
      // Handle chart subtypes: @inner chart:pie → render chart with outputFormat override
      if (layout.startsWith('chart:')) {
        const origFormat = this.outputFormat;
        this.outputFormat = layout as any;
        const result = this._renderContent('chart' as LayoutType, data);
        this.outputFormat = origFormat;
        return result;
      }
      return this._renderContent(layout as LayoutType, data);
    }

    // Auto-detect: use dashboard panel logic for smart dispatch
    return this._renderDashboardPanel(data);
  }

  private _getInnerLayout(): string | undefined {
    return this.layoutHints?.inner;
  }

  private _renderPanels(data: any): TemplateResult {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return html`<div class="empty-state">
        Panels require an object (keys become panel titles)
      </div>`;
    }

    const entries = Object.entries(data);
    const cols = this.layoutHints?.columns ? parseInt(this.layoutHints.columns, 10) : 0;
    const colsClass = cols >= 2 && cols <= 4 ? `cols-${cols}` : '';
    const innerLayout = this._getInnerLayout();

    return html`
      <div class="panels-grid ${colsClass}">
        ${entries.map(
          ([key, value]) => html`
            <div class="panel-item">
              <div class="panel-header">${this._formatColumnName(key)}</div>
              <div class="panel-content">${this._renderInner(value, innerLayout)}</div>
            </div>
          `
        )}
      </div>
    `;
  }

  private _renderTabs(data: any): TemplateResult {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return html`<div class="empty-state">Tabs require an object (keys become tab labels)</div>`;
    }

    const entries = Object.entries(data);
    const keys = entries.map(([k]) => k);

    // Default to first tab if not set or invalid
    const activeTab = keys.includes(this._activeTab) ? this._activeTab : keys[0] || '';
    const activeValue = data[activeTab];
    const innerLayout = this._getInnerLayout();
    return html`
      <div class="tabs-container">
        <div class="tabs-bar">
          ${keys.map(
            (key) => html`
              <button
                class="tab-btn ${key === activeTab ? 'active' : ''}"
                @click=${() => {
                  this._activeTab = key;
                }}
              >
                ${this._formatColumnName(key)}
              </button>
            `
          )}
        </div>
        <div class="tab-content">${this._renderInner(activeValue, innerLayout)}</div>
      </div>
    `;
  }

  private _renderAccordion(data: any): TemplateResult {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return html`<div class="empty-state">
        Accordion requires an object (keys become section headers)
      </div>`;
    }

    const entries = Object.entries(data);
    const innerLayout = this._getInnerLayout();
    const isBordered = this.layoutHints?.style === 'bordered';

    // Default: expand first section on initial render only
    if (!this._accordionInitialized && entries.length > 0) {
      this._accordionInitialized = true;
      this._expandedSections = new Set([entries[0][0]]);
    }

    return html`
      <div class="accordion-container ${isBordered ? 'bordered' : ''}">
        ${entries.map(
          ([key, value]) => html`
            <div class="accordion-section">
              <div
                class="accordion-header"
                @click=${() => {
                  const next = new Set(this._expandedSections);
                  if (next.has(key)) {
                    next.delete(key);
                  } else {
                    next.add(key);
                  }
                  this._expandedSections = next;
                }}
              >
                <span>${this._formatColumnName(key)}</span
                ><span
                  class="accordion-chevron ${this._expandedSections.has(key) ? 'expanded' : ''}"
                  >&#x25B6;</span
                >
              </div>
              <div class="accordion-body ${this._expandedSections.has(key) ? 'expanded' : ''}">
                ${this._renderInner(value, innerLayout)}
              </div>
            </div>
          `
        )}
      </div>
    `;
  }

  private _renderStack(data: any): TemplateResult {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return html`<div class="empty-state">Stack requires an object (keys become sections)</div>`;
    }

    const entries = Object.entries(data);
    const innerLayout = this._getInnerLayout();

    return html`
      <div class="stack-container">
        ${entries.map(
          ([key, value]) => html`
            <div class="stack-item">
              <div
                style="font-size:0.75rem;font-weight:600;color:var(--t-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-xs);"
              >
                ${this._formatColumnName(key)}
              </div>
              ${this._renderInner(value, innerLayout)}
            </div>
          `
        )}
      </div>
    `;
  }

  private _renderColumns(data: any): TemplateResult {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return html`<div class="empty-state">Columns require an object (keys become columns)</div>`;
    }

    const entries = Object.entries(data);
    const colCount = this.layoutHints?.columns
      ? Math.min(Math.max(parseInt(this.layoutHints.columns, 10), 2), 4)
      : Math.min(entries.length, 4);
    const innerLayout = this._getInnerLayout();

    return html`
      <div class="columns-grid cols-${colCount}">
        ${entries.map(
          ([key, value]) => html`
            <div class="column-item">
              <div
                style="font-size:0.75rem;font-weight:600;color:var(--t-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:var(--space-xs);"
              >
                ${this._formatColumnName(key)}
              </div>
              ${this._renderInner(value, innerLayout)}
            </div>
          `
        )}
      </div>
    `;
  }
}
