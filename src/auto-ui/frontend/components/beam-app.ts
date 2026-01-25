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
      :host([data-theme="light"]) {
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

      /* Inline Editable Elements */
      .editable {
        cursor: pointer;
        border-radius: var(--radius-sm);
        padding: 2px 6px;
        margin: -2px -6px;
        transition: background 0.15s ease, box-shadow 0.15s ease;
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
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .photon-icon-large.editable:hover {
        transform: scale(1.05);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 3px var(--accent-primary);
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
        transition: background 0.15s ease, transform 0.1s ease;
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
        transition: transform 0.2s ease, box-shadow 0.2s ease;
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
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 4px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 0.8rem;
      }

      .connection-banner button:hover {
        background: rgba(255,255,255,0.3);
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

      /* Settings Menu Dropdown */
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

      .settings-container {
        position: relative;
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
        transition: transform 0.15s ease, box-shadow 0.15s ease;
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

        /* Settings dropdown positioning */
        .settings-dropdown {
          right: 0;
          left: auto;
        }
      }

      @media (max-width: 480px) {
        .main-area {
          padding: var(--space-sm);
          padding-top: calc(var(--space-sm) + 60px);
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
    `
  ];

  @state() private _connected = false;
  @state() private _reconnecting = false;
  @state() private _sidebarVisible = false;
  @state() private _photons: any[] = [];
  @state() private _selectedPhoton: any = null;
  @state() private _view: 'list' | 'form' | 'marketplace' | 'config' = 'list';

  // ... (existing code)



  private _handleInstall(e: CustomEvent) {
    // Just log for now, the socket update 'photon_added' will handle the actual refresh
    this._log('info', `Installed ${e.detail.name}`);
  }

  private _handleMakerAction(e: CustomEvent) {
    const action = e.detail.action;
    // Find maker photon and invoke the static method
    const maker = this._photons.find(p => p.name === 'maker');
    if (!maker) {
      showToast('Maker photon not found', 'error');
      return;
    }

    // Navigate to maker photon and select the method
    this._selectedPhoton = maker;
    const method = maker.methods?.find((m: any) => m.name === action);
    if (method) {
      this._selectedMethod = method;
      this._view = 'form';
      this._updateHash();
    } else {
      showToast(`Method '${action}' not found on maker`, 'error');
    }
  }

  @state() private _selectedMethod: any = null;
  @state() private _lastResult: any = null;
  @state() private _lastFormParams: Record<string, any> = {};
  @state() private _sharedFormParams: Record<string, any> | null = null;
  @state() private _activityLog: any[] = [];
  @state() private _isExecuting = false;
  @state() private _theme: Theme = 'dark';
  @state() private _showHelp = false;
  @state() private _showPhotonHelp = false;
  @state() private _elicitationData: ElicitationData | null = null;
  @state() private _showElicitation = false;
  @state() private _protocolMode: 'legacy' | 'mcp' = 'legacy';
  @state() private _mcpReady = false;
  @state() private _showSettingsMenu = false;
  @state() private _rememberFormValues = false;
  @state() private _editingDescription = false;
  @state() private _editingIcon = false;
  @state() private _editedDescription = '';
  @state() private _selectedPrompt: any = null;
  @state() private _selectedResource: any = null;
  @state() private _promptArguments: Record<string, string> = {};
  @state() private _renderedPrompt: string = '';
  @state() private _resourceContent: string = '';

  @query('beam-sidebar')
  private _sidebar!: BeamSidebar;

  private _pendingBridgeCalls = new Map<string, Window>();

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
  }

  private async _connectMCP() {
    try {
      mcpClient.on('connect', async () => {
        this._mcpReady = true;
        this._connected = true;
        this._reconnecting = false;
        console.log('MCP client connected');
        this._log('info', 'Connected to Beam server');
        showToast('Connected to Beam server', 'success');

        // Load initial photon list
        const tools = await mcpClient.listTools();
        this._photons = mcpClient.toolsToPhotons(tools);

        // Restore state from hash or select first photon
        if (window.location.hash) {
          this._handleHashChange();
        } else if (!this._selectedPhoton && this._photons.length > 0) {
          this._selectedPhoton = this._photons[0];
          this._updateHash();
        }
      });

      mcpClient.on('disconnect', () => {
        this._mcpReady = false;
        this._connected = false;
        this._reconnecting = true;
        this._log('error', 'Disconnected from server');
        showToast('Connection lost. Reconnecting...', 'warning');
      });

      mcpClient.on('tools-changed', async () => {
        const tools = await mcpClient.listTools();
        this._photons = mcpClient.toolsToPhotons(tools);
      });

      mcpClient.on('progress', (data: any) => {
        this._log('info', data.message || 'Processing...');
      });

      // Handle photons list update from SSE
      mcpClient.on('photons', (data: any) => {
        if (data?.photons) {
          this._photons = data.photons;
          // Update selected photon if it was in the list
          if (this._selectedPhoton) {
            const updated = this._photons.find(p => p.name === this._selectedPhoton?.name);
            if (updated) {
              this._selectedPhoton = updated;
            }
          }
        }
      });

      // Handle hot-reload notifications
      mcpClient.on('hot-reload', (data: any) => {
        if (data?.photon) {
          const reloadedPhoton = data.photon;
          const index = this._photons.findIndex(p => p.name === reloadedPhoton.name);
          if (index !== -1) {
            this._photons = [
              ...this._photons.slice(0, index),
              reloadedPhoton,
              ...this._photons.slice(index + 1)
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
          const index = this._photons.findIndex(p => p.name === configuredPhoton.name);
          if (index !== -1) {
            this._photons = [
              ...this._photons.slice(0, index),
              configuredPhoton,
              ...this._photons.slice(index + 1)
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
        // Find iframes in nested shadow DOMs (custom-ui-renderer has its own shadow root)
        const iframes: HTMLIFrameElement[] = [];
        this.shadowRoot?.querySelectorAll('custom-ui-renderer').forEach(renderer => {
          const iframe = renderer.shadowRoot?.querySelector('iframe');
          if (iframe) iframes.push(iframe);
        });
        // Also check direct iframes (legacy)
        this.shadowRoot?.querySelectorAll('iframe').forEach(iframe => iframes.push(iframe));
        iframes.forEach(iframe => {
          iframe.contentWindow?.postMessage({
            type: 'photon:channel-event',
            ...data
          }, '*');
        });
      });

      // Handle board updates (legacy) - forward to custom UI iframes
      mcpClient.on('board-update', (data: any) => {
        // Find iframes in nested shadow DOMs (custom-ui-renderer has its own shadow root)
        const iframes: HTMLIFrameElement[] = [];
        this.shadowRoot?.querySelectorAll('custom-ui-renderer').forEach(renderer => {
          const iframe = renderer.shadowRoot?.querySelector('iframe');
          if (iframe) iframes.push(iframe);
        });
        this.shadowRoot?.querySelectorAll('iframe').forEach(iframe => iframes.push(iframe));
        iframes.forEach(iframe => {
          iframe.contentWindow?.postMessage({
            type: 'photon:board-update',
            ...data
          }, '*');
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
      this._log('error', 'Failed to connect to server');
      showToast('Connection failed. Retrying...', 'error');
      // Retry connection after a delay
      setTimeout(() => this._connectMCP(), 3000);
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
      const photon = this._photons.find(p => p.name === photonName);
      if (photon) {
        this._selectedPhoton = photon;

        if (methodName && photon.methods) {
          const method = photon.methods.find((m: any) => m.name === methodName);
          if (method) {
            this._selectedMethod = method;
            this._view = 'form';
            // Store shared params to pre-populate form
            if (Object.keys(sharedParams).length > 0) {
              this._sharedFormParams = sharedParams;
            }
          }
        } else if (photon.isApp && photon.appEntry) {
          // For Apps without method specified, auto-select main
          this._selectedMethod = photon.appEntry;
          this._view = 'form';
        } else {
          this._selectedMethod = null;
          this._view = 'list';
        }
      }
    }
  }

  private _updateHash() {
    if (!this._selectedPhoton) return;
    let hash = this._selectedPhoton.name;
    if (this._selectedMethod) {
      hash += `/${this._selectedMethod.name}`;
    }
    // Update URL without scrolling
    history.replaceState(null, '', `#${hash}`);
  }

  private _log(type: string, message: string) {
    this._activityLog = [{
      id: Date.now().toString(),
      type,
      message,
      timestamp: new Date().toISOString()
    }, ...this._activityLog];
  }

  render() {
    return html`
      ${!this._connected ? html`
        <div class="connection-banner ${this._reconnecting ? 'reconnecting' : ''}">
          <span>${this._reconnecting ? 'Reconnecting to server...' : 'Disconnected from server'}</span>
          <button @click=${() => this._connect()}>Retry Now</button>
        </div>
      ` : ''}

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

      <div class="sidebar-area glass-panel ${this._sidebarVisible ? 'visible' : ''}" style="margin: var(--space-sm); border-radius: var(--radius-md);">
        <beam-sidebar
          .photons=${this._photons}
          .selectedPhoton=${this._selectedPhoton?.name}
          .theme=${this._theme}
          @select=${this._handlePhotonSelectMobile}
          @marketplace=${this._handleMarketplaceMobile}
          @theme-change=${this._handleThemeChange}
          @show-shortcuts=${this._showHelpModal}
        ></beam-sidebar>
      </div>

      <main class="main-area" role="main" aria-label="Main content">
        ${this._renderContent()}
        <activity-log .items=${this._activityLog} @clear=${() => this._activityLog = []}></activity-log>
      </main>

      <toast-manager></toast-manager>

      ${this._showHelp ? this._renderHelpModal() : ''}
      ${this._showPhotonHelp ? this._renderPhotonHelpModal() : ''}
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
    if (this._view === 'marketplace') {
      return html`
            <div style="margin-bottom: var(--space-md);">
                <button 
                  style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                  @click=${() => this._view = 'list'}
                >← Back to Dashboard</button>
            </div>
            <h1 class="text-gradient">Marketplace</h1>
            <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">
              Discover and install new Photons.
            </p>
            <marketplace-view @install=${this._handleInstall} @maker-action=${this._handleMakerAction}></marketplace-view>
        `;
    }

    if (!this._selectedPhoton) {
      return html`
           <h1>Welcome to Beam</h1>
           <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">Select a Photon to begin.</p>

           <div class="glass-panel" style="padding: var(--space-xl); text-align: center;">
             <h3>No Photon Selected</h3>
             <p style="color: var(--t-muted); margin-bottom: var(--space-lg);">Select one from the sidebar or explore the marketplace.</p>
             <button class="btn-primary" @click=${() => this._view = 'marketplace'}>
               Browse Marketplace
             </button>
           </div>
         `;
    }

    // Show configuration view for unconfigured photons
    if (this._view === 'config' || this._selectedPhoton.configured === false) {
      return html`
        <div class="glass-panel" style="padding: var(--space-lg); max-width: 600px;">
          <photon-config
            .photon=${this._selectedPhoton}
            @configure=${this._handleConfigure}
          ></photon-config>
        </div>
      `;
    }

    if (this._view === 'form' && this._selectedMethod) {
      // Check for Linked UI (Custom Interface)
      if (this._selectedMethod.linkedUi) {
        const isAppMain = this._selectedPhoton.isApp && this._selectedMethod.name === 'main';
        const otherMethods = isAppMain
          ? (this._selectedPhoton.methods || []).filter((m: any) => m.name !== 'main')
          : [];

        return html`
          ${!isAppMain ? html`
            <div style="margin-bottom: var(--space-md);">
              <button
                style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                @click=${() => this._handleBackFromMethod()}
              >← Back to ${this._selectedPhoton.isApp ? this._selectedPhoton.name : 'Methods'}</button>
            </div>
          ` : ''}
          <div class="glass-panel" style="padding: 0; overflow: hidden; min-height: calc(100vh - 80px);">
             <custom-ui-renderer
                .photon=${this._selectedPhoton.name}
                .method=${this._selectedMethod.name}
                .uiId=${this._selectedMethod.linkedUi}
                .theme=${this._theme}
                style="height: calc(100vh - 80px);"
             ></custom-ui-renderer>
          </div>

          ${isAppMain && otherMethods.length > 0 ? html`
            <div style="margin-top: var(--space-xl); padding-top: var(--space-xl); border-top: 1px solid var(--border-glass);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-lg);">
                <div style="display: flex; align-items: center; gap: var(--space-sm);">
                  <span style="font-size: 1.5rem;">${this._selectedPhoton.appEntry?.icon || '📱'}</span>
                  <h3 style="margin: 0; font-size: 1.2rem; color: var(--t-primary);">${this._selectedPhoton.name}</h3>
                </div>
                <div class="settings-container">
                  <button class="settings-btn" @click=${this._toggleSettingsMenu}>
                    <span>⚙️</span>
                    <span>Settings</span>
                  </button>
                  ${this._showSettingsMenu ? html`
                    <div class="settings-dropdown">
                      <button class="settings-dropdown-item" @click=${() => this._launchAsApp()}>
                        <span class="icon">🖥️</span>
                        <span>Launch as App</span>
                      </button>
                      <button class="settings-dropdown-item" @click=${this._handleRefresh}>
                        <span class="icon">🔄</span>
                        <span>Reload</span>
                      </button>
                      <div class="settings-dropdown-divider"></div>
                      <button class="settings-dropdown-item danger" @click=${this._handleRemove}>
                        <span class="icon">🗑️</span>
                        <span>Remove</span>
                      </button>
                    </div>
                  ` : ''}
                </div>
              </div>
              <h4 style="color: var(--t-muted); text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.1em; margin-bottom: var(--space-md);">
                Methods
              </h4>
              <div class="cards-grid">
                ${otherMethods.map((method: any) => html`
                  <method-card .method=${method} .photonName=${this._selectedPhoton.name} @select=${this._handleMethodSelect} @update-metadata=${this._handleMethodMetadataUpdate}></method-card>
                `)}
              </div>
            </div>
          ` : ''}
        `;
      }

      // Default Form Interface
      const isAppMethod = this._selectedPhoton.isApp && this._selectedPhoton.appEntry;
      const backLabel = isAppMethod ? `← Back to ${this._selectedPhoton.name}` : '← Back to Methods';

      return html`
          <div class="header-toolbar">
            <div class="header-left">
              <button
                style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
                @click=${() => this._handleBackFromMethod()}
              >${backLabel}</button>
            </div>
            <div class="settings-container">
              <button class="settings-btn" @click=${this._toggleSettingsMenu}>
                <span>⚙️</span>
                <span>Settings</span>
              </button>
              ${this._showSettingsMenu ? html`
                <div class="settings-dropdown">
                  <button class="settings-dropdown-item" @click=${this._handleRefresh}>
                    <span class="icon">🔄</span>
                    <span>Refresh</span>
                  </button>
                  ${this._selectedPhoton.configured !== false ? html`
                    <button class="settings-dropdown-item" @click=${this._handleReconfigure}>
                      <span class="icon">🔧</span>
                      <span>Reconfigure</span>
                    </button>
                  ` : ''}
                  <div class="settings-dropdown-divider"></div>
                  <button class="settings-dropdown-item toggle" @click=${this._toggleRememberValues}>
                    <span style="display:flex;align-items:center;gap:10px;">
                      <span class="icon">💾</span>
                      <span>Remember Values</span>
                    </span>
                    <span class="toggle-switch ${this._rememberFormValues ? 'active' : ''}"></span>
                  </button>
                  <div class="settings-dropdown-divider"></div>
                  <button class="settings-dropdown-item" @click=${this._showPhotonHelpModal}>
                    <span class="icon">📖</span>
                    <span>Photon Help</span>
                  </button>
                </div>
              ` : ''}
            </div>
          </div>
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

            ${this._lastResult !== null ? html`
              <result-viewer
                .result=${this._lastResult}
                .outputFormat=${this._selectedMethod?.outputFormat}
                .layoutHints=${this._selectedMethod?.layoutHints}
                .theme=${this._theme}
                @share=${this._handleShareResult}
              ></result-viewer>
            ` : ''}
          </div>
        `;
    }

    return html`
        <div class="header-toolbar">
          <div class="header-left"></div>
          <div class="settings-container">
            <button class="settings-btn" @click=${this._toggleSettingsMenu}>
              <span>⚙️</span>
              <span>Settings</span>
            </button>
            ${this._showSettingsMenu ? html`
              <div class="settings-dropdown">
                <button class="settings-dropdown-item" @click=${this._handleRefresh}>
                  <span class="icon">🔄</span>
                  <span>Refresh</span>
                </button>
                ${this._selectedPhoton.configured !== false ? html`
                  <button class="settings-dropdown-item" @click=${this._handleReconfigure}>
                    <span class="icon">🔧</span>
                    <span>Reconfigure</span>
                  </button>
                ` : ''}
                <div class="settings-dropdown-divider"></div>
                <button class="settings-dropdown-item toggle" @click=${this._toggleRememberValues}>
                  <span style="display:flex;align-items:center;gap:10px;">
                    <span class="icon">💾</span>
                    <span>Remember Values</span>
                  </span>
                  <span class="toggle-switch ${this._rememberFormValues ? 'active' : ''}"></span>
                </button>
                ${this._selectedPhoton.name !== 'maker' ? html`
                  <div class="settings-dropdown-divider"></div>
                  <button class="settings-dropdown-item" @click=${this._handleRenamePhoton}>
                    <span class="icon">✏️</span>
                    <span>Rename</span>
                  </button>
                  <button class="settings-dropdown-item" @click=${this._handleViewSource}>
                    <span class="icon">📄</span>
                    <span>View Source</span>
                  </button>
                  <button class="settings-dropdown-item" style="color: #f87171;" @click=${this._handleDeletePhoton}>
                    <span class="icon">🗑️</span>
                    <span>Delete</span>
                  </button>
                ` : ''}
                <div class="settings-dropdown-divider"></div>
                <button class="settings-dropdown-item" @click=${this._showPhotonHelpModal}>
                  <span class="icon">📖</span>
                  <span>Photon Help</span>
                </button>
              </div>
            ` : ''}
          </div>
        </div>

        ${this._renderPhotonHeader()}

        <h3 style="color: var(--t-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em;">Methods</h3>
        <div class="cards-grid">
          ${(this._selectedPhoton.methods || []).map((method: any) => html`
            <method-card .method=${method} .photonName=${this._selectedPhoton.name} @select=${this._handleMethodSelect} @update-metadata=${this._handleMethodMetadataUpdate}></method-card>
          `)}
        </div>

        ${this._renderPromptsSection()}
        ${this._renderResourcesSection()}
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

  private _handlePhotonSelect(e: CustomEvent) {
    this._selectedPhoton = e.detail.photon;
    this._selectedMethod = null;
    this._lastResult = null;

    // For unconfigured photons, show configuration view
    if (this._selectedPhoton.configured === false) {
      this._view = 'config';
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
    this._selectedMethod = e.detail.method;
    this._lastResult = null;
    this._view = 'form';
    this._updateHash();
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
        }, 100);
      });
    } else {
      // For regular photons, go back to methods list
      this._view = 'list';
      this._selectedMethod = null;
      this._updateHash();
    }
  }

  private _toggleSettingsMenu = () => {
    this._showSettingsMenu = !this._showSettingsMenu;
  }

  private _closeSettingsMenu = () => {
    this._showSettingsMenu = false;
  }

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
  }

  private _launchAsApp = () => {
    this._closeSettingsMenu();
    if (this._selectedPhoton) {
      window.open(`/api/pwa/app?photon=${encodeURIComponent(this._selectedPhoton.name)}`, '_blank');
    }
  }

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
  }

  private _handleReconfigure = () => {
    this._closeSettingsMenu();
    this._view = 'config';
    this._updateHash();
  }

  private _toggleRememberValues = () => {
    this._rememberFormValues = !this._rememberFormValues;
    localStorage.setItem('beam-remember-values', String(this._rememberFormValues));
    showToast(this._rememberFormValues ? 'Form values will be remembered' : 'Form values will not be remembered', 'info');
  }

  // Maker instance method handlers - operate on the current photon
  private _handleRenamePhoton = () => {
    this._closeSettingsMenu();
    const currentName = this._selectedPhoton?.name || '';
    const newName = prompt(`Enter new name for "${currentName}":`, currentName);
    if (newName && newName !== currentName) {
      this._invokeMakerMethod('rename', { name: newName });
    }
  }

  private _handleViewSource = () => {
    this._closeSettingsMenu();
    this._invokeMakerMethod('source');
  }

  private _handleDeletePhoton = () => {
    this._closeSettingsMenu();
    if (confirm(`Are you sure you want to delete "${this._selectedPhoton?.name}"? This cannot be undone.`)) {
      this._invokeMakerMethod('delete');
    }
  }

  private async _invokeMakerMethod(methodName: string, additionalArgs: Record<string, any> = {}) {
    // Find maker photon
    const maker = this._photons.find(p => p.name === 'maker');
    if (!maker) {
      showToast('Maker photon not available', 'error');
      return;
    }

    // Invoke the maker method with the current photon's path
    const photonPath = this._selectedPhoton?.path;
    if (!photonPath) {
      showToast('Photon path not available', 'error');
      return;
    }

    this._log('info', `Invoking maker.${methodName} on ${this._selectedPhoton?.name}...`);

    // Use MCP to invoke the maker method
    if (this._mcpReady) {
      try {
        const toolName = `maker/${methodName}`;
        const result = await mcpClient.callTool(toolName, { photonPath, ...additionalArgs });

        if (result.isError) {
          const errorText = result.content.find(c => c.type === 'text')?.text || 'Unknown error';
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
    this._log('info', `Invoking ${this._selectedMethod.name}...`);
    this._lastResult = null;
    this._isExecuting = true;

    // Use MCP for all tool invocations
    if (this._mcpReady) {
      try {
        const toolName = `${this._selectedPhoton.name}/${this._selectedMethod.name}`;
        const result = await mcpClient.callTool(toolName, args);

        if (result.isError) {
          const errorText = result.content.find(c => c.type === 'text')?.text || 'Unknown error';
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
      }
    } else {
      this._log('error', 'Not connected to server');
      showToast('Not connected to server', 'error');
      this._isExecuting = false;
    }
  }

  private async _handleConfigure(e: CustomEvent) {
    const { photon, config } = e.detail;
    this._log('info', `Configuring ${photon}...`);

    if (this._mcpReady) {
      const result = await mcpClient.configurePhoton(photon, config);
      if (!result.success) {
        this._log('error', result.error || 'Configuration failed');
        showToast(result.error || 'Configuration failed', 'error');
      }
      // Success notification will come via SSE beam/configured
    } else {
      this._log('error', 'Not connected to server');
      showToast('Not connected to server', 'error');
    }
  }
  private _handleBridgeMessage = async (event: MessageEvent) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'photon:call-tool') {
      const callId = msg.callId;
      if (this._selectedPhoton && this._mcpReady) {
        this._log('info', `Bridge invoking ${msg.toolName}...`);

        try {
          const toolName = `${this._selectedPhoton.name}/${msg.toolName}`;
          const result = await mcpClient.callTool(toolName, msg.args || {});

          // Send response back to iframe
          if (event.source) {
            (event.source as Window).postMessage({
              type: 'photon:call-tool-response',
              callId,
              result: result.isError ? undefined : mcpClient.parseToolResult(result),
              error: result.isError ? result.content.find(c => c.type === 'text')?.text : undefined
            }, '*');
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (event.source) {
            (event.source as Window).postMessage({
              type: 'photon:call-tool-response',
              callId,
              error: errorMessage
            }, '*');
          }
        }
      }
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
          (event.source as Window).postMessage({
            type: 'photon:init-state',
            state
          }, '*');
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
  }

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
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Share link copied to clipboard', 'success');
    }).catch(() => {
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
  }

  private _handleElicitationSubmit = async (e: CustomEvent) => {
    const { value } = e.detail;
    // TODO: Implement elicitation response via MCP
    // Elicitation in MCP requires a different flow - the server needs to
    // track pending elicitations and match responses to them
    this._showElicitation = false;
    this._elicitationData = null;
    this._log('info', 'Input submitted');
    showToast('Elicitation response submitted', 'info');
  }

  private _handleElicitationCancel = () => {
    // TODO: Implement elicitation cancel via MCP
    this._showElicitation = false;
    this._elicitationData = null;
    this._isExecuting = false;
    this._log('info', 'Input cancelled');
    showToast('Input cancelled', 'info');
  }

  private _handleOAuthComplete = async (e: CustomEvent) => {
    const { elicitationId, success } = e.detail;
    // TODO: Implement OAuth completion via MCP
    this._showElicitation = false;
    this._elicitationData = null;
    if (success) {
      this._log('success', 'Authorization completed');
      showToast('Authorization completed', 'success');
    }
  }

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
        iframe.contentWindow.postMessage({
          type: 'photon:theme-change',
          theme: this._theme,
          themeTokens: themeTokens
        }, '*');
      }
    });

    // Also check for any direct iframes (fallback)
    const iframes = this.shadowRoot?.querySelectorAll('iframe');
    iframes?.forEach((iframe) => {
      iframe.contentWindow?.postMessage({
        type: 'photon:theme-change',
        theme: this._theme,
        themeTokens: themeTokens
      }, '*');
    });
  }

  private _handleKeydown = (e: KeyboardEvent) => {
    // Skip if typing in an input field (unless it's a special key combo)
    // Use composedPath() to check through shadow DOM boundaries
    const path = e.composedPath();
    const isInput = path.some((el) => {
      if (el instanceof HTMLElement) {
        return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      }
      return false;
    });

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
        ? photons.findIndex(p => p.name === this._selectedPhoton.name)
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
    if ((e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') && this._view === 'list') {
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
  }

  private _closeHelp() {
    this._showHelp = false;
  }

  private _showHelpModal = () => {
    this._closeSettingsMenu();
    this._showHelp = true;
  }

  private _showPhotonHelpModal = () => {
    this._closeSettingsMenu();
    this._showPhotonHelp = true;
  }

  private _closePhotonHelp() {
    this._showPhotonHelp = false;
  }

  private _generatePhotonHelpMarkdown(): string {
    if (!this._selectedPhoton) return '';

    const photon = this._selectedPhoton;
    const lines: string[] = [];

    // Header with icon
    const icon = photon.icon ? `${photon.icon} ` : '';
    lines.push(`# ${icon}${photon.name}`);
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
          lines.push('**Parameters:**');
          lines.push('');
          lines.push('| Name | Type | Required | Description |');
          lines.push('|------|------|----------|-------------|');
          for (const param of method.params) {
            const required = param.required ? '✓' : '';
            const desc = param.description || '-';
            lines.push(`| \`${param.name}\` | ${param.type || 'any'} | ${required} | ${desc} |`);
          }
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
        lines.push(`- **${resource.name}** (\`${resource.uri || '-'}\`): ${resource.description || 'No description'}`);
      }
      lines.push('');
    }

    return lines.join('\n');
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
        <div class="photon-icon-large editable ${isApp ? '' : 'mcp-icon'}"
             @click=${this._startEditingIcon}
             title="Click to change icon">
          ${displayIcon}
        </div>
        ${this._editingIcon ? this._renderEmojiPicker() : ''}
        <div class="photon-header-info">
          <h1 class="photon-header-name">${this._selectedPhoton.name}</h1>
          ${this._editingDescription ? html`
            <p class="photon-header-desc editable editing">
              <input
                class="editable-input"
                type="text"
                .value=${this._editedDescription}
                placeholder="Add a description..."
                @input=${(e: Event) => this._editedDescription = (e.target as HTMLInputElement).value}
                @blur=${this._saveDescription}
                @keydown=${this._handleDescriptionKeydown}
                autofocus
              />
            </p>
          ` : html`
            <p class="photon-header-desc editable ${isGenericDesc ? 'placeholder' : ''}"
               @click=${this._startEditingDescription}
               title="Click to edit description">
              ${isGenericDesc ? 'Click to add a description...' : description}
            </p>
          `}
          <div class="photon-header-meta">
            ${isApp ? html`<span class="photon-badge app">App</span>` : html`<span class="photon-badge">MCP</span>`}
            <span class="photon-badge">${methodCount} method${methodCount !== 1 ? 's' : ''}</span>
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
  }

  private _handleDescriptionKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._saveDescription();
    } else if (e.key === 'Escape') {
      this._editingDescription = false;
    }
  }

  private _saveDescription = async () => {
    this._editingDescription = false;
    const newDesc = this._editedDescription.trim();

    if (newDesc && this._selectedPhoton && this._mcpReady) {
      // Update local state optimistically
      this._selectedPhoton = { ...this._selectedPhoton, description: newDesc };

      // Send to server to persist via MCP
      const result = await mcpClient.updateMetadata(this._selectedPhoton.name, null, { description: newDesc });
      if (result.success) {
        showToast('Description updated', 'success');
      } else {
        showToast(result.error || 'Failed to update description', 'error');
      }
    }
  }

  private _startEditingIcon = () => {
    this._editingIcon = !this._editingIcon;
  }

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
  }

  private _handleMethodMetadataUpdate = async (e: CustomEvent) => {
    const { photonName, methodName, metadata } = e.detail;

    if (this._selectedPhoton && this._selectedPhoton.name === photonName && this._mcpReady) {
      // Update local state optimistically
      const methods = this._selectedPhoton.methods?.map((m: any) => {
        if (m.name === methodName) {
          return {
            ...m,
            ...(metadata.description !== undefined ? { description: metadata.description || '' } : {}),
            ...(metadata.icon !== undefined ? { icon: metadata.icon || undefined } : {})
          };
        }
        return m;
      });

      this._selectedPhoton = { ...this._selectedPhoton, methods };

      // Send to server to persist via MCP
      const result = await mcpClient.updateMetadata(photonName, methodName, metadata);
      if (result.success) {
        showToast(`Method ${metadata.description !== undefined ? 'description' : 'icon'} updated`, 'success');
      } else {
        showToast(result.error || 'Failed to update method metadata', 'error');
      }
    }
  }

  private _renderEmojiPicker() {
    const emojis = [
      '🔧', '⚙️', '🛠️', '🔨', '🔩', '⚡', '💡', '🎯',
      '📊', '📈', '📉', '📋', '📝', '📁', '📂', '🗂️',
      '🌐', '🔗', '🔒', '🔓', '🔑', '🛡️', '🔍', '🔎',
      '💾', '💿', '📀', '🖥️', '💻', '📱', '⌨️', '🖱️',
      '🤖', '🧠', '🎨', '🎭', '🎬', '🎮', '🎲', '🧩',
      '📧', '💬', '💭', '🗨️', '📣', '📢', '🔔', '🔕',
      '✅', '❌', '⭐', '🌟', '💫', '✨', '🔥', '💥',
    ];

    return html`
      <div class="emoji-picker" @click=${(e: Event) => e.stopPropagation()}>
        ${emojis.map(emoji => html`
          <button @click=${() => this._selectIcon(emoji)}>${emoji}</button>
        `)}
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
        ${prompts.map((prompt: any) => html`
          <div class="asset-card glass-panel" @click=${() => this._handlePromptSelect(prompt)}>
            <div class="asset-header">
              <div class="asset-icon prompt">📝</div>
              <span class="asset-name">${prompt.id}</span>
            </div>
            <div class="asset-desc">${prompt.description || 'Click to view and customize this prompt'}</div>
            <div class="asset-meta">${prompt.path}</div>
          </div>
        `)}
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
        ${resources.map((resource: any) => html`
          <div class="asset-card glass-panel" @click=${() => this._handleResourceSelect(resource)}>
            <div class="asset-header">
              <div class="asset-icon resource">📦</div>
              <span class="asset-name">${resource.id}</span>
            </div>
            <div class="asset-desc">${resource.description || 'Click to view this resource'}</div>
            <div class="asset-meta">${resource.mimeType || resource.path}</div>
          </div>
        `)}
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
            description: prompt.description
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
  }

  private _extractVariables(content: string): string[] {
    const matches = content.match(/\{\{(\w+)\}\}/g) || [];
    return [...new Set(matches.map(m => m.slice(2, -2)))];
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
            description: resource.description
          };
          this._resourceContent = content.text || '';
        }
      } catch (error) {
        console.error('Failed to load resource:', error);
      }
    }
  }

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
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._closePromptModal(); }}>
        <div class="asset-viewer-modal glass-panel">
          <button class="close-btn" @click=${this._closePromptModal}>&times;</button>

          <h2>
            <span class="icon">📝</span>
            ${this._selectedPrompt.id}
          </h2>

          ${this._selectedPrompt.description ? html`
            <p class="description">${this._selectedPrompt.description}</p>
          ` : ''}

          ${hasVariables ? html`
            <div class="variables-form">
              <h4>Variables</h4>
              ${variables.map((v: string) => html`
                <div class="variable-input">
                  <label>{{${v}}}</label>
                  <input
                    type="text"
                    placeholder="Enter value..."
                    .value=${this._promptArguments[v] || ''}
                    @input=${(e: Event) => this._updatePromptArgument(v, (e.target as HTMLInputElement).value)}
                  />
                </div>
              `)}
            </div>
          ` : ''}

          <div class="content-section">
            <h4>${hasVariables ? 'Rendered Prompt' : 'Content'}</h4>
            <div class="content-preview" .innerHTML=${renderedContent}></div>
          </div>

          <button class="copy-btn" @click=${this._copyPromptContent}>
            📋 Copy to Clipboard
          </button>
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
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._closeResourceModal(); }}>
        <div class="asset-viewer-modal glass-panel">
          <button class="close-btn" @click=${this._closeResourceModal}>&times;</button>

          <h2>
            <span class="icon">📦</span>
            ${this._selectedResource.id}
          </h2>

          ${this._selectedResource.description ? html`
            <p class="description">${this._selectedResource.description}</p>
          ` : ''}

          <div class="content-section">
            <h4>Content <span style="opacity:0.5">(${mimeType})</span></h4>
            ${isImage ? html`
              <img class="resource-image" src="data:${mimeType};base64,${this._selectedResource.content}" alt="${this._selectedResource.id}" />
            ` : html`
              <div class="content-preview">${displayContent}</div>
            `}
          </div>

          ${!isImage ? html`
            <button class="copy-btn" @click=${this._copyResourceContent}>
              📋 Copy to Clipboard
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  private _closePromptModal = () => {
    this._selectedPrompt = null;
    this._promptArguments = {};
    this._renderedPrompt = '';
  }

  private _closeResourceModal = () => {
    this._selectedResource = null;
    this._resourceContent = '';
  }

  private _updatePromptArgument = (key: string, value: string) => {
    this._promptArguments = {
      ...this._promptArguments,
      [key]: value
    };
  }

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
  }

  private _copyResourceContent = async () => {
    try {
      await navigator.clipboard.writeText(this._resourceContent);
      showToast('Resource copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy', 'error');
    }
  }

  private _renderHelpModal() {
    return html`
      <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="help-modal-title" @click=${(e: Event) => { if (e.target === e.currentTarget) this._closeHelp(); }}>
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
          >Close</button>
        </div>
      </div>
    `;
  }

  private _renderPhotonHelpModal() {
    const markdown = this._generatePhotonHelpMarkdown();
    let htmlContent = markdown;

    // Parse markdown if marked is available
    if ((window as any).marked) {
      htmlContent = (window as any).marked.parse(markdown);
    }

    return html`
      <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="photon-help-title" @click=${(e: Event) => { if (e.target === e.currentTarget) this._closePhotonHelp(); }}>
        <div class="help-modal glass-panel" style="max-width: 700px; max-height: 80vh; overflow: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-md);">
            <h2 id="photon-help-title" class="text-gradient" style="margin: 0;">${this._selectedPhoton?.name || 'Photon'} Help</h2>
            <button
              class="btn-secondary"
              style="padding: 6px 12px; font-size: 0.85rem;"
              @click=${this._closePhotonHelp}
              aria-label="Close help"
            >✕</button>
          </div>
          <div class="markdown-body" style="color: var(--t-default);">
            ${(window as any).marked ? html`${unsafeHTML(htmlContent)}` : html`<pre style="white-space: pre-wrap;">${markdown}</pre>`}
          </div>
        </div>
      </div>
    `;
  }
}
