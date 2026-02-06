import { LitElement, html, css, TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';

type LayoutType =
  | 'table'
  | 'list'
  | 'card'
  | 'tree'
  | 'json'
  | 'markdown'
  | 'mermaid'
  | 'code'
  | 'text'
  | 'chips'
  | 'grid'
  | 'html';

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
        font-size: 0.65rem;
        padding: 2px 8px;
        background: transparent;
        border: none;
        border-radius: 10px;
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
        font-family: var(--font-mono);
        font-size: 0.9rem;
        color: var(--t-primary);
        white-space: pre-wrap;
        overflow-x: auto;
        max-height: 500px;
        line-height: 1.5;
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
        --code-bg: rgba(0, 0, 0, 0.05);
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
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-panel);
        font-family: var(--font-sans);
        transition: background 0.3s ease, transform 0.3s ease, opacity 0.3s ease;
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
        transition: background 0.3s ease, opacity 0.3s ease;
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
        border-radius: 20px;
        font-size: 0.85rem;
        color: var(--t-primary);
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
        border-radius: 4px;
        font-family: var(--font-mono);
        font-size: 0.9em;
      }
      .markdown-body pre {
        background: var(--code-bg);
        padding: 1em;
        border-radius: 8px;
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
        border-radius: 8px;
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
        border-radius: 8px;
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
        background: #f8fafc;
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
        background: #ffffff;
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
        border-radius: 6px;
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
          max-height: 400px;
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
          padding: var(--space-sm) 0;
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

  // Track animated items for collection events
  @state()
  private _animatedItems = new Map<string, 'added' | 'removed' | 'updated'>();

  // Internal result copy for incremental updates
  @state()
  private _internalResult: any = null;

  // Property name for event subscriptions (set by parent)
  @property({ type: String })
  collectionProperty?: string;

  private _pageSize = 20;

  @query('.filter-input')
  private _filterInput!: HTMLInputElement;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._handleGlobalKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._handleGlobalKeydown);
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
    idField: string = 'id'
  ): void {
    // Initialize internal result if needed
    if (this._internalResult === null) {
      this._internalResult = Array.isArray(this.result) ? [...this.result] : this.result;
    }

    if (!Array.isArray(this._internalResult)) {
      // For non-array results, just replace
      if (type === 'changed') {
        this._internalResult = data;
      }
      return;
    }

    const itemId = data && typeof data === 'object' ? (data as Record<string, unknown>)[idField] : String(data);
    const stringId = String(itemId);

    switch (type) {
      case 'added':
        // Add item and track for animation
        this._internalResult = [...this._internalResult, data];
        this._animatedItems.set(stringId, 'added');
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
          this._internalResult = this._internalResult.filter(
            (item: unknown) => {
              const id = item && typeof item === 'object' ? (item as Record<string, unknown>)[idField] : item;
              return String(id) !== stringId;
            }
          );
          this._animatedItems.delete(stringId);
          this.requestUpdate();
        }, 300);
        break;

      case 'updated':
        // Update item and highlight
        const updateData = data as { index?: number; value?: unknown };
        if (updateData.index !== undefined && updateData.value !== undefined) {
          this._internalResult = this._internalResult.map(
            (item: unknown, i: number) => i === updateData.index ? updateData.value : item
          );
        } else {
          // Find and replace by ID
          this._internalResult = this._internalResult.map((item: unknown) => {
            const id = item && typeof item === 'object' ? (item as Record<string, unknown>)[idField] : item;
            return String(id) === stringId ? data : item;
          });
        }
        this._animatedItems.set(stringId, 'updated');
        setTimeout(() => {
          this._animatedItems.delete(stringId);
          this.requestUpdate();
        }, 800);
        break;

      case 'changed':
        // Full replacement
        this._internalResult = Array.isArray(data) ? [...data as unknown[]] : data;
        break;
    }
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
  private _getItemAnimationClass(item: unknown, idField: string = 'id'): string {
    const itemId = item && typeof item === 'object' ? (item as Record<string, unknown>)[idField] : item;
    const animation = this._animatedItems.get(String(itemId));
    return animation ? `item-${animation}` : '';
  }

  /**
   * Get the effective result (internal copy if available, otherwise prop)
   */
  private _getEffectiveResult(): unknown {
    return this._internalResult !== null ? this._internalResult : this.result;
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
        <div class="content">${this._renderContent(layout, filteredData)}</div>
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

  private _selectLayout(): LayoutType {
    // 1. Explicit format from docblock
    if (this.outputFormat) {
      const format = this.outputFormat.toLowerCase();
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
        chart: 'json', // fallback until chart layout exists
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

      // Array of objects → table or list
      if (data.every((item) => typeof item === 'object' && item !== null)) {
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

    // Single object → card
    if (typeof data === 'object') {
      return 'card';
    }

    return 'json';
  }

  private _hasSemanticFields(obj: any, fields: string[]): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj).map((k) => k.toLowerCase());
    return fields.some((f) => keys.includes(f.toLowerCase()));
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
      case 'html':
        return this._renderHtml();
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
            ${columns.map(
              (col) => html`
                <th
                  class="sortable ${this._sortColumn === col ? 'sorted' : ''}"
                  @click=${() => this._toggleSort(col)}
                >
                  ${this._formatColumnName(col)}
                  <span class="sort-indicator">
                    ${this._sortColumn === col ? (this._sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
              `
            )}
          </tr>
        </thead>
        <tbody>
          ${pageData.map(
            (row) => html`
              <tr>
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

    if (typeof item !== 'object' || item === null) {
      return html`<li class="list-item ${animClass}">
        <span class="list-item-title">${this._highlightText(String(item))}</span>
      </li>`;
    }

    const mapping = this._analyzeFields(item);

    return html`
      <li class="list-item ${animClass}">
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
            ? html`
                <span class="status-badge ${this._getStatusClass(item[mapping.badge])}"
                  >${item[mapping.badge]}</span
                >
              `
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
      ${scalarKeys.length > 0 ? html`
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
      ` : ''}
      ${nestedKeys.map((key) => html`
        <div style="margin-top:var(--space-sm);">
          ${this._formatCellValue(data[key], key, true)}
        </div>
      `)}
    `;
  }

  /** Returns true for arrays of objects or large nested objects that deserve their own section */
  private _isNestedValue(value: any): boolean {
    if (Array.isArray(value) && value.length > 0 && value.some((v) => typeof v === 'object' && v !== null)) return true;
    if (typeof value === 'object' && value !== null && Object.keys(value).length > 4) return true;
    return false;
  }

  private _renderChips(data: any): TemplateResult {
    if (!Array.isArray(data)) {
      return html`<div class="chip">${this._highlightText(String(data))}</div>`;
    }

    return html`
      <div class="smart-chips">
        ${data.map((item) => html`<span class="chip">${this._highlightText(String(item))}</span>`)}
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

    // Reset internal result when result prop changes (full data refresh)
    if (changedProperties.has('result')) {
      this._internalResult = null;
      this._animatedItems.clear();
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
    const bgColor = this.theme === 'light' ? '#f8fafc' : '#1e293b';
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
              tertiaryColor: '#f8fafc',
              background: '#ffffff',
              mainBkg: '#f8fafc',
              textColor: '#1e293b',
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
        const bgColor = this.theme === 'light' ? '#f8fafc' : '#1e293b';
        wrapper.style.cssText = `position: relative; background: ${bgColor}; border-radius: 8px; padding: 16px; margin: 16px 0;`;

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
          `<pre style="color: #ff6b6b; background: rgba(255,0,0,0.1); padding: 8px; border-radius: 4px;">Mermaid Error: ${e}\n\n${code}</pre>`;
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
        return html`<span style="display:flex;flex-wrap:wrap;gap:3px;">${value.map(
          (v) => html`<span style="font-size:0.75rem;padding:1px 6px;border-radius:3px;background:hsla(220,10%,80%,0.08);color:var(--t-muted);font-family:var(--font-mono);">${String(v)}</span>`
        )}</span>`;
      }
      // Array of objects → collapsible nested table
      const nodeKey = `cell-${key}`;
      const isExpanded = this._expandedNodes.has(nodeKey);
      const columns = Object.keys(value[0]).filter((k) => value[0][k] !== undefined);
      return html`
        <div>
          <button
            style="background:none;border:none;color:var(--accent-secondary);cursor:pointer;font-size:0.8rem;padding:2px 0;font-family:inherit;"
            @click=${(e: Event) => { e.stopPropagation(); this._toggleNode(nodeKey); }}
          >${isExpanded ? '▾' : '▸'} ${value.length} items</button>
          ${isExpanded ? html`
            <table class="smart-table" style="margin-top:6px;font-size:0.8rem;">
              <thead><tr>${columns.map((c) => html`<th style="white-space:nowrap;">${this._formatColumnName(c)}</th>`)}</tr></thead>
              <tbody>
                ${value.slice(0, 100).map((row) => html`
                  <tr>${columns.map((c) => html`<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this._formatCellValue(row[c], c, highlight)}</td>`)}</tr>
                `)}
                ${value.length > 100 ? html`<tr><td colspan="${columns.length}" style="text-align:center;color:var(--t-muted);font-style:italic;">…and ${value.length - 100} more</td></tr>` : ''}
              </tbody>
            </table>
          ` : ''}
        </div>
      `;
    }

    if (typeof value === 'object' && value !== null) {
      // Single nested object → inline key-value pairs
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length <= 4) {
        return html`<span style="display:flex;flex-wrap:wrap;gap:4px 10px;">${entries.map(
          ([k, v]) => html`<span><span style="color:var(--t-muted);font-size:0.75rem;text-transform:uppercase;">${k}</span> <span>${typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></span>`
        )}</span>`;
      }
      const nodeKey = `cell-${key}`;
      const isExpanded = this._expandedNodes.has(nodeKey);
      return html`
        <div>
          <button
            style="background:none;border:none;color:var(--accent-secondary);cursor:pointer;font-size:0.8rem;padding:2px 0;font-family:inherit;"
            @click=${(e: Event) => { e.stopPropagation(); this._toggleNode(nodeKey); }}
          >${isExpanded ? '▾' : '▸'} ${entries.length} fields</button>
          ${isExpanded ? html`
            <table class="smart-table kv-table" style="margin-top:6px;font-size:0.8rem;max-width:100%;">
              <tbody>
                ${entries.map(([k, v]) => html`
                  <tr>
                    <td class="kv-key">${this._formatColumnName(k)}</td>
                    <td>${this._formatCellValue(v, k, highlight)}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          ` : ''}
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
    if (!value.startsWith('http://') && !value.startsWith('https://') && !value.startsWith('data:image/')) return false;
    return /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(value) || value.startsWith('data:image/');
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
}
