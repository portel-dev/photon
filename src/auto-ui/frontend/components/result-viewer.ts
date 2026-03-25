import { LitElement, html, css, svg, TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { motion } from '../styles/index.js';
import { showToast } from './toast-manager.js';
import { formatLabel } from '../utils/format-label.js';
import { link, expand } from '../icons.js';
import { mcpClient } from '../services/mcp-client.js';

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
  | 'columns'
  | 'qr'
  | 'slides';

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
    motion,
    css`
      :host {
        display: block;
        margin-top: var(--space-md);
      }

      .container {
        padding: var(--space-md);
        position: relative;
        overflow: hidden;
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      .container.app-surface {
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 0;
      }

      .container.app-surface .content {
        padding: 0;
      }

      .container:fullscreen {
        background: var(--bg-app, #0a0a12);
        padding: var(--space-lg);
        overflow: hidden;
        border: none;
        border-radius: 0;
        display: flex;
        flex-direction: column;
        height: 100vh;
        box-sizing: border-box;
      }

      .container:fullscreen .header {
        flex-shrink: 0;
      }

      .container:fullscreen .content {
        flex: 1;
        overflow: auto;
        max-height: none;
      }

      .container:fullscreen .chart-container {
        max-height: none;
        height: 100%;
      }

      .container:fullscreen .mermaid-wrapper {
        height: 100%;
      }

      .container:fullscreen .mermaid-wrapper .mermaid-container {
        height: 100%;
      }

      .container:fullscreen .mermaid-wrapper .mermaid-container svg {
        width: 100%;
        height: 100%;
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
        font-family: var(--font-display);
        font-size: var(--text-sm);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--t-muted);
        font-weight: 600;
      }

      .format-badge {
        font-size: var(--text-2xs);
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
        font-size: var(--text-xs);
        transition: all 0.2s;
      }

      button:hover {
        background: var(--bg-glass);
        color: var(--t-primary);
      }

      .content {
        font-size: var(--text-md);
        color: var(--t-primary);
        line-height: 1.5;
        flex: 1;
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
        font-size: var(--text-md);
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
        background: var(--bg-glass);
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
        font-size: var(--text-xs);
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
          transform: translateX(-24px);
          background: hsla(120, 70%, 45%, 0.3);
          box-shadow: inset 3px 0 0 hsla(120, 70%, 50%, 0.6);
        }
        40% {
          background: hsla(120, 70%, 45%, 0.2);
        }
        100% {
          opacity: 1;
          transform: translateX(0);
          background: var(--bg-panel);
          box-shadow: none;
        }
      }

      @keyframes item-removed {
        0% {
          opacity: 1;
          transform: translateX(0);
          max-height: 80px;
        }
        50% {
          background: hsla(0, 70%, 50%, 0.2);
        }
        100% {
          opacity: 0;
          transform: translateX(24px);
          background: hsla(0, 70%, 50%, 0.25);
          max-height: 0;
          padding-top: 0;
          padding-bottom: 0;
          margin-top: 0;
          margin-bottom: 0;
        }
      }

      .list-item.item-added {
        animation: item-added 0.5s ease-out forwards;
      }

      .list-item.item-removed {
        animation: item-removed 0.4s ease-in forwards;
        overflow: hidden;
      }

      /* Highlight for updated / reordered items */
      .list-item.item-updated {
        animation: item-highlight 1s ease-out;
      }

      @keyframes item-highlight {
        0% {
          background: hsla(45, 90%, 55%, 0.35);
          box-shadow: inset 3px 0 0 hsla(45, 90%, 55%, 0.6);
        }
        100% {
          background: var(--bg-panel);
          box-shadow: none;
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
        animation: item-removed 0.4s ease-in forwards;
        overflow: hidden;
      }

      .smart-table tbody tr.item-updated {
        animation: item-highlight 1s ease-out;
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
        font-size: var(--text-lg);
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
        font-size: var(--text-md);
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
        font-size: var(--text-xs);
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
        font-size: var(--text-md);
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
        font-size: var(--text-2xl);
      }

      .card-title {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: 600;
        color: var(--t-primary);
      }

      .card-subtitle {
        color: var(--t-muted);
        font-size: var(--text-md);
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
        font-size: var(--text-xs);
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
        font-size: var(--text-md);
        color: var(--t-primary);
        transition:
          background 0.3s ease,
          transform 0.3s ease,
          opacity 0.3s ease;
      }

      .chip.item-added {
        animation: chip-added 0.5s ease-out forwards;
      }

      .chip.item-removed {
        animation: chip-removed 0.35s ease-in forwards;
      }

      .chip.item-updated {
        animation: chip-highlight 1s ease-out;
      }

      @keyframes chip-added {
        0% {
          opacity: 0;
          transform: scale(0.5);
          background: hsla(120, 70%, 45%, 0.35);
          box-shadow: 0 0 12px hsla(120, 70%, 50%, 0.4);
        }
        50% {
          transform: scale(1.08);
          background: hsla(120, 70%, 45%, 0.2);
        }
        100% {
          opacity: 1;
          transform: scale(1);
          background: var(--bg-glass-strong);
          box-shadow: none;
        }
      }

      @keyframes chip-removed {
        0% {
          opacity: 1;
          transform: scale(1);
        }
        40% {
          background: hsla(0, 70%, 50%, 0.25);
        }
        100% {
          opacity: 0;
          transform: scale(0.4);
          background: hsla(0, 70%, 50%, 0.3);
        }
      }

      @keyframes chip-highlight {
        0% {
          background: hsla(45, 90%, 55%, 0.4);
          box-shadow: 0 0 8px hsla(45, 90%, 55%, 0.3);
        }
        100% {
          background: var(--bg-glass-strong);
          box-shadow: none;
        }
      }

      /* Chip warmth — ring glow instead of border-left */
      .chip.warmth-hot {
        box-shadow:
          0 0 0 2px hsla(0, 80%, 60%, 0.5),
          0 0 8px hsla(0, 80%, 55%, 0.25);
        transition: box-shadow 2s ease-out;
      }
      .chip.warmth-warm {
        box-shadow:
          0 0 0 2px hsla(28, 80%, 55%, 0.4),
          0 0 6px hsla(28, 80%, 55%, 0.15);
        transition: box-shadow 2s ease-out;
      }
      .chip.warmth-cool {
        box-shadow: 0 0 0 1.5px hsla(48, 80%, 50%, 0.3);
        transition: box-shadow 2s ease-out;
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
        font-size: var(--text-xs);
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
        font-size: var(--text-sm);
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
        font-size: var(--text-xs);
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
        font-size: var(--text-md);
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
        font-size: var(--text-sm);
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
        font-size: var(--text-md);
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
        background: var(--bg-glass);
      }

      .tree-toggle {
        width: 18px;
        height: 18px;
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
        color: var(--syntax-string);
      }
      .tree-value.number {
        color: var(--syntax-number);
      }
      .tree-value.boolean {
        color: var(--syntax-boolean);
      }
      .tree-value.null {
        color: var(--syntax-null);
      }

      .tree-type {
        color: var(--t-muted);
        font-size: var(--text-xs);
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
        font-size: var(--text-lg);
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
        font-size: var(--text-sm);
        min-width: 50px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      .fullscreen-hint {
        color: rgba(255, 255, 255, 0.5);
        font-size: var(--text-xs);
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
        font-size: var(--text-xl);
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
        font-size: var(--text-xs);
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
        font-size: var(--text-lg);
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
        background: var(--accent-primary);
        color: white;
        border-color: var(--accent-primary);
      }

      /* Markdown items (array rendering with filter transitions) */
      .markdown-items {
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .markdown-item {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-glass);
        transition:
          opacity 0.25s ease,
          max-height 0.3s ease,
          padding 0.3s ease,
          margin 0.3s ease;
        max-height: 500px;
        overflow: hidden;
      }

      .markdown-item:last-child {
        border-bottom: none;
      }

      .markdown-item.filtered-out {
        opacity: 0;
        max-height: 0;
        padding: 0 16px;
        margin: 0;
        border-bottom-width: 0;
        pointer-events: none;
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
        font-family: var(--font-display);
        font-size: var(--text-3xl);
        font-weight: 700;
        color: var(--t-primary);
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        transition: color 0.3s ease-out;
      }

      .metric-label {
        font-size: var(--text-md);
        color: var(--t-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 500;
      }

      .metric-delta {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--text-md);
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
        color: var(--color-success);
        background: var(--color-success-bg);
      }

      .metric-delta.down {
        color: var(--color-error);
        background: var(--color-error-bg);
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
        font-size: var(--text-md);
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
        padding-left: calc(var(--space-md) + 24px);
      }

      .timeline-container::before {
        content: '';
        position: absolute;
        left: calc(var(--space-md) + 8px);
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--accent-primary, #6366f1);
        opacity: 0.35;
      }

      .timeline-group-header {
        position: relative;
        font-size: var(--text-xs);
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

      .timeline-dot {
        position: absolute;
        left: -20px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--accent-primary, #6366f1);
        border: 2px solid var(--bg-primary);
        z-index: 1;
        flex-shrink: 0;
      }

      .timeline-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        position: relative;
      }

      .timeline-title {
        font-weight: 600;
        color: var(--t-primary);
        font-size: var(--text-md);
        line-height: 1.3;
      }

      .timeline-time {
        font-size: var(--text-xs);
        color: var(--accent-primary);
        margin-bottom: 2px;
      }

      .timeline-description {
        font-size: var(--text-md);
        color: var(--t-muted);
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
        font-size: var(--text-xs);
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
        font-size: var(--text-3xl);
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
        font-size: var(--text-sm);
        color: var(--t-muted);
      }

      .cart-qty {
        padding: 2px 8px;
        background: var(--bg-glass-strong);
        border-radius: var(--radius-sm);
        font-size: var(--text-sm);
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
        font-size: var(--text-md);
        color: var(--t-muted);
      }

      .cart-summary-row.total {
        font-weight: 700;
        font-size: var(--text-lg);
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
        font-size: var(--text-xs);
        font-weight: 600;
        color: var(--accent, #7c3aed);
        text-transform: uppercase;
        letter-spacing: 0.06em;
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
        font-size: var(--text-md);
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
        font-size: var(--text-md);
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
        font-size: var(--text-3xl);
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

  @property({ type: String })
  photonName?: string;

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

  // QR code cache: text → data URL
  @query('#qr-container') private _qrContainer?: HTMLElement;

  // Layout determined by UI type unwrapping in updated() — consumed once by _selectLayout()
  private _unwrappedLayout: LayoutType | null = null;

  // Bridge old result across null-gap during execute cycles
  private _previousResult: any = null;

  // Recency heat: track when items were last added/updated
  private _itemHeatTimestamps = new Map<string, number>();
  private _warmthTimer: number | undefined;

  // Audit trail expansion state: track which items have expanded audit trails
  private _expandedAuditTrails = new Set<string>();

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
   * Prioritizes __meta timestamps (most recent), then standard timestamp fields.
   */
  private _getItemWarmthClass(item: unknown): string {
    const idField = this._activeIdField;
    let timestamp: number | undefined;

    // Try to read timestamp from item data (persisted, survives refresh)
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;

      // Check __meta object first (highest priority — most recent change)
      const meta = (rec as any).__meta;
      if (meta && typeof meta === 'object') {
        // Prefer modifiedAt (most recent change) over createdAt
        if (meta.modifiedAt) {
          const parsed = new Date(meta.modifiedAt).getTime();
          if (!isNaN(parsed)) timestamp = parsed;
        } else if (meta.createdAt) {
          const parsed = new Date(meta.createdAt).getTime();
          if (!isNaN(parsed)) timestamp = parsed;
        }
      }

      // Fall back to standard timestamp fields if __meta not found
      if (timestamp === undefined) {
        for (const field of ResultViewer._TIMESTAMP_FIELDS) {
          const val = rec[field];
          if (val !== undefined && val !== null) {
            const parsed =
              typeof val === 'number'
                ? val
                : new Date(typeof val === 'string' ? val : String(val as never)).getTime();
            if (!isNaN(parsed)) {
              timestamp = parsed;
              break;
            }
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
      <div class="container">
        <div
          class="content ${this._isTextLayout(layout) ? 'content-text' : 'content-structured'}"
          data-enter="scale-in"
        >
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
                  <button
                    class="fullscreen-btn"
                    @click=${() => this._zoomOut()}
                    title="Zoom out (-)"
                  >
                    −
                  </button>
                  <span class="zoom-level">${Math.round(this._zoomLevel * 100)}%</span>
                  <button class="fullscreen-btn" @click=${() => this._zoomIn()} title="Zoom in (+)">
                    +
                  </button>
                  <button
                    class="fullscreen-btn"
                    @click=${() => this._resetZoom()}
                    title="Reset zoom (0)"
                  >
                    ⟲
                  </button>
                </div>
                <div class="fullscreen-toolbar-right">
                  <button
                    class="fullscreen-btn close-btn"
                    @click=${() => this._closeFullscreen()}
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
                  <button
                    class="fullscreen-btn"
                    @click=${() => this._zoomOut()}
                    title="Zoom out (-)"
                  >
                    −
                  </button>
                  <span class="zoom-level">${Math.round(this._zoomLevel * 100)}%</span>
                  <button class="fullscreen-btn" @click=${() => this._zoomIn()} title="Zoom in (+)">
                    +
                  </button>
                  <button
                    class="fullscreen-btn"
                    @click=${() => this._resetZoom()}
                    title="Reset zoom (0)"
                  >
                    ⟲
                  </button>
                </div>
                <div class="fullscreen-toolbar-right">
                  <button
                    class="fullscreen-btn close-btn"
                    @click=${() => this._closeFullscreen()}
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
                    @click=${() => this._closeFullscreen()}
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

  /**
   * Unwrap a purpose-driven UI type (Table, Chart, Stats, Cards, Progress)
   * into a layout type + result data + layoutHints.
   */
  private _unwrapUIType(data: Record<string, any>): {
    layout: LayoutType;
    result: unknown;
    hints?: Partial<LayoutHints>;
    uiTypeColumns?: any;
    uiTypeFields?: any;
  } {
    const type = data._photonType as string;

    switch (type) {
      case 'table': {
        const result = data.rows ?? [];
        const extra: any = {};
        if (data.columns?.length || data.fields?.length) {
          extra.uiTypeColumns = data.columns;
          extra.uiTypeFields = data.fields;
        }
        return {
          layout: 'table',
          result,
          hints: data.options?.title ? { title: data.options.title } : undefined,
          ...extra,
        };
      }
      case 'cards': {
        const fields = data.fields ?? {};
        return {
          layout: 'list', // Cards render as rich list items
          result: data.items ?? [],
          hints: {
            title: fields.heading || data.options?.title,
            subtitle: fields.subtitle,
            icon: fields.image,
            badge: fields.badge,
            detail: fields.description,
          },
        };
      }
      case 'chart': {
        const chartType = data.chartType ?? 'line';
        let result: unknown;
        if ((chartType === 'pie' || chartType === 'doughnut') && data.data?.length) {
          result = data.data;
        } else if (data.series?.length && data.labels?.length) {
          result = data.labels.map((label: string, i: number) => {
            const row: Record<string, any> = { label };
            for (const s of data.series) {
              row[s.name] = s.data[i] ?? 0;
            }
            return row;
          });
        } else {
          result = data.data ?? [];
        }
        return {
          layout: 'chart',
          result,
          hints: {
            chartType,
            label: 'label',
            title: data.options?.title,
            // Note: xAxisLabel/yAxisLabel are display labels, not field names.
            // Don't set x/y hints — let the renderer auto-detect numeric fields.
          },
        };
      }
      case 'stats': {
        const stats = data.stats ?? [];
        if (stats.length === 1) {
          return {
            layout: 'metric',
            result: {
              value: stats[0].value,
              label: stats[0].label,
              trend: stats[0].trend,
              trendUp: stats[0].trendUp,
            },
          };
        }
        const dashboard: Record<string, any> = {};
        for (const stat of stats) {
          dashboard[stat.label] = {
            value: stat.value,
            trend: stat.trend,
            trendUp: stat.trendUp,
            prefix: stat.prefix,
            suffix: stat.suffix,
          };
        }
        return {
          layout: 'dashboard',
          result: dashboard,
          hints: data.options?.title ? { title: data.options.title } : undefined,
        };
      }
      case 'progress': {
        if (data.steps?.length) {
          return {
            layout: 'timeline',
            result: data.steps.map((s: any) => ({
              title: s.label,
              status: s.status,
              description: s.description,
            })),
          };
        }
        if (data.bars?.length) {
          const dashboard: Record<string, any> = {};
          for (const bar of data.bars) {
            dashboard[bar.label] = {
              value: bar.value,
              max: bar.max ?? 100,
              progress: Math.round((bar.value / (bar.max ?? 100)) * 100),
            };
          }
          return { layout: 'dashboard', result: dashboard };
        }
        return {
          layout: 'gauge',
          result: {
            value: data.value ?? 0,
            max: data.max ?? 100,
            progress: Math.round(((data.value ?? 0) / (data.max ?? 100)) * 100),
            label: data.options?.title,
          },
        };
      }
      case 'form': {
        return { layout: 'card', result: data.fields ?? data };
      }
      default: {
        // Unknown UI type — strip _photonType, caller will re-detect
        const { _photonType, ...rest } = data;
        return { layout: null as any, result: rest };
      }
    }
  }

  private _selectLayout(): LayoutType {
    // 0. Already unwrapped by updated() — use that layout
    if (this._unwrappedLayout) {
      const layout = this._unwrappedLayout;
      this._unwrappedLayout = null;
      return layout;
    }

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
          'qr',
          'slides',
        ].includes(format)
      ) {
        return format as LayoutType;
      }
      // Content formats
      if (format === 'md') return 'markdown';
      if (format === 'presentation') return 'slides';
    }

    // 2. _photonType objects (collection: and UI types) are unwrapped in updated()
    // If we still see one here, it means updated() hasn't run yet — skip auto-detect
    const data = this.result;
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      typeof data._photonType === 'string'
    ) {
      // Fallback: shouldn't normally reach here since updated() handles unwrapping
      return 'json';
    }

    // 3. Detect from data shape

    // String detection
    if (typeof data === 'string') {
      // Check for slide deck (marp-style: multiple --- separators or marp: true frontmatter)
      if (this._isSlidesString(data)) {
        return 'slides';
      }
      // Check for mermaid diagram syntax
      if (this._isMermaidString(data)) {
        return 'mermaid';
      }
      // Check for markdown indicators (including YAML frontmatter)
      if (
        data.includes('```') ||
        data.includes('##') ||
        data.includes('**') ||
        /^\s*---\s*[\r\n]/.test(data)
      ) {
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

      // Array of strings → chips or markdown
      if (data.every((item) => typeof item === 'string')) {
        // Check if any string contains markdown indicators
        const hasMarkdown = data.some(
          (s: string) =>
            s.includes('**') ||
            s.includes('##') ||
            s.includes('```') ||
            s.includes('](') ||
            /^\s*>\s/.test(s) ||
            /^\s*---\s*$/.test(s)
        );
        return hasMarkdown ? 'markdown' : 'chips';
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

        // Check if we have semantic fields for list — but prefer table for data-rich objects
        const fieldCount = Object.keys(data[0]).length;
        const hasListFields = this._hasSemanticFields(data[0], [
          'name',
          'title',
          'status',
          'state',
          'description',
        ]);
        return hasListFields && fieldCount <= 4 ? 'list' : 'table';
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

  /**
   * Check if data matches the expected shape for a format.
   * Returns false when the data clearly doesn't fit, so the renderer
   * should fall through to the default (JSON) view instead of producing
   * a broken or nonsensical rendering.
   */
  private _matchesFormat(layout: LayoutType, data: any): boolean {
    if (data === null || data === undefined) return true; // let renderer show empty state

    switch (layout) {
      case 'qr':
        // String is always QR-able; objects need a QR-renderable field
        if (typeof data === 'string') return true;
        if (typeof data === 'object') {
          return !!(data.qr || data.url || data.link || data.value);
        }
        return false;
      case 'table':
        return Array.isArray(data) || (typeof data === 'object' && data !== null);
      case 'metric':
      case 'gauge':
        // Need an object with a value-like field, not an array
        return (
          typeof data === 'object' &&
          !Array.isArray(data) &&
          (data.value !== undefined ||
            data.count !== undefined ||
            data.total !== undefined ||
            data.current !== undefined)
        );
      case 'chart':
        // Need array or object (not a plain string)
        return typeof data !== 'string';
      case 'mermaid':
        return typeof data === 'string';
      case 'markdown':
        return typeof data === 'string';
      case 'slides':
        return typeof data === 'string';
      default:
        return true; // other formats degrade gracefully
    }
  }

  private _renderContent(layout: LayoutType, filteredData: any): TemplateResult | string {
    if (filteredData === null) {
      return html`<div class="empty-state">No matches found</div>`;
    }

    // Error objects bypass format entirely — always render as error card
    if (filteredData && filteredData._error) {
      return this._renderErrorCard(filteredData.message || 'Unknown error');
    }

    // Format-data shape mismatch: fall through to default renderer.
    // E.g., @format qr but response has no QR data, or @format table but response is a string.
    if (!this._matchesFormat(layout, filteredData)) {
      return this._renderJson(filteredData);
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
        return this._renderMarkdown(filteredData);
      case 'html':
        return this._renderHtml(filteredData);
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
      case 'qr':
        return this._renderQR(filteredData);
      case 'mermaid':
        return this._renderMermaid(filteredData);
      case 'slides':
        return this._renderSlides(filteredData);
      case 'json':
      default:
        return this._renderJson(filteredData);
    }
  }

  private _renderTable(data: any[]): TemplateResult {
    // If data is a non-array object with array properties, extract and display them
    if (!Array.isArray(data) && data && typeof data === 'object') {
      const arrayEntries = Object.entries(data).filter(([, v]) => Array.isArray(v) && v.length > 0);
      if (arrayEntries.length > 0) {
        // Only show section labels when there are multiple sub-arrays — a single-table result
        // doesn't need a section heading (e.g. "ITEMS" above a lone table is redundant noise).
        const showSectionLabel = arrayEntries.length > 1;
        return html`${arrayEntries.map(
          ([key, arr]) => html`
            <div style="margin-bottom: 16px;">
              ${showSectionLabel
                ? html`<div
                    style="font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--t-muted); margin-bottom: 6px;"
                  >
                    ${formatLabel(key)}
                  </div>`
                : ''}
              ${this._renderTable(arr as any[])}
            </div>
          `
        )}`;
      }
      // Single object with no arrays → fall back to card
      return this._renderCard(data);
    }
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
        <tbody class="motion-stagger">
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

    // Derive field mapping from first item so we can render a header row
    const firstObj = typeof data[0] === 'object' && data[0] !== null ? data[0] : null;
    const mapping = firstObj ? this._analyzeFields(firstObj) : null;

    return html`
      ${mapping && (mapping.title || mapping.subtitle || mapping.badge || mapping.detail)
        ? html`
            <div
              style="display:flex;justify-content:space-between;align-items:center;padding:4px 10px;font-size:0.7rem;color:var(--t-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border-glass);"
            >
              <span style="flex:1;"
                >${mapping.title ? this._formatColumnName(mapping.title) : ''}${mapping.subtitle &&
                mapping.title
                  ? ' / ' + this._formatColumnName(mapping.subtitle)
                  : mapping.subtitle
                    ? this._formatColumnName(mapping.subtitle)
                    : ''}</span
              >
              <span style="display:flex;gap:16px;">
                ${mapping.detail
                  ? html`<span>${this._formatColumnName(mapping.detail)}</span>`
                  : ''}
                ${mapping.badge ? html`<span>${this._formatColumnName(mapping.badge)}</span>` : ''}
              </span>
            </div>
          `
        : ''}
      <ul class="smart-list motion-stagger">
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
                >${formatLabel(String(item[mapping.badge]))}</span
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
      ${this._renderAuditTrail(data)}
    `;
  }

  /**
   * Render audit trail from __meta object if present
   */
  private _renderAuditTrail(data: any): TemplateResult | string {
    if (!data || typeof data !== 'object') return '';

    const meta = data.__meta;
    if (!meta || typeof meta !== 'object') return '';

    // Create a unique key for this audit trail (use object reference if no ID)
    const idField = this._activeIdField;
    const itemId = data[idField] ? String(data[idField]) : Math.random().toString(36);
    const auditKey = `audit-${itemId}`;
    const isExpanded = this._expandedAuditTrails.has(auditKey);

    // Format timestamps to readable strings
    const formatTime = (isoString: string | null): string => {
      if (!isoString) return 'N/A';
      const date = new Date(isoString);
      return date.toLocaleString();
    };

    const createdAt = formatTime(meta.createdAt);
    const modifiedAt = meta.modifiedAt ? formatTime(meta.modifiedAt) : null;

    return html`
      <div
        style="margin-top: var(--space-md); border-top: 1px solid var(--border-glass); padding-top: var(--space-md);"
      >
        <details
          ?open="${isExpanded}"
          @toggle="${(e: Event) => {
            const detail = e.target as HTMLDetailsElement;
            if (detail.open) {
              this._expandedAuditTrails.add(auditKey);
            } else {
              this._expandedAuditTrails.delete(auditKey);
            }
          }}"
        >
          <summary
            style="cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: var(--space-sm);"
          >
            <span
              style="display: inline-block; width: 0.5em; height: 0.5em; border-radius: 50%; background: var(--text-secondary); margin-right: var(--space-xs);"
            ></span>
            Audit Trail
            ${meta.modifications?.length
              ? html`<span style="font-size: 0.85em; color: var(--text-secondary);"
                  >(${meta.modifications.length} changes)</span
                >`
              : ''}
          </summary>

          <div
            style="margin-top: var(--space-md); padding: var(--space-sm) var(--space-md); background: var(--bg-secondary); border-radius: var(--radius-sm);"
          >
            <table style="width: 100%; font-size: 0.9em;">
              <tbody>
                <tr style="border-bottom: 1px solid var(--border-subtle);">
                  <td
                    style="padding: var(--space-xs); color: var(--text-secondary); font-weight: 500;"
                  >
                    Created
                  </td>
                  <td style="padding: var(--space-xs);">${createdAt}</td>
                  ${meta.createdBy
                    ? html`<td
                        style="padding: var(--space-xs); color: var(--text-secondary); font-size: 0.85em;"
                      >
                        (by: ${meta.createdBy})
                      </td>`
                    : ''}
                </tr>
                ${modifiedAt
                  ? html`
                      <tr style="border-bottom: 1px solid var(--border-subtle);">
                        <td
                          style="padding: var(--space-xs); color: var(--text-secondary); font-weight: 500;"
                        >
                          Modified
                        </td>
                        <td style="padding: var(--space-xs);">${modifiedAt}</td>
                        ${meta.modifiedBy
                          ? html`<td
                              style="padding: var(--space-xs); color: var(--text-secondary); font-size: 0.85em;"
                            >
                              (by: ${meta.modifiedBy})
                            </td>`
                          : ''}
                      </tr>
                    `
                  : ''}
              </tbody>
            </table>

            ${meta.modifications &&
            Array.isArray(meta.modifications) &&
            meta.modifications.length > 0
              ? html`
                  <div style="margin-top: var(--space-md);">
                    <div
                      style="font-weight: 500; margin-bottom: var(--space-sm); color: var(--text-secondary);"
                    >
                      Changes
                    </div>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                      ${meta.modifications.map(
                        (mod: any, idx: number) => html`
                          <li
                            key="${idx}"
                            style="padding: var(--space-xs) var(--space-sm); margin-bottom: var(--space-xs); background: var(--bg-hover); border-left: 3px solid var(--primary); border-radius: 2px; font-size: 0.9em;"
                          >
                            <div style="margin-bottom: 2px;">
                              <span style="font-weight: 500; color: var(--text-primary);"
                                >${mod.field}</span
                              >
                              <span style="color: var(--text-secondary); margin: 0 var(--space-xs);"
                                >→</span
                              >
                              <span style="color: var(--text-secondary); font-size: 0.85em;"
                                >${formatTime(mod.timestamp || new Date().toISOString())}</span
                              >
                            </div>
                            <div
                              style="font-family: monospace; font-size: 0.85em; color: var(--text-secondary); margin-left: var(--space-sm);"
                            >
                              <span style="color: #d87070;">${JSON.stringify(mod.oldValue)}</span>
                              <span style="margin: 0 4px;">→</span>
                              <span style="color: #7cb342;">${JSON.stringify(mod.newValue)}</span>
                            </div>
                            ${mod.modifiedBy
                              ? html`<div
                                  style="font-size: 0.8em; color: var(--text-secondary); margin-top: 2px;"
                                >
                                  <em>by: ${mod.modifiedBy}</em>
                                </div>`
                              : ''}
                          </li>
                        `
                      )}
                    </ul>
                  </div>
                `
              : ''}
          </div>
        </details>
      </div>
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
    // Only treat plain objects (not arrays) with many keys as nested
    if (
      !Array.isArray(value) &&
      typeof value === 'object' &&
      value !== null &&
      Object.keys(value).length > 4
    )
      return true;
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
            html`<span
              class="chip ${this._getItemAnimationClass(item)} ${this._getItemWarmthClass(item)}"
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
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    style="transition:transform 0.15s;${isExpanded
                      ? 'transform:rotate(90deg)'
                      : ''}"
                  >
                    <polygon points="6,3 20,12 6,21"></polygon>
                  </svg>
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

  private _stripFrontMatter(text: string): { body: string; table: string } {
    const fmRegex = /^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*/;
    const tables: string[] = [];
    let body = text.replace(/^\uFEFF/, '').trimStart();

    while (true) {
      const match = fmRegex.exec(body);
      if (!match) break;
      const pairs: [string, string][] = [];
      for (const line of match[1].split(/\r?\n/)) {
        const m = /^([^:\s][^:]*):\s*(.+)$/.exec(line.trim());
        if (m) pairs.push([m[1].trim(), m[2].trim().replace(/^['"]|['"]$/g, '')]);
      }
      if (pairs.length) {
        const rows = pairs.map(([k, v]) => `| ${k} | ${v} |`).join('\n');
        tables.push(`| Field | Value |\n| --- | --- |\n${rows}`);
      }
      body = body.slice(match[0].length).trimStart();
    }

    return { body, table: tables.length ? tables.join('\n\n') + '\n\n' : '' };
  }

  private _renderMarkdown(filteredData?: any): TemplateResult {
    const data = filteredData !== undefined ? filteredData : this.result;
    const marked = (window as any).marked;

    // Array of items: render each as a separate block with filter transitions
    if (Array.isArray(this.result) && this.result.length > 1 && marked) {
      const query = this._filterQuery?.trim().toLowerCase() || '';
      const allMermaidBlocks: { id: string; code: string }[] = [];
      const allCodeBlocks: { id: string; code: string; language: string }[] = [];

      const items = this.result.map((item: any, index: number) => {
        const text = String(item);
        const matches = !query || text.toLowerCase().includes(query);
        const htmlContent = this._parseMarkdownItem(text, allMermaidBlocks, allCodeBlocks);
        return html`
          <div class="markdown-item ${matches ? '' : 'filtered-out'}" data-index="${index}">
            <div class="markdown-body">${unsafeHTML(htmlContent)}</div>
          </div>
        `;
      });

      this._pendingMermaidBlocks = allMermaidBlocks;
      this._pendingCodeBlocks = allCodeBlocks;

      return html`
        <div class="markdown-body-wrapper markdown-items">
          <button class="expand-btn" @click=${this._openMarkdownFullscreen} title="View fullscreen">
            ⤢
          </button>
          ${items}
        </div>
      `;
    }

    // Single value: render as before
    const str = Array.isArray(data) ? data.join('\n\n') : String(data);

    if (marked) {
      const { html: htmlContent, mermaidBlocks, codeBlocks } = this._parseRichMarkdown(str);
      this._pendingMermaidBlocks = mermaidBlocks;
      this._pendingCodeBlocks = codeBlocks;

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

  private _parseRichMarkdown(
    text: string,
    options?: { stripFrontMatter?: boolean; includeInlineStyles?: boolean }
  ): {
    html: string;
    mermaidBlocks: { id: string; code: string }[];
    codeBlocks: { id: string; code: string; language: string }[];
  } {
    const { stripFrontMatter = true, includeInlineStyles = false } = options || {};
    const source = stripFrontMatter ? this._stripFrontMatter(text) : { body: text, table: '' };
    const mermaidBlocks: { id: string; code: string }[] = [];
    const codeBlocks: { id: string; code: string; language: string }[] = [];

    const mermaidPlaceholder = (id: string) =>
      includeInlineStyles
        ? `<div class="mermaid-placeholder" data-mermaid-id="${id}" style="min-height: 100px; display: flex; align-items: center; justify-content: center; color: var(--t-muted);">Loading diagram...</div>`
        : `<div class="mermaid-placeholder" data-mermaid-id="${id}">Loading diagram...</div>`;

    let processed = (source.table + source.body).replace(
      /```mermaid\s*\n([\s\S]*?)```/g,
      (_match, code) => {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        mermaidBlocks.push({ id, code: code.trim() });
        return mermaidPlaceholder(id);
      }
    );

    processed = processed.replace(/```(\w+)?\s*\n([\s\S]*?)```/g, (_match, lang, code) => {
      const id = `code-${Math.random().toString(36).substr(2, 9)}`;
      const language = lang || 'text';
      codeBlocks.push({ id, code: code.trimEnd(), language });
      return `<div class="code-block-wrapper"><span class="language-label">${language}</span><pre data-code-id="${id}" class="language-${language}"><code class="language-${language}">Loading...</code></pre></div>`;
    });

    const marked = (window as any).marked;
    return {
      html: marked ? marked.parse(processed) : processed,
      mermaidBlocks,
      codeBlocks,
    };
  }

  /** Parse a single markdown item, extracting mermaid and code blocks */
  private _parseMarkdownItem(
    text: string,
    mermaidBlocks: { id: string; code: string }[],
    codeBlocks: { id: string; code: string; language: string }[]
  ): string {
    const parsed = this._parseRichMarkdown(text);
    mermaidBlocks.push(...parsed.mermaidBlocks);
    codeBlocks.push(...parsed.codeBlocks);
    return parsed.html;
  }

  private _renderHtml(filteredData?: any): TemplateResult {
    const data = filteredData !== undefined ? filteredData : this.result;
    const htmlContent = Array.isArray(data) ? data.join('\n') : String(data);
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

    // Unwrap _photonType objects before diff logic — this avoids mutating during render()
    if (
      changedProperties.has('result') &&
      this.result &&
      typeof this.result === 'object' &&
      !Array.isArray(this.result) &&
      typeof this.result._photonType === 'string'
    ) {
      const data = this.result as Record<string, any>;
      const photonType = data._photonType as string;

      if (photonType.startsWith('collection:')) {
        // Collection rendering hint (from Collection.as())
        const hint = photonType.replace('collection:', '');
        const formatMap: Record<string, LayoutType> = {
          table: 'table',
          cards: 'card',
          list: 'list',
          chart: 'chart',
          grid: 'grid',
          chips: 'chips',
        };
        this._unwrappedLayout = formatMap[hint] ?? 'table';
        this.result = data.items ?? [];
      } else {
        // Purpose-driven UI types (Table, Chart, Stats, Cards, Progress, Form)
        const unwrapped = this._unwrapUIType(data);
        if (unwrapped.layout) {
          this._unwrappedLayout = unwrapped.layout;
        }
        this.result = unwrapped.result;
        if (unwrapped.hints) {
          this.layoutHints = { ...this.layoutHints, ...unwrapped.hints };
        }
        if (unwrapped.uiTypeColumns !== undefined) {
          (this as any)._uiTypeColumns = unwrapped.uiTypeColumns;
        }
        if (unwrapped.uiTypeFields !== undefined) {
          (this as any)._uiTypeFields = unwrapped.uiTypeFields;
        }
      }
      // Setting this.result triggers another updated() cycle with the clean data
      return;
    }

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
      void this._renderMermaidBlocks(blocks);
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

    // Bind declarative data-method elements and auto-scale slides after render.
    // Pattern: await updateComplete (Lit render committed) → rAF (browser layout ready)
    if (changedProperties.has('result') && this.outputFormat === 'slides') {
      void this._onSlidesRendered();
    }
  }

  private async _onSlidesRendered(): Promise<void> {
    // Load bridge script if not cached (needed for bridge-powered slide iframes)
    if (!this._slidesBridgeScript) {
      await this._ensureBridgeScript();
      // Re-render now that bridge is available (template switches from raw HTML to iframe)
      this.requestUpdate();
      await this.updateComplete;
    }
    // Wait for Lit's render to fully commit to the DOM
    await this.updateComplete;
    // Wait for browser to complete layout
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // DOM is now fully ready for measurement and binding
    this._afterSlideRender();
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

  /**
   * Highlight inline HTML <code class="language-*"> elements that weren't
   * created by _parseRichMarkdown (e.g., hand-written HTML in slides).
   * These bypass the fenced code block regex but have language class hints.
   */
  private _highlightInlineCodeElements(): void {
    const Prism = (window as any).Prism;
    if (!Prism) return;

    const codeElements = this.shadowRoot?.querySelectorAll('code[class*="language-"]');
    if (!codeElements) return;

    const langMap: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      py: 'python',
      sh: 'bash',
      shell: 'bash',
      yml: 'yaml',
      md: 'markdown',
    };

    codeElements.forEach((el) => {
      // Skip already-highlighted elements (Prism adds .token spans)
      if (el.querySelector('.token')) return;

      const classMatch = el.className.match(/language-(\w+)/);
      if (!classMatch) return;

      const rawLang = classMatch[1];
      const prismLang = langMap[rawLang] || rawLang;
      const grammar = Prism.languages[prismLang] || Prism.languages['text'];
      if (!grammar) return;

      try {
        const code = el.textContent || '';
        el.innerHTML = Prism.highlight(code, grammar, prismLang);
      } catch {
        // Leave as plain text
      }
    });
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
      const target = this.shadowRoot?.querySelector(`[data-mermaid-id="${id}"]`) as HTMLElement;
      if (!target) {
        console.warn('Mermaid placeholder not found:', id);
        continue;
      }

      try {
        const renderSuffix = Math.random().toString(36).substr(2, 6);
        const { svg } = await mermaid.render(`${id}-${renderSuffix}-svg`, code);

        // Live container (from _renderMermaid) — inject SVG in-place, never replace the element
        if (target.classList.contains('mermaid-live-container')) {
          let diagramDiv = target.querySelector('.mermaid-diagram') as HTMLElement;
          if (!diagramDiv) {
            diagramDiv = document.createElement('div');
            diagramDiv.className = 'mermaid-diagram';
            diagramDiv.style.transition = 'opacity 0.2s ease';
            target.appendChild(diagramDiv);
            this._addMermaidExpandBtn(target, code, id);
          }
          // Fade transition for streaming updates
          diagramDiv.style.opacity = '0.4';
          requestAnimationFrame(() => {
            diagramDiv.innerHTML = svg;
            diagramDiv.style.opacity = '1';
          });
          // Update expand button closure
          const btn = target.querySelector('.expand-btn') as HTMLElement;
          if (btn) btn.onclick = () => this._openMermaidFullscreen(code, id);
          continue;
        }

        // Inline mermaid (from markdown/cards) — replace placeholder with wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-wrapper';
        wrapper.setAttribute('data-mermaid-id', id);
        const bgColor = this.theme === 'light' ? '#F4F6F8' : '#1e293b';
        wrapper.style.cssText = `position: relative; background: ${bgColor}; border-radius: var(--radius-sm); padding: 16px; margin: 16px 0;`;

        const diagramDiv = document.createElement('div');
        diagramDiv.className = 'mermaid-diagram';
        diagramDiv.id = id;
        diagramDiv.style.transition = 'opacity 0.2s ease';
        diagramDiv.innerHTML = svg;

        wrapper.appendChild(diagramDiv);
        this._addMermaidExpandBtn(wrapper, code, id);
        target.replaceWith(wrapper);
      } catch (e) {
        console.error('Mermaid render error:', e);
        target.innerHTML = `<pre style="color: #ff6b6b; background: rgba(255,0,0,0.1); padding: 8px; border-radius: var(--radius-xs);">Mermaid Error: ${e instanceof Error ? e.message : String(e as never)}\n\n${code}</pre>`;
      }
    }
  }

  private _openMermaidFullscreen(code: string, id: string) {
    this._resetZoom();
    this._fullscreenMermaid = code;
    setTimeout(() => {
      void (async () => {
        const fc = this.shadowRoot?.querySelector('#fullscreen-mermaid');
        const m = (window as any).mermaid;
        if (fc && m) {
          const { svg } = await m.render(`fs-${id}-svg`, code);
          fc.innerHTML = svg;
          this._autoFitFullscreen();
        }
      })();
    }, 50);
  }

  private _addMermaidExpandBtn(wrapper: HTMLElement, code: string, id: string) {
    const expandBtn = document.createElement('button');
    expandBtn.innerHTML = '⤢';
    expandBtn.title = 'View fullscreen';
    expandBtn.className = 'expand-btn';
    expandBtn.style.opacity = '0';
    expandBtn.onclick = () => this._openMermaidFullscreen(code, id);
    wrapper.appendChild(expandBtn);
  }

  private _renderMermaid(data: any): TemplateResult {
    const code = String(data);
    // Stable ID so streaming updates reuse the same container
    const mermaidId = 'mermaid-top-live';
    this._pendingMermaidBlocks.push({ id: mermaidId, code });
    const bgColor = this.theme === 'light' ? '#F4F6F8' : '#1e293b';

    // Single stable container — _renderMermaidBlocks injects SVG imperatively.
    // Lit re-renders won't destroy the SVG because the container stays the same.
    return html`<div
      class="mermaid-live-container"
      data-mermaid-id="${mermaidId}"
      style="position: relative; background: ${bgColor}; border-radius: var(--radius-sm); padding: 16px; margin: 16px 0; min-height: 120px;"
    ></div>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SLIDES RENDERER (Marp-style markdown presentations)
  // ═══════════════════════════════════════════════════════════════════════════

  private _slidesCurrentIndex = 0;
  private _slidesFullscreen = false;
  private _slidesDirection: 'forward' | 'backward' = 'forward';
  private _slidesTransitions: Map<number, string> = new Map(); // per-slide transition overrides
  private _slidesDefaultTransition = 'fade';
  private _slidesBoundElements: Set<Element> = new Set();
  private _slidesRefreshTimers: number[] = [];
  private _slidesResizeObserver: ResizeObserver | null = null;
  private _slidesScaleDebounce: ReturnType<typeof setTimeout> | null = null;
  private _slidesScaling = false;
  private _slidesLastZoom = '';

  // ── Bridge-powered slide rendering ──
  // Slide embeds run inside an iframe with the platform bridge loaded.
  // The bridge handles data-method binding, format rendering, streaming, and live updates.
  private _slidesBridgeScript: string | null = null; // cached bridge script
  private _slidesBridgeLoading = false;

  // ── Pre-render pipeline: triple-buffer for flicker-free slide navigation ──
  // Caches rendered HTML + computed zoom for adjacent slides so navigation is instant.
  private _slidesParsed: string[] = []; // all parsed slide markdown strings
  private _slidesConfig: Record<string, string> = {}; // frontmatter config
  private _slidesBaseUrl = '';
  private _slidesThemeClass = '';
  private _slidesPrerendered: Map<
    number,
    { html: string; zoom: string; embedResults: Map<string, unknown> }
  > = new Map();
  private _slidesPrerendering: Set<number> = new Set(); // indices currently being pre-rendered
  private _slidesMcpCache: Map<string, unknown> = new Map(); // method+args → result cache

  private _parseSlides(raw: string): {
    slides: string[];
    theme: string;
    config: Record<string, string>;
  } {
    const config: Record<string, string> = {};
    let content = raw;

    // Extract YAML frontmatter
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fmMatch) {
      content = content.slice(fmMatch[0].length);
      for (const line of fmMatch[1].split('\n')) {
        const kv = line.match(/^(\w+):\s*(.+)/);
        if (kv) config[kv[1]] = kv[2].trim();
      }
    }

    // Extract global default transition from frontmatter
    if (config.transition) {
      this._slidesDefaultTransition = config.transition.split(/\s+/)[0] || 'fade';
    } else {
      this._slidesDefaultTransition = 'fade';
    }

    // Split by --- slide separator (must be on its own line)
    const slides = content
      .split(/\n---\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Parse per-slide transition overrides from HTML comments
    this._slidesTransitions.clear();
    slides.forEach((slide, i) => {
      const match = slide.match(/<!--\s*transition:\s*(\w+)\s*-->/);
      if (match) {
        this._slidesTransitions.set(i, match[1]);
      }
    });

    // Default theme: match Beam's active theme (dark→default, light→uncover)
    const defaultTheme = 'auto';
    return { slides, theme: config.theme || defaultTheme, config };
  }

  /** Ensure the bridge script is loaded and cached */
  private async _ensureBridgeScript(): Promise<string> {
    if (this._slidesBridgeScript) return this._slidesBridgeScript;
    if (this._slidesBridgeLoading) {
      // Wait for existing fetch
      while (this._slidesBridgeLoading) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return this._slidesBridgeScript || '';
    }
    this._slidesBridgeLoading = true;
    try {
      const photonName = this.photonName || '';
      const res = await fetch(
        `/api/platform-bridge?photon=${encodeURIComponent(photonName)}&method=&theme=${encodeURIComponent(this.theme)}`
      );
      this._slidesBridgeScript = await res.text();
    } catch {
      this._slidesBridgeScript = '';
    }
    this._slidesBridgeLoading = false;
    return this._slidesBridgeScript || '';
  }

  /** Build an iframe srcdoc for a slide with the bridge loaded */
  private _buildSlideSrcdoc(
    slideHtml: string,
    codeBlocks?: { id: string; code: string; language: string }[],
    headerText?: string,
    footerText?: string,
    pageNum?: string
  ): string {
    const bridge = this._slidesBridgeScript || '';
    // Convert data-embed="photon/method" to data-method="method" for bridge binding.
    // The bridge is scoped to the photon, so strip the photon prefix.
    // e.g., data-embed="walkthrough/monitor" → data-method="monitor"
    const photonPrefix = this.photonName ? this.photonName + '/' : '';
    let html = slideHtml
      .replace(/data-embed="([^"]+)"/g, (_, path) => {
        const method = path.startsWith(photonPrefix) ? path.slice(photonPrefix.length) : path;
        // Add data-live so the bridge subscribes to streaming updates
        return `data-method="${method}" data-live`;
      })
      .replace(/data-embed-params=/g, 'data-args=')
      .replace(/data-embed-height="([^"]+)"/g, 'style="height:$1px;overflow:auto"')
      .replace(/data-embed-view="[^"]*"/g, ''); // strip view hint (bridge auto-detects)

    // Inline code blocks: replace "Loading..." placeholders with actual code
    // so Prism.js can highlight them inside the iframe
    if (codeBlocks) {
      for (const block of codeBlocks) {
        const escaped = block.code
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        html = html.replace(
          `<code class="language-${block.language}">Loading...</code>`,
          `<code class="language-${block.language}">${escaped}</code>`
        );
      }
    }

    const themeClass = this._slidesThemeClass || 'slides-theme-default';
    return `<!doctype html>
<html lang="en" class="${themeClass}">
<head>
<meta charset="UTF-8">
<meta name="photon-template" content="true">
${bridge}
<style>
  /* All colors derive from MCP host theme tokens — adapts to any client */
  /* Background is transparent — the outer slide viewport provides the bg */
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden;
    font-family: var(--font-sans, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    color: var(--color-on-surface, var(--text, #e6e6e6));
    font-size: 16px; line-height: 1.6; }
  body { padding: 0; display: flex; flex-direction: column; }
  .slide-header { padding: 8px 5vw; font-size: 12px; opacity: 0.6;
    color: var(--color-on-surface-variant, inherit);
    border-bottom: 1px solid var(--color-outline-variant, rgba(128,128,128,0.15)); flex-shrink: 0; }
  .slide-body { flex: 1; padding: 4vh 5vw; overflow: hidden; }
  .slide-footer { padding: 6px 5vw; font-size: 11px; opacity: 0.5; display: flex; justify-content: space-between;
    color: var(--color-on-surface-variant, inherit);
    border-top: 1px solid var(--color-outline-variant, rgba(128,128,128,0.15)); flex-shrink: 0; }
  h1, h2, h3 { color: var(--color-primary, var(--accent, #79aef0)); }
  a { color: var(--color-primary, var(--accent, #79aef0)); }
  strong { color: var(--color-on-surface, var(--text-primary, inherit)); }
  [data-method] { position: relative; max-height: 50vh; overflow: hidden; }
  [data-method].loading::after {
    content: ''; display: inline-block; width: 14px; height: 14px;
    border: 2px solid var(--color-outline-variant, rgba(128,128,128,0.3));
    border-top-color: var(--color-primary, currentColor);
    border-radius: 50%; animation: spin 0.6s linear infinite;
    margin-left: 8px; vertical-align: middle;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  [data-method].error { color: var(--color-error, var(--error, #f87171)); font-style: italic; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 12px; border-bottom: 1px solid var(--color-outline-variant, var(--border-muted, rgba(128,128,128,0.2))); text-align: left; }
  th { font-weight: 600; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--color-on-surface-variant, var(--text-secondary, #b3b3b3)); }
  code { font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace); font-size: 0.9em; }
  pre { background: var(--color-surface-container, var(--bg-secondary, rgba(0,0,0,0.3)));
    padding: 12px; border-radius: var(--radius-md, 8px); overflow-x: auto; position: relative; }
  .code-block-wrapper { position: relative; margin: 1em 0; }
  .code-block-wrapper pre { margin: 0; }
  .code-block-wrapper .language-label { position: absolute; top: 0; right: 0;
    padding: 2px 8px; font-size: 10px; text-transform: uppercase;
    color: var(--color-on-surface-muted, rgba(255,255,255,0.4));
    background: var(--color-surface-container-high, rgba(0,0,0,0.3));
    border-radius: 0 var(--radius-md, 8px) 0 4px;
    font-family: var(--font-mono, monospace); }
  code.inline, code:not([class]) { background: var(--color-surface-container-high, var(--bg-tertiary, rgba(128,128,128,0.15)));
    padding: 2px 6px; border-radius: var(--radius-sm, 4px); }
  img { max-width: 100%; border-radius: var(--radius-sm, 4px); }
  blockquote { border-left: 3px solid var(--color-primary, var(--accent, #79aef0));
    padding-left: 16px; margin-left: 0; color: var(--color-on-surface-variant, var(--text-secondary, #b3b3b3)); }
  /* Syntax highlighting — uses fixed colors (language semantics, not theme-dependent) */
  code[class*="language-"], pre[class*="language-"] { color: var(--color-on-surface, #abb2bf); text-shadow: none; }
  .token.comment, .token.prolog { color: var(--color-on-surface-muted, #5c6370); font-style: italic; }
  .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol { color: #e06c75; }
  .token.selector, .token.string, .token.char, .token.builtin { color: #98c379; }
  .token.operator, .token.entity, .token.url { color: #56b6c2; }
  .token.atrule, .token.attr-value, .token.keyword { color: #c678dd; }
  .token.function, .token.class-name { color: #61afef; }
  .token.regex, .token.variable { color: #d19a66; }
  .token.punctuation { color: var(--color-on-surface-variant, #abb2bf); }

  /* ═══ Slide Layout Utilities ═══ */
  /* Two-column grid — the most common slide layout */
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
  .cols.center { align-items: center; }
  .cols-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; }
  .cols-auto { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 24px; }
  .gap-sm { gap: 16px; }
  .gap-lg { gap: 32px; }

  /* Typography */
  .muted { opacity: 0.7; }
  .small { font-size: 0.85em; }
  .large { font-size: 1.2em; }
  .caption { font-size: 0.8em; opacity: 0.6; margin-top: 4px; }

  /* Cards — elevated surface for code, images, callouts */
  .card { background: var(--color-surface-container, rgba(0,0,0,0.2));
    border-radius: var(--radius-md, 12px); padding: 16px; overflow: hidden; }
  .card img { width: 100%; display: block; border-radius: var(--radius-sm, 8px); }
  .card-elevated { box-shadow: var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.2)); }

  /* Callout / highlight box */
  .callout { background: var(--color-primary-container, rgba(121,174,240,0.1));
    border-left: 3px solid var(--color-primary, #79aef0);
    padding: 12px 16px; border-radius: 0 var(--radius-sm, 6px) var(--radius-sm, 6px) 0; }

  /* Badge / chip */
  .badge { display: inline-block; padding: 2px 10px; border-radius: var(--radius-full, 999px);
    font-size: 0.8em; background: var(--color-primary, #79aef0); color: var(--color-on-primary, #fff); }

  /* Spacers */
  .mt-0 { margin-top: 0; }
  .mb-0 { margin-bottom: 0; }
  .mt-1 { margin-top: 8px; }
  .mt-2 { margin-top: 16px; }

  /* Full-bleed image */
  .hero { width: 100%; border-radius: var(--radius-lg, 14px);
    box-shadow: var(--shadow-lg, 0 24px 60px rgba(0,0,0,0.28)); }
</style>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-typescript.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js"><\/script>
<script>
  // Highlight code blocks after bridge binds
  document.addEventListener('DOMContentLoaded', function() {
    if (window.Prism) {
      setTimeout(function() { Prism.highlightAll(); }, 100);
    }
    // No bg override needed — iframe fills viewport edge-to-edge,
    // bridge theme bg matches the slide container bg naturally.
  });
<\/script>
</head>
<body>
${headerText ? `<div class="slide-header">${headerText}</div>` : ''}
<div class="slide-body">${html}</div>
${footerText || pageNum ? `<div class="slide-footer"><span>${footerText || ''}</span><span>${pageNum || ''}</span></div>` : ''}
</body>
</html>`;
  }

  /** Render a single slide's markdown to HTML (shared by live render + pre-render) */
  private _renderSlideHtml(slideMarkdown: string): {
    html: string;
    mermaidBlocks: { id: string; code: string }[];
    codeBlocks: { id: string; code: string; language: string }[];
  } {
    // Rewrite relative paths
    let md = slideMarkdown;
    if (this._slidesBaseUrl) {
      md = md.replace(
        /(!?\[([^\]]*)\])\((?!https?:\/\/|\/|data:)([^)]+)\)/g,
        (_, prefix, _alt, relPath) => `${prefix}(${this._slidesBaseUrl}${relPath})`
      );
      md = md.replace(
        /(\bsrc=["'])(?!https?:\/\/|\/|data:)([^"']+)(["'])/g,
        (_, pre, relPath, post) => `${pre}${this._slidesBaseUrl}${relPath}${post}`
      );
    }
    return this._parseRichMarkdown(md, {
      stripFrontMatter: false,
      includeInlineStyles: true,
    });
  }

  private _renderSlides(data: any): TemplateResult {
    const raw = String(data);
    const { slides, theme: rawTheme, config } = this._parseSlides(raw);

    if (slides.length === 0) {
      return this._renderMarkdown(raw);
    }

    // Cache parsed slides for pre-rendering pipeline
    this._slidesParsed = slides;
    this._slidesConfig = config;

    // Restore slide position from URL hash (e.g., #slide-5 → index 4)
    try {
      const hashMatch = window.location.hash.match(/^#slide-(\d+)$/);
      if (hashMatch && this._slidesCurrentIndex === 0) {
        const hashIndex = parseInt(hashMatch[1], 10) - 1;
        if (hashIndex >= 0 && hashIndex < slides.length) {
          this._slidesCurrentIndex = hashIndex;
        }
      }
    } catch {
      /* ignore in iframe contexts */
    }

    // Clamp index
    if (this._slidesCurrentIndex >= slides.length) this._slidesCurrentIndex = slides.length - 1;
    if (this._slidesCurrentIndex < 0) this._slidesCurrentIndex = 0;

    const current = slides[this._slidesCurrentIndex];
    const total = slides.length;
    const idx = this._slidesCurrentIndex;

    // Helper to strip surrounding quotes from YAML values
    const stripQuotes = (s: string) => s.replace(/^["']|["']$/g, '');

    // Resolve base URL for relative paths (images, links)
    const rawBaseUrl = stripQuotes(config.baseUrl || '');
    this._slidesBaseUrl =
      rawBaseUrl || (this.photonName ? `/api/assets/${encodeURIComponent(this.photonName)}/` : '');

    const { html: slideHtml, mermaidBlocks, codeBlocks } = this._renderSlideHtml(current);
    this._pendingMermaidBlocks = mermaidBlocks;
    this._pendingCodeBlocks = codeBlocks;

    // Resolve theme: 'auto' and 'default' inherit from Beam's active theme
    // Both use CSS variables, so they automatically adapt to light/dark mode
    const resolvedTheme =
      rawTheme === 'auto' || rawTheme === 'default'
        ? this.theme === 'light'
          ? 'uncover'
          : 'default'
        : rawTheme;
    const themeClass = `slides-theme-${resolvedTheme}`;
    this._slidesThemeClass = themeClass;

    // Frontmatter-driven inline overrides
    const bgOverride = config.backgroundColor ? `background:${config.backgroundColor};` : '';
    const colorOverride = config.color ? `color:${config.color};` : '';
    const viewportStyle = bgOverride + colorOverride;

    const showPaginate = config.paginate === 'true';
    const headerText = stripQuotes(config.header || '');
    const footerText = stripQuotes(config.footer || '');

    // Determine current transition for data attributes
    const currentTransition = this._getSlideTransition(idx);

    return html`
      <div
        class="slides-container ${themeClass}"
        id="slides-root"
        data-transition="${currentTransition}"
        data-direction="${this._slidesDirection}"
        @keydown=${(e: KeyboardEvent) => this._slidesKeydown(e, total)}
        tabindex="0"
        style="${viewportStyle}"
      >
        <div class="slides-viewport">
          <div class="slides-content">
            ${this._slidesBridgeScript
              ? html`<iframe
                  class="slide-bridge-frame"
                  .srcdoc=${this._buildSlideSrcdoc(
                    slideHtml,
                    codeBlocks,
                    headerText,
                    footerText,
                    showPaginate ? `${idx + 1} / ${total}` : ''
                  )}
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  frameborder="0"
                  style="width:100%;height:100%;border:none;"
                ></iframe>`
              : unsafeHTML(slideHtml)}
          </div>
          <div class="slides-controls">
            <button
              class="slides-btn"
              ?disabled=${idx === 0}
              @click=${() => this._slidesNavigate(idx - 1, total)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <span class="slides-counter">${idx + 1} / ${total}</span>
            <button
              class="slides-btn"
              ?disabled=${idx === total - 1}
              @click=${() => this._slidesNavigate(idx + 1, total)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
            <button
              class="slides-btn slides-fullscreen-btn"
              title="Fullscreen (F)"
              @click=${() => this._slidesToggleFullscreen()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
                ></path>
              </svg>
            </button>
          </div>
        </div>
        ${footerText && !this._slidesBridgeScript
          ? html`<div class="slides-footer">
              <span>${footerText}</span>
            </div>`
          : ''}
      </div>
      <style>
        .slides-container {
          position: relative;
          border-radius: var(--radius-md, 8px);
          outline: none;
          background: #1a1a2e;
          color: #e5e5e5;
          font-family:
            system-ui,
            -apple-system,
            sans-serif;
        }
        .slides-container:fullscreen {
          display: flex;
          flex-direction: column;
        }
        .slides-viewport {
          aspect-ratio: 16 / 9;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 48px 64px;
          overflow: hidden;
          position: relative;
        }
        .slides-container:fullscreen .slides-viewport {
          flex: 1;
          aspect-ratio: auto;
          padding: 64px 120px;
        }
        .slides-container:fullscreen .slides-viewport:has(.slide-bridge-frame) {
          padding: 0;
        }
        .slides-content {
          width: 100%;
          max-width: 960px;
          line-height: 1.6;
        }
        /* When slide content is a bridge iframe, fill the entire viewport edge-to-edge */
        .slides-viewport:has(.slide-bridge-frame) {
          padding: 0;
        }
        .slides-content:has(.slide-bridge-frame) {
          max-width: none;
          height: 100%;
          width: 100%;
        }
        .slides-prerender {
          position: absolute;
          left: -9999px;
          top: 0;
          width: 100%;
          max-width: 960px;
          line-height: 1.6;
          visibility: hidden;
          pointer-events: none;
          z-index: -1;
        }
        .slides-content h1 {
          font-size: 2.4em;
          margin: 0 0 0.4em;
          font-weight: 700;
        }
        .slides-content h2 {
          font-size: 1.8em;
          margin: 0 0 0.4em;
          font-weight: 600;
        }
        .slides-content h3 {
          font-size: 1.3em;
          margin: 0 0 0.3em;
        }
        .slides-content p {
          margin: 0.5em 0;
          font-size: 1.15em;
        }
        .slides-content ul,
        .slides-content ol {
          margin: 0.5em 0;
          padding-left: 1.5em;
          font-size: 1.1em;
        }
        .slides-content li {
          margin: 0.3em 0;
        }
        .slides-content code {
          background: rgba(255, 255, 255, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.9em;
        }
        .slides-content pre {
          background: rgba(0, 0, 0, 0.3);
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
        }
        .slides-content pre code {
          background: none;
          padding: 0;
        }
        .slides-content img {
          max-width: 100%;
          border-radius: 8px;
        }
        .slides-content blockquote {
          border-left: 4px solid rgba(255, 255, 255, 0.3);
          padding-left: 16px;
          margin: 0.5em 0;
          opacity: 0.85;
        }
        .slides-content table {
          border-collapse: collapse;
          width: 100%;
          margin: 0.5em 0;
        }
        .slides-content th,
        .slides-content td {
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 8px 12px;
          text-align: left;
        }
        .slides-content th {
          background: rgba(255, 255, 255, 0.05);
        }
        .slides-controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 10px 16px;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(8px);
          opacity: 0;
          transition: opacity 0.3s ease;
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 10;
        }
        .slides-controls:hover,
        .slides-container:focus-within .slides-controls {
          opacity: 1;
        }
        .slides-container:fullscreen .slides-controls {
          opacity: 0;
          padding-top: 10px;
        }
        .slides-container:fullscreen .slides-controls:hover {
          opacity: 1;
        }
        .slides-btn {
          background: var(--color-surface-container, rgba(255, 255, 255, 0.1));
          border: 1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.2));
          color: var(--color-on-surface, #e5e5e5);
          padding: 6px 14px;
          border-radius: var(--radius-sm, 6px);
          cursor: pointer;
          font-size: 14px;
          transition: background 0.15s;
        }
        .slides-btn:hover:not(:disabled) {
          background: var(--color-surface-container-high, rgba(255, 255, 255, 0.2));
        }
        .slides-btn:disabled {
          opacity: 0.3;
          cursor: default;
        }
        .slides-counter {
          font-size: 13px;
          opacity: 0.7;
          min-width: 50px;
          text-align: center;
        }
        .slides-fullscreen-btn {
          margin-left: 8px;
        }
        .slides-header {
          padding: 8px 24px;
          font-size: 12px;
          opacity: 0.6;
          color: var(--color-on-surface-variant, inherit);
          border-bottom: 1px solid var(--color-outline-variant, rgba(128, 128, 128, 0.15));
        }
        .slides-footer {
          display: flex;
          justify-content: space-between;
          padding: 6px 24px;
          font-size: 11px;
          opacity: 0.5;
          color: var(--color-on-surface-variant, inherit);
          border-top: 1px solid var(--color-outline-variant, rgba(128, 128, 128, 0.15));
        }
        .slides-container:fullscreen .slides-header,
        .slides-container:fullscreen .slides-footer {
          opacity: 0;
          transition: opacity 0.25s ease;
        }
        .slides-container:fullscreen:hover .slides-header,
        .slides-container:fullscreen:hover .slides-footer {
          opacity: 0.5;
        }

        /* ═══ THEMES ═══ */
        .slides-theme-default {
          background: var(--color-surface, var(--bg, #1a1a2e));
          color: var(--color-on-surface, var(--text, #e5e5e5));
        }
        .slides-theme-default .slides-content h1,
        .slides-theme-default .slides-content h2 {
          color: var(--color-primary, var(--accent, #7dd3fc));
        }

        .slides-theme-uncover {
          background: var(--color-surface-bright, var(--bg, #fafafa));
          color: var(--color-on-surface, var(--text, #333));
        }
        .slides-theme-uncover .slides-content h1,
        .slides-theme-uncover .slides-content h2 {
          color: var(--color-primary, var(--accent, #1a1a2e));
        }

        .slides-theme-gaia {
          background: #004643;
          color: #e8e4e6;
        }
        .slides-theme-gaia .slides-content h1,
        .slides-theme-gaia .slides-content h2 {
          color: #f9bc60;
        }
        .slides-theme-gaia .slides-controls {
          background: rgba(0, 0, 0, 0.2);
        }

        .slides-theme-uncover .slides-controls {
          background: rgba(128, 128, 128, 0.08);
        }
        .slides-theme-uncover .slides-btn {
          color: var(--text-primary, #333);
          border-color: var(--border-primary, rgba(0, 0, 0, 0.15));
          background: rgba(128, 128, 128, 0.05);
        }
        .slides-theme-uncover .slides-btn:hover:not(:disabled) {
          background: rgba(128, 128, 128, 0.12);
        }

        .slides-theme-rose {
          background: #1c1017;
          color: #f0e6eb;
        }
        .slides-theme-rose .slides-content h1,
        .slides-theme-rose .slides-content h2 {
          color: #f472b6;
        }

        .slides-theme-dracula {
          background: #282a36;
          color: #f8f8f2;
        }
        .slides-theme-dracula .slides-content h1,
        .slides-theme-dracula .slides-content h2 {
          color: #bd93f9;
        }
        .slides-theme-dracula .slides-controls {
          background: #191a21;
        }

        /* ═══ VIEW TRANSITIONS ═══ */
        .slides-content {
          view-transition-name: slide-content;
        }

        /* Fade */
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes fadeOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }

        /* Slide */
        @keyframes slideOutLeft {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-100%);
          }
        }
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes slideOutRight {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(100%);
          }
        }
        @keyframes slideInLeft {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0);
          }
        }

        /* Cover */
        @keyframes coverIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes coverInReverse {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes stayPut {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(0);
          }
        }

        /* Reveal */
        @keyframes revealOut {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-100%);
          }
        }
        @keyframes revealOutReverse {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(100%);
          }
        }

        /* Zoom */
        @keyframes zoomIn {
          from {
            transform: scale(0.8);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes zoomOut {
          from {
            transform: scale(1);
            opacity: 1;
          }
          to {
            transform: scale(1.2);
            opacity: 0;
          }
        }

        /* Transition: fade (default) */
        ::view-transition-old(slide-content) {
          animation: fadeOut 0.4s ease;
        }
        ::view-transition-new(slide-content) {
          animation: fadeIn 0.4s ease;
        }

        /* Transition: slide forward */
        :host([data-slides-transition='slide'][data-slides-direction='forward'])
          ::view-transition-old(slide-content) {
          animation: slideOutLeft 0.4s ease;
        }
        :host([data-slides-transition='slide'][data-slides-direction='forward'])
          ::view-transition-new(slide-content) {
          animation: slideInRight 0.4s ease;
        }
        :host([data-slides-transition='slide'][data-slides-direction='backward'])
          ::view-transition-old(slide-content) {
          animation: slideOutRight 0.4s ease;
        }
        :host([data-slides-transition='slide'][data-slides-direction='backward'])
          ::view-transition-new(slide-content) {
          animation: slideInLeft 0.4s ease;
        }

        /* Transition: cover */
        :host([data-slides-transition='cover'][data-slides-direction='forward'])
          ::view-transition-old(slide-content) {
          animation: stayPut 0.4s ease;
        }
        :host([data-slides-transition='cover'][data-slides-direction='forward'])
          ::view-transition-new(slide-content) {
          animation: coverIn 0.4s ease;
        }
        :host([data-slides-transition='cover'][data-slides-direction='backward'])
          ::view-transition-old(slide-content) {
          animation: stayPut 0.4s ease;
        }
        :host([data-slides-transition='cover'][data-slides-direction='backward'])
          ::view-transition-new(slide-content) {
          animation: coverInReverse 0.4s ease;
        }

        /* Transition: reveal */
        :host([data-slides-transition='reveal'][data-slides-direction='forward'])
          ::view-transition-old(slide-content) {
          animation: revealOut 0.4s ease;
        }
        :host([data-slides-transition='reveal'][data-slides-direction='forward'])
          ::view-transition-new(slide-content) {
          animation: stayPut 0.4s ease;
        }
        :host([data-slides-transition='reveal'][data-slides-direction='backward'])
          ::view-transition-old(slide-content) {
          animation: revealOutReverse 0.4s ease;
        }
        :host([data-slides-transition='reveal'][data-slides-direction='backward'])
          ::view-transition-new(slide-content) {
          animation: stayPut 0.4s ease;
        }

        /* Transition: zoom */
        :host([data-slides-transition='zoom']) ::view-transition-old(slide-content) {
          animation: zoomOut 0.4s ease;
        }
        :host([data-slides-transition='zoom']) ::view-transition-new(slide-content) {
          animation: zoomIn 0.4s ease;
        }

        /* ═══ DECLARATIVE BINDING STYLES ═══ */
        .slides-content [data-method] {
          position: relative;
          max-height: 50vh;
          overflow: hidden;
          contain: layout;
        }
        .slides-content [data-method].loading::after {
          content: '';
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(128, 128, 128, 0.3);
          border-top-color: currentColor;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
          margin-left: 8px;
          vertical-align: middle;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        .slides-content [data-method].error {
          color: #f87171;
          font-style: italic;
        }
        .slides-content .demo-box {
          background: rgba(128, 128, 128, 0.1);
          border: 1px solid rgba(128, 128, 128, 0.2);
          border-radius: 8px;
          padding: 16px;
          margin: 12px 0;
        }

        /* ═══ EMBED IFRAMES ═══ */
        .slides-content .slide-embed {
          width: 100%;
          border: none;
          border-radius: 12px;
          background: rgba(0, 0, 0, 0.15);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }
        .slides-content [data-embed] {
          margin: 12px 0;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
      </style>
    `;
  }

  private _getSlideTransition(slideIndex: number): string {
    return this._slidesTransitions.get(slideIndex) ?? this._slidesDefaultTransition;
  }

  /**
   * Apply pre-rendered zoom and embed results to the visible slide.
   * Lit renders the slide HTML normally; we only inject cached MCP results
   * and apply the pre-computed zoom to avoid flicker.
   */
  private _applyPrerendered(slideIndex: number): boolean {
    const cached = this._slidesPrerendered.get(slideIndex);
    if (!cached) return false;

    const content = this.shadowRoot?.querySelector('.slides-content') as HTMLElement;
    if (!content) return false;

    // Apply pre-computed zoom immediately (no measurement needed)
    content.style.zoom = cached.zoom;
    this._slidesLastZoom = cached.zoom;

    // Convert data-embed to data-method and inject cached MCP results
    this._bindSlideElements();

    // Inject cached embed results into bound data-method elements
    if (cached.embedResults.size > 0) {
      content.querySelectorAll('[data-method]').forEach((el) => {
        const method = el.getAttribute('data-method') || '';
        const format = el.getAttribute('data-format') || '';
        const argsRaw = el.getAttribute('data-args') || '{}';
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(argsRaw);
        } catch {
          /* */
        }
        const cacheKey = `${method}:${JSON.stringify(args)}`;
        const data = this._slidesMcpCache.get(cacheKey);
        if (data !== undefined) {
          // Render cached result directly — no MCP call needed
          el.classList.remove('loading');
          if (format) {
            this._renderSlideFormat(el as HTMLElement, data, format);
          } else {
            this._renderBindingResult(el as HTMLElement, data, format, '');
          }
        }
      });
    }

    return true;
  }

  private _slidesNavigate(newIndex: number, total: number): void {
    if (newIndex < 0 || newIndex >= total || newIndex === this._slidesCurrentIndex) return;

    this._slidesDirection = newIndex > this._slidesCurrentIndex ? 'forward' : 'backward';
    const transition = this._getSlideTransition(newIndex);

    // Persist slide position in URL hash for refresh/bookmark support
    try {
      const newHash = `#slide-${newIndex + 1}`;
      if (window.location.hash !== newHash) {
        history.replaceState(null, '', newHash);
      }
    } catch {
      /* ignore in iframe contexts */
    }

    // Set data attributes on host for CSS view-transition selectors
    this.setAttribute('data-slides-transition', transition);
    this.setAttribute('data-slides-direction', this._slidesDirection);

    const afterRender = () => {
      // Try to apply pre-rendered content (instant, no flicker)
      const applied = this._applyPrerendered(newIndex);
      if (applied) {
        // Still need to highlight code + set up resize observer + pre-render next
        this._highlightInlineCodeElements();
        this._preRenderAdjacentSlides();
      } else {
        // Fall back to normal bind + scale cycle
        this._afterSlideRender();
      }
    };

    if (transition === 'none' || !('startViewTransition' in document)) {
      this._slidesCurrentIndex = newIndex;
      this.requestUpdate();
      void this.updateComplete.then(() => afterRender());
      return;
    }

    (document as any)
      .startViewTransition(() => {
        this._slidesCurrentIndex = newIndex;
        this.requestUpdate();
        return this.updateComplete;
      })
      .finished.then(() => {
        afterRender();
      })
      .catch(() => {
        afterRender();
      });
  }

  private _afterSlideRender(): void {
    // Called from _onSlidesRendered (which awaits updateComplete + rAF)
    // or from _slidesNavigate (after view transition completes).
    // DOM is already ready — no need for updateComplete here.
    this._bindSlideElements();
    this._highlightInlineCodeElements();

    // For bridge iframe: scale after iframe loads its new srcdoc
    const iframe = this.shadowRoot?.querySelector('.slide-bridge-frame') as HTMLIFrameElement;
    if (iframe) {
      const doScale = () => {
        this._autoScaleSlide();
        // Watch for async embed content changes (gauge, table loading)
        try {
          const body = iframe.contentDocument?.body;
          if (body) {
            new ResizeObserver(() => {
              if (this._slidesScaling) return;
              if (this._slidesScaleDebounce) clearTimeout(this._slidesScaleDebounce);
              this._slidesScaleDebounce = setTimeout(() => this._autoScaleSlide(), 400);
            }).observe(body);
          }
        } catch {
          /* cross-origin */
        }
      };
      // Always listen for load (srcdoc change triggers new load event)
      iframe.addEventListener('load', doScale, { once: true });
      // Also try after a short delay in case load already fired
      setTimeout(doScale, 300);
    } else {
      this._autoScaleSlide();
    }

    // Watch for outer content size changes (non-iframe path)
    if (this._slidesResizeObserver) {
      this._slidesResizeObserver.disconnect();
    }
    const content = this.shadowRoot?.querySelector('.slides-content') as HTMLElement;
    if (content && !iframe) {
      this._slidesResizeObserver = new ResizeObserver(() => {
        if (this._slidesScaling) return;
        if (this._slidesScaleDebounce) clearTimeout(this._slidesScaleDebounce);
        this._slidesScaleDebounce = setTimeout(() => {
          this._autoScaleSlide();
        }, 600);
      });
      this._slidesResizeObserver.observe(content);
    }

    // Pre-render adjacent slides in background (triple-buffer)
    this._preRenderAdjacentSlides();
  }

  /**
   * Pre-render slides N-1 and N+1 in a hidden container.
   * Binds data-method elements (calls MCP) and measures zoom.
   * Results are cached so navigation can swap instantly.
   */
  private _preRenderAdjacentSlides(): void {
    const idx = this._slidesCurrentIndex;
    const total = this._slidesParsed.length;
    if (total === 0) return;

    // Pre-render next and previous (next has higher priority)
    const targets: number[] = [];
    if (idx + 1 < total) targets.push(idx + 1);
    if (idx - 1 >= 0) targets.push(idx - 1);

    // Evict stale cache entries (keep only current ± 2)
    for (const cached of this._slidesPrerendered.keys()) {
      if (Math.abs(cached - idx) > 2) {
        this._slidesPrerendered.delete(cached);
      }
    }

    for (const target of targets) {
      if (this._slidesPrerendered.has(target) || this._slidesPrerendering.has(target)) continue;
      void this._preRenderSlide(target);
    }
  }

  private async _preRenderSlide(slideIndex: number): Promise<void> {
    if (this._slidesPrerendering.has(slideIndex)) return;
    this._slidesPrerendering.add(slideIndex);

    try {
      const markdown = this._slidesParsed[slideIndex];
      if (!markdown) return;

      const root = this.shadowRoot;
      if (!root) return;
      const viewport = root.querySelector('.slides-viewport') as HTMLElement;
      if (!viewport) return;

      // Render markdown to HTML
      const { html: slideHtml } = this._renderSlideHtml(markdown);

      // Create hidden container for rendering + measurement
      const container = document.createElement('div');
      container.className = 'slides-prerender';
      container.innerHTML = slideHtml;
      viewport.appendChild(container);

      // Bind data-embed → data-method conversion + resolve formats
      this._bindPrerenderedEmbeds(container);

      // Invoke data-method elements and render results
      const methodEls = container.querySelectorAll('[data-method]');
      const embedResults = new Map<string, unknown>();

      await Promise.all(
        Array.from(methodEls).map(async (el) => {
          const method = el.getAttribute('data-method') || '';
          const argsRaw = el.getAttribute('data-args') || '{}';
          const format = el.getAttribute('data-format') || '';
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(argsRaw);
          } catch {
            /* */
          }

          // Check MCP cache first
          const cacheKey = `${method}:${JSON.stringify(args)}`;
          let data = this._slidesMcpCache.get(cacheKey);
          if (data === undefined) {
            try {
              // Timeout pre-render MCP calls (streaming generators can hang indefinitely)
              const result = await Promise.race([
                mcpClient.callTool(method, args),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('pre-render timeout')), 5000)
                ),
              ]);
              data = mcpClient.parseToolResult(result);
              this._slidesMcpCache.set(cacheKey, data);
            } catch {
              (el as HTMLElement).textContent = '';
              return;
            }
          }
          embedResults.set(method, data);

          // Render format into the element
          if (format) {
            this._renderSlideFormat(el as HTMLElement, data, format);
          } else {
            (el as HTMLElement).textContent =
              typeof data === 'object'
                ? JSON.stringify(data, null, 2)
                : String((data ?? '') as string | number | boolean);
          }
        })
      );

      // Measure zoom at natural size
      container.style.zoom = '1';
      const padV = document.fullscreenElement ? 128 : 96;
      const padH = document.fullscreenElement ? 240 : 128;
      const viewH = viewport.clientHeight - padV;
      const viewW = viewport.clientWidth - padH;
      const contentH = container.scrollHeight;
      const contentW = container.scrollWidth;

      let zoom = '';
      if (contentH > 0 && viewH > 0 && contentW > 0 && viewW > 0) {
        const scale = Math.min(viewH / contentH, viewW / contentW);
        const clamped = Math.max(0.5, Math.min(2.5, scale));
        zoom = Math.abs(clamped - 1) > 0.02 ? String(clamped) : '';
      }

      // Cache the pre-rendered result
      this._slidesPrerendered.set(slideIndex, {
        html: container.innerHTML,
        zoom,
        embedResults,
      });

      // Clean up hidden container
      container.remove();
    } finally {
      this._slidesPrerendering.delete(slideIndex);
    }
  }

  /** Convert data-embed to data-method in a pre-render container (same logic as _bindSlideElements) */
  private _bindPrerenderedEmbeds(container: HTMLElement): void {
    const embeds = container.querySelectorAll('[data-embed]');
    embeds.forEach((el) => {
      const embedPath = el.getAttribute('data-embed') || '';
      const paramsRaw = el.getAttribute('data-embed-params') || '';
      const height = el.getAttribute('data-embed-height') || '320';
      const embedView = el.getAttribute('data-embed-view') || '';

      // Form embeds: skip pre-rendering (they need iframe interaction)
      if (embedView === 'form') return;

      el.setAttribute('data-method', embedPath);
      el.removeAttribute('data-embed');
      if (paramsRaw) el.setAttribute('data-args', paramsRaw);

      // Resolve @format from photon metadata
      if (!el.getAttribute('data-format')) {
        const parts = embedPath.split('/');
        if (parts.length === 2) {
          try {
            const beamApp =
              (this.getRootNode() as ShadowRoot)?.host || document.querySelector('beam-app');
            const photons = (beamApp as any)?._photons || [];
            const photon = photons.find((p: any) => p.name === parts[0]);
            const method = photon?.methods?.find((m: any) => m.name === parts[1]);
            if (method?.outputFormat) {
              el.setAttribute('data-format', method.outputFormat);
            }
          } catch {
            /* */
          }
        }
      }

      (el as HTMLElement).style.height = `${height}px`;
      (el as HTMLElement).style.overflow = 'auto';
    });
  }

  private _autoScaleSlide(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const viewport = root.querySelector('.slides-viewport') as HTMLElement;
    const content = root.querySelector('.slides-content') as HTMLElement;
    if (!viewport || !content) return;

    this._slidesScaling = true;

    try {
      // For bridge iframe slides: use transform:scale on .slide-body
      const iframe = content.querySelector('.slide-bridge-frame') as HTMLIFrameElement;
      if (iframe?.contentDocument?.body) {
        const doc = iframe.contentDocument;
        const slideBody = doc.querySelector('.slide-body') as HTMLElement;
        if (!slideBody) return;

        // Reset any previous transform to measure natural size
        slideBody.style.transform = '';
        slideBody.style.transformOrigin = '';

        // Measure natural content size (slideBody has overflow:hidden, use scrollHeight)
        const naturalH = slideBody.scrollHeight;
        const naturalW = slideBody.scrollWidth;

        // Available space = iframe viewport (which is the full slide viewport)
        const iframeH = iframe.clientHeight;
        const iframeW = iframe.clientWidth;

        // Subtract header/footer heights
        const header = doc.querySelector('.slide-header') as HTMLElement;
        const footer = doc.querySelector('.slide-footer') as HTMLElement;
        const headerH = header?.offsetHeight || 0;
        const footerH = footer?.offsetHeight || 0;
        const availH = iframeH - headerH - footerH;

        if (naturalH > 0 && availH > 0 && naturalW > 0 && iframeW > 0) {
          const scaleH = availH / naturalH;
          const scaleW = iframeW / naturalW;
          const scale = Math.min(scaleH, scaleW);
          const clamped = Math.max(0.5, Math.min(2.5, scale));

          if (Math.abs(clamped - 1) > 0.02) {
            slideBody.style.transform = `scale(${clamped})`;
            slideBody.style.transformOrigin = 'top left';
            // Adjust container to match scaled size so it doesn't overflow
            slideBody.style.width = `${100 / clamped}%`;
            slideBody.style.height = `${availH / clamped}px`;
          }
        }
        return;
      }

      // Non-iframe slides: use prerender div measurement (legacy path)
      let prerender = root.querySelector('.slides-prerender') as HTMLElement;
      if (!prerender) {
        prerender = document.createElement('div');
        prerender.className = 'slides-prerender';
        viewport.appendChild(prerender);
      }

      prerender.innerHTML = content.innerHTML;
      prerender.querySelectorAll('iframe').forEach((el) => {
        const placeholder = document.createElement('div');
        placeholder.style.height = el.style.height || '200px';
        el.replaceWith(placeholder);
      });
      prerender.style.zoom = '1';

      const padV = document.fullscreenElement ? 128 : 96;
      const padH = document.fullscreenElement ? 240 : 128;
      const viewH = viewport.clientHeight - padV;
      const viewW = viewport.clientWidth - padH;
      const contentH = prerender.scrollHeight;
      const contentW = prerender.scrollWidth;

      if (contentH <= 0 || viewH <= 0 || contentW <= 0 || viewW <= 0) {
        return;
      }

      // Scale to fit: zoom up or down so content fills the viewport
      const scaleH = viewH / contentH;
      const scaleW = viewW / contentW;
      const zoom = Math.min(scaleH, scaleW);

      // Clamp: don't go below 0.5 or above 2.5
      const clampedZoom = Math.max(0.5, Math.min(2.5, zoom));
      const newZoom = Math.abs(clampedZoom - 1) > 0.02 ? String(clampedZoom) : '';

      // Only update if zoom actually changed — prevents ResizeObserver from re-triggering
      if (newZoom !== this._slidesLastZoom) {
        this._slidesLastZoom = newZoom;
        content.style.zoom = newZoom;
      }
    } finally {
      // Release guard after a frame so the ResizeObserver callback
      // triggered by our zoom change is suppressed
      requestAnimationFrame(() => {
        this._slidesScaling = false;
      });
    }
  }

  private _bindSlideElements(): void {
    const root = this.shadowRoot;
    if (!root) return;

    // Clear previous refresh timers and streaming subscriptions
    for (const timer of this._slidesRefreshTimers) {
      clearInterval(timer);
    }
    this._slidesRefreshTimers = [];
    // Clean up render event listeners from previous slide
    this._slidesBoundElements.forEach((el) => {
      const cleanup = (el as any)._renderCleanup;
      if (typeof cleanup === 'function') cleanup();
    });
    this._slidesBoundElements.clear();

    // Process data-embed elements — convert to inline data-method divs (no iframes).
    // The existing data-method binding below will pick them up and call MCP directly.
    const embeds = root.querySelectorAll('.slides-content [data-embed]');
    embeds.forEach((el) => {
      if (this._slidesBoundElements.has(el)) return;
      // Don't mark as bound yet — let the data-method binding below handle it

      const embedPath = el.getAttribute('data-embed') || '';
      const paramsRaw = el.getAttribute('data-embed-params') || '';
      const height = el.getAttribute('data-embed-height') || '320';

      const embedView = el.getAttribute('data-embed-view') || '';

      // Form embeds need the pure-view iframe (inline binding doesn't support form rendering)
      if (embedView === 'form') {
        let url = `/${embedPath}?view=form`;
        if (paramsRaw) {
          try {
            const params = JSON.parse(paramsRaw) as Record<string, unknown>;
            for (const [key, value] of Object.entries(params)) {
              const encoded =
                typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value as string | number | boolean);
              url += `&${encodeURIComponent(key)}=${encodeURIComponent(encoded)}`;
            }
          } catch {
            /* invalid params JSON */
          }
        }
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.className = 'slide-embed';
        iframe.style.height = `${height}px`;
        iframe.style.flex = '1';
        iframe.style.border = 'none';
        iframe.style.borderRadius = '8px';
        iframe.setAttribute('loading', 'lazy');
        el.innerHTML = '';
        el.appendChild(iframe);
        this._slidesBoundElements.add(el);
        return;
      }

      // Convert data-embed="photon/method" to data-method="photon/method"
      // This lets the inline binding call mcpClient.callTool() directly — no iframe needed
      el.setAttribute('data-method', embedPath);
      el.removeAttribute('data-embed');

      // Convert data-embed-params to data-args
      if (paramsRaw) {
        el.setAttribute('data-args', paramsRaw);
      }

      // Resolve @format from method metadata (e.g., walkthrough/team → "table")
      // Look up from beam-app's photon list via the DOM tree
      if (!el.getAttribute('data-format')) {
        const parts = embedPath.split('/');
        if (parts.length === 2) {
          try {
            const beamApp =
              (this.getRootNode() as ShadowRoot)?.host || document.querySelector('beam-app');
            const photons = (beamApp as any)?._photons || [];
            const photon = photons.find((p: any) => p.name === parts[0]);
            const method = photon?.methods?.find((m: any) => m.name === parts[1]);
            if (method?.outputFormat) {
              el.setAttribute('data-format', method.outputFormat);
            }
          } catch {
            /* format lookup failed, will render as raw */
          }
        }
      }

      // Set height constraint from data-embed-height
      (el as HTMLElement).style.height = `${height}px`;
      (el as HTMLElement).style.overflow = 'auto';
    });

    const elements = root.querySelectorAll('.slides-content [data-method]');
    if (elements.length === 0) return;

    elements.forEach((el) => {
      if (this._slidesBoundElements.has(el)) return;
      this._slidesBoundElements.add(el);

      const method = el.getAttribute('data-method') || '';
      const format = el.getAttribute('data-format') || '';
      const field = el.getAttribute('data-field') || '';
      const argsRaw = el.getAttribute('data-args') || '{}';
      const trigger = el.getAttribute('data-trigger') || this._inferTrigger(el);
      const targetSel = el.getAttribute('data-target') || '';
      const refresh = el.getAttribute('data-refresh') || '';

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsRaw);
      } catch {
        /* invalid JSON, use empty */
      }

      const invoke = async () => {
        const target = targetSel ? (root.querySelector(targetSel) ?? el) : el;
        target.classList.add('loading');
        target.classList.remove('error');

        try {
          const result = await mcpClient.callTool(method, args);
          const data = mcpClient.parseToolResult(result);
          target.classList.remove('loading');

          if (result.isError) {
            target.classList.add('error');
            target.textContent = String(data) || 'Error';
            return;
          }

          this._renderBindingResult(target as HTMLElement, data, format, field);
        } catch {
          // Streaming methods (generators) may timeout or hang — that's OK,
          // render events arrive via SSE and are handled by the render listener below.
          target.classList.remove('loading');
        }
      };

      if (trigger === 'load') {
        void invoke();
      } else if (trigger === 'click') {
        el.addEventListener('click', () => void invoke(), { once: false });
        (el as HTMLElement).style.cursor = 'pointer';
      }

      // Subscribe to streaming render events (generator yields, this.render() calls)
      // Match by photon/method name — e.g., data-method="walkthrough/monitor"
      const [embedPhoton, embedMethod] = method.split('/');
      if (embedPhoton && embedMethod) {
        const renderHandler = (data: any) => {
          if (data?.photon === embedPhoton && data?.method === embedMethod) {
            const target = targetSel ? (root.querySelector(targetSel) ?? el) : el;
            target.classList.remove('loading');
            const renderFormat = data.format || format;
            if (renderFormat && data.value !== undefined) {
              this._renderSlideFormat(target as HTMLElement, data.value, renderFormat);
            }
          }
        };
        mcpClient.on('render', renderHandler);
        // Store cleanup reference — cleared when _bindSlideElements resets
        (el as any)._renderCleanup = () => mcpClient.off('render', renderHandler);
      }

      // Polling via data-refresh
      if (refresh) {
        const ms = this._parseRefreshInterval(refresh);
        if (ms > 0) {
          const timer = window.setInterval(() => void invoke(), ms);
          this._slidesRefreshTimers.push(timer);
        }
      }
    });
  }

  private _inferTrigger(el: Element): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'a') return 'click';
    return 'load';
  }

  private _parseRefreshInterval(value: string): number {
    const match = value.match(/^(\d+)(s|ms|m)?$/);
    if (!match) return 0;
    const num = parseInt(match[1], 10);
    const unit = match[2] || 's';
    if (unit === 'ms') return num;
    if (unit === 'm') return num * 60000;
    return num * 1000;
  }

  private _renderBindingResult(
    target: HTMLElement,
    data: unknown,
    format: string,
    field: string
  ): void {
    // Extract nested field if specified
    let value = data;
    if (field && typeof data === 'object' && data !== null) {
      const parts = field.split('.');
      let current: any = data;
      for (const part of parts) {
        if (current == null) break;
        current = current[part];
      }
      value = current;
    }

    if (format === 'text' || !format) {
      // Plain text rendering
      target.textContent =
        value == null
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value as string | number | boolean);
    } else if (format === 'json') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = JSON.stringify(value, null, 2);
      pre.appendChild(code);
      target.innerHTML = '';
      target.appendChild(pre);
    } else if (format === 'html') {
      target.innerHTML = String(value);
    } else {
      // For format renderers (gauge, table, metric, etc.) —
      // render as formatted text with the value, keeping it simple.
      // The full format renderer from photon-renderers.js could be loaded lazily,
      // but for slides we use a lightweight inline approach.
      this._renderSlideFormat(target, value, format);
    }
  }

  private _renderSlideFormat(target: HTMLElement, data: unknown, format: string): void {
    // Use the full photon renderers (same as bridge's photon.render())
    // Lazy-load on first use from /api/photon-renderers.js
    const win = window as any;
    const doRender = () => {
      if (win._photonRenderers?.render) {
        win._photonRenderers.render(target, data, format);
      } else {
        // Final fallback: render as text
        target.textContent =
          typeof data === 'object'
            ? JSON.stringify(data, null, 2)
            : String((data ?? '') as string | number | boolean);
      }
    };

    if (win._photonRenderers) {
      doRender();
    } else if (win._photonRenderersLoading) {
      // Already loading — queue this render
      win._photonRenderersQueue = win._photonRenderersQueue || [];
      win._photonRenderersQueue.push(doRender);
    } else {
      // Load the renderers script via fetch+eval (avoids strict MIME and quote escaping issues)
      win._photonRenderersLoading = true;
      win._photonRenderersQueue = [doRender];
      fetch('/api/photon-renderers.js')
        .then((r) => r.text())
        .then((code) => {
          try {
            // eslint-disable-next-line no-eval
            (0, eval)(code);
          } catch {
            /* renderer eval failed */
          }
          const queue = win._photonRenderersQueue || [];
          win._photonRenderersQueue = [];
          queue.forEach((fn: () => void) => fn());
        })
        .catch(() => {
          const queue = win._photonRenderersQueue || [];
          win._photonRenderersQueue = [];
          queue.forEach((fn: () => void) => fn());
        });
    }
  }

  private _slidesKeydown(e: KeyboardEvent, total: number): void {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      if (this._slidesCurrentIndex < total - 1) {
        this._slidesNavigate(this._slidesCurrentIndex + 1, total);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      if (this._slidesCurrentIndex > 0) {
        this._slidesNavigate(this._slidesCurrentIndex - 1, total);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      this._slidesNavigate(0, total);
    } else if (e.key === 'End') {
      e.preventDefault();
      this._slidesNavigate(total - 1, total);
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      this._slidesToggleFullscreen();
    } else if (e.key === 'Escape') {
      // Escape exits fullscreen (browser handles this, but ensure state sync)
      this._slidesFullscreen = false;
    }
  }

  private _slidesToggleFullscreen(): void {
    const el = this.shadowRoot?.getElementById('slides-root');
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen()
        .then(() => {
          this._slidesFullscreen = true;
          el.focus();
          // Re-scale after fullscreen dimensions are applied
          requestAnimationFrame(() => this._autoScaleSlide());
        })
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => {
          this._slidesFullscreen = false;
          // Re-scale back to normal dimensions
          requestAnimationFrame(() => this._autoScaleSlide());
        })
        .catch(() => {});
    }
  }

  private _renderQR(data: any): TemplateResult {
    // Shape validation handled by _matchesFormat — data is guaranteed to have QR content here
    const text =
      typeof data === 'object' && data !== null
        ? String(data.qr || data.url || data.link || data.value)
        : String(data);

    // Detect content type for smart linking
    const isUrl = /^https?:\/\//i.test(text);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
    const isPhone = /^[+]?[\d\s\-().]{7,}$/.test(text.trim());

    let href = '';
    let linkLabel = text;
    if (isUrl) {
      href = text;
      try {
        linkLabel = new URL(text).hostname + new URL(text).pathname;
      } catch {
        /* keep full text */
      }
    } else if (isEmail) {
      href = `mailto:${text}`;
    } else if (isPhone) {
      href = `tel:${text.replace(/[\s\-().]/g, '')}`;
    }

    // Schedule QR code generation after render — size adapts to container.
    // Lazy-loads qrcodejs from CDN if not already present.
    const renderQR = () => {
      if (!this._qrContainer) return;
      this._qrContainer.innerHTML = '';
      try {
        const containerWidth = this._qrContainer.clientWidth;
        const qrSize = Math.max(200, Math.min(containerWidth - 48, 400));
        new (window as any).QRCode(this._qrContainer, {
          text: text,
          width: qrSize,
          height: qrSize,
          correctLevel: (window as any).QRCode?.CorrectLevel?.H,
          colorDark: '#000000',
          colorLight: '#ffffff',
        });
      } catch (error) {
        console.error('Failed to generate QR code:', error);
      }
    };

    setTimeout(() => {
      if ((window as any).QRCode) {
        renderQR();
      } else {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
        script.onload = renderQR;
        script.onerror = () => console.error('Failed to load QR code library');
        document.head.appendChild(script);
      }
    }, 0);

    // Build extra info from object fields (e.g. tunnel returns provider, port, etc.)
    // Skip url/link/value (shown as QR content), message (shown separately as status)
    const message =
      typeof data === 'object' && data !== null ? (data.message as string | undefined) : undefined;
    const extraFields: Array<{ label: string; value: string }> = [];
    if (typeof data === 'object' && data !== null) {
      for (const [k, v] of Object.entries(data)) {
        if (
          ['url', 'link', 'value', 'message', 'port'].includes(k) ||
          v == null ||
          typeof v === 'object'
        )
          continue;
        extraFields.push({ label: k, value: `${v as string | number | boolean}` });
      }
    }

    return html`<div
      style="
      display: flex; flex-direction: column; align-items: center; gap: 0;
      padding: 0; border-radius: var(--radius-md);
      border: 1px solid var(--border-glass);
      background: var(--bg-subtle); overflow: hidden;
      width: fit-content; min-width: 280px; max-width: 480px;
      margin: 16px auto;
    "
    >
      <div
        id="qr-container"
        style="
        width: 100%; padding: 24px;
        display: flex; justify-content: center; align-items: center;
        background: #ffffff; border-radius: var(--radius-md) var(--radius-md) 0 0;
      "
      ></div>

      <div
        style="
        width: 100%; padding: 16px 20px;
        display: flex; flex-direction: column; gap: 10px;
        border-top: 1px solid var(--border-glass);
      "
      >
        ${message
          ? html`<div
              style="
              font-size: 0.8rem; color: var(--t-secondary, #a0a0a0);
              text-align: center; font-weight: 500;
            "
            >
              ${message}
            </div>`
          : ''}
        ${href
          ? html`<div
              style="display: flex; align-items: center; gap: 10px; justify-content: center;"
            >
              <a
                href="${href}"
                target="_blank"
                rel="noopener noreferrer"
                style="
                  font-size: 0.85rem; color: var(--accent, #3b82f6);
                  text-decoration: none; font-weight: 500;
                  text-align: center; word-break: break-word;
                "
                @mouseenter=${(e: Event) =>
                  ((e.target as HTMLElement).style.textDecoration = 'underline')}
                @mouseleave=${(e: Event) =>
                  ((e.target as HTMLElement).style.textDecoration = 'none')}
                >${linkLabel}</a
              >
              <button
                title="Copy to clipboard"
                style="
                  background: var(--bg-subtle, rgba(255,255,255,0.06));
                  border: 1px solid var(--border-glass);
                  border-radius: 6px; padding: 6px 10px; cursor: pointer;
                  color: var(--t-muted); font-size: 0.85rem; flex-shrink: 0;
                  transition: all 0.15s; line-height: 1;
                "
                @mouseenter=${(e: Event) => {
                  (e.target as HTMLElement).style.color = 'var(--accent, #3b82f6)';
                  (e.target as HTMLElement).style.borderColor = 'var(--accent, #3b82f6)';
                }}
                @mouseleave=${(e: Event) => {
                  (e.target as HTMLElement).style.color = 'var(--t-muted)';
                  (e.target as HTMLElement).style.borderColor = 'var(--border-glass)';
                }}
                @click=${(e: Event) => {
                  void navigator.clipboard.writeText(text);
                  const btn = e.target as HTMLElement;
                  const orig = btn.textContent;
                  btn.textContent = '✓ Copied';
                  btn.style.color = 'var(--accent, #3b82f6)';
                  setTimeout(() => {
                    btn.textContent = orig;
                    btn.style.color = 'var(--t-muted)';
                  }, 1500);
                }}
              >
                Copy
              </button>
            </div>`
          : html`<div
              style="
              font-size: 0.875rem; color: var(--t-muted);
              text-align: center; word-break: break-all;
            "
            >
              ${text}
            </div>`}
        ${extraFields.length > 0
          ? html`<div
              style="
              display: flex; flex-direction: column; gap: 6px;
              padding-top: 10px; border-top: 1px solid var(--border-glass);
              font-size: 0.8rem;
            "
            >
              ${extraFields.map(
                (f) =>
                  html`<div style="display: flex; justify-content: space-between; gap: 12px;">
                    <span style="color: var(--t-muted); text-transform: capitalize;"
                      >${f.label}</span
                    >
                    <span
                      style="color: var(--t-primary); font-family: var(--font-mono, monospace); word-break: break-all; text-align: right;"
                      >${f.value}</span
                    >
                  </div>`
              )}
            </div>`
          : ''}
      </div>
    </div>`;
  }

  private _renderText(data: any): TemplateResult | string {
    const text = String(data);
    // Fallback: detect mermaid strings that _selectLayout missed (e.g., timing)
    if (this._isMermaidString(text)) {
      return this._renderMermaid(text);
    }
    return this._highlightText(text);
  }

  private _renderErrorCard(message: string): TemplateResult {
    // Parse structured error message (from server formatError)
    // Format: "❌ Tool Error: name\n\nError Type: ...\nMessage: ...\nSuggestion: ..."
    const lines = message.split('\n').filter((l) => l.trim());
    const messageLine = lines.find((l) => l.startsWith('Message: '));
    const suggestionLine = lines.find((l) => l.startsWith('Suggestion: '));
    const displayMessage = messageLine
      ? messageLine.replace('Message: ', '')
      : lines[0]?.replace(/^❌\s*/, '') || message;
    const suggestion = suggestionLine ? suggestionLine.replace('Suggestion: ', '') : '';

    return html`<div
      style="
      padding: 20px; border-radius: var(--radius-md);
      border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
      background: color-mix(in srgb, #ef4444 5%, var(--bg-subtle));
      display: flex; flex-direction: column; gap: 8px;
      margin: 8px 0;
    "
    >
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.1rem;">⚠️</span>
        <span style="font-weight: 600; color: var(--t-primary); font-size: 0.95rem;">
          ${displayMessage}
        </span>
      </div>
      ${suggestion
        ? html`<div
            style="
        font-size: 0.85rem; color: var(--t-secondary);
        padding-left: 28px;
      "
          >
            ${suggestion}
          </div>`
        : ''}
    </div>`;
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
    // Delegate to formatLabel which handles camelCase, snake_case, and known acronyms (ID, URL, etc.)
    return formatLabel(name);
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
      return html`<span class="status-badge ${this._getStatusClass(value)}"
        >${formatLabel(value)}</span
      >`;
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
            style="background:none;border:none;color:var(--accent-secondary);cursor:pointer;font-size:0.8rem;padding:2px 0;font-family:inherit;display:inline-flex;align-items:center;gap:4px;"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggleNode(nodeKey);
            }}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="currentColor"
              style="display:inline-block;transition:transform 0.15s;transform:rotate(${isExpanded
                ? '90deg'
                : '0deg'});"
            >
              <polygon points="6,3 20,12 6,21"></polygon>
            </svg>
            ${this._formatColumnName(key)} <span style="opacity:0.6;">(${value.length})</span>
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
      // Single nested object → sub-rows (one key-value pair per row for readability)
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length <= 4) {
        return html`<div style="display:flex;flex-direction:column;gap:2px;">
          ${entries.map(
            ([k, v]) =>
              html`<div style="display:flex;gap:8px;align-items:baseline;">
                <span
                  style="color:var(--t-muted);font-size:0.75rem;white-space:nowrap;min-width:4em;"
                  >${this._formatColumnName(k)}</span
                >
                <span
                  >${typeof v === 'object' && v !== null
                    ? JSON.stringify(v)
                    : String(v as never)}</span
                >
              </div>`
          )}
        </div>`;
      }
      const nodeKey = `cell-${key}`;
      const isExpanded = this._expandedNodes.has(nodeKey);
      return html`
        <div>
          <button
            style="background:none;border:none;color:var(--accent-secondary);cursor:pointer;font-size:0.8rem;padding:2px 0;font-family:inherit;display:inline-flex;align-items:center;gap:4px;"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggleNode(nodeKey);
            }}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="currentColor"
              style="display:inline-block;transition:transform 0.15s;transform:rotate(${isExpanded
                ? '90deg'
                : '0deg'});"
            >
              <polygon points="6,3 20,12 6,21"></polygon>
            </svg>
            ${this._formatColumnName(key)} <span style="opacity:0.6;">(${entries.length})</span>
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

    // Detect mermaid diagram strings and render them visually
    if (this._isMermaidString(str)) {
      const mermaidId = `mermaid-cell-${Math.random().toString(36).substr(2, 9)}`;
      // Queue for rendering — updated() lifecycle will call _renderMermaidBlocks
      this._pendingMermaidBlocks.push({ id: mermaidId, code: str });
      return html`<div
        class="mermaid-placeholder"
        data-mermaid-id="${mermaidId}"
        style="min-height: 80px; display: flex; align-items: center; justify-content: center; color: var(--t-muted);"
      >
        Loading diagram...
      </div>`;
    }

    // Multiline strings → monospace pre-formatted block (ASCII art, boards, etc.)
    if (str.includes('\n')) {
      return html`<pre
        style="margin:0;font-family:var(--font-mono);font-size:0.8rem;white-space:pre;overflow-x:auto;line-height:1.4;"
      >
${str}</pre
      >`;
    }

    return highlight ? this._highlightText(str) : str;
  }

  private _isMermaidString(str: string): boolean {
    const trimmed = str.trimStart();
    return /^(flowchart |graph |sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie |gitGraph|journey|mindmap|timeline|sankey|xychart|block-beta|packet-beta|architecture-beta|kanban)/.test(
      trimmed
    );
  }

  /**
   * Detect slide deck content: marp frontmatter or 3+ slide separators
   */
  private _isSlidesString(str: string): boolean {
    // Marp frontmatter
    if (/^---\s*\n[\s\S]*?marp:\s*true/m.test(str)) return true;
    // 3+ horizontal rules used as slide separators (not just one markdown hr)
    const separators = str.split(/\n---\s*\n/).length - 1;
    return separators >= 2;
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
    return (
      lower === 'status' ||
      lower === 'state' ||
      lower === 'priority' ||
      lower === 'assignee' ||
      lower === 'author' ||
      lower === 'createdby' ||
      lower === 'updatedby' ||
      lower === 'role' ||
      lower === 'type'
    );
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

  copy() {
    const text =
      typeof this.result === 'object' ? JSON.stringify(this.result, null, 2) : String(this.result);

    void navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  }

  share() {
    this.dispatchEvent(
      new CustomEvent('share', {
        bubbles: true,
        composed: true,
      })
    );
  }

  fullscreen() {
    const container = this.shadowRoot?.querySelector('.container') as HTMLElement;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void container.requestFullscreen();
    }
  }

  isTabularData(): boolean {
    return (
      Array.isArray(this.result) &&
      this.result.length > 0 &&
      typeof this.result[0] === 'object' &&
      this.result[0] !== null
    );
  }

  getDownloadLabel(layout?: LayoutType): string {
    if (!layout) layout = this._selectLayout();
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

  downloadSmart(layout?: LayoutType) {
    if (!layout) layout = this._selectLayout();
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

  download(format: 'json' | 'csv') {
    let content: string;
    let mimeType: string;
    let filename: string;
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv' && this.isTabularData()) {
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
    void this.updateComplete.then(() => this._initChart(data, canvasId));

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
                  <div class="timeline-title-row">
                    <span class="timeline-dot"></span>
                    <div class="timeline-title">
                      ${titleField ? item[titleField] : JSON.stringify(item)}
                    </div>
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

    // Gauge: { value, max } or { progress } — check before metric to avoid false matches
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (('progress' in value && typeof value.progress === 'number') ||
        ('value' in value && typeof value.value === 'number' && ('max' in value || 'min' in value)))
    ) {
      return this._renderGauge(value);
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

    // Array of objects → try chart first, then table
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      if (this._isChartShaped(value)) {
        // Inline chart for dashboard panel
        const canvasId = `dash-chart-${Math.random().toString(36).slice(2, 9)}`;
        void this.updateComplete.then(async () => {
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
          summary[key] = value;
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
