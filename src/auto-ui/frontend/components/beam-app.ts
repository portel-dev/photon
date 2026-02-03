import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';
import type { BeamSidebar } from './beam-sidebar.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import type { ElicitationData } from './elicitation-modal.js';
import { mcpClient } from '../services/mcp-client.js';

const THEME_STORAGE_KEY = 'beam-theme';
const PROTOCOL_STORAGE_KEY = 'beam-protocol';
const FETCH_TIMEOUT_MS = 10_000;
const MCP_RECONNECT_DELAY_MS = 3_000;
const SCROLL_RENDER_DELAY_MS = 100;

@customElement('beam-app')
export class BeamApp extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        /* ===== Dark Theme (Default) ===== */
        --bg-app: hsl(220, 15%, 10%);
        --bg-glass: hsla(220, 15%, 14%, 0.6);
        --bg-glass-strong: hsla(220, 15%, 14%, 0.85);
        --bg-panel: hsl(220, 15%, 12%);
        --t-primary: hsl(220, 10%, 95%);
        --t-muted: hsl(220, 10%, 65%);
        --border-glass: hsla(220, 10%, 80%, 0.1);
        --accent-primary: hsl(260, 100%, 65%);
        --accent-secondary: hsl(190, 100%, 50%);
        --glow-primary: hsla(260, 100%, 65%, 0.3);

        display: flex;
        height: 100vh;
        width: 100vw;
        background: var(--bg-app);
        color: var(--t-primary);
        font-family: var(--font-sans);
        overflow: hidden;
      }

      /* ===== Light Theme - "Warm Editorial" ===== */
      :host([data-theme='light']) {
        --bg-app: hsl(40, 20%, 94%);
        --bg-glass: hsla(45, 40%, 99%, 0.92);
        --bg-glass-strong: hsla(45, 50%, 100%, 0.97);
        --bg-panel: hsl(42, 35%, 97%);
        --t-primary: hsl(220, 30%, 15%);
        --t-muted: hsl(220, 10%, 45%);
        --border-glass: hsla(30, 20%, 50%, 0.15);
        --accent-primary: hsl(215, 70%, 48%);
        --accent-secondary: hsl(165, 60%, 38%);
        --glow-primary: hsla(215, 70%, 48%, 0.15);
      }

      .sidebar-area {
        width: 300px;
        flex-shrink: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
      }

      .main-area {
        flex: 1;
        position: relative;
        overflow-y: auto;
        overflow-x: hidden;
        padding: var(--space-lg);
      }

      .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--space-md);
        margin-bottom: var(--space-xl);
        align-items: stretch; /* Make cards same height per row */
      }

      /* Photon Header */
      .photon-header {
        display: flex;
        align-items: flex-start;
        gap: var(--space-lg);
        margin-bottom: var(--space-xl);
      }

      .photon-icon-large {
        width: 64px;
        height: 64px;
        border-radius: 16px;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        color: white;
        flex-shrink: 0;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      }

      .photon-icon-large.mcp-icon {
        background: var(--bg-glass);
        color: var(--accent-secondary);
        font-size: 20px;
        font-weight: 600;
      }

      .photon-icon-large img {
        width: 40px;
        height: 40px;
        object-fit: contain;
      }

      .photon-header-info {
        flex: 1;
        min-width: 0;
      }

      .photon-header-name {
        font-size: 2rem;
        font-weight: 700;
        margin: 0 0 var(--space-sm) 0;
        background: linear-gradient(135deg, var(--t-primary), var(--accent-secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .photon-header-desc {
        color: var(--t-muted);
        font-size: 1rem;
        line-height: 1.5;
        margin: 0;
      }

      .photon-header-meta {
        display: flex;
        gap: var(--space-md);
        margin-top: var(--space-sm);
      }

      .photon-header-path {
        font-family: var(--font-mono, monospace);
        font-size: 0.7rem;
        color: var(--t-muted);
        margin-top: 4px;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.15s;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 400px;
      }

      .photon-header-path:hover {
        opacity: 1;
      }

      .photon-badge {
        font-size: 0.75rem;
        padding: 4px 10px;
        border-radius: 12px;
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
      }

      .photon-badge.app {
        background: hsla(260, 100%, 65%, 0.15);
        border-color: hsla(260, 100%, 65%, 0.3);
        color: hsl(260, 100%, 75%);
      }

      .photon-badge.update {
        background: hsla(30, 100%, 55%, 0.15);
        border-color: hsla(30, 100%, 55%, 0.3);
        color: hsl(30, 100%, 65%);
        cursor: pointer;
      }

      .photon-badge.source {
        background: hsla(200, 60%, 50%, 0.1);
        border-color: hsla(200, 60%, 50%, 0.2);
        color: hsl(200, 60%, 65%);
      }

      .photon-header-actions {
        display: flex;
        gap: var(--space-sm);
        margin-top: var(--space-sm);
      }

      .btn-sm {
        font-size: 0.75rem;
        padding: 4px 12px;
        border-radius: 8px;
        border: 1px solid var(--border-glass);
        background: var(--bg-glass);
        color: var(--t-primary);
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-sm:hover {
        background: var(--bg-glass-strong);
        border-color: var(--accent-secondary);
      }

      .btn-sm.primary {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      .btn-sm.primary:hover {
        opacity: 0.9;
      }

      /* Inline Editable Elements */
      .editable {
        cursor: pointer;
        border-radius: var(--radius-sm);
        padding: 2px 6px;
        margin: -2px -6px;
        transition:
          background 0.15s ease,
          box-shadow 0.15s ease;
        position: relative;
      }

      .editable:hover {
        background: var(--bg-glass);
      }

      .editable:hover::after {
        content: '✏️';
        position: absolute;
        right: -24px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 0.8rem;
        opacity: 0.6;
      }

      .editable.editing {
        background: var(--bg-glass-strong);
        box-shadow: 0 0 0 2px var(--accent-primary);
      }

      .editable-input {
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        width: 100%;
        outline: none;
        padding: 0;
        margin: 0;
      }

      .editable-input::placeholder {
        color: var(--t-muted);
        font-style: italic;
      }

      .photon-header-desc.editable {
        min-width: 200px;
        display: inline-block;
      }

      .photon-header-desc.placeholder {
        color: var(--t-muted);
        font-style: italic;
      }

      /* Editable Icon */
      .photon-icon-large.editable {
        cursor: pointer;
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
      }

      .photon-icon-large.editable:hover {
        transform: scale(1.05);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.3),
          0 0 0 3px var(--accent-primary);
      }

      /* Emoji Picker */
      .emoji-picker {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-sm);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 100;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 4px;
        max-width: 280px;
      }

      .emoji-picker button {
        background: none;
        border: none;
        font-size: 1.5rem;
        padding: 4px;
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition:
          background 0.15s ease,
          transform 0.1s ease;
      }

      .emoji-picker button:hover {
        background: var(--bg-glass);
        transform: scale(1.1);
      }

      /* Prompts & Resources Section */
      .section-header {
        color: var(--t-muted);
        text-transform: uppercase;
        font-size: 0.8rem;
        letter-spacing: 0.1em;
        margin-top: var(--space-xl);
        margin-bottom: var(--space-md);
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .section-header .count {
        background: var(--bg-glass);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 0.7rem;
      }

      .asset-card {
        padding: var(--space-md);
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        cursor: pointer;
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
        height: 100%;
        box-sizing: border-box;
      }

      .asset-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 32px -4px rgba(0, 0, 0, 0.3);
        border-color: var(--accent-secondary);
      }

      .asset-card .asset-icon {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: var(--bg-glass);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex-shrink: 0;
      }

      .asset-card .asset-icon.prompt {
        background: hsla(45, 80%, 50%, 0.15);
        color: hsl(45, 80%, 50%);
      }

      .asset-card .asset-icon.resource {
        background: hsla(190, 80%, 50%, 0.15);
        color: hsl(190, 80%, 50%);
      }

      .asset-card .asset-header {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .asset-card .asset-name {
        font-weight: 600;
        font-size: 1rem;
        color: var(--t-primary);
      }

      .asset-card .asset-desc {
        font-size: 0.85rem;
        color: var(--t-muted);
        flex: 1;
      }

      .asset-card .asset-meta {
        font-size: 0.75rem;
        color: var(--t-muted);
        opacity: 0.7;
      }

      /* Prompt/Resource Viewer */
      .asset-viewer {
        padding: var(--space-lg);
      }

      .asset-viewer-header {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        margin-bottom: var(--space-lg);
      }

      .asset-viewer-icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
      }

      .asset-viewer-icon.prompt {
        background: hsla(45, 80%, 50%, 0.15);
        color: hsl(45, 80%, 50%);
      }

      .asset-viewer-icon.resource {
        background: hsla(190, 80%, 50%, 0.15);
        color: hsl(190, 80%, 50%);
      }

      .asset-viewer-title {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0;
      }

      .asset-viewer-desc {
        color: var(--t-muted);
        margin: 4px 0 0 0;
      }

      .prompt-preview {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-md);
        font-family: var(--font-mono);
        font-size: 0.9rem;
        white-space: pre-wrap;
        line-height: 1.6;
        max-height: 400px;
        overflow-y: auto;
      }

      .prompt-preview .variable {
        background: hsla(45, 80%, 50%, 0.2);
        color: hsl(45, 80%, 60%);
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;
      }

      .background-glow {
        position: absolute;
        top: -20%;
        left: -10%;
        width: 50%;
        height: 50%;
        background: radial-gradient(circle, var(--glow-primary) 0%, transparent 70%);
        pointer-events: none;
        z-index: 0;
      }

      .connection-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #f87171;
        color: white;
        padding: var(--space-sm) var(--space-md);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-md);
        z-index: 9998;
        font-size: 0.9rem;
      }

      .connection-banner button {
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 4px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 0.8rem;
      }

      .connection-banner button:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .reconnecting {
        background: #fbbf24;
      }

      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .help-modal {
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-xl);
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
      }

      .help-modal h2 {
        margin: 0 0 var(--space-lg) 0;
        font-size: 1.5rem;
      }

      .help-modal-close {
        position: absolute;
        top: var(--space-md);
        right: var(--space-md);
        background: none;
        border: none;
        color: var(--t-muted);
        font-size: 1.5rem;
        cursor: pointer;
      }

      .markdown-body table {
        border-collapse: collapse;
        width: 100%;
        margin: var(--space-sm) 0;
        font-size: 0.85rem;
      }

      .markdown-body th,
      .markdown-body td {
        border: 1px solid var(--border-glass);
        padding: 6px 10px;
        text-align: left;
      }

      .markdown-body th {
        background: var(--bg-glass);
        font-weight: 600;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--t-muted);
      }

      .markdown-body code {
        background: var(--bg-glass);
        padding: 2px 5px;
        border-radius: 3px;
        font-size: 0.85em;
      }

      .markdown-body pre {
        background: var(--bg-glass);
        padding: var(--space-md);
        border-radius: 8px;
        overflow-x: auto;
      }

      .markdown-body pre code {
        background: none;
        padding: 0;
      }

      .markdown-body hr {
        border: none;
        border-top: 1px solid var(--border-glass);
        margin: var(--space-md) 0;
      }

      .shortcut-section {
        margin-bottom: var(--space-lg);
      }

      .shortcut-section h3 {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--t-muted);
        margin: 0 0 var(--space-sm) 0;
      }

      .shortcut-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }

      .shortcut-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-xs) 0;
      }

      .shortcut-key {
        display: inline-flex;
        gap: 4px;
      }

      .shortcut-key kbd {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: 4px;
        padding: 2px 8px;
        font-family: var(--font-mono);
        font-size: 0.85rem;
      }

      .shortcut-desc {
        color: var(--t-muted);
        font-size: 0.9rem;
      }

      /* Header Toolbar */
      .header-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-md);
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: var(--space-md);
      }

      /* Desktop Action Toolbar */
      .action-toolbar {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
      }

      .toolbar-btn {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        padding: 6px 10px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
        transition: all 0.2s ease;
        white-space: nowrap;
      }

      .toolbar-btn:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .toolbar-btn.icon-only {
        padding: 6px 8px;
      }

      .toolbar-btn.icon-only span.label {
        display: none;
      }

      .toolbar-btn.danger:hover {
        border-color: #f87171;
        color: #f87171;
      }

      .toolbar-btn.active {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
      }

      .toolbar-divider {
        width: 1px;
        height: 24px;
        background: var(--border-glass);
        margin: 0 var(--space-xs);
      }

      .toolbar-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .toolbar-toggle .toggle-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--bg-glass-strong);
        transition: background 0.2s ease;
      }

      .toolbar-toggle .toggle-indicator.active {
        background: var(--accent-primary);
      }

      /* Mobile dropdown toggle */
      .settings-container {
        position: relative;
        display: none;
      }

      .settings-btn {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85rem;
        transition: all 0.2s ease;
      }

      .settings-btn:hover {
        color: var(--t-primary);
        background: var(--bg-glass-strong);
        border-color: var(--accent-primary);
      }

      .settings-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        min-width: 200px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 100;
        overflow: hidden;
      }

      .settings-dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        cursor: pointer;
        color: var(--t-primary);
        font-size: 0.9rem;
        transition: background 0.15s ease;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
      }

      .settings-dropdown-item:hover {
        background: var(--bg-glass);
      }

      .settings-dropdown-item .icon {
        font-size: 1rem;
        width: 20px;
        text-align: center;
      }

      .settings-dropdown-divider {
        height: 1px;
        background: var(--border-glass);
        margin: 4px 0;
      }

      .settings-dropdown-item.toggle {
        justify-content: space-between;
      }

      .toggle-switch {
        width: 36px;
        height: 20px;
        background: var(--bg-glass);
        border-radius: 10px;
        position: relative;
        transition: background 0.2s ease;
      }

      .toggle-switch.active {
        background: var(--accent-primary);
      }

      .toggle-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s ease;
      }

      .toggle-switch.active::after {
        transform: translateX(16px);
      }

      /* Prism.js Syntax Highlighting (One Dark theme) */
      code[class*='language-'],
      pre[class*='language-'] {
        color: #abb2bf;
        text-shadow: none;
      }
      .token.comment,
      .token.prolog,
      .token.doctype,
      .token.cdata {
        color: #5c6370;
        font-style: italic;
      }
      .token.punctuation {
        color: #abb2bf;
      }
      .token.property,
      .token.tag,
      .token.boolean,
      .token.number,
      .token.constant,
      .token.symbol,
      .token.deleted {
        color: #e06c75;
      }
      .token.selector,
      .token.attr-name,
      .token.string,
      .token.char,
      .token.builtin,
      .token.inserted {
        color: #98c379;
      }
      .token.operator,
      .token.entity,
      .token.url,
      .language-css .token.string,
      .style .token.string {
        color: #56b6c2;
      }
      .token.atrule,
      .token.attr-value,
      .token.keyword {
        color: #c678dd;
      }
      .token.function,
      .token.class-name {
        color: #61afef;
      }
      .token.regex,
      .token.important,
      .token.variable {
        color: #d19a66;
      }

      /* Asset Viewer Modal */
      .asset-viewer-modal {
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-xl);
        max-width: 800px;
        width: 90%;
        max-height: 85vh;
        overflow-y: auto;
        position: relative;
      }

      .asset-viewer-modal .close-btn {
        position: absolute;
        top: var(--space-md);
        right: var(--space-md);
        background: none;
        border: none;
        color: var(--t-muted);
        font-size: 1.5rem;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        transition: all 0.15s ease;
      }

      .asset-viewer-modal .close-btn:hover {
        background: var(--bg-glass);
        color: var(--t-primary);
      }

      .asset-viewer-modal h2 {
        margin: 0 0 var(--space-md) 0;
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .asset-viewer-modal h2 .icon {
        font-size: 1.5rem;
      }

      .asset-viewer-modal .description {
        color: var(--t-muted);
        margin-bottom: var(--space-lg);
      }

      /* Variables Form */
      .variables-form {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-md);
        margin-bottom: var(--space-lg);
      }

      .variables-form h4 {
        margin: 0 0 var(--space-md) 0;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--t-muted);
      }

      .variable-input {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        margin-bottom: var(--space-sm);
      }

      .variable-input label {
        min-width: 120px;
        font-family: var(--font-mono);
        font-size: 0.9rem;
        color: hsl(45, 80%, 60%);
      }

      .variable-input input {
        flex: 1;
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        padding: var(--space-sm) var(--space-md);
        color: var(--t-primary);
        font-size: 0.9rem;
      }

      .variable-input input:focus {
        outline: none;
        border-color: var(--accent-primary);
      }

      /* Content Preview */
      .content-section {
        margin-top: var(--space-lg);
      }

      .content-section h4 {
        margin: 0 0 var(--space-sm) 0;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--t-muted);
      }

      .content-preview {
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        padding: var(--space-md);
        font-family: var(--font-mono);
        font-size: 0.85rem;
        white-space: pre-wrap;
        line-height: 1.6;
        max-height: 300px;
        overflow-y: auto;
      }

      .content-preview .var-highlight {
        background: hsla(45, 80%, 50%, 0.2);
        color: hsl(45, 80%, 60%);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .content-preview .var-filled {
        background: hsla(150, 80%, 50%, 0.2);
        color: hsl(150, 80%, 60%);
        padding: 2px 6px;
        border-radius: 4px;
      }

      /* Copy Button */
      .copy-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        border: none;
        padding: var(--space-sm) var(--space-lg);
        border-radius: var(--radius-sm);
        color: white;
        font-weight: 500;
        cursor: pointer;
        margin-top: var(--space-md);
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease;
      }

      .copy-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .resource-image {
        max-width: 100%;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-glass);
      }

      /* ===== Mobile Menu Button ===== */
      .mobile-menu-btn {
        display: none;
        position: fixed;
        top: var(--space-md);
        left: var(--space-md);
        z-index: 1001;
        width: 44px;
        height: 44px;
        border-radius: var(--radius-sm);
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        color: var(--t-primary);
        cursor: pointer;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        transition: all 0.2s;
      }

      .mobile-menu-btn:hover {
        background: var(--bg-glass-strong);
        transform: scale(1.05);
      }

      .mobile-menu-btn.open {
        background: var(--accent-primary);
        color: white;
      }

      /* ===== Sidebar Overlay (mobile) ===== */
      .sidebar-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
        z-index: 999;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .sidebar-overlay.visible {
        opacity: 1;
      }

      /* ===== HTML UI Panel ===== */
      .html-ui-panel {
        min-height: 500px;
        display: flex;
        flex-direction: column;
      }

      .html-ui-panel result-viewer {
        flex: 1;
        margin: 0;
      }

      /* ===== Progress Bar ===== */
      .progress-container {
        margin: var(--space-md) 0;
        padding: var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
      }

      .progress-bar-wrapper {
        height: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
        overflow: hidden;
      }

      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
        border-radius: 4px;
        transition: width 0.3s ease;
      }

      .progress-bar.indeterminate {
        animation: indeterminate 1.5s infinite ease-in-out;
      }

      @keyframes indeterminate {
        0% {
          transform: translateX(-100%);
        }
        50% {
          transform: translateX(200%);
        }
        100% {
          transform: translateX(-100%);
        }
      }

      .progress-text {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: var(--space-sm);
        font-size: 0.85rem;
        color: var(--t-muted);
      }

      .progress-percentage {
        font-weight: 600;
        color: var(--accent-secondary);
      }

      /* ===== Responsive Design ===== */
      @media (max-width: 768px) {
        .mobile-menu-btn {
          display: flex;
        }

        .sidebar-overlay {
          display: block;
          pointer-events: none;
        }

        .sidebar-overlay.visible {
          pointer-events: auto;
        }

        .sidebar-area {
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          width: 85%;
          max-width: 320px;
          margin: 0 !important;
          border-radius: 0 var(--radius-md) var(--radius-md) 0 !important;
          transform: translateX(-100%);
          transition: transform 0.3s ease;
          z-index: 1000;
        }

        .sidebar-area.visible {
          transform: translateX(0);
        }

        .main-area {
          padding: var(--space-md);
          padding-top: calc(var(--space-md) + 60px); /* Space for mobile menu button */
        }

        .photon-header {
          flex-direction: column;
          align-items: flex-start;
          gap: var(--space-md);
        }

        .photon-header-name {
          font-size: 1.5rem;
        }

        .cards-grid {
          grid-template-columns: 1fr;
        }

        /* Touch-friendly targets - min 44px */
        .asset-card,
        .method-card,
        button,
        .filter-btn {
          min-height: 44px;
        }

        .photon-header-meta {
          flex-wrap: wrap;
        }

        /* Responsive toolbar: hide desktop, show mobile dropdown */
        .action-toolbar {
          display: none;
        }

        .settings-container {
          display: block;
        }

        /* Settings dropdown positioning */
        .settings-dropdown {
          right: 0;
          left: auto;
        }

        /* Emoji picker positioning for mobile */
        .emoji-picker {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          max-width: 90vw;
          z-index: 1000;
        }

        /* Help modal adjustments */
        .help-modal {
          padding: var(--space-lg);
          max-height: 85vh;
        }
      }

      @media (max-width: 480px) {
        .main-area {
          padding: var(--space-sm);
          padding-top: calc(var(--space-sm) + 60px);
        }

        .cards-grid {
          gap: var(--space-sm);
        }

        .photon-icon-large {
          width: 48px;
          height: 48px;
          font-size: 20px;
        }

        .photon-header-name {
          font-size: 1.25rem;
        }

        .modal-content,
        .glass-panel {
          max-width: 100%;
          border-radius: var(--radius-sm);
        }

        .help-modal {
          padding: var(--space-md);
          max-height: 90vh;
        }

        /* Section headers more compact */
        .section-header {
          margin-top: var(--space-lg);
          margin-bottom: var(--space-sm);
        }
      }

      /* ===== Animation & Performance Optimization ===== */
      /* Use transform and opacity for GPU-accelerated animations */
      .sidebar-area,
      .mobile-menu-btn,
      .modal-overlay,
      .asset-card,
      .photon-icon-large {
        will-change: transform, opacity;
      }

      /* Remove will-change after animation completes to free GPU memory */
      .sidebar-area:not(.visible),
      .modal-overlay:not(:hover) {
        will-change: auto;
      }

      /* Reduce motion for users who prefer it */
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }

        .sidebar-area {
          transition: none;
        }
      }
    `,
  ];

  @state() private _connected = false;
  @state() private _reconnecting = false;
  @state() private _reconnectAttempt = 0;
  @state() private _sidebarVisible = false;
  @state() private _photons: any[] = [];
  @state() private _externalMCPs: any[] = [];
  @state() private _selectedPhoton: any = null;
  @state() private _view: 'list' | 'form' | 'marketplace' | 'config' | 'diagnostics' | 'mcp-app' = 'list';
  @state() private _welcomePhase: 'welcome' | 'marketplace' = 'welcome';
  @state() private _configMode: 'initial' | 'edit' = 'initial';

  // ... (existing code)

  private _handleInstall(e: CustomEvent) {
    // Just log for now, the socket update 'photon_added' will handle the actual refresh
    this._log('info', `Installed ${e.detail.name}`);
  }

  private _handleMakerAction(e: CustomEvent) {
    const action = e.detail.action;
    // Try maker first, then marketplace for sync/init
    let target = this._photons.find((p) => p.name === 'maker');
    let targetName = 'maker';

    // sync and init moved to marketplace photon
    if (
      (action === 'sync' || action === 'init') &&
      !target?.methods?.find((m: any) => m.name === action)
    ) {
      target = this._photons.find((p) => p.name === 'marketplace');
      targetName = 'marketplace';
    }

    if (!target) {
      this._showError('Photon not found', `${targetName} photon not found`);
      return;
    }

    // Navigate to target photon and select the method
    this._selectedPhoton = target;
    const method = target.methods?.find((m: any) => m.name === action);
    if (method) {
      this._selectedMethod = method;
      this._view = 'form';
      this._updateHash();
      this._log('info', `Starting ${targetName}/${action}...`);
      showToast(`Starting ${action}...`, 'info');
    } else {
      this._showError('Photon not found', `Method '${action}' not found on ${targetName}`);
    }
  }

  /**
   * Collect static methods from all internal photons for global display
   */
  private get _globalStaticMethods(): Array<{ photon: any; method: any }> {
    const results: Array<{ photon: any; method: any }> = [];
    for (const photon of this._photons) {
      if (!photon.internal || !photon.methods) continue;
      for (const method of photon.methods) {
        if (method.isStatic) {
          results.push({ photon, method });
        }
      }
    }
    return results;
  }

  /**
   * Handle clicking a global static method card
   */
  private _handleGlobalMethodSelect(photon: any, method: any) {
    this._teardownActiveCustomUI();
    this._selectedPhoton = photon;
    this._selectedMethod = method;
    this._view = 'form';
    this._updateHash();
    this._maybeAutoInvoke(method);
  }

  @state() private _diagnosticsData: any = null;
  @state() private _testResults: Array<{
    method: string;
    passed: boolean;
    error?: string;
    duration?: number;
  }> = [];
  @state() private _runningTests = false;
  @state() private _selectedMethod: any = null;
  @state() private _lastResult: any = null;
  @state() private _lastFormParams: Record<string, any> = {};
  @state() private _sharedFormParams: Record<string, any> | null = null;
  @state() private _activityLog: any[] = [];
  @state() private _isExecuting = false;
  @state() private _progress: { value: number; message: string } | null = null;
  @state() private _theme: Theme = 'dark';
  @state() private _showHelp = false;
  @state() private _showPhotonHelp = false;
  @state() private _photonHelpMarkdown = '';
  @state() private _photonHelpLoading = false;
  @state() private _elicitationData: ElicitationData | null = null;
  @state() private _showElicitation = false;
  @state() private _protocolMode: 'legacy' | 'mcp' = 'legacy';
  @state() private _selectedMcpAppUri: string | null = null; // Selected tab for MCP Apps with multiple UIs
  @state() private _mcpReady = false;
  @state() private _showSettingsMenu = false;
  @state() private _rememberFormValues = false;
  @state() private _verboseLogging = false;
  @state() private _showSourceModal = false;
  @state() private _sourceData: { path: string; code: string } | null = null;
  @state() private _editingDescription = false;
  @state() private _editingIcon = false;
  @state() private _editedDescription = '';
  @state() private _updatesAvailable: Array<{
    name: string;
    currentVersion: string;
    latestVersion: string;
    marketplace: string;
  }> = [];
  @state() private _selectedPrompt: any = null;
  @state() private _selectedResource: any = null;
  @state() private _promptArguments: Record<string, string> = {};
  @state() private _renderedPrompt: string = '';
  @state() private _resourceContent: string = '';

  @query('beam-sidebar')
  private _sidebar!: BeamSidebar;

  private _pendingBridgeCalls = new Map<string, Window>();

  // File storage for ChatGPT Apps SDK uploadFile/getFileDownloadUrl
  private _uploadedFiles = new Map<string, { data: string; fileName: string; fileType: string }>();
  private _modelContext: any = null;
  private _fileIdCounter = 0;

  // Deep link URL for setOpenInAppUrl
  private _openInAppUrl: string | null = null;

  connectedCallback() {
    super.connectedCallback();

    // Load saved theme preference
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme;
    if (savedTheme === 'light' || savedTheme === 'dark') {
      this._theme = savedTheme;
    }
    this._applyTheme();

    // Load saved protocol preference
    const savedProtocol = localStorage.getItem(PROTOCOL_STORAGE_KEY) as 'legacy' | 'mcp';
    if (savedProtocol === 'mcp') {
      this._protocolMode = 'mcp';
    }

    // Load saved remember values preference
    const savedRemember = localStorage.getItem('beam-remember-values');
    if (savedRemember === 'true') {
      this._rememberFormValues = true;
    }

    // Load saved verbose logging preference
    const savedVerbose = localStorage.getItem('beam-verbose-logging');
    if (savedVerbose === 'true') {
      this._verboseLogging = true;
    }

    // Click outside to close settings menu
    document.addEventListener('click', this._handleDocumentClick);

    // Connect via MCP Streamable HTTP (SSE for notifications)
    this._connectMCP();

    window.addEventListener('hashchange', this._handleHashChange);
    window.addEventListener('message', this._handleBridgeMessage);
    window.addEventListener('keydown', this._handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this._handleHashChange);
    window.removeEventListener('message', this._handleBridgeMessage);
    window.removeEventListener('keydown', this._handleKeydown);
    document.removeEventListener('click', this._handleDocumentClick);
  }

  private _handleDocumentClick = (e: MouseEvent) => {
    const path = e.composedPath();

    if (this._showSettingsMenu) {
      const settingsContainer = this.shadowRoot?.querySelector('.settings-container');
      if (settingsContainer && !path.includes(settingsContainer)) {
        this._showSettingsMenu = false;
      }
    }

    // Close emoji picker when clicking outside
    if (this._editingIcon) {
      const emojiPicker = this.shadowRoot?.querySelector('.emoji-picker');
      const iconElement = this.shadowRoot?.querySelector('.photon-icon-large');
      if (emojiPicker && !path.includes(emojiPicker) && !path.includes(iconElement!)) {
        this._editingIcon = false;
      }
    }
  };

  private async _connectMCP() {
    try {
      mcpClient.on('connect', async () => {
        this._mcpReady = true;
        this._connected = true;
        this._reconnecting = false;
        this._reconnectAttempt = 0;
        console.log('MCP client connected');

        // Load initial photon list
        const tools = await mcpClient.listTools();
        const { photons, externalMCPs } = mcpClient.toolsToPhotons(tools);
        this._photons = photons;
        this._externalMCPs = externalMCPs;

        // Add unconfigured photons from configuration schema
        this._addUnconfiguredPhotons();

        // Check for available updates in background
        this._checkForUpdates();

        // Restore state from hash or select first photon
        if (window.location.hash) {
          this._handleHashChange();
        } else if (!this._selectedPhoton && this._photons.length > 0) {
          const firstUserPhoton = this._photons.find((p) => !p.internal);
          if (firstUserPhoton) this._selectedPhoton = firstUserPhoton;
          this._updateHash();
        }
      });

      mcpClient.on('disconnect', () => {
        this._mcpReady = false;
        this._connected = false;
        this._reconnecting = true;
        this._reconnectAttempt++;
        // Connection status shown via banner, not log
        showToast('Connection lost. Reconnecting...', 'warning');
      });

      mcpClient.on('tools-changed', async () => {
        const prevNames = new Set(this._photons.filter((p) => !p.internal).map((p) => p.name));
        const tools = await mcpClient.listTools();
        const { photons, externalMCPs } = mcpClient.toolsToPhotons(tools);
        this._photons = photons;
        this._externalMCPs = externalMCPs;
        // Re-add unconfigured photons from configuration schema
        this._addUnconfiguredPhotons();
        // Auto-select newly added user photon (welcome wizard flow)
        if (!this._selectedPhoton) {
          const newUserPhoton = this._photons.find(
            (p) => !p.internal && p.configured && !prevNames.has(p.name)
          );
          if (newUserPhoton) {
            this._selectedPhoton = newUserPhoton;
            this._welcomePhase = 'welcome';
            this._view = 'list';
            this._updateHash();
          }
        }
      });

      // Handle configuration schema for unconfigured photons
      mcpClient.on('configuration-available', () => {
        this._addUnconfiguredPhotons();
      });

      mcpClient.on('progress', (data: any) => {
        this._log('info', data.message || 'Processing...');
        // Update progress bar state
        if (typeof data.progress === 'number') {
          // For status events (progress=0 with message), only update if we don't have progress yet
          // or if it's an actual progress update (progress > 0)
          if (data.progress > 0 || !this._progress) {
            this._progress = {
              value: data.total ? data.progress / data.total : data.progress,
              message: data.message || 'Processing...',
            };
          } else if (this._progress && data.message) {
            // Status event - just update message, keep current progress value
            this._progress = {
              ...this._progress,
              message: data.message,
            };
          }
        }
      });

      // Handle toast notifications
      mcpClient.on('toast', (data: any) => {
        if (data?.message) {
          const type = data.type || 'info';
          const duration = data.duration || 3000;
          showToast(data.message, type, duration);
        }
      });

      // Handle thinking indicator
      mcpClient.on('thinking', (data: any) => {
        if (data?.active) {
          // Show thinking state - use progress bar with indeterminate state
          this._progress = {
            value: -1, // -1 indicates indeterminate
            message: 'Processing...',
          };
        } else if (this._progress?.value === -1) {
          // Only clear if we're in thinking state
          this._progress = null;
        }
      });

      // Handle log messages
      mcpClient.on('log', (data: any) => {
        if (data?.message) {
          const level = data.level || 'info';
          this._log(level, data.message);
        }
      });

      // Handle photons list update from SSE
      mcpClient.on('photons', (data: any) => {
        if (data?.photons) {
          const prevNames = new Set(this._photons.filter((p) => !p.internal).map((p) => p.name));
          this._photons = data.photons;
          // Update selected photon if it was in the list
          if (this._selectedPhoton) {
            const updated = this._photons.find((p) => p.name === this._selectedPhoton?.name);
            if (updated) {
              this._selectedPhoton = updated;
            }
          } else {
            // Auto-select newly added user photon (welcome wizard flow)
            const newUserPhoton = this._photons.find(
              (p) => !p.internal && p.configured && !prevNames.has(p.name)
            );
            if (newUserPhoton) {
              this._selectedPhoton = newUserPhoton;
              this._welcomePhase = 'welcome';
              this._view = 'list';
              this._updateHash();
            }
          }
        }
      });

      // Handle hot-reload notifications
      mcpClient.on('hot-reload', (data: any) => {
        if (data?.photon) {
          const reloadedPhoton = data.photon;
          const index = this._photons.findIndex((p) => p.name === reloadedPhoton.name);
          if (index !== -1) {
            this._photons = [
              ...this._photons.slice(0, index),
              reloadedPhoton,
              ...this._photons.slice(index + 1),
            ];
          }

          // Update selected photon if it was reloaded
          if (this._selectedPhoton?.name === reloadedPhoton.name) {
            this._selectedPhoton = reloadedPhoton;

            // Reselect method if it still exists
            if (this._selectedMethod) {
              const updatedMethod = reloadedPhoton.methods?.find(
                (m: any) => m.name === this._selectedMethod.name
              );
              if (updatedMethod) {
                this._selectedMethod = updatedMethod;
              }
            }
          }

          this._log('success', `${reloadedPhoton.name} reloaded`);
          showToast(`${reloadedPhoton.name} reloaded successfully`, 'success');
        }
      });

      // Handle configuration complete notifications
      mcpClient.on('configured', (data: any) => {
        if (data?.photon) {
          const configuredPhoton = data.photon;
          this._log('success', `${configuredPhoton.name} configured successfully`);
          showToast(`${configuredPhoton.name} configured successfully!`, 'success');

          // Update photon in list
          const index = this._photons.findIndex((p) => p.name === configuredPhoton.name);
          if (index !== -1) {
            this._photons = [
              ...this._photons.slice(0, index),
              configuredPhoton,
              ...this._photons.slice(index + 1),
            ];
          }

          // Update selected photon and switch to methods view
          if (this._selectedPhoton?.name === configuredPhoton.name) {
            this._selectedPhoton = configuredPhoton;
            if (configuredPhoton.isApp && configuredPhoton.appEntry) {
              this._selectedMethod = configuredPhoton.appEntry;
              this._view = 'form';
            } else {
              this._view = 'list';
            }
            this._updateHash();
          }
        }
      });

      // Handle elicitation requests
      mcpClient.on('elicitation', (data: any) => {
        if (data) {
          this._elicitationData = data;
          this._showElicitation = true;
          this._log('info', `Input required: ${data.message || data.ask}`);
        }
      });

      // Handle channel events (task-moved, task-updated, etc.) - forward with delta
      mcpClient.on('channel-event', (data: any) => {
        this._forwardToIframes({ type: 'photon:channel-event', ...data });
      });

      // Handle board updates (legacy) - forward to custom UI iframes
      mcpClient.on('board-update', (data: any) => {
        this._forwardToIframes({ type: 'photon:board-update', ...data });
      });

      // Handle refresh-needed (lastEventId too old) - forward to custom UI iframes
      mcpClient.on('refresh-needed', (data: any) => {
        this._forwardToIframes({ type: 'photon:refresh-needed', ...data });
      });

      // MCP Apps standard: forward ui/notifications/tool-result to iframes as JSON-RPC
      mcpClient.on('ui-tool-result', (params: any) => {
        this._forwardToIframes({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params,
        });
      });

      // MCP Apps standard: forward ui/notifications/tool-input-partial to iframes as JSON-RPC
      mcpClient.on('ui-tool-input-partial', (params: any) => {
        this._forwardToIframes({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-input-partial',
          params,
        });
      });

      // MCP Apps standard: forward ui/notifications/tool-input to iframes as JSON-RPC
      mcpClient.on('ui-tool-input', (params: any) => {
        this._forwardToIframes({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-input',
          params,
        });
      });

      // Handle errors
      mcpClient.on('error', (data: any) => {
        if (data?.message) {
          this._isExecuting = false;
          this._log('error', data.message);
          showToast(data.message, 'error', 5000);
        }
      });

      await mcpClient.connect();
    } catch (error) {
      console.error('MCP connection failed:', error);
      this._mcpReady = false;
      this._connected = false;
      this._reconnecting = true;
      // Connection status shown via indicator, not log
      this._showError('Connection lost');
      // Retry connection after a delay
      setTimeout(() => this._connectMCP(), MCP_RECONNECT_DELAY_MS);
    }
  }

  private _handleHashChange = () => {
    const fullHash = window.location.hash.slice(1);
    // Parse hash format: photon/method?param1=value1&param2=value2
    const [pathPart, queryPart] = fullHash.split('?');
    const [photonName, methodName] = pathPart.split('/');

    // Parse query parameters for shared links
    let sharedParams: Record<string, any> = {};
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      for (const [key, value] of params) {
        // Try to parse JSON values (objects, arrays, numbers, booleans)
        try {
          sharedParams[key] = JSON.parse(value);
        } catch {
          sharedParams[key] = value;
        }
      }
    }

    if (photonName) {
      // Look in both photons and external MCPs
      let photon = this._photons.find((p) => p.name === photonName);
      if (!photon) {
        photon = this._externalMCPs.find((p) => p.name === photonName);
      }

      if (photon) {
        this._selectedPhoton = photon;

        // Handle external MCPs with MCP Apps
        if (photon.isExternalMCP && photon.hasMcpApp) {
          this._selectedMethod = null;
          this._view = 'mcp-app';
          return;
        }

        if (methodName && photon.methods) {
          const method = photon.methods.find((m: any) => m.name === methodName);
          if (method) {
            this._selectedMethod = method;
            this._view = 'form';
            // Store shared params to pre-populate form
            if (Object.keys(sharedParams).length > 0) {
              this._sharedFormParams = sharedParams;
            } else {
              // Auto-invoke if no shared params provided
              this._maybeAutoInvoke(method);
            }
          }
        } else if (photon.isApp && photon.appEntry) {
          // For Apps without method specified, auto-select main
          this._selectedMethod = photon.appEntry;
          this._view = 'form';
          // Auto-invoke app entry if it has no required params
          this._maybeAutoInvoke(photon.appEntry);
        } else {
          this._selectedMethod = null;
          this._view = 'list';
        }
      }
    }
  };

  private _updateHash() {
    if (!this._selectedPhoton) return;
    let hash = this._selectedPhoton.name;
    if (this._selectedMethod) {
      hash += `/${this._selectedMethod.name}`;
    }
    // Update URL without scrolling
    history.replaceState(null, '', `#${hash}`);
  }

  /**
   * Add unconfigured photons from configurationSchema to the photons list
   */
  private _addUnconfiguredPhotons() {
    const schema = mcpClient.getConfigurationSchema();
    if (!schema) return;

    // Get names of photons already in list
    const existingNames = new Set(this._photons.map((p) => p.name));

    // Add unconfigured photons that aren't already in the list
    const unconfigured = Object.entries(schema)
      .filter(([name, config]) => !existingNames.has(name) && !config['x-configured'])
      .map(([name, config]) => ({
        id: name,
        name,
        configured: false,
        internal: config['x-internal'],
        methods: [], // Empty methods signals needs setup
        requiredParams: Object.entries(config.properties || {}).map(
          ([key, prop]: [string, any]) => ({
            name: key,
            type: prop.type || 'string',
            format: prop.format,
            default: prop.default,
            required: config.required?.includes(key),
          })
        ),
        errorMessage: config['x-error-message'],
      }));

    if (unconfigured.length > 0) {
      this._photons = [...this._photons, ...unconfigured];
    }
  }

  private _getTestMethods(): string[] {
    if (!this._selectedPhoton?.methods) return [];
    return this._selectedPhoton.methods
      .filter((m: any) => m.name.startsWith('test_') || m.name.startsWith('test'))
      .map((m: any) => m.name);
  }

  private _getAllTestMethods(): Array<{ photon: string; method: string }> {
    const results: Array<{ photon: string; method: string }> = [];
    for (const p of this._photons) {
      if (!p.methods) continue;
      for (const m of p.methods) {
        if (m.name.startsWith('test_') || m.name.startsWith('test')) {
          results.push({ photon: p.name, method: m.name });
        }
      }
    }
    return results;
  }

  private _runTests = async () => {
    if (!this._selectedPhoton || this._runningTests) return;
    const testMethods = this._getTestMethods();
    if (testMethods.length === 0) return;

    this._runningTests = true;
    this._testResults = [];
    this._log('info', `Running ${testMethods.length} test(s) for ${this._selectedPhoton.name}...`);

    for (const testName of testMethods) {
      try {
        const res = await fetch('/api/test/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photon: this._selectedPhoton.name, test: testName }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        const result = await res.json();
        this._testResults = [
          ...this._testResults,
          {
            method: testName,
            passed: result.passed,
            error: result.error,
            duration: result.duration,
          },
        ];
      } catch (error) {
        console.warn('Test fetch failed:', error);
        this._testResults = [
          ...this._testResults,
          {
            method: testName,
            passed: false,
            error: 'Request failed',
          },
        ];
      }
    }

    this._runningTests = false;
    const passed = this._testResults.filter((r) => r.passed).length;
    const total = this._testResults.length;
    showToast(`Tests: ${passed}/${total} passed`, passed === total ? 'success' : 'warning');
    this._log(passed === total ? 'success' : 'error', `Tests: ${passed}/${total} passed`);
  };

  private _runAllTests = async () => {
    const allTests = this._getAllTestMethods();
    if (allTests.length === 0 || this._runningTests) return;

    this._runningTests = true;
    this._testResults = [];
    this._log('info', `Running ${allTests.length} test(s) across all photons...`);

    for (const { photon, method } of allTests) {
      try {
        const res = await fetch('/api/test/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photon, test: method }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        const result = await res.json();
        this._testResults = [
          ...this._testResults,
          {
            method: `${photon}/${method}`,
            passed: result.passed,
            error: result.error,
            duration: result.duration,
          },
        ];
      } catch (error) {
        console.warn('Test fetch failed:', error);
        this._testResults = [
          ...this._testResults,
          {
            method: `${photon}/${method}`,
            passed: false,
            error: 'Request failed',
          },
        ];
      }
    }

    this._runningTests = false;
    const passed = this._testResults.filter((r) => r.passed).length;
    const total = this._testResults.length;
    showToast(`Tests: ${passed}/${total} passed`, passed === total ? 'success' : 'warning');
    this._log(
      passed === total ? 'success' : 'error',
      `All photon tests: ${passed}/${total} passed`
    );
  };

  private _renderDiagnostics() {
    if (!this._diagnosticsData) {
      this._fetchDiagnostics();
      return html`<div style="color: var(--t-muted);">Loading diagnostics...</div>`;
    }

    const d = this._diagnosticsData;
    return html`
      <div
        style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-md); margin-bottom: var(--space-lg);"
      >
        <div class="glass-panel" style="padding: var(--space-md);">
          <div style="font-size: 0.75rem; color: var(--t-muted); text-transform: uppercase;">
            Node
          </div>
          <div style="font-size: 1.1rem; font-weight: 600;">${d.nodeVersion}</div>
        </div>
        <div class="glass-panel" style="padding: var(--space-md);">
          <div style="font-size: 0.75rem; color: var(--t-muted); text-transform: uppercase;">
            Photon
          </div>
          <div style="font-size: 1.1rem; font-weight: 600;">${d.photonVersion}</div>
        </div>
        <div class="glass-panel" style="padding: var(--space-md);">
          <div style="font-size: 0.75rem; color: var(--t-muted); text-transform: uppercase;">
            Uptime
          </div>
          <div style="font-size: 1.1rem; font-weight: 600;">
            ${Math.floor(d.uptime / 60)}m ${Math.floor(d.uptime % 60)}s
          </div>
        </div>
        <div class="glass-panel" style="padding: var(--space-md);">
          <div style="font-size: 0.75rem; color: var(--t-muted); text-transform: uppercase;">
            Sources
          </div>
          <div style="font-size: 1.1rem; font-weight: 600;">${d.marketplaceSources}</div>
        </div>
      </div>

      <h3
        style="color: var(--t-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em; margin-bottom: var(--space-sm);"
      >
        Photons (${d.configuredCount} loaded${d.unconfiguredCount > 0 ? `, ${d.unconfiguredCount} unconfigured` : ''})
      </h3>
      <div class="glass-panel" style="padding: var(--space-md);">
        ${(d.photons || []).map(
          (p: any) => html`
            <div style="padding: 4px 0;">
              <div style="display: flex; align-items: center; gap: var(--space-sm);">
                <span
                  style="width: 10px; height: 10px; border-radius: 50; background: ${p.status ===
                  'loaded'
                    ? '#4ade80'
                    : p.status === 'unconfigured'
                      ? '#fbbf24'
                      : '#f87171'}; flex-shrink: 0;"
                ></span>
                <span style="flex: 1;">${p.name}${p.internal ? html` <span style="color: var(--t-muted); font-size: 0.7rem; font-style: italic;">system</span>` : ''}</span>
                <span style="color: var(--t-muted); font-size: 0.8rem;">${p.methods} methods</span>
                ${p.error
                  ? html`<span style="color: #f87171; font-size: 0.75rem;">${p.error}</span>`
                  : ''}
              </div>
              ${p.path
                ? html`<div style="font-family: monospace; font-size: 0.65rem; color: var(--t-muted); opacity: 0.6; margin-left: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.path.replace(/^\/Users\/[^/]+\/|^\/home\/[^/]+\//, '~/')}</div>`
                : ''}
            </div>
          `
        )}
      </div>

      <h3
        style="color: var(--t-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em; margin-top: var(--space-lg); margin-bottom: var(--space-sm);"
      >
        Test Runner
      </h3>
      ${this._getAllTestMethods().length > 0
        ? html`
            <div class="glass-panel" style="padding: var(--space-md);">
              <div
                style="display: flex; align-items: center; justify-content: space-between; margin-bottom: ${this
                  ._testResults.length > 0
                  ? 'var(--space-md)'
                  : '0'};"
              >
                <span style="color: var(--t-muted); font-size: 0.85rem;">
                  ${this._getAllTestMethods().length} test(s) across
                  ${new Set(this._getAllTestMethods().map((t) => t.photon)).size} photon(s)
                </span>
                <button class="btn-sm" @click=${this._runAllTests} ?disabled=${this._runningTests}>
                  ${this._runningTests ? '⏳ Running...' : '▶ Run All Tests'}
                </button>
              </div>
              ${this._testResults.length > 0
                ? html`
                    ${this._testResults.map(
                      (r) => html`
                        <div
                          style="display: flex; align-items: center; gap: var(--space-sm); padding: 4px 0; font-size: 0.85rem;"
                        >
                          <span>${r.passed ? '✅' : '❌'}</span>
                          <span style="flex: 1; font-family: monospace;">${r.method}</span>
                          ${r.duration != null
                            ? html`<span style="color: var(--t-muted); font-size: 0.75rem;"
                                >${r.duration}ms</span
                              >`
                            : ''}
                          ${r.error
                            ? html`<span style="color: #f87171; font-size: 0.75rem;"
                                >${r.error}</span
                              >`
                            : ''}
                        </div>
                      `
                    )}
                    <div
                      style="margin-top: var(--space-sm); color: var(--t-muted); font-size: 0.8rem;"
                    >
                      ${this._testResults.filter((r) => r.passed).length}/${this._testResults
                        .length}
                      passed
                    </div>
                  `
                : ''}
            </div>
          `
        : html`
            <div
              class="glass-panel"
              style="padding: var(--space-md); color: var(--t-muted); font-size: 0.85rem;"
            >
              No test methods found. Add methods prefixed with
              <code style="background: var(--bg-panel); padding: 2px 6px; border-radius: 4px;"
                >test</code
              >
              to any photon.
            </div>
          `}

      <div style="margin-top: var(--space-md);">
        <button
          class="btn-sm"
          @click=${() => {
            this._diagnosticsData = null;
            this._fetchDiagnostics();
          }}
        >
          🔄 Refresh
        </button>
      </div>
    `;
  }

  private async _fetchDiagnostics() {
    try {
      const res = await fetch('/api/diagnostics', {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        this._diagnosticsData = await res.json();
      }
    } catch (error) {
      console.debug('Diagnostics fetch failed:', error);
    }
  }

  private _showError(error: string, context?: string) {
    let message = error;
    let action: { label: string; callback: () => void } | undefined;

    if (error.includes('Not connected') || error.includes('Connection lost')) {
      message = 'Connection lost. Beam will auto-reconnect, or restart with `photon beam`.';
    } else if (error.includes('not found') || error.includes('Not found')) {
      message = context || 'Photon may have been removed. Try refreshing.';
      action = { label: 'Refresh', callback: () => window.location.reload() };
    } else if (error.includes('Configuration') || error.includes('config')) {
      message = context || error;
      action = { label: 'Reconfigure', callback: () => this._handleReconfigure() };
    } else if (error.includes('Install') || error.includes('install')) {
      message = 'Check marketplace connectivity and try again.';
    } else {
      message = context ? `${error}: ${context}` : error;
    }

    showToast(message, 'error', 5000, action);
  }

  private async _checkForUpdates() {
    try {
      const res = await fetch('/api/marketplace/updates', {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return;
      const data = await res.json();
      this._updatesAvailable = data.updates || [];

      // Mark photons with available updates
      if (this._updatesAvailable.length > 0) {
        this._photons = this._photons.map((p) => {
          const update = this._updatesAvailable.find((u) => u.name === p.name);
          return update ? { ...p, hasUpdate: true } : p;
        });
      }
    } catch (error) {
      console.debug('Update check failed:', error);
    }
  }

  private _log(type: string, message: string, verbose = false) {
    // Skip verbose messages if verbose logging is disabled
    if (verbose && !this._verboseLogging) {
      return;
    }

    // Check if this is a duplicate of the most recent message
    const lastItem = this._activityLog[0];
    if (lastItem && lastItem.message === message && lastItem.type === type) {
      // Increment count on existing item
      this._activityLog = [
        { ...lastItem, count: (lastItem.count || 1) + 1, timestamp: new Date().toISOString() },
        ...this._activityLog.slice(1),
      ];
      return;
    }

    this._activityLog = [
      {
        id: Date.now().toString(),
        type,
        message,
        timestamp: new Date().toISOString(),
        count: 1,
      },
      ...this._activityLog,
    ];
  }

  render() {
    return html`
      ${!this._connected
        ? html`
            <div class="connection-banner ${this._reconnecting ? 'reconnecting' : ''}">
              <div>
                <span
                  >${this._reconnecting
                    ? `Reconnecting to server...${this._reconnectAttempt > 1 ? ` (attempt ${this._reconnectAttempt})` : ''}`
                    : 'Disconnected from server'}</span
                >
                ${this._reconnectAttempt >= 2
                  ? html`<div style="font-size: 0.75rem; opacity: 0.8; margin-top: 2px;">
                      Server may have stopped. Restart:
                      <code
                        style="background: rgba(255,255,255,0.2); padding: 1px 4px; border-radius: 3px;"
                        >photon beam</code
                      >
                    </div>`
                  : ''}
              </div>
              <button @click=${() => this._connect()}>Retry Now</button>
            </div>
          `
        : ''}

      <div class="background-glow"></div>

      <!-- Mobile Menu Button -->
      <button
        class="mobile-menu-btn ${this._sidebarVisible ? 'open' : ''}"
        @click=${this._toggleSidebar}
        aria-label="${this._sidebarVisible ? 'Close menu' : 'Open menu'}"
      >
        ${this._sidebarVisible ? '✕' : '☰'}
      </button>

      <!-- Sidebar Overlay (mobile) -->
      <div
        class="sidebar-overlay ${this._sidebarVisible ? 'visible' : ''}"
        @click=${this._closeSidebar}
      ></div>

      <div
        class="sidebar-area glass-panel ${this._sidebarVisible ? 'visible' : ''}"
        style="margin: var(--space-sm); border-radius: var(--radius-md);"
      >
        <beam-sidebar
          .photons=${this._photons}
          .externalMCPs=${this._externalMCPs}
          .selectedPhoton=${this._selectedPhoton?.name}
          .theme=${this._theme}
          .connected=${this._connected}
          .reconnecting=${this._reconnecting}
          .updatesAvailable=${this._updatesAvailable.length}
          @select=${this._handlePhotonSelectMobile}
          @marketplace=${this._handleMarketplaceMobile}
          @theme-change=${this._handleThemeChange}
          @show-shortcuts=${this._showHelpModal}
          @reconnect-mcp=${this._handleReconnectMCP}
          @diagnostics=${() => {
            this._view = 'diagnostics';
            this._updateHash();
          }}
        ></beam-sidebar>
      </div>

      <main class="main-area" role="main" aria-label="Main content">
        ${this._renderContent()}
        <activity-log
          .items=${this._activityLog}
          @clear=${() => (this._activityLog = [])}
        ></activity-log>
      </main>

      <toast-manager></toast-manager>

      ${this._showHelp ? this._renderHelpModal() : ''}
      ${this._showPhotonHelp ? this._renderPhotonHelpModal() : ''}
      ${this._showSourceModal ? this._renderSourceModal() : ''}
      ${this._selectedPrompt?.content ? this._renderPromptModal() : ''}
      ${this._selectedResource?.content ? this._renderResourceModal() : ''}

      <elicitation-modal
        ?open=${this._showElicitation}
        .data=${this._elicitationData}
        @submit=${this._handleElicitationSubmit}
        @cancel=${this._handleElicitationCancel}
        @oauth-complete=${this._handleOAuthComplete}
      ></elicitation-modal>
    `;
  }

  private _renderContent() {
    if (this._view === 'diagnostics') {
      return html`
        <div style="margin-bottom: var(--space-md);">
          <button
            style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
            @click=${() => (this._view = 'list')}
          >
            ← Back to Dashboard
          </button>
        </div>
        <h1 class="text-gradient">Diagnostics</h1>
        <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">
          Server health and photon status.
        </p>
        ${this._renderDiagnostics()}
      `;
    }

    if (this._view === 'marketplace') {
      const globalMethods = this._globalStaticMethods;

      return html`
        <div style="margin-bottom: var(--space-md);">
          <button
            style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
            @click=${() => (this._view = 'list')}
          >
            ← Back to Dashboard
          </button>
        </div>
        <h1 class="text-gradient">Marketplace</h1>
        <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">
          Discover and install new Photons.
        </p>

        ${globalMethods.length > 0
          ? html`
              <h3
                style="color: var(--t-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em; margin-bottom: var(--space-md);"
              >
                Actions
              </h3>
              <div class="cards-grid" style="margin-bottom: var(--space-xl);">
                ${globalMethods.map(
                  ({ photon, method }) => html`
                    <method-card
                      .method=${method}
                      .photonName=${photon.name}
                      @select=${() => this._handleGlobalMethodSelect(photon, method)}
                    ></method-card>
                  `
                )}
              </div>
            `
          : ''}

        <marketplace-view
          @install=${this._handleInstall}
          @maker-action=${this._handleMakerAction}
        ></marketplace-view>
      `;
    }

    if (!this._selectedPhoton) {
      const userPhotons = this._photons.filter((p) => !p.internal);
      const configuredPhotons = userPhotons.filter((p) => p.configured);
      const unconfiguredPhotons = userPhotons.filter((p) => !p.configured);

      // No user photons at all — show welcome wizard
      if (userPhotons.length === 0) {
        if (this._welcomePhase === 'marketplace') {
          return html`
            <div style="margin-bottom: var(--space-md);">
              <button
                style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                @click=${() => (this._welcomePhase = 'welcome')}
              >
                ← Back to Welcome
              </button>
            </div>
            <h1 class="text-gradient">Marketplace</h1>
            <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">
              Discover and install a photon to get started.
            </p>
            <marketplace-view
              @install=${this._handleInstall}
              @maker-action=${this._handleMakerAction}
            ></marketplace-view>
          `;
        }

        // Phase 1: Welcome screen with two paths
        return html`
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; text-align:center;">
            <h1 class="text-gradient" style="font-size:2rem; margin-bottom: var(--space-sm);">
              Welcome to Photon Beam
            </h1>
            <p style="color: var(--t-muted); font-size: 1.05rem; max-width: 520px; margin: 0 auto var(--space-lg) auto; line-height: 1.6;">
              Photon lets you build and run MCP tools — callable from
              Claude, Cursor, or any AI assistant.
            </p>
            <div style="display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: var(--space-sm); max-width: 580px; width: 100%; margin-bottom: var(--space-xl); align-items: center;">
              <div class="glass-panel" style="padding: var(--space-md); text-align: center;">
                <div style="font-size: 1.2rem; margin-bottom: 4px;">📄</div>
                <div style="font-size: 0.75rem; font-weight: 600;">One .ts file</div>
                <div style="font-size: 0.65rem; color: var(--t-muted); font-family: monospace;">app.photon.ts</div>
              </div>
              <div style="color: var(--t-muted); font-size: 1.2rem;">→</div>
              <div class="glass-panel" style="padding: var(--space-md); text-align: center;">
                <div style="font-size: 1.2rem; margin-bottom: 4px;">⚡</div>
                <div style="font-size: 0.75rem; font-weight: 600;">Methods = Tools</div>
                <div style="font-size: 0.65rem; color: var(--t-muted);">Each method becomes an MCP tool</div>
              </div>
              <div style="color: var(--t-muted); font-size: 1.2rem;">→</div>
              <div class="glass-panel" style="padding: var(--space-md); text-align: center;">
                <div style="font-size: 1.2rem; margin-bottom: 4px;">🤖</div>
                <div style="font-size: 0.75rem; font-weight: 600;">Use anywhere</div>
                <div style="font-size: 0.65rem; color: var(--t-muted);">CLI, Beam, Claude, Cursor</div>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg); max-width: 520px; width:100%;">
              <button
                class="glass-panel"
                style="padding: var(--space-lg); border:1px solid var(--border-glass); cursor:pointer; text-align:center; transition: border-color 0.2s, box-shadow 0.2s;"
                @mouseenter=${(e: Event) => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-primary)'}
                @mouseleave=${(e: Event) => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-glass)'}
                @click=${() => (this._welcomePhase = 'marketplace')}
              >
                <div style="font-size: 2rem; margin-bottom: var(--space-sm);">📦</div>
                <div style="font-weight:600; font-size:1.05rem; margin-bottom: var(--space-xs); color: var(--t-primary);">Browse & Install</div>
                <div style="color: var(--t-muted); font-size: 0.85rem; line-height:1.5;">
                  Install a ready-made photon from the marketplace
                </div>
              </button>
              <button
                class="glass-panel"
                style="padding: var(--space-lg); border:1px solid var(--border-glass); cursor:pointer; text-align:center; transition: border-color 0.2s, box-shadow 0.2s;"
                @mouseenter=${(e: Event) => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-primary)'}
                @mouseleave=${(e: Event) => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-glass)'}
                @click=${() => this._handleMakerAction(new CustomEvent('maker-action', { detail: { action: 'wizard' } }))}
              >
                <div style="font-size: 2rem; margin-bottom: var(--space-sm);">🛠️</div>
                <div style="font-weight:600; font-size:1.05rem; margin-bottom: var(--space-xs); color: var(--t-primary);">Create Your Own</div>
                <div style="color: var(--t-muted); font-size: 0.85rem; line-height:1.5;">
                  Build a custom photon from scratch with the guided wizard
                </div>
              </button>
            </div>
          </div>
        `;
      }

      // Has user photons but none selected — show dashboard overview
      return html`
        <h1 class="text-gradient" style="margin-bottom: var(--space-lg);">
          Welcome to Photon Beam
        </h1>

        <div
          style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-md); margin-bottom: var(--space-lg);"
        >
          <div class="glass-panel" style="padding: var(--space-lg);">
            <h3 style="margin-bottom: var(--space-sm);">Your Photons</h3>
            <p style="color: var(--t-muted); font-size: 0.9rem; margin-bottom: var(--space-sm);">
              ${configuredPhotons.length} configured
              photon${configuredPhotons.length !== 1 ? 's' : ''}
            </p>
            ${configuredPhotons.length > 0
              ? html`<div style="font-size: 0.85rem; color: var(--t-secondary);">
                  ${configuredPhotons
                    .slice(0, 5)
                    .map(
                      (p) => html`<div style="padding: 2px 0;">${p.icon || '⚡'} ${p.name}</div>`
                    )}
                  ${configuredPhotons.length > 5
                    ? html`<div style="color: var(--t-muted);">
                        +${configuredPhotons.length - 5} more
                      </div>`
                    : ''}
                </div>`
              : html`<p style="color: var(--t-muted); font-size: 0.85rem;">
                  No photons configured yet.
                </p>`}
          </div>

          <div class="glass-panel" style="padding: var(--space-lg);">
            <h3 style="margin-bottom: var(--space-sm);">Browse Marketplace</h3>
            <p style="color: var(--t-muted); font-size: 0.9rem; margin-bottom: var(--space-md);">
              Discover and install new photons.
            </p>
            <button class="btn-primary" @click=${() => (this._view = 'marketplace')}>
              Explore
            </button>
          </div>

          <div class="glass-panel" style="padding: var(--space-lg);">
            <h3 style="margin-bottom: var(--space-sm);">Keyboard Shortcuts</h3>
            <p style="color: var(--t-muted); font-size: 0.9rem; margin-bottom: var(--space-sm);">
              Press
              <kbd
                style="padding: 2px 6px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 4px; font-size: 0.85rem;"
                >?</kbd
              >
              to see all shortcuts.
            </p>
          </div>
        </div>

        ${unconfiguredPhotons.length > 0
          ? html`
              <div
                class="glass-panel"
                style="padding: var(--space-lg); border-left: 3px solid hsl(45, 80%, 50%);"
              >
                <h3 style="margin-bottom: var(--space-sm);">Setup Required</h3>
                <p
                  style="color: var(--t-muted); font-size: 0.9rem; margin-bottom: var(--space-sm);"
                >
                  ${unconfiguredPhotons.length}
                  photon${unconfiguredPhotons.length !== 1 ? 's need' : ' needs'} configuration.
                </p>
                <div style="font-size: 0.85rem; color: var(--t-secondary);">
                  ${unconfiguredPhotons.map(
                    (p) =>
                      html`<div
                        style="padding: 2px 0; cursor: pointer;"
                        @click=${() => {
                          this._selectedPhoton = p;
                          this._view = 'config';
                        }}
                      >
                        ⚠️ ${p.name}
                      </div>`
                  )}
                </div>
              </div>
            `
          : ''}
      `;
    }

    // Show configuration view for unconfigured photons or edit mode
    if (this._view === 'config' || this._selectedPhoton.configured === false) {
      const isEditMode = this._selectedPhoton.configured !== false;
      return html`
        ${isEditMode
          ? html`
              <div style="margin-bottom: var(--space-md);">
                <button
                  style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                  @click=${() => (this._view = 'list')}
                >
                  ← Back to ${this._selectedPhoton.name}
                </button>
              </div>
            `
          : ''}
        <div class="glass-panel" style="padding: var(--space-lg); max-width: 600px;">
          <photon-config
            .photon=${this._selectedPhoton}
            .mode=${this._selectedPhoton.configured === false ? 'initial' : this._configMode}
            @configure=${this._handleConfigure}
          ></photon-config>
        </div>
      `;
    }

    // MCP App view for external MCPs with MCP Apps Extension
    if (this._view === 'mcp-app' && this._selectedPhoton.isExternalMCP && this._selectedPhoton.hasMcpApp) {
      const uris = this._selectedPhoton.mcpAppUris?.length > 0
        ? this._selectedPhoton.mcpAppUris
        : [this._selectedPhoton.mcpAppUri];
      const hasMultipleUIs = uris.length > 1;
      // Use selected URI or default to first
      const currentUri = this._selectedMcpAppUri && uris.includes(this._selectedMcpAppUri)
        ? this._selectedMcpAppUri
        : uris[0];

      // Find the linked tool (the one with _meta.ui.resourceUri matching the current URI)
      // This tool provides initial data to the app
      // linkedUi is extracted path (e.g., "mcp-app.html"), mcpAppUri is full URI (e.g., "ui://server/mcp-app.html")
      const linkedMethod = this._selectedPhoton.methods?.find(
        (m: any) => m.linkedUi && currentUri?.endsWith('/' + m.linkedUi)
      );

      // Extract tab name from URI (e.g., "ui://server/dashboard.html" -> "dashboard")
      const getTabName = (uri: string) => {
        const match = uri.match(/\/([^/]+)$/);
        if (match) {
          const filename = match[1];
          // Remove extension and convert to title case
          return filename.replace(/\.(html?|htm)$/i, '').replace(/-/g, ' ');
        }
        return uri;
      };

      return html`
        ${hasMultipleUIs
          ? html`
              <div class="mcp-app-tabs" style="
                display: flex;
                gap: var(--space-xs);
                padding: var(--space-sm) var(--space-md);
                background: var(--bg-glass);
                border-bottom: 1px solid var(--border-glass);
                border-radius: var(--radius-md) var(--radius-md) 0 0;
                margin-bottom: 0;
              ">
                ${uris.map(
                  (uri: string) => html`
                    <button
                      style="
                        padding: var(--space-xs) var(--space-md);
                        background: ${uri === currentUri ? 'var(--accent-primary)' : 'var(--bg-glass)'};
                        color: ${uri === currentUri ? 'white' : 'var(--t-muted)'};
                        border: 1px solid ${uri === currentUri ? 'var(--accent-primary)' : 'var(--border-glass)'};
                        border-radius: var(--radius-sm);
                        cursor: pointer;
                        font-size: 0.85rem;
                        font-weight: 500;
                        text-transform: capitalize;
                        transition: all 0.2s ease;
                      "
                      @click=${() => this._selectMcpAppTab(uri)}
                      title=${uri}
                    >
                      ${getTabName(uri)}
                    </button>
                  `
                )}
              </div>
            `
          : ''}
        <div
          class="glass-panel"
          style="padding: 0; overflow: hidden; min-height: calc(100vh - 80px); ${hasMultipleUIs ? 'border-radius: 0 0 var(--radius-md) var(--radius-md);' : ''}"
        >
          <mcp-app-renderer
            .mcpName=${this._selectedPhoton.name}
            .appUri=${currentUri}
            .linkedTool=${linkedMethod?.name || ''}
            .theme=${this._theme}
            style="height: calc(100vh - ${hasMultipleUIs ? '120px' : '80px'});"
          ></mcp-app-renderer>
        </div>

        ${this._selectedPhoton.methods && this._selectedPhoton.methods.length > 0
          ? html`
              <div
                style="margin-top: var(--space-xl); padding-top: var(--space-xl); border-top: 1px solid var(--border-glass);"
              >
                <h4 style="color: var(--t-secondary); font-size: 0.9rem; margin-bottom: var(--space-md);">
                  Available Tools
                </h4>
                ${this._selectedPhoton.methods.map(
                  (method: any) => html`
                    <method-card
                      .method=${method}
                      .photonName=${this._selectedPhoton.name}
                      .selected=${this._selectedMethod?.name === method.name}
                      @select=${(e: CustomEvent) => {
                        this._selectedMethod = e.detail.method;
                        this._view = 'form';
                        this._updateHash();
                      }}
                    ></method-card>
                  `
                )}
              </div>
            `
          : ''}
      `;
    }

    if (this._view === 'form' && this._selectedMethod) {
      // Check for Linked UI (Custom Interface)
      if (this._selectedMethod.linkedUi) {
        const isAppMain = this._selectedPhoton.isApp && this._selectedMethod.name === 'main';
        const otherMethods = isAppMain
          ? (this._selectedPhoton.methods || []).filter((m: any) => m.name !== 'main')
          : [];

        // External MCPs use mcp-app-renderer (MCP Apps Extension protocol)
        // Internal photons use custom-ui-renderer (photon bridge protocol)
        const isExternalMCP = (this._selectedPhoton as any).isExternalMCP;

        return html`
          ${!isAppMain
            ? html`
                <div style="margin-bottom: var(--space-md);">
                  <button
                    style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                    @click=${() => this._handleBackFromMethod()}
                  >
                    ← Back to ${this._selectedPhoton.internal ? 'Marketplace' : this._selectedPhoton.isApp ? this._selectedPhoton.name : 'Methods'}
                  </button>
                </div>
              `
            : ''}
          <div
            class="glass-panel"
            style="padding: 0; overflow: hidden; min-height: calc(100vh - 80px);"
          >
            ${isExternalMCP
              ? html`
                  <mcp-app-renderer
                    .mcpName=${this._selectedPhoton.name}
                    .appUri=${`ui://${this._selectedPhoton.name}/${this._selectedMethod.linkedUi}`}
                    .linkedTool=${this._selectedMethod.name}
                    .theme=${this._theme}
                    style="height: calc(100vh - 80px);"
                  ></mcp-app-renderer>
                `
              : html`
                  <custom-ui-renderer
                    .photon=${this._selectedPhoton.name}
                    .method=${this._selectedMethod.name}
                    .uiId=${this._selectedMethod.linkedUi}
                    .theme=${this._theme}
                    style="height: calc(100vh - 80px);"
                  ></custom-ui-renderer>
                `}
          </div>

          ${isAppMain && otherMethods.length > 0
            ? html`
                <div
                  style="margin-top: var(--space-xl); padding-top: var(--space-xl); border-top: 1px solid var(--border-glass);"
                >
                  <div
                    style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-lg);"
                  >
                    <div style="display: flex; align-items: center; gap: var(--space-sm);">
                      <span style="font-size: 1.5rem;"
                        >${this._selectedPhoton.appEntry?.icon || '📱'}</span
                      >
                      <h3 style="margin: 0; font-size: 1.2rem; color: var(--t-primary);">
                        ${this._selectedPhoton.name}
                      </h3>
                    </div>
                    ${this._renderActionToolbar({
                      showLaunchApp: true,
                      showReconfigure: false,
                      showRememberValues: false,
                      showRename: false,
                      showViewSource: false,
                      showDelete: false,
                      showRemove: true,
                      showHelp: false,
                      showRunTests: false,
                    })}
                  </div>
                  <h4
                    style="color: var(--t-muted); text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.1em; margin-bottom: var(--space-md);"
                  >
                    Methods
                  </h4>
                  <div class="cards-grid">
                    ${otherMethods.map(
                      (method: any) => html`
                        <method-card
                          .method=${method}
                          .photonName=${this._selectedPhoton.name}
                          @select=${this._handleMethodSelect}
                          @update-metadata=${this._handleMethodMetadataUpdate}
                        ></method-card>
                      `
                    )}
                  </div>
                </div>
              `
            : ''}
        `;
      }

      // Default Form Interface
      const isAppMethod = this._selectedPhoton.isApp && this._selectedPhoton.appEntry;
      const isInternalPhoton = this._selectedPhoton.internal;
      const backLabel = isInternalPhoton
        ? '← Back'
        : isAppMethod
          ? `← Back to ${this._selectedPhoton.name}`
          : '← Back to Methods';

      // For external MCPs, hide photon-specific toolbar actions
      const isExternalMCP = this._selectedPhoton.isExternalMCP;

      return html`
        <div class="header-toolbar">
          <div class="header-left">
            <button
              style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
              @click=${() => this._handleBackFromMethod()}
            >
              ${backLabel}
            </button>
          </div>
          ${this._renderActionToolbar({
            showRefresh: !isExternalMCP,
            showReconfigure: !isExternalMCP,
            showRename: false,
            showViewSource: false,
            showDelete: false,
            showHelp: !isExternalMCP,
          })}
        </div>
        ${this._renderMethodContent()}
      `;
    }

    // For external MCPs, hide photon-specific toolbar actions in list view
    const isExternalMCP = this._selectedPhoton?.isExternalMCP;

    return html`
      <div class="header-toolbar">
        <div class="header-left"></div>
        ${this._renderActionToolbar({
          showRefresh: !isExternalMCP,
          showReconfigure: !isExternalMCP,
          showHelp: !isExternalMCP,
          showRename: !isExternalMCP,
          showViewSource: !isExternalMCP,
          showDelete: !isExternalMCP,
        })}
      </div>

      ${this._renderPhotonHeader()}

      <h3
        style="color: var(--t-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em;"
      >
        Methods
      </h3>
      <div class="cards-grid">
        ${(this._selectedPhoton.methods || []).map(
          (method: any) => html`
            <method-card
              .method=${method}
              .photonName=${this._selectedPhoton.name}
              @select=${this._handleMethodSelect}
              @update-metadata=${this._handleMethodMetadataUpdate}
            ></method-card>
          `
        )}
      </div>

      ${this._testResults.length > 0
        ? html`
            <div class="glass-panel" style="padding: var(--space-md); margin-top: var(--space-md);">
              <h4 style="margin-bottom: var(--space-sm);">Test Results</h4>
              ${this._testResults.map(
                (r) => html`
                  <div
                    style="display: flex; align-items: center; gap: var(--space-sm); padding: 4px 0; font-size: 0.85rem;"
                  >
                    <span>${r.passed ? '✅' : '❌'}</span>
                    <span style="flex: 1;">${r.method}</span>
                    ${r.duration != null
                      ? html`<span style="color: var(--t-muted); font-size: 0.75rem;"
                          >${r.duration}ms</span
                        >`
                      : ''}
                    ${r.error
                      ? html`<span style="color: #f87171; font-size: 0.75rem;">${r.error}</span>`
                      : ''}
                  </div>
                `
              )}
              <div style="margin-top: var(--space-sm); color: var(--t-muted); font-size: 0.8rem;">
                ${this._testResults.filter((r) => r.passed).length}/${this._testResults.length}
                passed
              </div>
            </div>
          `
        : ''}
      ${this._renderPromptsSection()} ${this._renderResourcesSection()}
    `;
  }

  // ===== Mobile Sidebar Methods =====
  private _toggleSidebar() {
    this._sidebarVisible = !this._sidebarVisible;
  }

  private _closeSidebar() {
    this._sidebarVisible = false;
  }

  private _handlePhotonSelectMobile(e: CustomEvent) {
    this._closeSidebar();
    this._handlePhotonSelect(e);
  }

  private _handleMarketplaceMobile() {
    this._closeSidebar();
    this._view = 'marketplace';
  }

  private async _handleReconnectMCP(e: CustomEvent) {
    const { name } = e.detail;
    showToast(`Reconnecting to ${name}...`, 'info');

    const result = await mcpClient.reconnectMCP(name);

    if (result.success) {
      showToast(`Connected to ${name}`, 'success');
      // Refresh tools list to get updated external MCP info
      const tools = await mcpClient.listTools();
      const { photons, externalMCPs } = mcpClient.toolsToPhotons(tools);
      this._photons = photons;
      this._externalMCPs = externalMCPs;
    } else {
      showToast(`Failed to connect: ${result.error}`, 'error');
    }
  }

  /**
   * Select a tab in the MCP App tab bar (for MCPs with multiple UIs)
   */
  private _selectMcpAppTab(uri: string) {
    this._selectedMcpAppUri = uri;
  }

  private _handlePhotonSelect(e: CustomEvent) {
    this._selectedPhoton = e.detail.photon;
    this._selectedMethod = null;
    this._lastResult = null;
    this._selectedMcpAppUri = null; // Reset MCP App tab when switching MCPs

    // For unconfigured photons, show configuration view
    if (this._selectedPhoton.configured === false) {
      this._view = 'config';
      this._updateHash();
      return;
    }

    // For external MCPs with MCP Apps, show the MCP App
    if (this._selectedPhoton.isExternalMCP && this._selectedPhoton.hasMcpApp) {
      this._view = 'mcp-app';
      this._updateHash();
      return;
    }

    // For Apps, automatically select the main method to show Custom UI
    if (this._selectedPhoton.isApp && this._selectedPhoton.appEntry) {
      this._selectedMethod = this._selectedPhoton.appEntry;
      this._view = 'form';
    } else {
      this._view = 'list';
    }
    this._updateHash();
  }

  private _handleMethodSelect(e: CustomEvent) {
    // Teardown any active custom-ui-renderer before switching methods
    this._teardownActiveCustomUI();
    this._selectedMethod = e.detail.method;
    this._lastResult = null;
    this._view = 'form';
    this._updateHash();

    // Auto-invoke if method has autorun or has no required parameters
    this._maybeAutoInvoke(e.detail.method);
  }

  /**
   * Check if method is an HTML UI that should show in minimal "UI mode"
   * (no form controls, just the rendered HTML)
   */
  /**
   * Trigger teardown on any active custom-ui-renderer before switching methods
   */
  private _teardownActiveCustomUI(): void {
    const customRenderer = this.shadowRoot?.querySelector('custom-ui-renderer') as any;
    if (customRenderer?.teardown) {
      customRenderer.teardown().catch(() => {});
    }
    const mcpAppRenderer = this.shadowRoot?.querySelector('mcp-app-renderer') as any;
    if (mcpAppRenderer?.teardown) {
      mcpAppRenderer.teardown().catch(() => {});
    }
  }

  private _isHtmlUiMode(): boolean {
    if (!this._selectedMethod) return false;

    const isHtmlFormat = this._selectedMethod.outputFormat === 'html';
    const hasResult = this._lastResult !== null;

    // Check if method has no required parameters
    const params = this._selectedMethod.params || {};
    const required = params.required || [];
    const properties = params.properties || {};
    const hasNoRequiredParams = required.length === 0 && Object.keys(properties).length === 0;

    return isHtmlFormat && hasResult && hasNoRequiredParams;
  }

  /**
   * Render the method content - either as a minimal HTML UI or full form
   */
  private _renderMethodContent() {
    // HTML UI mode: minimal chrome, just show the interactive content
    if (this._isHtmlUiMode()) {
      return html`
        <div class="glass-panel html-ui-panel" style="padding: 0; overflow: hidden;">
          <result-viewer
            .result=${this._lastResult}
            .outputFormat=${this._selectedMethod?.outputFormat}
            .layoutHints=${this._selectedMethod?.layoutHints}
            .theme=${this._theme}
            @share=${this._handleShareResult}
          ></result-viewer>
        </div>
      `;
    }

    // Standard form mode
    return html`
      <div class="glass-panel" style="padding: var(--space-lg);">
        <h2 style="margin-top:0;">${this._selectedMethod.name}</h2>
        <p style="color: var(--t-muted);">${this._selectedMethod.description}</p>
        <invoke-form
          .params=${this._selectedMethod.params}
          .loading=${this._isExecuting}
          .photonName=${this._selectedPhoton.name}
          .methodName=${this._selectedMethod.name}
          .rememberValues=${this._rememberFormValues}
          .sharedValues=${this._sharedFormParams}
          @submit=${this._handleExecute}
          @cancel=${() => this._handleBackFromMethod()}
        ></invoke-form>

        ${this._progress
          ? html`
              <div class="progress-container">
                <div class="progress-bar-wrapper">
                  <div
                    class="progress-bar ${this._progress.value < 0 ? 'indeterminate' : ''}"
                    style="width: ${this._progress.value < 0
                      ? '30%'
                      : Math.round(this._progress.value * 100) + '%'}"
                  ></div>
                </div>
                <div class="progress-text">
                  <span>${this._progress.message}</span>
                  ${this._progress.value >= 0
                    ? html`
                        <span class="progress-percentage"
                          >${Math.round(this._progress.value * 100)}%</span
                        >
                      `
                    : ''}
                </div>
              </div>
            `
          : ''}
        ${this._lastResult !== null
          ? html`
              <result-viewer
                .result=${this._lastResult}
                .outputFormat=${this._selectedMethod?.outputFormat}
                .layoutHints=${this._selectedMethod?.layoutHints}
                .theme=${this._theme}
                @share=${this._handleShareResult}
              ></result-viewer>
            `
          : ''}
      </div>
    `;
  }

  /**
   * Check if a method should auto-invoke and invoke it if so.
   * Auto-invokes when: method.autorun === true OR method has no required parameters
   */
  private _maybeAutoInvoke(method: any) {
    if (!method || !this._mcpReady) return;

    // Check if method should autorun
    const shouldAutorun = method.autorun === true;

    // Check if method has no required parameters
    const params = method.params || {};
    const required = params.required || [];
    const properties = params.properties || {};
    const hasNoRequiredParams = required.length === 0 && Object.keys(properties).length === 0;

    if (shouldAutorun || hasNoRequiredParams) {
      // Auto-invoke with empty args
      this._handleExecute(new CustomEvent('execute', { detail: { args: {} } }));
    }
  }

  private _handleBackFromMethod() {
    if (this._selectedPhoton.isApp && this._selectedPhoton.appEntry) {
      // For Apps, go back to the main Custom UI and scroll to methods
      this._selectedMethod = this._selectedPhoton.appEntry;
      this._view = 'form';
      this._updateHash();

      // Scroll to methods section after render
      this.updateComplete.then(() => {
        setTimeout(() => {
          const mainArea = this.shadowRoot?.querySelector('.main-area');
          if (mainArea) {
            // Scroll past the Custom UI to show methods
            mainArea.scrollTo({ top: mainArea.scrollHeight, behavior: 'smooth' });
          }
        }, SCROLL_RENDER_DELAY_MS);
      });
    } else if (this._selectedPhoton.internal) {
      // For internal photons, go back to welcome screen
      this._selectedMethod = null;
      this._selectedPhoton = null;
      this._welcomePhase = 'welcome';
      this._view = 'list';
      this._updateHash();
    } else {
      // For regular photons, go back to methods list
      this._view = 'list';
      this._selectedMethod = null;
      this._updateHash();
    }
  }

  private _toggleSettingsMenu = () => {
    this._showSettingsMenu = !this._showSettingsMenu;
  };

  private _closeSettingsMenu = () => {
    this._showSettingsMenu = false;
  };

  private _handleRefresh = async () => {
    this._closeSettingsMenu();
    // Reload the current photon via MCP
    if (this._selectedPhoton && this._mcpReady) {
      showToast(`Reloading ${this._selectedPhoton.name}...`, 'info');
      const result = await mcpClient.reloadPhoton(this._selectedPhoton.name);
      if (!result.success) {
        showToast(result.error || 'Reload failed', 'error');
      }
    }
  };

  private _launchAsApp = () => {
    this._closeSettingsMenu();
    if (this._selectedPhoton) {
      window.open(`/api/pwa/app?photon=${encodeURIComponent(this._selectedPhoton.name)}`, '_blank');
    }
  };

  private _handleRemove = async () => {
    this._closeSettingsMenu();
    if (this._selectedPhoton && this._mcpReady) {
      if (confirm(`Remove ${this._selectedPhoton.name} from this workspace?`)) {
        const result = await mcpClient.removePhoton(this._selectedPhoton.name);
        if (!result.success) {
          showToast(result.error || 'Remove failed', 'error');
        }
      }
    }
  };

  private _handleCopyMCPConfig = async () => {
    if (!this._selectedPhoton) return;
    try {
      const res = await fetch(
        `/api/export/mcp-config?photon=${encodeURIComponent(this._selectedPhoton.name)}`,
        {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }
      );
      if (!res.ok) throw new Error('Failed to fetch config');
      const config = await res.json();
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      showToast('MCP config copied — paste into Claude Desktop settings', 'success');
    } catch (error) {
      console.warn('Copy MCP config failed:', error);
      showToast('Failed to copy MCP config', 'error');
    }
  };

  private _handleUpgrade = async () => {
    if (!this._selectedPhoton) return;
    const name = this._selectedPhoton.name;
    showToast(`Upgrading ${name}...`, 'info');

    try {
      const res = await fetch('/api/marketplace/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) throw new Error('Upgrade failed');
      const result = await res.json();

      showToast(`${name} upgraded${result.version ? ` to ${result.version}` : ''}`, 'success');

      // Clear hasUpdate flag
      this._photons = this._photons.map((p) => (p.name === name ? { ...p, hasUpdate: false } : p));
      this._updatesAvailable = this._updatesAvailable.filter((u) => u.name !== name);
      if (this._selectedPhoton?.name === name) {
        this._selectedPhoton = { ...this._selectedPhoton, hasUpdate: false };
      }
    } catch (error) {
      console.warn('Upgrade failed:', error);
      showToast(
        `Failed to upgrade ${name}. Check marketplace connectivity and try again.`,
        'error'
      );
    }
  };

  private _handleReconfigure = () => {
    this._closeSettingsMenu();
    this._configMode = this._selectedPhoton?.configured ? 'edit' : 'initial';

    // Populate requiredParams from configurationSchema if not already present
    if (this._selectedPhoton && !this._selectedPhoton.requiredParams?.length) {
      const schema = mcpClient.getConfigurationSchema();
      const photonSchema = schema?.[this._selectedPhoton.name];
      if (photonSchema?.properties) {
        this._selectedPhoton = {
          ...this._selectedPhoton,
          requiredParams: Object.entries(photonSchema.properties).map(
            ([key, prop]: [string, any]) => ({
              name: key,
              type: prop.type || 'string',
              format: prop.format,
              default: prop.default,
              required: photonSchema.required?.includes(key),
            })
          ),
        };
      }
    }

    this._view = 'config';
    this._updateHash();
  };

  private _toggleRememberValues = () => {
    this._rememberFormValues = !this._rememberFormValues;
    localStorage.setItem('beam-remember-values', String(this._rememberFormValues));
    showToast(
      this._rememberFormValues
        ? 'Form values will be remembered'
        : 'Form values will not be remembered',
      'info'
    );
  };

  private _toggleVerboseLogging = () => {
    this._verboseLogging = !this._verboseLogging;
    localStorage.setItem('beam-verbose-logging', String(this._verboseLogging));
    showToast(
      this._verboseLogging ? 'Verbose logging enabled' : 'Verbose logging disabled',
      'info'
    );
  };

  // Maker instance method handlers - operate on the current photon
  private _handleRenamePhoton = () => {
    this._closeSettingsMenu();
    const currentName = this._selectedPhoton?.name || '';
    const newName = prompt(`Enter new name for "${currentName}":`, currentName);
    if (newName && newName !== currentName) {
      this._invokeMakerMethod('rename', { name: newName });
    }
  };

  private _handleViewSource = async () => {
    this._closeSettingsMenu();

    const maker = this._photons.find((p) => p.name === 'maker');
    if (!maker) {
      this._showError('Photon not found', 'Maker photon not available');
      return;
    }

    const photonPath = this._selectedPhoton?.path;
    if (!photonPath) {
      showToast('Photon path not available', 'error');
      return;
    }

    if (this._mcpReady) {
      try {
        const result = await mcpClient.callTool('maker/source', { photonPath });
        if (result.isError) {
          const errorText =
            result.content.find((c: any) => c.type === 'text')?.text || 'Failed to load source';
          showToast(errorText, 'error');
        } else {
          const data = mcpClient.parseToolResult(result);
          if (data && data.code) {
            this._sourceData = data;
            this._showSourceModal = true;
          } else {
            showToast('No source code returned', 'error');
          }
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to load source', 'error');
      }
    }
  };

  private _handleDeletePhoton = () => {
    this._closeSettingsMenu();
    if (
      confirm(
        `Are you sure you want to delete "${this._selectedPhoton?.name}"? This cannot be undone.`
      )
    ) {
      this._invokeMakerMethod('delete');
    }
  };

  private async _invokeMakerMethod(methodName: string, additionalArgs: Record<string, any> = {}) {
    // Find maker photon
    const maker = this._photons.find((p) => p.name === 'maker');
    if (!maker) {
      this._showError('Photon not found', 'Maker photon not available');
      return;
    }

    // Invoke the maker method with the current photon's path
    const photonPath = this._selectedPhoton?.path;
    if (!photonPath) {
      showToast('Photon path not available', 'error');
      return;
    }

    this._log('info', `Invoking maker.${methodName} on ${this._selectedPhoton?.name}...`, true);

    // Use MCP to invoke the maker method
    if (this._mcpReady) {
      try {
        const toolName = `maker/${methodName}`;
        const result = await mcpClient.callTool(toolName, { photonPath, ...additionalArgs });

        if (result.isError) {
          const errorText = result.content.find((c) => c.type === 'text')?.text || 'Unknown error';
          this._log('error', errorText);
          showToast(errorText, 'error', 5000);
        } else {
          const data = mcpClient.parseToolResult(result);
          this._log('success', `maker.${methodName} completed`);
          // Handle result if needed
          if (methodName === 'source' && data) {
            // Show source in a new window or modal
            console.log('Source:', data);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this._log('error', message);
        showToast(message, 'error', 5000);
      }
    }
  }

  private async _handleExecute(e: CustomEvent) {
    const args = e.detail.args;
    this._lastFormParams = args; // Store for sharing
    this._sharedFormParams = null; // Clear shared params after use
    this._log('info', `Invoking ${this._selectedMethod.name}...`, true);
    this._lastResult = null;
    this._isExecuting = true;
    this._progress = null;

    // Use MCP for all tool invocations
    if (this._mcpReady) {
      try {
        const toolName = `${this._selectedPhoton.name}/${this._selectedMethod.name}`;
        const result = await mcpClient.callTool(toolName, args);

        if (result.isError) {
          const errorText = result.content.find((c) => c.type === 'text')?.text || 'Unknown error';
          this._log('error', errorText);
          showToast(errorText, 'error', 5000);
        } else {
          this._lastResult = mcpClient.parseToolResult(result);
          this._log('success', 'Execution completed');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this._log('error', message);
        showToast(message, 'error', 5000);
      } finally {
        this._isExecuting = false;
        this._progress = null;
      }
    } else {
      this._log('error', 'Not connected to server');
      this._showError('Not connected');
      this._isExecuting = false;
      this._progress = null;
    }
  }

  private async _handleConfigure(e: CustomEvent) {
    const { photon, config } = e.detail;
    this._log('info', `Configuring ${photon}...`);

    if (this._mcpReady) {
      const result = await mcpClient.configurePhoton(photon, config);
      if (!result.success) {
        this._log('error', result.error || 'Configuration failed');
        this._showError('Configuration failed', result.error);
      }
      // Success notification will come via SSE beam/configured
    } else {
      this._log('error', 'Not connected to server');
      this._showError('Not connected');
    }
  }
  /**
   * Forward a message to all custom-ui-renderer iframes
   */
  private _forwardToIframes(message: any): void {
    const iframes: HTMLIFrameElement[] = [];
    this.shadowRoot?.querySelectorAll('custom-ui-renderer').forEach((renderer) => {
      const iframe = renderer.shadowRoot?.querySelector('iframe');
      if (iframe) iframes.push(iframe);
    });
    this.shadowRoot?.querySelectorAll('iframe').forEach((iframe) => iframes.push(iframe));
    iframes.forEach((iframe) => {
      iframe.contentWindow?.postMessage(message, '*');
    });
  }

  private _handleBridgeMessage = async (event: MessageEvent) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    // MCP Apps standard: JSON-RPC tools/call from iframes
    if (msg.jsonrpc === '2.0' && msg.method === 'tools/call' && msg.id != null) {
      if (this._selectedPhoton && this._mcpReady) {
        const toolName = `${this._selectedPhoton.name}/${msg.params?.name}`;
        try {
          const mcpResult = await mcpClient.callTool(toolName, msg.params?.arguments || {});
          if (mcpResult.isError) {
            const errorText =
              mcpResult.content?.find((c) => c.type === 'text')?.text || 'Tool call failed';
            if (event.source) {
              (event.source as Window).postMessage(
                { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: errorText } },
                '*'
              );
            }
          } else {
            // For external MCPs (MCP Apps Extension), return full CallToolResult format
            // For internal photons with custom UI, parse to just the data for backwards compatibility
            const isExternalMCP = (this._selectedPhoton as any).isExternalMCP;
            const result = isExternalMCP
              ? {
                  content: mcpResult.content || [],
                  structuredContent: mcpResult.structuredContent,
                  isError: mcpResult.isError ?? false,
                }
              : mcpClient.parseToolResult(mcpResult);

            if (event.source) {
              (event.source as Window).postMessage(
                { jsonrpc: '2.0', id: msg.id, result },
                '*'
              );
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (event.source) {
            (event.source as Window).postMessage(
              {
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32000, message: errorMessage },
              },
              '*'
            );
          }
        }
      }
    }

    // MCP Apps standard: JSON-RPC ui/update-model-context from iframes
    if (msg.jsonrpc === '2.0' && msg.method === 'ui/update-model-context' && msg.id != null) {
      // Store model context for future conversation turns
      this._modelContext = msg.params || null;
      if (event.source) {
        (event.source as Window).postMessage({ jsonrpc: '2.0', id: msg.id, result: {} }, '*');
      }
    }

    // MCP Apps standard: JSON-RPC ui/ready from iframes (acknowledgement)
    if (msg.jsonrpc === '2.0' && msg.method === 'ui/ready') {
      // iframe bridge is ready — no action needed
    }

    // Handle app state persistence
    if (msg.type === 'photon:set-state') {
      if (this._selectedPhoton && this._selectedMethod) {
        const stateKey = `beam-app-state:${this._selectedPhoton.name}:${this._selectedMethod.name}`;
        try {
          localStorage.setItem(stateKey, JSON.stringify(msg.state));
        } catch (e) {
          console.warn('Failed to persist app state:', e);
        }
      }
    }

    // Handle request for persisted state
    if (msg.type === 'photon:get-state') {
      if (this._selectedPhoton && this._selectedMethod && event.source) {
        const stateKey = `beam-app-state:${this._selectedPhoton.name}:${this._selectedMethod.name}`;
        try {
          const savedState = localStorage.getItem(stateKey);
          const state = savedState ? JSON.parse(savedState) : null;
          (event.source as Window).postMessage(
            {
              type: 'photon:init-state',
              state,
            },
            '*'
          );
        } catch (e) {
          console.warn('Failed to load app state:', e);
        }
      }
    }

    // Handle custom UI notifying what resource it's viewing
    // This enables on-demand channel subscriptions
    // photonId: hash of photon path (from selected photon)
    // itemId: whatever the photon uses to identify the item (e.g., board name)
    if (msg.type === 'photon:viewing') {
      const photonId = this._selectedPhoton?.id;
      const itemId = msg.itemId || msg.board; // Support both new and legacy field names
      if (photonId && itemId) {
        mcpClient.notifyViewing(photonId, itemId);
      }
    }

    // ChatGPT Apps SDK: uploadFile
    if (msg.type === 'photon:upload-file' && event.source) {
      const callId = msg.callId;
      const fileId = `file_${++this._fileIdCounter}_${Date.now()}`;

      // Store the file data
      this._uploadedFiles.set(fileId, {
        data: msg.data,
        fileName: msg.fileName,
        fileType: msg.fileType,
      });

      // Send response
      (event.source as Window).postMessage(
        { type: 'photon:upload-file-response', callId, fileId },
        '*'
      );
    }

    // ChatGPT Apps SDK: getFileDownloadUrl
    if (msg.type === 'photon:get-file-url' && event.source) {
      const callId = msg.callId;
      const file = this._uploadedFiles.get(msg.fileId);

      if (file) {
        // The file.data is already a data URL from FileReader.readAsDataURL
        (event.source as Window).postMessage(
          { type: 'photon:get-file-url-response', callId, url: file.data },
          '*'
        );
      } else {
        (event.source as Window).postMessage(
          { type: 'photon:get-file-url-response', callId, error: 'File not found' },
          '*'
        );
      }
    }

    // ChatGPT Apps SDK: requestModal
    if (msg.type === 'photon:request-modal' && event.source) {
      const callId = msg.callId;

      // For now, show a simple elicitation modal with the template as message
      // In the future, this could render custom modal templates
      this._elicitationData = {
        type: 'confirm',
        message: msg.template || 'Modal Request',
        elicitationId: callId,
        ...msg.params,
      } as ElicitationData;
      this._showElicitation = true;

      // Store the source window to respond later
      this._pendingBridgeCalls.set(callId, event.source as Window);
    }

    // ChatGPT Apps SDK: setOpenInAppUrl
    if (msg.type === 'photon:set-open-in-app-url') {
      this._openInAppUrl = msg.href;
      this._log('info', `Open-in-app URL set: ${msg.href}`);
    }

    // Handle display mode request
    if (msg.type === 'photon:request-display-mode') {
      // For now, just log it - could implement fullscreen/pip in future
      this._log('info', `Display mode requested: ${msg.mode}`);
    }

    // Handle height notification
    if (msg.type === 'photon:notify-height') {
      // Could be used to adjust iframe height dynamically
      this._log('debug', `Custom UI height notification: ${msg.height}px`);
    }
  };

  // ===== Share Result Link =====
  private _handleShareResult() {
    if (!this._selectedPhoton || !this._selectedMethod) {
      showToast('No method selected to share', 'error');
      return;
    }

    // Build shareable URL with hash and query params
    const baseUrl = window.location.origin + window.location.pathname;
    const hash = `${this._selectedPhoton.name}/${this._selectedMethod.name}`;

    // Encode form parameters as query string
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(this._lastFormParams)) {
      if (value !== undefined && value !== null && value !== '') {
        // Handle objects/arrays by JSON encoding
        if (typeof value === 'object') {
          params.set(key, JSON.stringify(value));
        } else {
          params.set(key, String(value));
        }
      }
    }

    let shareUrl = `${baseUrl}#${hash}`;
    if (params.toString()) {
      shareUrl += `?${params.toString()}`;
    }

    // Copy to clipboard
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        showToast('Share link copied to clipboard', 'success');
      })
      .catch(() => {
        // Fallback: show URL in prompt
        prompt('Copy this link to share:', shareUrl);
      });
  }

  private _handleThemeChange = (e: CustomEvent) => {
    const newTheme = e.detail.theme as Theme;
    this._theme = newTheme;
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    this._applyTheme();
    this._broadcastThemeToIframes();
  };

  private _handleElicitationSubmit = async (e: CustomEvent) => {
    const { value } = e.detail;
    const elicitationId = (this._elicitationData as any)?.elicitationId;

    this._showElicitation = false;
    this._elicitationData = null;

    // Check if this is a ChatGPT SDK modal request
    const pendingWindow = elicitationId ? this._pendingBridgeCalls.get(elicitationId) : null;
    if (pendingWindow) {
      this._pendingBridgeCalls.delete(elicitationId);
      pendingWindow.postMessage(
        { type: 'photon:request-modal-response', callId: elicitationId, result: value },
        '*'
      );
      return;
    }

    if (elicitationId && this._mcpReady) {
      const result = await mcpClient.sendElicitationResponse(elicitationId, value);
      if (result.success) {
        this._log('info', 'Input submitted');
      } else {
        this._log('error', 'Failed to submit input');
        showToast('Failed to submit input', 'error');
      }
    } else {
      this._log('info', 'Input submitted');
    }
  };

  private _handleElicitationCancel = async () => {
    const elicitationId = (this._elicitationData as any)?.elicitationId;

    this._showElicitation = false;
    this._elicitationData = null;
    this._isExecuting = false;

    // Check if this is a ChatGPT SDK modal request
    const pendingWindow = elicitationId ? this._pendingBridgeCalls.get(elicitationId) : null;
    if (pendingWindow) {
      this._pendingBridgeCalls.delete(elicitationId);
      pendingWindow.postMessage(
        { type: 'photon:request-modal-response', callId: elicitationId, error: 'User cancelled' },
        '*'
      );
      return;
    }

    if (elicitationId && this._mcpReady) {
      await mcpClient.sendElicitationResponse(elicitationId, null, true);
    }

    this._log('info', 'Input cancelled');
    showToast('Input cancelled', 'info');
  };

  private _handleOAuthComplete = async (e: CustomEvent) => {
    const { elicitationId, success } = e.detail;
    // OAuth completion is handled by the auth service callback
    // The elicitation UI just needs to close and show status
    this._showElicitation = false;
    this._elicitationData = null;
    if (success) {
      this._log('success', 'Authorization completed');
      showToast('Authorization completed', 'success');
    }
  };

  private _applyTheme() {
    this.setAttribute('data-theme', this._theme);
  }

  private _broadcastThemeToIframes() {
    const themeTokens = getThemeTokens(this._theme);

    // Find custom-ui-renderer components and notify their iframes
    const renderers = this.shadowRoot?.querySelectorAll('custom-ui-renderer');
    renderers?.forEach((renderer) => {
      const shadowRoot = (renderer as any).shadowRoot;
      const iframe = shadowRoot?.querySelector('iframe');
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: 'photon:theme-change',
            theme: this._theme,
            themeTokens: themeTokens,
          },
          '*'
        );
      }
    });

    // Also check for any direct iframes (fallback)
    const iframes = this.shadowRoot?.querySelectorAll('iframe');
    iframes?.forEach((iframe) => {
      iframe.contentWindow?.postMessage(
        {
          type: 'photon:theme-change',
          theme: this._theme,
          themeTokens: themeTokens,
        },
        '*'
      );
    });
  }

  private _handleKeydown = (e: KeyboardEvent) => {
    // Skip if typing in an input field (unless it's a special key combo)
    // Check both composedPath() and activeElement for nested shadow DOM support
    const path = e.composedPath();
    let isInput = path.some((el) => {
      if (el instanceof HTMLElement) {
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
      }
      return false;
    });

    // Also check activeElement through shadow DOM chain as a fallback
    if (!isInput) {
      let activeEl: Element | null = document.activeElement;
      while (activeEl) {
        const tag = activeEl.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          isInput = true;
          break;
        }
        // Traverse into shadow DOM if present
        activeEl = (activeEl as any).shadowRoot?.activeElement || null;
      }
    }

    // Ctrl/Cmd+K or / to focus search
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !isInput)) {
      e.preventDefault();
      this._sidebar?.focusSearch();
      return;
    }

    // Escape to close modals or clear
    if (e.key === 'Escape') {
      if (this._sidebarVisible) {
        this._closeSidebar();
        return;
      }
      if (this._showHelp) {
        this._showHelp = false;
        return;
      }
      if (this._showPhotonHelp) {
        this._showPhotonHelp = false;
        return;
      }
      if (this._showSourceModal) {
        this._closeSourceModal();
        return;
      }
      if (this._view === 'form' && this._selectedMethod) {
        this._handleBackFromMethod();
        return;
      }
      if (this._view === 'marketplace') {
        this._view = 'list';
        return;
      }
    }

    // Skip other shortcuts if in input
    if (isInput) return;

    // ? to show help
    if (e.key === '?' && e.shiftKey) {
      this._showHelp = !this._showHelp;
      return;
    }

    // t to toggle theme
    if (e.key === 't') {
      const newTheme = this._theme === 'dark' ? 'light' : 'dark';
      this._theme = newTheme;
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      this._applyTheme();
      this._broadcastThemeToIframes();
      showToast(`Theme: ${newTheme}`, 'info');
      return;
    }

    // p to show marketplace
    if (e.key === 'p') {
      this._view = 'marketplace';
      return;
    }

    // f to toggle favorites filter
    if (e.key === 'f') {
      this._sidebar?.toggleFavoritesFilter();
      const isActive = this._sidebar?.isFavoritesFilterActive();
      showToast(isActive ? 'Showing favorites only' : 'Showing all photons', 'info');
      return;
    }

    // h to go back
    if (e.key === 'h') {
      if (this._view === 'form') {
        this._handleBackFromMethod();
      } else if (this._view === 'marketplace') {
        this._view = 'list';
      }
      return;
    }

    // [ and ] to navigate photons
    if (e.key === '[' || e.key === ']') {
      const photons = this._sidebar?.getAllPhotons() || this._photons;
      if (photons.length === 0) return;

      const currentIndex = this._selectedPhoton
        ? photons.findIndex((p) => p.name === this._selectedPhoton.name)
        : -1;

      let newIndex: number;
      if (e.key === '[') {
        newIndex = currentIndex <= 0 ? photons.length - 1 : currentIndex - 1;
      } else {
        newIndex = currentIndex >= photons.length - 1 ? 0 : currentIndex + 1;
      }

      const newPhoton = photons[newIndex];
      if (newPhoton) {
        this._handlePhotonSelect(new CustomEvent('select', { detail: { photon: newPhoton } }));
      }
      return;
    }

    // j/k or arrows to navigate methods
    if (
      (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') &&
      this._view === 'list'
    ) {
      const methods = this._selectedPhoton?.methods || [];
      if (methods.length === 0) return;

      const currentIndex = this._selectedMethod
        ? methods.findIndex((m: any) => m.name === this._selectedMethod.name)
        : -1;

      let newIndex: number;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        newIndex = currentIndex >= methods.length - 1 ? 0 : currentIndex + 1;
      } else {
        newIndex = currentIndex <= 0 ? methods.length - 1 : currentIndex - 1;
      }

      this._selectedMethod = methods[newIndex];
      // Highlight but don't navigate to form
      return;
    }

    // Enter to select highlighted method
    if (e.key === 'Enter' && this._selectedMethod && this._view === 'list') {
      this._view = 'form';
      this._updateHash();
      return;
    }

    // r to reload/re-execute
    if (e.key === 'r') {
      if (this._view === 'form' && this._selectedMethod && this._lastResult !== null) {
        // Re-execute last method (would need form data - skip for now)
        showToast('Press Ctrl+Enter in form to re-execute', 'info');
      }
      return;
    }
  };

  private _closeHelp() {
    this._showHelp = false;
  }

  private _showHelpModal = () => {
    this._closeSettingsMenu();
    this._showHelp = true;
  };

  private _showPhotonHelpModal = async () => {
    this._closeSettingsMenu();
    this._photonHelpMarkdown = '';
    this._photonHelpLoading = true;
    this._showPhotonHelp = true;

    if (this._selectedPhoton) {
      const markdown = await mcpClient.getPhotonHelp(this._selectedPhoton.name);
      if (markdown) {
        this._photonHelpMarkdown = markdown;
      } else {
        // Fallback to client-side generation
        this._photonHelpMarkdown = this._generatePhotonHelpMarkdown();
      }
      this._photonHelpLoading = false;
    }
  };

  private _closePhotonHelp() {
    this._showPhotonHelp = false;
  }

  private _generatePhotonHelpMarkdown(): string {
    if (!this._selectedPhoton) return '';

    const photon = this._selectedPhoton;
    const name = photon.name;
    const displayName = photon.label || name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const lines: string[] = [];

    // Header with icon
    const icon = photon.icon ? `${photon.icon} ` : '';
    lines.push(`# ${icon}${displayName}`);
    lines.push('');

    // Badges
    const badges: string[] = [];
    if (photon.internal) badges.push('`System`');
    if (photon.isApp) badges.push('`App`');
    if (badges.length > 0) {
      lines.push(badges.join(' '));
      lines.push('');
    }

    if (photon.description) {
      lines.push(photon.description);
      lines.push('');
    }

    // Installation — the most important section
    if (!photon.internal) {
      lines.push('## Install');
      lines.push('');
      lines.push('Use this photon as an MCP server in one step:');
      lines.push('');
      lines.push('```bash');
      lines.push(`npx @portel/photon mcp ${name}`);
      lines.push('```');
      lines.push('');
      lines.push('That\'s it — no prior setup needed. Photon auto-installs from the marketplace and prompts for any missing configuration.');
      lines.push('');
      if (photon.installSource?.marketplace) {
        lines.push(`From a custom marketplace: \`npx @portel/photon mcp ${photon.installSource.marketplace}:${name}\``);
        lines.push('');
      }
      lines.push('Or add to your MCP client config (Claude Desktop, Cursor, etc.):');
      lines.push('');
      lines.push('```json');
      lines.push(`"${name}": {`);
      lines.push(`  "command": "npx",`);
      lines.push(`  "args": ["@portel/photon", "mcp", "${name}"]`);
      lines.push(`}`);
      lines.push('```');
      lines.push('');
    }

    // Methods (Tools)
    if (photon.methods && photon.methods.length > 0) {
      lines.push('## Methods');
      lines.push('');

      for (const method of photon.methods) {
        lines.push(`### ${method.name}`);
        lines.push('');
        if (method.description) {
          lines.push(method.description);
          lines.push('');
        }

        // Parameters
        if (method.params && method.params.length > 0) {
          lines.push('| Name | Type | Required | Description |');
          lines.push('|------|------|----------|-------------|');
          for (const param of method.params) {
            const required = param.required ? '✓' : '';
            const desc = param.description || '-';
            lines.push(`| \`${param.name}\` | ${param.type || 'any'} | ${required} | ${desc} |`);
          }
          lines.push('');
        }

        // CLI usage for this method
        if (!photon.internal) {
          const paramHints = (method.params || [])
            .filter((p: any) => p.required)
            .map((p: any) => `--${p.name} <${p.type || 'value'}>`)
            .join(' ');
          lines.push(`CLI: \`photon cli ${name} ${method.name}${paramHints ? ' ' + paramHints : ''}\``);
          lines.push('');
        }

        // Return type
        if (method.returnType) {
          lines.push(`**Returns:** \`${method.returnType}\``);
          lines.push('');
        }
      }
    }

    // Prompts
    if (photon.prompts && photon.prompts.length > 0) {
      lines.push('## Prompts');
      lines.push('');
      for (const prompt of photon.prompts) {
        lines.push(`- **${prompt.name}**: ${prompt.description || 'No description'}`);
      }
      lines.push('');
    }

    // Resources
    if (photon.resources && photon.resources.length > 0) {
      lines.push('## Resources');
      lines.push('');
      for (const resource of photon.resources) {
        lines.push(
          `- **${resource.name}** (\`${resource.uri || '-'}\`): ${resource.description || 'No description'}`
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Renders the action toolbar for both desktop (inline buttons) and mobile (dropdown)
   * @param options Configuration for which buttons to show
   */
  private _renderActionToolbar(
    options: {
      showRefresh?: boolean;
      showReconfigure?: boolean;
      showRememberValues?: boolean;
      showRename?: boolean;
      showViewSource?: boolean;
      showDelete?: boolean;
      showHelp?: boolean;
      showLaunchApp?: boolean;
      showRemove?: boolean;
      showRunTests?: boolean;
    } = {}
  ) {
    const {
      showRefresh = true,
      showReconfigure = this._selectedPhoton?.configured !== false,
      showRememberValues = true,
      showRename = this._selectedPhoton?.name !== 'maker',
      showViewSource = this._selectedPhoton?.name !== 'maker',
      showDelete = this._selectedPhoton?.name !== 'maker',
      showHelp = true,
      showLaunchApp = false,
      showRemove = false,
      showRunTests = this._getTestMethods().length > 0,
    } = options;

    return html`
      <!-- Desktop Action Toolbar -->
      <div class="action-toolbar">
        ${showRefresh
          ? html`
              <button class="toolbar-btn" @click=${this._handleRefresh} title="Refresh photon">
                <span>🔄</span>
                <span class="label">Refresh</span>
              </button>
            `
          : ''}
        ${showReconfigure
          ? html`
              <button
                class="toolbar-btn"
                @click=${this._handleReconfigure}
                title="Reconfigure photon"
              >
                <span>🔧</span>
                <span class="label">Configure</span>
              </button>
            `
          : ''}
        ${showRememberValues
          ? html`
              <button
                class="toolbar-btn toolbar-toggle"
                @click=${this._toggleRememberValues}
                title="Remember form values between invocations"
              >
                <span>📝</span>
                <span class="label">Remember</span>
                <span class="toggle-indicator ${this._rememberFormValues ? 'active' : ''}"></span>
              </button>
            `
          : ''}
        ${showLaunchApp
          ? html`
              <button
                class="toolbar-btn"
                @click=${() => this._launchAsApp()}
                title="Launch in separate window"
              >
                <span>🖥️</span>
                <span class="label">Launch</span>
              </button>
            `
          : ''}
        ${showRunTests
          ? html`
              <button
                class="toolbar-btn"
                @click=${this._runTests}
                ?disabled=${this._runningTests}
                title="Run test methods for this photon"
              >
                <span>🧪</span>
                <span class="label">${this._runningTests ? 'Running...' : 'Run Tests'}</span>
              </button>
            `
          : ''}
        ${showRename || showViewSource || showDelete
          ? html` <span class="toolbar-divider"></span> `
          : ''}
        ${showRename
          ? html`
              <button
                class="toolbar-btn icon-only"
                @click=${this._handleRenamePhoton}
                title="Rename photon"
              >
                <span>✏️</span>
              </button>
            `
          : ''}
        ${showViewSource
          ? html`
              <button
                class="toolbar-btn icon-only"
                @click=${this._handleViewSource}
                title="View source code"
              >
                <span>📄</span>
              </button>
            `
          : ''}
        ${showDelete
          ? html`
              <button
                class="toolbar-btn icon-only danger"
                @click=${this._handleDeletePhoton}
                title="Delete photon"
              >
                <span>🗑️</span>
              </button>
            `
          : ''}
        ${showRemove
          ? html`
              <button
                class="toolbar-btn icon-only danger"
                @click=${this._handleRemove}
                title="Remove from list"
              >
                <span>🗑️</span>
              </button>
            `
          : ''}
        ${showHelp
          ? html`
              <span class="toolbar-divider"></span>
              <button
                class="toolbar-btn icon-only"
                @click=${this._showPhotonHelpModal}
                title="Photon documentation"
              >
                <span>❓</span>
              </button>
            `
          : ''}
      </div>

      <!-- Mobile Dropdown Menu -->
      <div class="settings-container">
        <button class="settings-btn" @click=${this._toggleSettingsMenu}>
          <span>⚙️</span>
          <span>Menu</span>
        </button>
        ${this._showSettingsMenu
          ? html`
              <div class="settings-dropdown">
                ${showLaunchApp
                  ? html`
                      <button class="settings-dropdown-item" @click=${() => this._launchAsApp()}>
                        <span class="icon">🖥️</span>
                        <span>Launch as App</span>
                      </button>
                    `
                  : ''}
                ${showRunTests
                  ? html`
                      <button
                        class="settings-dropdown-item"
                        @click=${this._runTests}
                        ?disabled=${this._runningTests}
                      >
                        <span class="icon">🧪</span>
                        <span>${this._runningTests ? 'Running Tests...' : 'Run Tests'}</span>
                      </button>
                    `
                  : ''}
                ${showRefresh
                  ? html`
                      <button class="settings-dropdown-item" @click=${this._handleRefresh}>
                        <span class="icon">🔄</span>
                        <span>Refresh</span>
                      </button>
                    `
                  : ''}
                ${showReconfigure
                  ? html`
                      <button class="settings-dropdown-item" @click=${this._handleReconfigure}>
                        <span class="icon">🔧</span>
                        <span>Reconfigure</span>
                      </button>
                    `
                  : ''}
                ${showRememberValues
                  ? html`
                      <div class="settings-dropdown-divider"></div>
                      <button
                        class="settings-dropdown-item toggle"
                        @click=${this._toggleRememberValues}
                      >
                        <span style="display:flex;align-items:center;gap:10px;">
                          <span class="icon">📝</span>
                          <span>Remember Values</span>
                        </span>
                        <span
                          class="toggle-switch ${this._rememberFormValues ? 'active' : ''}"
                        ></span>
                      </button>
                    `
                  : ''}
                <button class="settings-dropdown-item toggle" @click=${this._toggleVerboseLogging}>
                  <span style="display:flex;align-items:center;gap:10px;">
                    <span class="icon">📋</span>
                    <span>Verbose Logging</span>
                  </span>
                  <span class="toggle-switch ${this._verboseLogging ? 'active' : ''}"></span>
                </button>
                ${showRename || showViewSource || showDelete
                  ? html` <div class="settings-dropdown-divider"></div> `
                  : ''}
                ${showRename
                  ? html`
                      <button class="settings-dropdown-item" @click=${this._handleRenamePhoton}>
                        <span class="icon">✏️</span>
                        <span>Rename</span>
                      </button>
                    `
                  : ''}
                ${showViewSource
                  ? html`
                      <button class="settings-dropdown-item" @click=${this._handleViewSource}>
                        <span class="icon">📄</span>
                        <span>View Source</span>
                      </button>
                    `
                  : ''}
                ${showDelete
                  ? html`
                      <button
                        class="settings-dropdown-item"
                        style="color: #f87171;"
                        @click=${this._handleDeletePhoton}
                      >
                        <span class="icon">🗑️</span>
                        <span>Delete</span>
                      </button>
                    `
                  : ''}
                ${showRemove
                  ? html`
                      <button
                        class="settings-dropdown-item"
                        style="color: #f87171;"
                        @click=${this._handleRemove}
                      >
                        <span class="icon">🗑️</span>
                        <span>Remove</span>
                      </button>
                    `
                  : ''}
                ${showHelp
                  ? html`
                      <div class="settings-dropdown-divider"></div>
                      <button class="settings-dropdown-item" @click=${this._showPhotonHelpModal}>
                        <span class="icon">📖</span>
                        <span>Photon Help</span>
                      </button>
                    `
                  : ''}
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _renderPhotonHeader() {
    if (!this._selectedPhoton) return '';

    const isApp = this._selectedPhoton.isApp;
    const methodCount = this._selectedPhoton.methods?.length || 0;
    const description = this._selectedPhoton.description || `${this._selectedPhoton.name} MCP`;
    const isGenericDesc = description.endsWith(' MCP') || description === 'Photon tool';

    // Get icon - check for custom icon first, then app icon, then initials
    const customIcon = this._selectedPhoton.icon;
    const photonInitials = this._selectedPhoton.name.substring(0, 2).toUpperCase();
    const defaultIcon = isApp ? '📱' : photonInitials;
    const displayIcon = customIcon || defaultIcon;

    return html`
      <div class="photon-header">
        <div
          class="photon-icon-large editable ${isApp ? '' : 'mcp-icon'}"
          @click=${this._startEditingIcon}
          title="Click to change icon"
        >
          ${displayIcon}
        </div>
        ${this._editingIcon ? this._renderEmojiPicker() : ''}
        <div class="photon-header-info">
          <h1 class="photon-header-name">${this._selectedPhoton.name}</h1>
          ${this._editingDescription
            ? html`
                <p class="photon-header-desc editable editing">
                  <input
                    class="editable-input"
                    type="text"
                    .value=${this._editedDescription}
                    placeholder="Add a description..."
                    @input=${(e: Event) =>
                      (this._editedDescription = (e.target as HTMLInputElement).value)}
                    @blur=${this._saveDescription}
                    @keydown=${this._handleDescriptionKeydown}
                    autofocus
                  />
                </p>
              `
            : html`
                <p
                  class="photon-header-desc editable ${isGenericDesc ? 'placeholder' : ''}"
                  @click=${this._startEditingDescription}
                  title="Click to edit description"
                >
                  ${isGenericDesc ? 'Click to add a description...' : description}
                </p>
              `}
          <div class="photon-header-meta">
            ${isApp
              ? html`<span class="photon-badge app">App</span>`
              : html`<span class="photon-badge">MCP</span>`}
            <span class="photon-badge">${methodCount} method${methodCount !== 1 ? 's' : ''}</span>
            ${this._selectedPhoton.version
              ? html`<span class="photon-badge">${this._selectedPhoton.version}</span>`
              : ''}
            ${this._selectedPhoton.hasUpdate
              ? html`<span class="photon-badge update" @click=${this._handleUpgrade}
                  >Update available</span
                >`
              : ''}
            ${this._selectedPhoton.author
              ? html`<span class="photon-badge">${this._selectedPhoton.author}</span>`
              : ''}
            ${this._selectedPhoton.installSource
              ? html`<span class="photon-badge source"
                  >from ${this._selectedPhoton.installSource.marketplace}</span
                >`
              : ''}
          </div>
          ${this._selectedPhoton.path
            ? html`<div
                class="photon-header-path"
                title="Click to copy: ${this._selectedPhoton.path}"
                @click=${() => {
                  navigator.clipboard.writeText(this._selectedPhoton!.path);
                  showToast('Path copied to clipboard');
                }}
              >
                ${this._selectedPhoton.path.replace(/^\/Users\/[^/]+\/|^\/home\/[^/]+\//, '~/')}
              </div>`
            : ''}
          <div class="photon-header-actions">
            <button
              class="btn-sm"
              @click=${this._handleCopyMCPConfig}
              title="Copy MCP config for Claude Desktop"
            >
              📋 Copy MCP Config
            </button>
            ${this._selectedPhoton.hasUpdate
              ? html`<button class="btn-sm primary" @click=${this._handleUpgrade}>
                  ⬆ Upgrade
                </button>`
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  private _startEditingDescription = () => {
    const desc = this._selectedPhoton?.description || '';
    const isGeneric = desc.endsWith(' MCP') || desc === 'Photon tool';
    this._editedDescription = isGeneric ? '' : desc;
    this._editingDescription = true;
  };

  private _handleDescriptionKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._saveDescription();
    } else if (e.key === 'Escape') {
      this._editingDescription = false;
    }
  };

  private _saveDescription = async () => {
    this._editingDescription = false;
    const newDesc = this._editedDescription.trim();

    if (newDesc && this._selectedPhoton && this._mcpReady) {
      // Update local state optimistically
      this._selectedPhoton = { ...this._selectedPhoton, description: newDesc };

      // Send to server to persist via MCP
      const result = await mcpClient.updateMetadata(this._selectedPhoton.name, null, {
        description: newDesc,
      });
      if (result.success) {
        showToast('Description updated', 'success');
      } else {
        showToast(result.error || 'Failed to update description', 'error');
      }
    }
  };

  private _startEditingIcon = () => {
    this._editingIcon = !this._editingIcon;
  };

  private _selectIcon = async (icon: string) => {
    this._editingIcon = false;

    if (this._selectedPhoton && this._mcpReady) {
      // Update local state optimistically
      this._selectedPhoton = { ...this._selectedPhoton, icon };

      // Send to server to persist via MCP
      const result = await mcpClient.updateMetadata(this._selectedPhoton.name, null, { icon });
      if (result.success) {
        showToast('Icon updated', 'success');
      } else {
        showToast(result.error || 'Failed to update icon', 'error');
      }
    }
  };

  private _handleMethodMetadataUpdate = async (e: CustomEvent) => {
    const { photonName, methodName, metadata } = e.detail;

    if (this._selectedPhoton && this._selectedPhoton.name === photonName && this._mcpReady) {
      // Update local state optimistically
      const methods = this._selectedPhoton.methods?.map((m: any) => {
        if (m.name === methodName) {
          return {
            ...m,
            ...(metadata.description !== undefined
              ? { description: metadata.description || '' }
              : {}),
            ...(metadata.icon !== undefined ? { icon: metadata.icon || undefined } : {}),
          };
        }
        return m;
      });

      this._selectedPhoton = { ...this._selectedPhoton, methods };

      // Send to server to persist via MCP
      const result = await mcpClient.updateMetadata(photonName, methodName, metadata);
      if (result.success) {
        showToast(
          `Method ${metadata.description !== undefined ? 'description' : 'icon'} updated`,
          'success'
        );
      } else {
        showToast(result.error || 'Failed to update method metadata', 'error');
      }
    }
  };

  private _renderEmojiPicker() {
    const emojis = [
      '🔧',
      '⚙️',
      '🛠️',
      '🔨',
      '🔩',
      '⚡',
      '💡',
      '🎯',
      '📊',
      '📈',
      '📉',
      '📋',
      '📝',
      '📁',
      '📂',
      '🗂️',
      '🌐',
      '🔗',
      '🔒',
      '🔓',
      '🔑',
      '🛡️',
      '🔍',
      '🔎',
      '💾',
      '💿',
      '📀',
      '🖥️',
      '💻',
      '📱',
      '⌨️',
      '🖱️',
      '🤖',
      '🧠',
      '🎨',
      '🎭',
      '🎬',
      '🎮',
      '🎲',
      '🧩',
      '📧',
      '💬',
      '💭',
      '🗨️',
      '📣',
      '📢',
      '🔔',
      '🔕',
      '✅',
      '❌',
      '⭐',
      '🌟',
      '💫',
      '✨',
      '🔥',
      '💥',
    ];

    return html`
      <div class="emoji-picker" @click=${(e: Event) => e.stopPropagation()}>
        ${emojis.map(
          (emoji) => html` <button @click=${() => this._selectIcon(emoji)}>${emoji}</button> `
        )}
      </div>
    `;
  }

  private _renderPromptsSection() {
    const prompts = this._selectedPhoton?.assets?.prompts || [];
    if (prompts.length === 0) return '';

    return html`
      <h3 class="section-header">
        📝 Prompts
        <span class="count">${prompts.length}</span>
      </h3>
      <div class="cards-grid">
        ${prompts.map(
          (prompt: any) => html`
            <div class="asset-card glass-panel" @click=${() => this._handlePromptSelect(prompt)}>
              <div class="asset-header">
                <div class="asset-icon prompt">📝</div>
                <span class="asset-name">${prompt.id}</span>
              </div>
              <div class="asset-desc">
                ${prompt.description || 'Click to view and customize this prompt'}
              </div>
              <div class="asset-meta">${prompt.path}</div>
            </div>
          `
        )}
      </div>
    `;
  }

  private _renderResourcesSection() {
    const resources = this._selectedPhoton?.assets?.resources || [];
    if (resources.length === 0) return '';

    return html`
      <h3 class="section-header">
        📦 Resources
        <span class="count">${resources.length}</span>
      </h3>
      <div class="cards-grid">
        ${resources.map(
          (resource: any) => html`
            <div
              class="asset-card glass-panel"
              @click=${() => this._handleResourceSelect(resource)}
            >
              <div class="asset-header">
                <div class="asset-icon resource">📦</div>
                <span class="asset-name">${resource.id}</span>
              </div>
              <div class="asset-desc">${resource.description || 'Click to view this resource'}</div>
              <div class="asset-meta">${resource.mimeType || resource.path}</div>
            </div>
          `
        )}
      </div>
    `;
  }

  private _handlePromptSelect = async (prompt: any) => {
    this._selectedPrompt = prompt;
    this._promptArguments = {};
    this._renderedPrompt = '';

    // Load the prompt content via MCP
    if (this._mcpReady && this._selectedPhoton) {
      try {
        const uri = `prompt://${this._selectedPhoton.name}/${prompt.id}`;
        const content = await mcpClient.readResource(uri);
        if (content?.text) {
          this._selectedPrompt = {
            ...this._selectedPrompt,
            content: content.text,
            renderedContent: content.text,
            variables: this._extractVariables(content.text),
            description: prompt.description,
          };
          for (const v of this._selectedPrompt.variables) {
            this._promptArguments[v] = '';
          }
          this._renderedPrompt = content.text;
        }
      } catch (error) {
        console.error('Failed to load prompt:', error);
      }
    }
  };

  private _extractVariables(content: string): string[] {
    const matches = content.match(/\{\{(\w+)\}\}/g) || [];
    return [...new Set(matches.map((m) => m.slice(2, -2)))];
  }

  private _handleResourceSelect = async (resource: any) => {
    this._selectedResource = resource;
    this._resourceContent = '';

    // Load the resource content via MCP
    if (this._mcpReady && this._selectedPhoton) {
      try {
        const uri = `ui://${this._selectedPhoton.name}/${resource.id}`;
        const content = await mcpClient.readResource(uri);
        if (content) {
          this._selectedResource = {
            ...this._selectedResource,
            content: content.text,
            mimeType: content.mimeType,
            description: resource.description,
          };
          this._resourceContent = content.text || '';
        }
      } catch (error) {
        console.error('Failed to load resource:', error);
      }
    }
  };

  private _renderPromptWithVariables(content: string): string {
    // Highlight {{variables}} in the prompt
    return content.replace(/\{\{(\w+)\}\}/g, '<span class="variable">{{$1}}</span>');
  }

  private _renderPromptModal() {
    if (!this._selectedPrompt || !this._selectedPrompt.content) return '';

    const variables = this._selectedPrompt.variables || [];
    const hasVariables = variables.length > 0;

    // Render the prompt with filled values highlighted
    let renderedContent = this._selectedPrompt.content;
    for (const [key, value] of Object.entries(this._promptArguments)) {
      if (value) {
        renderedContent = renderedContent.replace(
          new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
          `<span class="var-filled">${value}</span>`
        );
      } else {
        renderedContent = renderedContent.replace(
          new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
          `<span class="var-highlight">{{${key}}}</span>`
        );
      }
    }

    return html`
      <div
        class="modal-overlay"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._closePromptModal();
        }}
      >
        <div class="asset-viewer-modal glass-panel">
          <button class="close-btn" @click=${this._closePromptModal}>&times;</button>

          <h2>
            <span class="icon">📝</span>
            ${this._selectedPrompt.id}
          </h2>

          ${this._selectedPrompt.description
            ? html` <p class="description">${this._selectedPrompt.description}</p> `
            : ''}
          ${hasVariables
            ? html`
                <div class="variables-form">
                  <h4>Variables</h4>
                  ${variables.map(
                    (v: string) => html`
                      <div class="variable-input">
                        <label>{{${v}}}</label>
                        <input
                          type="text"
                          placeholder="Enter value..."
                          .value=${this._promptArguments[v] || ''}
                          @input=${(e: Event) =>
                            this._updatePromptArgument(v, (e.target as HTMLInputElement).value)}
                        />
                      </div>
                    `
                  )}
                </div>
              `
            : ''}

          <div class="content-section">
            <h4>${hasVariables ? 'Rendered Prompt' : 'Content'}</h4>
            <div class="content-preview" .innerHTML=${renderedContent}></div>
          </div>

          <button class="copy-btn" @click=${this._copyPromptContent}>📋 Copy to Clipboard</button>
        </div>
      </div>
    `;
  }

  private _renderResourceModal() {
    if (!this._selectedResource || !this._selectedResource.content) return '';

    const mimeType = this._selectedResource.mimeType || 'text/plain';
    const isImage = mimeType.startsWith('image/');
    const isJson = mimeType === 'application/json';

    let displayContent = this._selectedResource.content;
    if (isJson) {
      try {
        displayContent = JSON.stringify(JSON.parse(displayContent), null, 2);
      } catch {
        // Keep as-is
      }
    }

    return html`
      <div
        class="modal-overlay"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._closeResourceModal();
        }}
      >
        <div class="asset-viewer-modal glass-panel">
          <button class="close-btn" @click=${this._closeResourceModal}>&times;</button>

          <h2>
            <span class="icon">📦</span>
            ${this._selectedResource.id}
          </h2>

          ${this._selectedResource.description
            ? html` <p class="description">${this._selectedResource.description}</p> `
            : ''}

          <div class="content-section">
            <h4>Content <span style="opacity:0.5">(${mimeType})</span></h4>
            ${isImage
              ? html`
                  <img
                    class="resource-image"
                    src="data:${mimeType};base64,${this._selectedResource.content}"
                    alt="${this._selectedResource.id}"
                  />
                `
              : html` <div class="content-preview">${displayContent}</div> `}
          </div>

          ${!isImage
            ? html`
                <button class="copy-btn" @click=${this._copyResourceContent}>
                  📋 Copy to Clipboard
                </button>
              `
            : ''}
        </div>
      </div>
    `;
  }

  private _closePromptModal = () => {
    this._selectedPrompt = null;
    this._promptArguments = {};
    this._renderedPrompt = '';
  };

  private _closeResourceModal = () => {
    this._selectedResource = null;
    this._resourceContent = '';
  };

  private _updatePromptArgument = (key: string, value: string) => {
    this._promptArguments = {
      ...this._promptArguments,
      [key]: value,
    };
  };

  private _copyPromptContent = async () => {
    // Build the rendered content
    let content = this._selectedPrompt?.content || '';
    for (const [key, value] of Object.entries(this._promptArguments)) {
      if (value) {
        content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    try {
      await navigator.clipboard.writeText(content);
      showToast('Prompt copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy', 'error');
    }
  };

  private _copyResourceContent = async () => {
    try {
      await navigator.clipboard.writeText(this._resourceContent);
      showToast('Resource copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy', 'error');
    }
  };

  private _renderHelpModal() {
    return html`
      <div
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._closeHelp();
        }}
      >
        <div class="help-modal glass-panel">
          <h2 id="help-modal-title" class="text-gradient">Keyboard Shortcuts</h2>

          <div class="shortcut-section">
            <h3>Navigation</h3>
            <div class="shortcut-list">
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>⌘</kbd><kbd>K</kbd></span>
                <span class="shortcut-desc">Focus search</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>/</kbd></span>
                <span class="shortcut-desc">Focus search</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>[</kbd> <kbd>]</kbd></span>
                <span class="shortcut-desc">Previous / Next photon</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>j</kbd> <kbd>k</kbd></span>
                <span class="shortcut-desc">Navigate methods</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>Enter</kbd></span>
                <span class="shortcut-desc">Select method</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>h</kbd></span>
                <span class="shortcut-desc">Go back</span>
              </div>
            </div>
          </div>

          <div class="shortcut-section">
            <h3>Actions</h3>
            <div class="shortcut-list">
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>⌘</kbd><kbd>Enter</kbd></span>
                <span class="shortcut-desc">Submit form</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>Esc</kbd></span>
                <span class="shortcut-desc">Close / Cancel</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>t</kbd></span>
                <span class="shortcut-desc">Toggle theme</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>p</kbd></span>
                <span class="shortcut-desc">Open marketplace</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>f</kbd></span>
                <span class="shortcut-desc">Toggle favorites filter</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-key"><kbd>?</kbd></span>
                <span class="shortcut-desc">Show this help</span>
              </div>
            </div>
          </div>

          <button
            class="btn-primary"
            style="width: 100%; margin-top: var(--space-md);"
            @click=${this._closeHelp}
          >
            Close
          </button>
        </div>
      </div>
    `;
  }

  private _renderPhotonHelpModal() {
    const markdown = this._photonHelpLoading
      ? this._generatePhotonHelpMarkdown()
      : this._photonHelpMarkdown || this._generatePhotonHelpMarkdown();
    let htmlContent = markdown;

    // Parse markdown if marked is available
    if ((window as any).marked) {
      // Extract mermaid blocks before parsing
      const mermaidBlocks: { id: string; code: string }[] = [];
      let processed = markdown.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_match: string, code: string) => {
        const id = `help-mermaid-${Math.random().toString(36).substr(2, 9)}`;
        mermaidBlocks.push({ id, code: code.trim() });
        return `<div data-mermaid-id="${id}" style="min-height: 80px; display: flex; align-items: center; justify-content: center; color: var(--t-muted);">Loading diagram...</div>`;
      });
      htmlContent = (window as any).marked.parse(processed);

      // Render mermaid blocks after DOM update
      if (mermaidBlocks.length > 0 && (window as any).mermaid) {
        const mermaid = (window as any).mermaid;
        const isDark = this.getAttribute('data-theme') !== 'light';
        mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
        requestAnimationFrame(() => {
          for (const { id, code } of mermaidBlocks) {
            const el = this.shadowRoot?.querySelector(`[data-mermaid-id="${id}"]`);
            if (el) {
              mermaid.render(id + '-svg', code).then(({ svg }: { svg: string }) => {
                el.innerHTML = svg;
                (el as HTMLElement).style.minHeight = '';
                (el as HTMLElement).style.background = isDark ? 'hsla(220, 15%, 18%, 0.8)' : 'hsla(0, 0%, 97%, 0.8)';
                (el as HTMLElement).style.borderRadius = '8px';
                (el as HTMLElement).style.padding = '12px';
              }).catch(() => {
                el.textContent = 'Diagram rendering failed';
              });
            }
          }
        });
      }
    }

    return html`
      <div
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photon-help-title"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._closePhotonHelp();
        }}
      >
        <div
          class="help-modal glass-panel"
          style="max-width: 700px; max-height: 80vh; overflow: auto;"
        >
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-md);"
          >
            <h2 id="photon-help-title" class="text-gradient" style="margin: 0;">
              Help
              ${this._photonHelpLoading
                ? html`<span style="font-size: 0.7em; opacity: 0.6; margin-left: 8px;">Loading...</span>`
                : ''}
            </h2>
            <button
              class="btn-secondary"
              style="padding: 6px 12px; font-size: 0.85rem;"
              @click=${this._closePhotonHelp}
              aria-label="Close help"
            >
              ✕
            </button>
          </div>
          <div class="markdown-body" style="color: var(--t-default);">
            ${(window as any).marked
              ? html`${unsafeHTML(htmlContent)}`
              : html`<pre style="white-space: pre-wrap;">${markdown}</pre>`}
          </div>
        </div>
      </div>
    `;
  }

  private _closeSourceModal = () => {
    this._showSourceModal = false;
    this._sourceData = null;
  };

  private _copySourceCode = async () => {
    if (this._sourceData?.code) {
      try {
        await navigator.clipboard.writeText(this._sourceData.code);
        showToast('Source code copied', 'success');
      } catch {
        showToast('Failed to copy', 'error');
      }
    }
  };

  private _renderSourceModal() {
    if (!this._sourceData) return '';

    const filename = this._sourceData.path.split('/').pop() || 'source.ts';
    const ext = filename.split('.').pop()?.toLowerCase() || 'ts';

    // Map file extensions to Prism language
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      json: 'json',
      css: 'css',
      sql: 'sql',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      rs: 'rust',
      go: 'go',
      sh: 'bash',
      bash: 'bash',
    };
    const language = langMap[ext] || 'typescript';

    // Apply syntax highlighting if Prism is available
    let highlightedCode = this._sourceData.code;
    const Prism = (window as any).Prism;
    if (Prism && Prism.languages[language]) {
      highlightedCode = Prism.highlight(this._sourceData.code, Prism.languages[language], language);
    }

    return html`
      <div
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-modal-title"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._closeSourceModal();
        }}
      >
        <div
          class="help-modal glass-panel"
          style="max-width: 900px; max-height: 85vh; display: flex; flex-direction: column;"
        >
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-md); flex-shrink: 0;"
          >
            <div>
              <h2 id="source-modal-title" class="text-gradient" style="margin: 0;">Source Code</h2>
              <div
                style="font-size: 0.85rem; color: var(--t-muted); margin-top: 4px; font-family: var(--font-mono);"
              >
                ${filename}
              </div>
            </div>
            <div style="display: flex; gap: var(--space-sm);">
              <button
                class="toolbar-btn"
                style="padding: 6px 12px; font-size: 0.85rem;"
                @click=${this._copySourceCode}
                title="Copy source code"
              >
                📋 Copy
              </button>
              <button
                class="toolbar-btn"
                style="padding: 6px 12px; font-size: 0.85rem;"
                @click=${this._closeSourceModal}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>
          <pre
            class="language-${language}"
            style="
            flex: 1;
            overflow: auto;
            white-space: pre;
            background: #1e1e2e;
            border: 1px solid var(--border-glass);
            border-radius: var(--radius-sm);
            padding: var(--space-md);
            margin: 0;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            line-height: 1.6;
            tab-size: 2;
          "
          ><code class="language-${language}" style="display: block; overflow-x: visible;">${Prism
            ? unsafeHTML(highlightedCode)
            : this._sourceData.code}</code></pre>
        </div>
      </div>
    `;
  }
}
