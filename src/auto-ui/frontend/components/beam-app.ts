import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { customElement, property, state, query } from 'lit/decorators.js';
import { theme, Theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';
import { confirmElicit } from '../utils/elicit.js';
import {
  xMark,
  menu,
  expand,
  collapse,
  clipboard,
  pencil,
  source,
  check,
  hourglass,
  appDefault,
  refresh,
  play,
  upload,
  prompts as promptsIcon,
  file as fileIcon,
  iconSvgString,
  iconPaths,
} from '../icons.js';
import { trapFocus } from '../utils/focus-trap.js';
import type { BeamSidebar } from './beam-sidebar.js';
import type { ResultViewer } from './result-viewer.js';
import { getThemeTokens } from '../../design-system/tokens.js';
import { loadSavedThemeConfig } from './theme-settings.js';
import {
  generateBeamThemeColors,
  beamThemeToCSS,
  type ThemeConfig,
} from '../../design-system/tokens.js';
import type { ElicitationData } from './elicitation-modal.js';
import type { ApprovalItem } from './pending-approvals.js';
import './pending-approvals.js';
import { mcpClient } from '../services/mcp-client.js';
import {
  initializeGlobalPhotonSession,
  getGlobalSessionManager,
} from '../services/photon-instance-manager.js';
import { ViewportAwareProxy } from '../services/viewport-aware-proxy.js';
import { ViewportManager, getPageSizeForClient } from '../services/viewport-manager.js';
import { buildBeamRoutePath, parseBeamRoutePath } from '../utils/beam-route.js';
import { formatLabel } from '../utils/format-label.js';

const THEME_STORAGE_KEY = 'beam-theme';
const PROTOCOL_STORAGE_KEY = 'beam-protocol';
const FETCH_TIMEOUT_MS = 10_000;
const MCP_RECONNECT_DELAY_MS = 3_000;
const MCP_MAX_CONNECT_RETRIES = 5;
const SCROLL_RENDER_DELAY_MS = 100;

@customElement('beam-app')
export class BeamApp extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        /* ===== Dark Theme (Default) — Precision Optics ===== */
        --bg-app: #0b1018;
        --bg-glass: hsla(215, 25%, 12%, 0.6);
        --bg-glass-strong: hsla(215, 25%, 12%, 0.85);
        --bg-panel: #131b28;
        --t-primary: #f0ede6;
        --t-muted: #6b8a8a;
        --border-glass: hsla(210, 20%, 50%, 0.12);
        --accent-primary: #ffb000;
        --accent-secondary: #78e6ff;
        --glow-primary: rgba(255, 176, 0, 0.3);

        /* Semantic status colors */
        --color-error: #ff6b6b;
        --color-error-glow: rgba(255, 107, 107, 0.6);
        --color-error-bg: rgba(255, 107, 107, 0.1);
        --color-success: #58d68d;
        --color-success-glow: rgba(88, 214, 141, 0.6);
        --color-success-bg: rgba(88, 214, 141, 0.15);
        --color-warning: #ffb347;
        --color-warning-bg: rgba(255, 179, 71, 0.15);
        --color-warning-glow: rgba(255, 179, 71, 0.6);
        --color-info: var(--accent-secondary);

        /* CLI preview */
        --cli-bg: #080c12;
        --cli-border: #1e2d3d;
        --cli-text: #58d68d;
        --cli-muted: #4a6565;
        --cli-hover-bg: #0b1018;

        /* Initials icon (marketplace cards) */
        --initials-bg-sat: 25%;
        --initials-bg-lum: 18%;
        --initials-fg-sat: 50%;
        --initials-fg-lum: 70%;

        /* Shadow tokens (dark defaults) */
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
        --shadow-md: 0 4px 24px -1px rgba(0, 0, 0, 0.3);
        --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.35);

        display: flex;
        height: 100vh;
        width: 100vw;
        background: var(--bg-app);
        color: var(--t-primary);
        font-family: var(--font-sans);
        overflow: visible; /* Allow focus rings and shadows to display */
      }

      /* ===== Light Theme — Mineral Paper ===== */
      :host([data-theme='light']) {
        --bg-app: #eef1f5;
        --bg-glass: rgba(255, 255, 255, 0.75);
        --bg-glass-strong: rgba(255, 255, 255, 0.9);
        --bg-panel: #ffffff;
        --t-primary: #0d1420;
        --t-muted: #5f6b7a;
        --border-glass: rgba(100, 120, 150, 0.15);
        --accent-primary: #d98a00;
        --accent-secondary: #0ea5c6;
        --glow-primary: rgba(217, 138, 0, 0.15);

        /* Semantic status colors — light theme */
        --color-error: #d64545;
        --color-error-glow: rgba(214, 69, 69, 0.5);
        --color-error-bg: rgba(214, 69, 69, 0.08);
        --color-success: #1f9d68;
        --color-success-glow: rgba(31, 157, 104, 0.55);
        --color-success-bg: rgba(31, 157, 104, 0.1);
        --color-warning: #d98a00;
        --color-warning-bg: rgba(217, 138, 0, 0.1);
        --color-warning-glow: rgba(217, 138, 0, 0.5);
        --color-info: var(--accent-secondary);

        /* CLI preview — light theme */
        --cli-bg: #f5f7fa;
        --cli-border: var(--border-glass);
        --cli-text: #1f9d68;
        --cli-muted: var(--t-muted);
        --cli-hover-bg: #e8ecf2;

        /* Light-mode shadows — cool, clean */
        --shadow-sm: 0px 1px 3px rgba(0, 20, 50, 0.06), 0px 1px 2px rgba(0, 20, 50, 0.04);
        --shadow-md: 0px 2px 6px rgba(0, 20, 50, 0.06), 0px 4px 8px rgba(0, 20, 50, 0.04);
        --shadow-lg: 0px 4px 8px rgba(0, 20, 50, 0.06), 0px 10px 20px rgba(0, 20, 50, 0.04);

        /* Initials icon (marketplace cards) */
        --initials-bg-sat: 20%;
        --initials-bg-lum: 92%;
        --initials-fg-sat: 40%;
        --initials-fg-lum: 35%;

        /* Parameter tags — cool chip style for light backgrounds */
        --param-tag-bg: rgba(100, 120, 150, 0.1);
        --param-tag-color: #3a4a5c;
      }

      /* Skip to main content link — WCAG 2.4.1 */
      .skip-link {
        position: absolute;
        left: -9999px;
        top: auto;
        width: 1px;
        height: 1px;
        overflow: hidden;
        z-index: 10000;
        padding: var(--space-sm) var(--space-md);
        background: var(--accent-primary);
        color: white;
        font-size: var(--text-md);
        border-radius: var(--radius-sm);
        text-decoration: none;
      }

      .skip-link:focus {
        position: fixed;
        left: var(--space-md);
        top: var(--space-md);
        width: auto;
        height: auto;
        overflow: visible;
      }

      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .sidebar-area {
        width: var(--sidebar-width, 300px);
        flex-shrink: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: visible;
      }

      .sidebar-resize-handle {
        position: absolute;
        right: -3px;
        top: 0;
        bottom: 0;
        width: 6px;
        cursor: col-resize;
        z-index: 20;
        background: transparent;
        transition: background 0.15s;
      }

      .sidebar-resize-handle:hover,
      .sidebar-resize-handle.dragging {
        background: var(--accent-primary);
        opacity: 0.5;
      }

      :host(.focus-mode) .sidebar-area {
        display: none;
      }

      :host(.focus-mode) .photon-header {
        display: none;
      }

      :host(.focus-mode) context-bar {
        display: none;
      }

      :host(.focus-mode) .main-area {
        padding: 0;
      }

      :host(.focus-mode) .main-toolbar {
        display: none !important;
      }

      /* View modes: isolate form or result for testing/embedding.
         Hides ALL chrome — method selector, description, CLI preview, activity log,
         toolbars, focus toolbar. Only the target component renders. */
      :host(.view-result) invoke-form,
      :host(.view-result) .progress-container,
      :host(.view-result) .result-empty,
      :host(.view-form) result-viewer,
      :host(.view-form) custom-ui-renderer,
      :host(.view-form) canvas-renderer,
      :host(.view-form) .result-empty {
        display: none !important;
      }

      :host(.view-result) .mobile-menu-btn,
      :host(.view-result) .focus-toolbar,
      :host(.view-result) .main-toolbar,
      :host(.view-result) .method-toolbar,
      :host(.view-result) .method-description,
      :host(.view-result) .method-header,
      :host(.view-result) activity-log,
      :host(.view-result) .glass-panel > div > p,
      :host(.view-result) app-layout,
      :host(.view-result) .result-chrome,
      :host(.view-form) .mobile-menu-btn,
      :host(.view-form) .focus-toolbar,
      :host(.view-form) .main-toolbar,
      :host(.view-form) .method-toolbar,
      :host(.view-form) .method-header,
      :host(.view-form) .method-description,
      :host(.view-form) activity-log,
      :host(.view-form) app-layout,
      :host(.view-form) .result-chrome {
        display: none !important;
      }

      :host(.view-result) .main-area,
      :host(.view-form) .main-area {
        padding: 0 !important;
      }

      /* In view modes, strip ALL chrome — panel header, method bar, form chrome */
      :host(.view-result) .method-name-bar,
      :host(.view-result) .form-chrome,
      :host(.view-result) .panel-header,
      :host(.view-result) .method-detail > div:first-child,
      :host(.view-form) .method-name-bar,
      :host(.view-form) .form-chrome,
      :host(.view-form) .panel-header {
        display: none !important;
      }

      /* In view modes, remove glass-panel styling and fill the viewport */
      :host(.view-result) .method-detail,
      :host(.view-form) .method-detail {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 !important;
        flex: 1 !important;
        display: flex !important;
        flex-direction: column !important;
        height: 100% !important;
      }

      /* View modes: content fills and centers in the viewport */
      :host(.view-result) .main-area,
      :host(.view-form) .main-area {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 100vh !important;
        overflow: hidden !important;
      }

      /* Scale content to fill available space using container queries */
      :host(.view-result) .main-area > *,
      :host(.view-form) .main-area > * {
        width: 100% !important;
        max-width: 100% !important;
      }

      /* In view=form mode, let the form expand to fill the viewport height
         so fields aren't clipped in short iframes */
      :host(.view-form) .method-detail {
        flex: 1 !important;
        display: flex !important;
        flex-direction: column !important;
        height: 100vh !important;
        overflow: auto !important;
      }
      :host(.view-form) invoke-form {
        flex: 1 !important;
        overflow: auto !important;
      }

      .result-chrome {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border-primary, rgba(255, 255, 255, 0.08));
        font-size: 12px;
      }
      .result-chrome-title {
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.6;
      }
      .result-chrome-actions {
        display: flex;
        gap: 6px;
      }
      .result-chrome-actions button {
        padding: 4px 10px;
        border-radius: 4px;
        border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.12));
        background: transparent;
        color: var(--text-secondary, #aaa);
        font-size: 11px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .result-chrome-actions button:hover {
        background: rgba(128, 128, 128, 0.1);
      }

      .form-chrome {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--border-primary, rgba(255, 255, 255, 0.08));
      }
      .form-chrome button {
        padding: 8px 20px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.12));
        transition:
          background 0.15s,
          opacity 0.15s;
      }
      .form-chrome .btn-secondary {
        background: transparent;
        color: var(--text-secondary, #aaa);
      }
      .form-chrome .btn-secondary:hover {
        background: rgba(128, 128, 128, 0.1);
      }
      .form-chrome .btn-primary {
        background: var(--accent-primary, #7dd3fc);
        color: #000;
        border-color: transparent;
        font-weight: 600;
      }
      .form-chrome .btn-primary:hover {
        opacity: 0.9;
      }
      .form-chrome button:disabled {
        opacity: 0.4;
        cursor: default;
      }

      .focus-toolbar {
        position: sticky;
        top: 0;
        z-index: 200;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 6px 8px;
        gap: 4px;
        flex-shrink: 0;
      }

      .focus-toolbar .focus-toolbar-back {
        margin-right: auto;
      }

      .focus-toolbar button {
        width: 28px;
        height: 28px;
        border-radius: var(--radius-sm);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        cursor: pointer;
        font-size: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        backdrop-filter: blur(8px);
      }

      .main-area {
        flex: 1;
        min-width: 0;
        position: relative;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .main-content-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: var(--space-lg);
        scrollbar-gutter: stable;
        display: flex;
        flex-direction: column;
      }

      /* Page transition when switching photons */
      @keyframes page-enter {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .main-area.page-transitioning {
        animation: page-enter 0.2s var(--motion-ease-out, ease-out) both;
      }

      .main-toolbar {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        margin-bottom: 8px;
        flex-shrink: 0;
      }

      .beam-back-btn,
      .beam-fullscreen-btn {
        width: 28px;
        height: 28px;
        border-radius: var(--radius-sm);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        cursor: pointer;
        font-size: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        backdrop-filter: blur(8px);
      }

      .beam-back-btn {
        margin-right: auto;
      }

      .beam-fullscreen-btn {
        margin-left: auto;
      }

      .beam-tab-btn.active {
        color: var(--accent-secondary);
        border-color: var(--accent-secondary);
      }

      .tab-group-divider {
        width: 1px;
        height: 16px;
        background: var(--border-glass);
        margin: 0 2px;
        align-self: center;
      }

      .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, min(100%, 380px)));
        gap: var(--space-md);
        align-items: stretch;
      }

      method-card.flash-highlight {
        animation: flash-highlight 0.6s ease-out;
      }

      @keyframes flash-highlight {
        0% {
          outline: 2px solid var(--accent-primary);
          outline-offset: 2px;
        }
        100% {
          outline: 2px solid transparent;
          outline-offset: 2px;
        }
      }

      /* Empty states */
      .empty-state-inline {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-lg);
        color: var(--t-muted);
        font-size: var(--text-md);
        border: 1px dashed var(--border-glass);
        border-radius: var(--radius-md);
        justify-content: center;
      }

      .empty-state-icon {
        font-size: var(--text-xl);
        opacity: 0.6;
      }

      .result-empty {
        margin-top: var(--space-md);
      }

      /* Bento Layout */
      .bento-methods {
        margin-top: var(--space-lg);
        margin-bottom: var(--space-lg);
      }

      /* Anchor navigation: Methods | Prompts | Resources */
      .anchor-nav {
        display: flex;
        gap: var(--space-md);
        margin: 0 0 var(--space-md);
      }

      .anchor-link {
        color: var(--accent-secondary);
        font-size: var(--text-sm);
        font-weight: 500;
        cursor: pointer;
        text-decoration: none;
        padding: 4px 0;
        border-bottom: 2px solid transparent;
        transition: all 0.15s;
      }

      .anchor-link:hover {
        border-bottom-color: var(--accent-secondary);
      }

      .bento-section-title {
        font-family: var(--font-display);
        color: var(--t-muted);
        text-transform: uppercase;
        font-size: var(--text-xs);
        letter-spacing: 0.1em;
        font-weight: 600;
        margin: 0 0 var(--space-md) 0;
      }

      .bento-bottom-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-lg);
        margin-top: var(--space-md);
      }

      @media (max-width: 768px) {
        .bento-bottom-grid {
          grid-template-columns: 1fr;
        }
      }

      /* Photon Header */
      .photon-header {
        display: flex;
        align-items: flex-start;
        gap: var(--space-lg);
        margin-bottom: var(--space-md);
      }

      .photon-icon-large {
        width: 64px;
        height: 64px;
        border-radius: var(--radius-lg);
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        color: white;
        flex-shrink: 0;
        box-shadow: var(--shadow-lg);
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
        font-family: var(--font-display);
        font-size: var(--text-3xl);
        font-weight: 700;
        margin: 0 0 var(--space-sm) 0;
        background: linear-gradient(135deg, var(--t-primary), var(--accent-secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .photon-header-desc {
        color: var(--t-muted);
        font-size: var(--text-lg);
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
        font-size: var(--text-xs);
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
        font-size: var(--text-xs);
        padding: 4px 10px;
        border-radius: var(--radius-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
      }

      .photon-badge.app {
        background: rgba(255, 176, 0, 0.15);
        border-color: rgba(255, 176, 0, 0.3);
        color: #ffca4d;
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

      /* Button resets — elements converted from div/p/span to button */
      button.photon-icon-large {
        border: none;
        padding: 0;
      }

      button.photon-header-desc {
        background: transparent;
        border: none;
        padding: 0;
        font: inherit;
        text-align: left;
      }

      button.photon-header-path {
        background: transparent;
        border: none;
        padding: 0;
      }

      button.photon-badge.update {
        font: inherit;
      }

      button.asset-card {
        width: 100%;
        font: inherit;
        text-align: left;
      }

      .photon-header-actions {
        display: flex;
        gap: var(--space-sm);
        margin-top: var(--space-sm);
      }

      .btn-sm {
        font-size: var(--text-xs);
        padding: 4px 12px;
        border-radius: var(--radius-sm);
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
        content: '';
        position: absolute;
        right: -22px;
        top: 50%;
        transform: translateY(-50%);
        width: 14px;
        height: 14px;
        background: currentColor;
        opacity: 0.5;
        -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/%3E%3Cpath d='m15 5 4 4'/%3E%3C/svg%3E");
        mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/%3E%3Cpath d='m15 5 4 4'/%3E%3C/svg%3E");
        -webkit-mask-size: contain;
        mask-size: contain;
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
          var(--shadow-lg),
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
        box-shadow: var(--shadow-lg);
        z-index: 100;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 4px;
        max-width: 280px;
      }

      .emoji-picker button {
        background: none;
        border: none;
        font-size: var(--text-2xl);
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
        font-family: var(--font-display);
        color: var(--t-muted);
        text-transform: uppercase;
        font-size: var(--text-sm);
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
        border-radius: var(--radius-full);
        font-size: var(--text-xs);
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
        box-shadow: var(--shadow-lg);
        border-color: var(--accent-secondary);
      }

      .asset-card .asset-icon {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
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
        font-size: var(--text-lg);
        color: var(--t-primary);
      }

      .asset-card .asset-desc {
        font-size: var(--text-md);
        color: var(--t-muted);
        flex: 1;
      }

      .asset-card .asset-meta {
        font-size: var(--text-xs);
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
        border-radius: var(--radius-md);
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
        font-size: var(--text-2xl);
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
        font-size: var(--text-md);
        white-space: pre-wrap;
        line-height: 1.6;
        max-height: 400px;
        overflow-y: auto;
      }

      .prompt-preview .variable {
        background: hsla(45, 80%, 50%, 0.2);
        color: hsl(45, 80%, 60%);
        padding: 2px 6px;
        border-radius: var(--radius-xs);
        font-weight: 500;
      }

      .connection-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: var(--color-error);
        color: white;
        padding: var(--space-sm) var(--space-md);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-md);
        z-index: 9998;
        font-size: var(--text-md);
      }

      .connection-banner button {
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 4px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--text-sm);
      }

      .connection-banner button:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .reconnecting {
        background: var(--color-warning);
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
        font-size: var(--text-2xl);
      }

      .help-modal-close {
        position: absolute;
        top: var(--space-md);
        right: var(--space-md);
        background: none;
        border: none;
        color: var(--t-muted);
        font-size: var(--text-2xl);
        cursor: pointer;
      }

      .markdown-body table {
        border-collapse: collapse;
        width: 100%;
        margin: var(--space-sm) 0;
        font-size: var(--text-md);
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
        font-size: var(--text-sm);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--t-muted);
      }

      .markdown-body code {
        background: var(--bg-glass);
        padding: 2px 5px;
        border-radius: var(--radius-xs);
        font-size: 0.85em;
      }

      .markdown-body pre {
        background: var(--bg-glass);
        padding: var(--space-md);
        border-radius: var(--radius-sm);
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
        font-size: var(--text-sm);
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
        border-radius: var(--radius-xs);
        padding: 2px 8px;
        font-family: var(--font-mono);
        font-size: var(--text-md);
      }

      .shortcut-desc {
        color: var(--t-muted);
        font-size: var(--text-md);
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
        font-size: var(--text-sm);
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
        border-color: var(--color-error);
        color: var(--color-error);
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
        font-size: var(--text-md);
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
        box-shadow: var(--shadow-lg);
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
        font-size: var(--text-md);
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
        font-size: var(--text-lg);
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
        border-radius: var(--radius-full);
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
        font-size: var(--text-2xl);
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
        font-size: var(--text-2xl);
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
        font-size: var(--text-md);
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
        font-size: var(--text-md);
        color: var(--color-warning);
      }

      .variable-input input {
        flex: 1;
        background: var(--bg-panel);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        padding: var(--space-sm) var(--space-md);
        color: var(--t-primary);
        font-size: var(--text-md);
      }

      .variable-input input:focus-visible {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--glow-primary);
      }

      /* Content Preview */
      .content-section {
        margin-top: var(--space-lg);
      }

      .content-section h4 {
        margin: 0 0 var(--space-sm) 0;
        font-size: var(--text-md);
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
        font-size: var(--text-md);
        white-space: pre-wrap;
        line-height: 1.6;
        max-height: 300px;
        overflow-y: auto;
      }

      .content-preview .var-highlight {
        background: hsla(45, 80%, 50%, 0.2);
        color: hsl(45, 80%, 60%);
        padding: 2px 6px;
        border-radius: var(--radius-xs);
      }

      .content-preview .var-filled {
        background: hsla(150, 80%, 50%, 0.2);
        color: hsl(150, 80%, 60%);
        padding: 2px 6px;
        border-radius: var(--radius-xs);
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
        box-shadow: var(--shadow-md);
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
        font-size: var(--text-2xl);
        box-shadow: var(--shadow-md);
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

      /* ===== Theme Settings Panel ===== */
      .theme-settings-overlay,
      .approvals-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.3);
        z-index: 1000;
      }

      .theme-settings-panel {
        position: fixed;
        top: var(--space-md);
        right: var(--space-md);
        bottom: var(--space-md);
        width: 280px;
        z-index: 1001;
        overflow-y: auto;
        border-radius: var(--radius-md);
        animation: slideInRight 0.2s ease;
      }

      .approvals-panel {
        position: fixed;
        bottom: var(--space-xl);
        left: var(--space-md);
        width: 340px;
        max-height: 60vh;
        z-index: 1001;
        overflow-y: auto;
        border-radius: var(--radius-md);
        animation: slideInUp 0.2s ease;
      }

      @keyframes slideInUp {
        from {
          transform: translateY(20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      @keyframes slideInRight {
        from {
          transform: translateX(20px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
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
        background: var(--bg-glass);
        border-radius: var(--radius-xs);
        overflow: hidden;
      }

      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
        border-radius: var(--radius-xs);
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
        font-size: var(--text-md);
        color: var(--t-muted);
      }

      .progress-percentage {
        font-weight: 600;
        color: var(--accent-secondary);
      }

      /* Method detail view */
      .method-detail {
        padding: var(--space-lg);
        margin-top: var(--space-md);
      }

      .split-divider {
        width: 5px;
        flex-shrink: 0;
        cursor: col-resize;
        background: var(--border-glass);
        position: relative;
        transition: background 0.15s;
      }

      .split-divider::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 1px;
        height: 32px;
        background: var(--t-muted);
        border-radius: 2px;
        opacity: 0.4;
      }

      .split-divider:hover,
      .split-divider.dragging {
        background: var(--accent-primary);
        opacity: 0.6;
      }

      .method-detail h2 {
        margin-top: 0;
      }

      .method-detail p {
        color: var(--t-muted);
      }

      .method-description p {
        margin: 0 0 0.4em;
      }
      .method-description p:last-child {
        margin-bottom: 0;
      }
      .method-description ul,
      .method-description ol {
        margin: 0.2em 0 0.4em;
        padding-left: 1.4em;
      }
      .method-description li {
        margin: 0.1em 0;
      }
      .method-description code {
        background: var(--bg-glass);
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 0.9em;
      }
      .method-description strong {
        color: var(--t-primary);
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

        .beam-back-btn {
          display: none; /* Handled by mobile menu button */
        }

        .beam-fullscreen-btn {
          width: 44px;
          height: 44px;
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

        /* Touch-friendly targets - min 44px (exclude small inline buttons) */
        .asset-card,
        .method-card,
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

        /* Compact method detail on mobile */
        .method-detail {
          padding: var(--space-md);
        }

        /* Help modal adjustments */
        .help-modal {
          padding: var(--space-lg);
          max-height: 85vh;
        }
      }

      @media (max-width: 480px) {
        .method-detail {
          padding: var(--space-sm);
        }

        .method-detail h2 {
          font-size: 1.25rem;
        }

        .method-detail p {
          font-size: 0.85rem;
        }

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
  private _connectRetries = 0;
  @state() private _sidebarVisible = false;
  @state() private _sidebarWidth = parseInt(
    localStorage.getItem('beam-sidebar-width') || '300',
    10
  );
  @state() private _focusMode = false;
  @state() private _viewMode: 'full' | 'form' | 'result' = 'full';
  @state() private _photons: any[] = [];
  @state() private _externalMCPs: any[] = [];
  @state() private _selectedPhoton: any = null;
  @state() private _view:
    | 'list'
    | 'form'
    | 'marketplace'
    | 'daemon'
    | 'config'
    | 'diagnostics'
    | 'mcp-app'
    | 'studio'
    | 'source' = 'list';
  @state() private _welcomePhase: 'welcome' | 'marketplace' = 'welcome';
  @state() private _configMode: 'initial' | 'edit' = 'initial';
  /**
   * Sub-tab inside the Settings view. Setup is constructor params /
   * env-injected values; Configuration is the auto-generated settings
   * MCP tool. Default chosen on tab entry, then user-selectable.
   */
  @state() private _settingsTab: 'setup' | 'configuration' = 'configuration';
  private _pendingStudioOpen = false; // Open Studio after maker creates a new photon
  private _pendingTemplateSource: string | undefined; // Template source to apply after Studio opens

  private _handleInstall(e: CustomEvent) {
    const name = e.detail.name;
    this._log('info', `Installed ${name}`);
    // After daemon updates photon list, scroll to and highlight the new photon
    setTimeout(() => {
      this._sidebar?.scrollPhotonIntoView(name);
    }, 1500); // Allow time for daemon photon_added event to refresh sidebar
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
    // Track if this is a creation action — open Studio after photon appears
    if (action === 'new' || action === 'wizard') {
      this._pendingStudioOpen = true;
      this._pendingTemplateSource = e.detail.templateSource;
    }
    const method = target.methods?.find((m: any) => m.name === action);
    if (method) {
      this._selectedMethod = method;
      this._view = 'form';
      this._updateRoute();
      this._log('info', `Starting ${targetName}/${action}...`);
      showToast(`Starting ${action}...`, 'info');
    } else {
      this._showError('Photon not found', `Method '${action}' not found on ${targetName}`);
    }
  }

  private async _handleCreatePhoton(filename: string, template = 'blank') {
    try {
      const res = await fetch('/api/create-photon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, template }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create photon' }));
        this._showError('Create failed', err.error);
        return;
      }
      const { name } = await res.json();
      showToast(`Created ${filename}`, 'success');
      // Wait for file watcher to pick it up, then select and open studio
      this._pendingStudioOpen = true;
      setTimeout(() => {
        this._sidebar?.scrollPhotonIntoView(name);
      }, 1500);
    } catch (err: any) {
      this._showError('Create failed', err.message);
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
  private _triggerPageTransition() {
    const mainArea = this.shadowRoot?.querySelector('.main-area') as HTMLElement;
    if (mainArea) {
      mainArea.classList.remove('page-transitioning');
      // Force reflow to restart animation
      void mainArea.offsetWidth;
      mainArea.classList.add('page-transitioning');
      mainArea.addEventListener(
        'animationend',
        () => {
          mainArea.classList.remove('page-transitioning');
        },
        { once: true }
      );
    }
  }

  private _handleGlobalMethodSelect(photon: any, method: any) {
    this._teardownActiveCustomUI();
    // Clear split view when switching to a different photon
    if (this._selectedPhoton?.name !== photon.name) {
      this._closeSecondPanel();
      this._triggerPageTransition();
    }
    this._selectedPhoton = photon;
    this._lastFormParams = {};
    this._sharedFormParams = null;
    // Set _isExecuting BEFORE setting state to prevent iframe from rendering
    // before the tool call starts (which would bypass elicitation)
    if (this._willAutoInvoke(method)) {
      this._isExecuting = true;
    }
    this._selectedMethod = method;
    this._view = 'form';
    this._updateRoute();
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
  @state() private _canvasActive = false; // true when canvas:ui/data streams are active
  @state() private _customUiRevision = 0; // bumped on tools-changed to invalidate custom UI iframes
  @state() private _customFormatUri: string | null = null;
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
  @state() private _showApprovals = false;
  @state() private _pendingApprovalsList: ApprovalItem[] = [];
  @state() private _protocolMode: 'legacy' | 'mcp' = 'legacy';
  @state() private _selectedMcpAppUri: string | null = null; // Selected tab for MCP Apps with multiple UIs
  @state() private _mcpReady = false;
  @state() private _showSettingsMenu = false;
  @state() private _showThemeSettings = false;
  @state() private _oklchEnabled = false;
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
  @state() private _currentInstance = 'default';
  @state() private _instances: string[] = [];
  @state() private _autoInstance = '';
  @state() private _instanceSelectorMode: 'auto' | 'manual' = 'auto';
  @state() private _selectedPrompt: any = null;
  @state() private _selectedResource: any = null;
  @state() private _promptArguments: Record<string, string> = {};
  @state() private _renderedPrompt: string = '';
  @state() private _resourceContent: string = '';

  // Split view state — N-panel system (primary panel uses existing state, additional panels here)
  @state() private _splitPanels: Array<{
    id: string;
    type: 'method' | 'source';
    method?: any;
    result?: any;
    executing?: boolean;
    progress?: { value: number; message: string } | null;
    formParams?: Record<string, any>;
    instance?: string;
  }> = [];
  @state() private _methodPickerOpen = false;
  @state() private _methodPickerPanelId: string | null = null;
  @state() private _splitPrimaryWidth: number | null = null; // null = equal flex split
  @state() private _mainTab: 'app' | 'methods' | 'log' | 'source' | 'settings' | 'help' = 'methods';
  private _nextPanelId = 0;
  // Maps progressToken → panelId so progress events route to the correct split pane
  private _panelProgressTokens = new Map<string | number, string>();

  private get _splitViewEnabled() {
    return this._splitPanels.length > 0;
  }

  @query('beam-sidebar')
  private _sidebar!: BeamSidebar;

  @query('result-viewer')
  private _resultViewer!: ResultViewer;

  // Collection auto-subscription for ReactiveArray/Map/Set events
  private _collectionUnsubscribes: Array<() => void> = [];
  private _currentCollectionName: string | null = null;

  private _pendingBridgeCalls = new Map<string, Window>();

  // File storage for ChatGPT Apps SDK uploadFile/getFileDownloadUrl
  private _uploadedFiles = new Map<string, { data: string; fileName: string; fileType: string }>();
  private _modelContext: any = null;
  private _fileIdCounter = 0;

  // Deep link URL for setOpenInAppUrl
  private _openInAppUrl: string | null = null;

  // PWA install state
  private _pwaInstallPrompt: any = null;
  private _pwaIsStandalone = false;
  private _pwaCurrentPhoton: string | null = null;

  connectedCallback() {
    super.connectedCallback();

    // Load saved theme preference
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme;
    if (savedTheme === 'light' || savedTheme === 'dark') {
      this._theme = savedTheme;
    }
    this._applyTheme();

    // Apply saved OKLCH theme config if present
    const savedOklch = loadSavedThemeConfig();
    if (savedOklch) {
      this._oklchEnabled = true;
      this._applyOklchTheme({
        hue: savedOklch.hue,
        chroma: savedOklch.chroma,
        lightness: savedOklch.lightness,
        theme: this._theme,
      });
    }

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

    // Note: ?view=form|result|embed URLs are now served by pure-view.html (bridge-powered)
    // and never reach beam-app. The view mode CSS and focus mode are still used for the
    // in-IDE focus toggle and any edge cases where view mode is set programmatically.

    // Click outside to close settings menu
    document.addEventListener('click', this._handleDocumentClick);

    // Listen for local elicitation requests (from confirmElicit/promptElicit/elicit)
    document.addEventListener('beam:elicit-local', this._handleLocalElicit as EventListener);

    // Connect via MCP Streamable HTTP (SSE for notifications)
    void this._connectMCP();

    // Set up notification handlers
    this._setupNotificationHandlers();

    window.addEventListener('popstate', this._handleRouteChange);
    window.addEventListener('message', this._handleBridgeMessage);
    window.addEventListener('keydown', this._handleKeydown);

    // PWA: Register service worker and install prompt listener
    this._initPWA();
  }

  private _viewScaleObserver: ResizeObserver | null = null;

  private _setupViewModeScaling(): void {
    const scale = () => {
      const rv = this.shadowRoot?.querySelector('result-viewer') as HTMLElement;
      if (!rv) return;

      // Measure the actual rendered content inside result-viewer's shadow DOM
      const rvContent = rv.shadowRoot?.querySelector('.content') as HTMLElement;
      if (!rvContent) return;

      // Reset zoom to measure natural size
      rv.style.zoom = '';

      const viewportH = window.innerHeight;
      const viewportW = window.innerWidth;
      const contentH = rvContent.scrollHeight || rvContent.offsetHeight;
      const contentW = rvContent.scrollWidth || rvContent.offsetWidth;

      if (contentH <= 0 || viewportH <= 0) return;

      // Scale based on height — content typically spans full width already.
      // CSS zoom on the result-viewer will enlarge text, rows, and spacing
      // proportionally while the container clips any horizontal overflow.
      const pad = 32;
      const zoom = (viewportH - pad) / contentH;
      const clamped = Math.max(0.8, Math.min(3, zoom));

      if (clamped > 1.02) {
        rv.style.zoom = String(clamped);
      }
    };

    // Poll until content appears, then scale + observe
    const poll = () => {
      const rv = this.shadowRoot?.querySelector('result-viewer') as HTMLElement;
      const content = rv?.shadowRoot?.querySelector('.content') as HTMLElement;
      if (!content || content.scrollHeight < 10) {
        setTimeout(poll, 300);
        return;
      }
      scale();
      // Re-scale on window resize
      window.addEventListener('resize', () => requestAnimationFrame(scale));
    };

    setTimeout(poll, 500);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this._handleRouteChange);
    window.removeEventListener('message', this._handleBridgeMessage);
    window.removeEventListener('keydown', this._handleKeydown);
    document.removeEventListener('click', this._handleDocumentClick);
    document.removeEventListener('beam:elicit-local', this._handleLocalElicit as EventListener);
    this._cleanupCollectionSubscriptions();
  }

  willUpdate(changedProperties: Map<string | number | symbol, unknown>) {
    super.willUpdate(changedProperties);
    if (changedProperties.has('_selectedPhoton')) {
      const name = this._selectedPhoton?.name || null;
      if (name !== this._pwaCurrentPhoton) {
        this._pwaCurrentPhoton = name;
        if (name) {
          this._setupPWAManifest(name);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PWA — Progressive Web App support
  // ---------------------------------------------------------------------------

  private _initPWA() {
    // Detect if already running as an installed PWA
    this._pwaIsStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    // Register the service worker (provides offline boot page & health checks)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => this._log('info', `PWA SW registered: ${reg.scope}`, true))
        .catch((err) => this._log('warn', `PWA SW registration failed: ${err}`, true));
    }

    // Chrome/Edge fire this when the page meets installability criteria
    window.addEventListener('beforeinstallprompt', (e: any) => {
      this._pwaInstallPrompt = e;
    });

    window.addEventListener('appinstalled', () => {
      this._pwaInstallPrompt = null;
      this._log('info', 'PWA app installed');
    });
  }

  /**
   * Set up notification handlers for photon notifications.
   * When a notification arrives for a photon that cares about that event type,
   * bring the window to focus (especially important for PWAs/background tabs).
   */
  private _setupNotificationHandlers() {
    mcpClient.on('photon-notification', (notification: any) => {
      const { photon, type, priority } = notification;
      if (!photon || !type) return;

      // Check if this photon cares about this notification type
      // This information comes from @notify-on tags in the photon source
      const sidebarElement = this.querySelector('beam-sidebar');
      if (sidebarElement && sidebarElement.isNotificationWatched) {
        const isWatched = sidebarElement.isNotificationWatched(photon, type);

        // Only bring window to focus if photon explicitly cares about this event
        if (isWatched) {
          window.focus();
          console.log(`📡 Window focused for ${photon} notification: ${type}`);

          // Optional: update sidebar warmth
          sidebarElement.updatePhotonWarmth?.(photon);
        }
      }
    });
  }

  /**
   * Set up the PWA manifest & icons for the currently selected photon.
   * Called whenever the selected photon changes. The manifest points to
   * /api/pwa/icon-png URLs which the service worker intercepts and renders
   * as real PNGs via OffscreenCanvas — no client-side blob URL needed.
   */
  private _setupPWAManifest(photonName: string) {
    // Update (or create) <link rel="manifest">
    let manifestLink = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = `/api/pwa/manifest.json?photon=${encodeURIComponent(photonName)}`;

    // Update (or create) <link rel="apple-touch-icon">
    let appleIcon = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
      appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = `/api/pwa/icon?photon=${encodeURIComponent(photonName)}`;

    // Update <meta name="apple-mobile-web-app-title">
    let appleTitleMeta = document.head.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-title"]'
    );
    if (!appleTitleMeta) {
      appleTitleMeta = document.createElement('meta');
      appleTitleMeta.name = 'apple-mobile-web-app-title';
      document.head.appendChild(appleTitleMeta);
    }
    appleTitleMeta.content = photonName;

    // Pre-warm the service worker icon cache so Chrome's install dialog
    // shows the rendered emoji icon instead of the fallback solid-color PNG.
    // The SW intercepts /api/pwa/icon-png requests and renders the SVG via
    // OffscreenCanvas, then caches the result. Fetching here triggers that
    // rendering before the user clicks install.
    this._prewarmIconCache(photonName);

    this._log('info', `PWA manifest set for "${photonName}"`, true);
  }

  /**
   * Pre-warm the service worker icon cache by fetching the PNG icon URLs.
   * This ensures the rendered emoji icons are cached before the user
   * attempts to install the PWA, improving the install dialog appearance.
   */
  private _prewarmIconCache(photonName: string) {
    const sizes = [192, 512];
    sizes.forEach((size) => {
      const url = `/api/pwa/icon-png?photon=${encodeURIComponent(photonName)}&size=${size}`;
      fetch(url, { mode: 'no-cors' }).catch(() => {});
    });
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

  private _initialConnectDone = false;

  private async _connectMCP() {
    try {
      // Wire the sampling handler BEFORE connecting so the very first
      // server→client `sampling/createMessage` during initialization
      // (rare, but possible when a photon's onInitialize samples) has
      // somewhere to land. The handler surfaces a modal asking the
      // person at Beam to answer — Beam plays the role of a
      // sampling-capable client by routing to the human.
      mcpClient.setRequestHandler('sampling/createMessage', async (params) => {
        const { openSamplingModal } = await import('./sampling-modal.js');
        const text = await openSamplingModal(params as any);
        return {
          role: 'assistant' as const,
          content: { type: 'text' as const, text },
          model: 'human@beam',
          stopReason: 'endTurn',
        };
      });

      mcpClient.on('connect', () => {
        void (async () => {
          const isReconnect = this._initialConnectDone;
          this._mcpReady = true;
          this._connected = true;
          this._reconnecting = false;
          this._reconnectAttempt = 0;
          console.log(isReconnect ? 'MCP client reconnected' : 'MCP client connected');

          // Load/refresh photon list
          const tools = await mcpClient.listTools();
          const { photons, externalMCPs } = mcpClient.toolsToPhotons(tools);
          this._photons = photons;
          this._externalMCPs = externalMCPs;

          // Add unconfigured photons from configuration schema
          this._addUnconfiguredPhotons();

          if (isReconnect) {
            // Reconnect: update selected photon reference but do NOT re-invoke main()
            // Re-invoking would blank the app UI that's already displaying content
            if (this._selectedPhoton) {
              const updated = this._photons.find((p) => p.name === this._selectedPhoton?.name);
              if (updated) this._selectedPhoton = updated;
            }
            // Restore instance for stateful photons (daemon may have restarted)
            if (this._selectedPhoton?.stateful && this._selectedPhoton.configured) {
              void this._restoreInstance(this._selectedPhoton.name);
            }
            return;
          }

          this._initialConnectDone = true;

          // Check for available updates in background
          void this._checkForUpdates();

          // Start polling for pending approvals
          this._startApprovalsPolling();

          // Restore state from URL path or select first photon
          if (window.location.pathname !== '/') {
            void this._handleRouteChange();
          } else if (!this._selectedPhoton && this._photons.length > 0) {
            const firstUserPhoton = this._photons.find((p) => !p.internal);
            if (firstUserPhoton) {
              this._selectedPhoton = firstUserPhoton;
              // For apps, auto-select main method and invoke — same as _handleRouteChange
              if (firstUserPhoton.isApp && firstUserPhoton.appEntry) {
                if (this._willAutoInvoke(firstUserPhoton.appEntry)) {
                  this._isExecuting = true;
                }
                this._selectedMethod = firstUserPhoton.appEntry;
                this._view = 'form';
                this._maybeAutoInvoke(firstUserPhoton.appEntry);
              } else {
                this._view = 'list';
              }
            }
            this._updateRoute(true);
          }
        })();
      });

      mcpClient.on('disconnect', () => {
        this._mcpReady = false;
        this._connected = false;
        this._reconnecting = true;
        this._reconnectAttempt++;
        this._stopApprovalsPolling();
        // Connection status shown via banner, not log
        showToast('Connection lost. Reconnecting...', 'warning');
      });

      mcpClient.on('tools-changed', () => {
        void (async () => {
          const tools = await mcpClient.listTools();
          const { photons, externalMCPs } = mcpClient.toolsToPhotons(tools);
          // Capture prevNames AFTER the await — _photons may have been updated by
          // a concurrent SSE 'photons' event while we were waiting for listTools().
          const prevNames = new Set(this._photons.filter((p) => !p.internal).map((p) => p.name));
          this._photons = photons;
          this._externalMCPs = externalMCPs;
          this._customUiRevision++; // invalidate custom UI iframes to pick up asset changes
          // Re-add unconfigured photons from configuration schema
          this._addUnconfiguredPhotons();

          // Update selected photon reference if it exists in the new list.
          // This handles the case where photon loading completes AFTER initial
          // page load — the photon may have gained isApp/appEntry/linkedUi since
          // the first listTools() call. Without this, the stale reference shows
          // the method list instead of auto-invoking the app entry.
          if (this._selectedPhoton) {
            const updated = this._photons.find((p) => p.name === this._selectedPhoton?.name);
            if (updated) {
              const wasApp = this._selectedPhoton.isApp;
              this._selectedPhoton = updated;
              // If photon just became an app (e.g., main method's linkedUi resolved),
              // switch to app view and auto-invoke
              if (!wasApp && updated.isApp && updated.appEntry && this._view === 'list') {
                if (this._willAutoInvoke(updated.appEntry)) {
                  this._isExecuting = true;
                }
                this._selectedMethod = updated.appEntry;
                this._view = 'form';
                this._updateRoute(true);
                this._maybeAutoInvoke(updated.appEntry);
              }
            }
          }

          // No photon selected — either re-try URL route or auto-select new photon
          if (!this._selectedPhoton && window.location.pathname !== '/') {
            const { photonName: pathPhotonName } = parseBeamRoutePath(
              window.location.pathname,
              this._photons,
              this._externalMCPs
            );
            const routePhoton = pathPhotonName
              ? this._photons.find((p) => p.name === pathPhotonName) ||
                this._externalMCPs.find((p) => p.name === pathPhotonName)
              : null;
            if (routePhoton) {
              // URL points to a photon that's now available — re-run route handling
              void this._handleRouteChange();
            } else {
              // Auto-select newly added user photon (welcome wizard flow)
              const newUserPhoton = this._photons.find(
                (p) => !p.internal && p.configured && !prevNames.has(p.name)
              );
              if (newUserPhoton) {
                this._selectedPhoton = newUserPhoton;
                this._welcomePhase = 'welcome';
                this._view = 'list';
                this._updateRoute(true);
              }
            }
          }
        })();
      });

      // Handle configuration schema for unconfigured photons
      mcpClient.on('configuration-available', () => {
        this._addUnconfiguredPhotons();
      });

      mcpClient.on('progress', (data: any) => {
        this._log('info', data.message || 'Processing...');

        // Route progress to the correct split panel if progressToken matches
        const panelId =
          data.progressToken != null
            ? this._panelProgressTokens.get(data.progressToken)
            : undefined;

        const progressValue =
          typeof data.progress === 'number'
            ? data.progress > 0
              ? {
                  value: data.total ? data.progress / data.total : data.progress,
                  message: data.message || 'Processing...',
                }
              : { value: -1, message: data.message || 'Processing...' }
            : null;

        if (panelId && progressValue) {
          // Route to the specific split panel
          this._updatePanel(panelId, { progress: progressValue });
        } else if (progressValue) {
          // No panel match — update global progress bar
          this._progress = progressValue;
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
          this._log(level, data.message, false, data.durationMs);
        }
      });

      // Handle render events — intermediate formatted results from this.render()
      mcpClient.on('render', (data: any) => {
        // Forward ALL render events to bridge iframes (slides, custom UI) —
        // they handle their own filtering by photon/method name.
        this._forwardRenderToSlideIframes(data);

        // Only apply to main result viewer if it matches the currently selected photon/method.
        if (data?.photon && data?.method) {
          const currentPhoton = this._selectedPhoton?.name;
          const currentMethod = this._selectedMethod?.name;
          if (data.photon !== currentPhoton || data.method !== currentMethod) return;
        }

        // Handle render:clear — remove intermediate output
        if (data?.clear) {
          this._lastResult = null;
          this._customFormatUri = null;
          this.requestUpdate();
          return;
        }
        if (data?.format && data?.value !== undefined) {
          // Update the result viewer with the rendered value and its format
          this._lastResult = data.value;
          // Override the output format for this render
          if (this._selectedMethod) {
            this._selectedMethod = { ...this._selectedMethod, outputFormat: data.format };

            // For custom (non-built-in) formats, check if photon provides a renderer
            const builtinFormats = new Set([
              'table',
              'list',
              'card',
              'kv',
              'tree',
              'json',
              'markdown',
              'md',
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
              'guide',
              'slides',
              'presentation',
            ]);
            const baseFormat = data.format.split(':')[0].toLowerCase();
            if (!builtinFormats.has(baseFormat) && this._selectedPhoton) {
              // Custom format — set a custom format URI for the renderer to load
              this._customFormatUri = `ui://${this._selectedPhoton.name}/format-${data.format}`;
            } else {
              this._customFormatUri = null;
            }
          }
          this.requestUpdate();
        }
      });

      // Handle canvas events — two-stream AI-generated UI (canvas:ui + canvas:data)
      mcpClient.on('canvas', (data: any) => {
        if (!data?.photon || !data?.method) return;
        const currentPhoton = this._selectedPhoton?.name;
        const currentMethod = this._selectedMethod?.name;
        if (data.photon !== currentPhoton || data.method !== currentMethod) return;

        // Lazily create canvas-renderer on first canvas event
        if (!this._canvasActive) {
          this._canvasActive = true;
          this.requestUpdate();
        }

        // Forward to canvas-renderer iframe after render
        void this.updateComplete.then(() => {
          const canvas = this.shadowRoot?.querySelector('canvas-renderer') as any;
          if (!canvas) return;
          if (data.type === 'ui') {
            canvas.pushUI(data.html);
          } else if (data.type === 'data') {
            canvas.pushData(data.slot, data.data);
          }
        });
      });

      // Handle photons list update from SSE
      mcpClient.on('photons', (data: any) => {
        if (data?.photons) {
          const prevNames = new Set(this._photons.filter((p) => !p.internal).map((p) => p.name));
          // Preserve frontend-only flags (hasUpdate) across SSE refreshes
          const updateFlags = new Map<string, boolean>();
          for (const p of this._photons) {
            if (p.hasUpdate) updateFlags.set(p.name, true);
          }
          this._photons = data.photons.map((p: any) =>
            updateFlags.has(p.name) ? { ...p, hasUpdate: true } : p
          );
          // Check for pending studio open (create-photon or maker flow)
          if (this._pendingStudioOpen) {
            const newPhoton = this._photons.find((p) => !p.internal && !prevNames.has(p.name));
            if (newPhoton) {
              this._pendingStudioOpen = false;
              this._selectedPhoton = newPhoton;
              this._view = 'studio';
              // Apply template source after Studio opens
              if (this._pendingTemplateSource) {
                const tpl = this._pendingTemplateSource;
                this._pendingTemplateSource = undefined;
                requestAnimationFrame(() => {
                  const studio = this.shadowRoot?.querySelector('photon-studio') as any;
                  if (studio?.applyTemplate) {
                    studio.applyTemplate({
                      source: tpl,
                      id: 'custom',
                      name: '',
                      description: '',
                      icon: '',
                    });
                  }
                });
              }
              this._updateRoute(true);
            }
          }

          // Update selected photon if it was in the list
          if (this._selectedPhoton) {
            const updated = this._photons.find((p) => p.name === this._selectedPhoton?.name);
            if (updated) {
              this._selectedPhoton = updated;
            }
          } else {
            // Auto-select newly added user photon (welcome wizard flow)
            // Skip if user is intentionally on the home page
            if (window.location.pathname === '/') return;
            const newUserPhoton = this._photons.find(
              (p) => !p.internal && p.configured && !prevNames.has(p.name)
            );
            if (newUserPhoton) {
              this._selectedPhoton = newUserPhoton;
              this._welcomePhase = 'welcome';
              this._view = 'list';
              this._updateRoute(true);
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
            this._updateRoute(true);
          }
        }
      });

      // Handle elicitation requests
      mcpClient.on('elicitation', (data: any) => {
        if (data) {
          // Transform external MCP elicitation format (mode: 'form'|'url') to
          // elicitation-modal format (ask: 'form'|'text'|etc.)
          const elicitationData = {
            ...data,
            // Map MCP protocol 'mode' to elicitation-modal 'ask'
            ask: data.ask || data.mode || 'form',
          };
          this._elicitationData = elicitationData;
          this._showElicitation = true;
          this._log('info', `Input required: ${data.message || elicitationData.ask}`);
        }
      });

      // Handle elicitation deferred to pending approvals
      mcpClient.on('elicitation-deferred', (data: any) => {
        if (data) {
          // Close modal if this elicitation was being shown
          if (
            this._elicitationData &&
            (this._elicitationData as any).elicitationId === data.elicitationId
          ) {
            this._showElicitation = false;
            this._elicitationData = null;
          }
          // Refresh pending approvals list
          void this._fetchPendingApprovals();
          this._log('info', `Moved to pending approvals: ${data.message || 'Approval required'}`);
        }
      });

      // Handle approval resolved (from another tab or timeout)
      mcpClient.on('approval-resolved', (data: any) => {
        if (data) {
          this._pendingApprovalsList = this._pendingApprovalsList.filter(
            (a) => a.id !== data.approvalId
          );
          if (this._pendingApprovalsList.length === 0) {
            this._showApprovals = false;
          }
        }
      });

      // Handle channel events (task-moved, task-updated, etc.) via unified JSON-RPC format
      mcpClient.on('channel-event', (data: any) => {
        this._forwardToIframes({
          jsonrpc: '2.0',
          method: 'photon/notifications/emit',
          params: data,
        });
      });

      // Handle board updates via unified JSON-RPC format
      mcpClient.on('board-update', (data: any) => {
        this._forwardToIframes({
          jsonrpc: '2.0',
          method: 'photon/notifications/emit',
          params: { emit: 'board-update', ...data },
        });

        // Auto mode: follow the board that just had activity
        if (
          this._instanceSelectorMode === 'auto' &&
          data?.board &&
          data?.photon === this._selectedPhoton?.name &&
          data.board !== this._currentInstance
        ) {
          void this._handleInstanceChange(
            new CustomEvent('instance-change', { detail: { instance: data.board } })
          );
        }

        // Keep instance list fresh when new boards appear
        if (data?.photon === this._selectedPhoton?.name) {
          void this._fetchInstances(data.photon);
        }
      });

      // Handle refresh-needed via unified JSON-RPC format
      mcpClient.on('refresh-needed', (data: any) => {
        this._forwardToIframes({
          jsonrpc: '2.0',
          method: 'photon/notifications/emit',
          params: { emit: 'refresh-needed', ...data },
        });
      });

      // Handle stateful photon state changes (e.g., CLI added item → Beam auto-refreshes)
      mcpClient.on('state-changed', (data: any) => {
        if (!data?.photon) return;

        // Update breadcrumb if instance switched (from _use or external client)
        if (
          data.method === '_use' &&
          data.data?.instance &&
          this._selectedPhoton?.name === data.photon
        ) {
          this._setCurrentInstance(data.photon, data.data.instance);
        }

        // Only auto-refresh if we're viewing a SAFE (read-only) method on the changed photon.
        // Methods with required params are mutations (add, remove, update) — replaying them
        // would duplicate side-effects. Only parameterless methods (get, list, stats) are safe.
        // Show warmth indicator on sidebar for the changed photon
        const sidebarEl = this.renderRoot?.querySelector?.('beam-sidebar');
        (sidebarEl as any)?.updatePhotonWarmth?.(data.photon);

        const methodParams = this._selectedMethod?.params;
        const hasRequiredParams = methodParams?.required?.length > 0;
        if (
          this._selectedPhoton?.name === data.photon &&
          this._selectedMethod &&
          this._lastResult !== null &&
          !this._isExecuting &&
          !hasRequiredParams
        ) {
          void this._silentRefresh();
        }
      });

      // Restore instance after SSE reconnection (daemon restart, network recovery, etc.)
      mcpClient.on('reconnect', () => {
        void (async () => {
          this._log('info', 'Connection restored');
          if (this._selectedPhoton?.stateful && this._selectedPhoton.configured) {
            await this._restoreInstance(this._selectedPhoton.name);
          }
        })();
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
          // Elicitation cancellation is already handled by the cancel event handler
          if (data.message === 'Elicitation cancelled by user') return;
          this._isExecuting = false;
          this._log('error', data.message);
          showToast(data.message, 'error', 5000);
        }
      });

      await mcpClient.connect();
      this._connectRetries = 0;
    } catch (error) {
      console.error('MCP connection failed:', error);
      this._mcpReady = false;
      this._connected = false;
      this._connectRetries++;

      if (this._connectRetries <= MCP_MAX_CONNECT_RETRIES) {
        this._reconnecting = true;
        this._reconnectAttempt = this._connectRetries;
        // Retry with exponential backoff
        setTimeout(() => {
          void this._connectMCP();
        }, MCP_RECONNECT_DELAY_MS * this._connectRetries);
      } else {
        // Give up — show static disconnected banner, no more toasts
        this._reconnecting = false;
      }
    }
  }

  private _handleRouteChange = () => {
    void (async () => {
      const queryPart = window.location.search.slice(1); // "?focus=1&key=val" → "focus=1&key=val"
      const { photonName, methodNames } = parseBeamRoutePath(
        window.location.pathname,
        this._photons,
        this._externalMCPs
      );
      const methodName = methodNames[0];

      // Parse query parameters for shared links
      this._sharedFormParams = null;
      let sharedParams: Record<string, any> = {};
      if (queryPart) {
        const params = new URLSearchParams(queryPart);
        // Focus mode: hide sidebar and photon header, expand main area to full width
        if (params.has('focus')) {
          this._focusMode = true;
          this.classList.add('focus-mode');
        }
        // View mode: isolate form or result rendering
        const viewParam = params.get('view');
        if (viewParam === 'form' || viewParam === 'result') {
          this._viewMode = viewParam;
          this.classList.add(`view-${viewParam}`);
          // Implicitly enable focus mode for isolated views
          if (!this._focusMode) {
            this._focusMode = true;
            this.classList.add('focus-mode');
          }
          // Auto-scale content to fill viewport in embed/view modes.
          this._setupViewModeScaling();
        }
        for (const [key, value] of params) {
          if (key === 'focus' || key === 'view') continue; // UI mode flags, not shared params
          // Try to parse JSON values (objects, arrays, numbers, booleans)
          try {
            sharedParams[key] = JSON.parse(value);
          } catch {
            sharedParams[key] = value;
          }
        }
      }

      // Reset picker and split panels on any route change
      this._methodPickerOpen = false;
      this._methodPickerPanelId = null;
      this._splitPanels = [];

      if (photonName === 'marketplace') {
        this._selectedPhoton = null;
        this._selectedMethod = null;
        this._lastResult = null;
        this._view = 'marketplace';
        return;
      }

      if (photonName === 'daemon') {
        this._selectedPhoton = null;
        this._selectedMethod = null;
        this._lastResult = null;
        this._view = 'daemon';
        return;
      }

      if (!photonName || photonName === 'home') {
        this._selectedPhoton = null;
        this._selectedMethod = null;
        this._lastResult = null;
        this._customFormatUri = null;
        return;
      }

      if (photonName) {
        // Look in both photons and external MCPs
        let photon = this._photons.find((p) => p.name === photonName);
        if (!photon) {
          photon = this._externalMCPs.find((p) => p.name === photonName);
        }

        if (photon) {
          this._selectedPhoton = photon;
          this._lastResult = null;
          this._customFormatUri = null;

          // Restore saved instance for stateful photons (survives tab refresh)
          if (photon.stateful && photon.configured) {
            await this._restoreInstance(photon.name);
          }

          // Fetch available instances for stateful photons (populates instance panel)
          if (photon.stateful) {
            await this._fetchInstances(photon.name);
          }

          // Handle external MCPs with MCP Apps
          if (photon.isExternalMCP && photon.hasMcpApp) {
            this._selectedMethod = null;
            this._view = 'mcp-app';
            this._mainTab = 'app';
            return;
          }

          if (methodName && photon.methods) {
            // Handle split view format: "method1+method2"
            const [firstMethodName, secondMethodName] = methodNames;
            const method = photon.methods.find((m: any) => m.name === firstMethodName);
            if (method) {
              // Store shared params to pre-populate form
              if (Object.keys(sharedParams).length > 0) {
                this._sharedFormParams = sharedParams;
              }
              // Set _isExecuting BEFORE setting state for auto-invoke or view=result mode
              if (this._willAutoInvoke(method) || this._viewMode === 'result') {
                this._isExecuting = true;
              }
              this._selectedMethod = method;
              this._view = 'form';
              // Set app tab when loading app entry via URL
              if (photon.isApp && photon.appEntry?.name === method.name) {
                this._mainTab = 'app';
              } else if (!photon.isApp) {
                this._mainTab = 'methods';
              }
              // Auto-invoke for URL-based routing (same as click-based method select)
              this._maybeAutoInvoke(method);

              // Handle split view if additional methods are in URL
              if (secondMethodName) {
                // Skip first (primary method), restore the rest as panels
                for (let i = 1; i < methodNames.length; i++) {
                  const name = methodNames[i];
                  if (name === 'source') {
                    this._addPanel('source');
                  } else {
                    const panelMethod = photon.methods.find((m: any) => m.name === name);
                    if (panelMethod) {
                      this._addPanel('method', panelMethod);
                    }
                  }
                }
              }

              // Auto-invoke if no shared params provided
              if (Object.keys(sharedParams).length === 0) {
                this._maybeAutoInvoke(method);
              }
            }
          } else if (photon.isApp && photon.appEntry) {
            // For Apps without method specified, auto-select main
            // Set _isExecuting BEFORE setting state to prevent iframe from rendering
            // before the tool call starts (which would bypass elicitation)
            if (this._willAutoInvoke(photon.appEntry)) {
              this._isExecuting = true;
            }
            this._selectedMethod = photon.appEntry;
            this._view = 'form';
            this._mainTab = 'app';
            // Auto-invoke app entry if it has no required params
            this._maybeAutoInvoke(photon.appEntry);
          } else {
            this._selectedMethod = null;
            this._view = 'list';
            this._mainTab = 'methods';
          }
        }
      }
    })();
  };

  private _updateRoute(replace = false) {
    let path: string;
    if (this._view === 'marketplace') {
      path = '/marketplace';
    } else if (this._view === 'daemon') {
      path = '/daemon';
    } else if (!this._selectedPhoton) {
      path = '/';
    } else {
      const splitPanelMethodNames = this._selectedMethod
        ? this._splitPanels
            .map((panel) => {
              if (panel.type === 'method' && panel.method) return panel.method.name;
              if (panel.type === 'source') return 'source';
              return null;
            })
            .filter((name): name is string => !!name)
        : [];
      path = buildBeamRoutePath(
        this._selectedPhoton,
        this._selectedMethod?.name,
        splitPanelMethodNames
      );
    }
    // Push state for browser back/forward navigation
    if (replace) {
      history.replaceState(null, '', path);
    } else {
      history.pushState(null, '', path);
    }
  }

  private _goHome = () => {
    this._selectedPhoton = null;
    this._selectedMethod = null;
    this._lastResult = null;
    this._customFormatUri = null;
    this._updateRoute();
  };

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
            envVar: prop['x-env-var'] || key,
            type: prop.type || 'string',
            isOptional: !config.required?.includes(key),
            hasDefault: prop.default !== undefined,
            defaultValue: prop.default,
          })
        ),
        errorReason: config['x-error-reason'],
        errorMessage: config['x-error-message'],
      }));

    if (unconfigured.length > 0) {
      this._photons = [...this._photons, ...unconfigured];
    }
  }

  /**
   * Filter methods for user-facing display: hide @internal methods,
   * _use/_instances/_settings system methods, and methods with @internal in description.
   */
  private _getVisibleMethods(photon?: any): any[] {
    const p = photon || this._selectedPhoton;
    if (!p?.methods) return [];
    return p.methods.filter((m: any) => {
      // Hide runtime instance management and settings methods (settings has a dedicated toolbar button)
      if (m.name === '_use' || m.name === '_instances' || m.name === 'settings') return false;
      // Hide methods with @internal in their description
      if (m.description && /@internal\b/i.test(m.description)) return false;
      return true;
    });
  }

  private _getTestMethods(): string[] {
    if (!this._selectedPhoton?.methods) return [];
    return this._selectedPhoton.methods
      .filter((m: any) => m.name.startsWith('test_') || m.name.startsWith('test'))
      .map((m: any) => m.name);
  }

  /** Fetch all tests (external .test.ts + inline) from the server */
  private async _fetchTestList(photonName: string): Promise<string[]> {
    try {
      const res = await fetch(`/api/test/list?photon=${encodeURIComponent(photonName)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return this._getTestMethods();
      const data = await res.json();
      if (data.tests && data.tests.length > 0) {
        return data.tests.map((t: any) => t.name);
      }
    } catch {
      // Fall back to inline test discovery
    }
    return this._getTestMethods();
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
    const testMethods = await this._fetchTestList(this._selectedPhoton.name);
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
      void this._fetchDiagnostics();
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
        Photons (${d.configuredCount}
        loaded${d.unconfiguredCount > 0 ? `, ${d.unconfiguredCount} unconfigured` : ''})
      </h3>
      <div class="glass-panel" style="padding: var(--space-md);">
        ${(d.photons || []).map(
          (p: any) => html`
            <div style="padding: 4px 0;">
              <div style="display: flex; align-items: center; gap: var(--space-sm);">
                <span
                  style="width: 10px; height: 10px; border-radius: 50; background: ${p.status ===
                  'loaded'
                    ? 'var(--color-success)'
                    : p.status === 'unconfigured'
                      ? 'var(--color-warning)'
                      : 'var(--color-error)'}; flex-shrink: 0;"
                ></span>
                <span style="flex: 1;"
                  >${p.name}${p.internal
                    ? html` <span
                        style="color: var(--t-muted); font-size: 0.7rem; font-style: italic;"
                        >system</span
                      >`
                    : ''}</span
                >
                <span style="color: var(--t-muted); font-size: 0.8rem;">${p.methods} methods</span>
                ${p.error
                  ? html`<span style="color: var(--color-error); font-size: 0.75rem;"
                      >${p.error}</span
                    >`
                  : ''}
              </div>
              ${p.path
                ? html`<div
                    style="font-family: monospace; font-size: 0.65rem; color: var(--t-muted); opacity: 0.6; margin-left: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  >
                    ${p.path.replace(/^\/Users\/[^/]+\/|^\/home\/[^/]+\//, '~/')}
                  </div>`
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
                  ${this._runningTests ? html`${hourglass} Running...` : 'Run All Tests'}
                </button>
              </div>
              ${this._testResults.length > 0
                ? html`
                    ${this._testResults.map(
                      (r) => html`
                        <div
                          style="display: flex; align-items: center; gap: var(--space-sm); padding: 4px 0; font-size: 0.85rem;"
                        >
                          <span>${r.passed ? check : xMark}</span>
                          <span style="flex: 1; font-family: monospace;">${r.method}</span>
                          ${r.duration != null
                            ? html`<span style="color: var(--t-muted); font-size: 0.75rem;"
                                >${r.duration}ms</span
                              >`
                            : ''}
                          ${r.error
                            ? html`<span style="color: var(--color-error); font-size: 0.75rem;"
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
              <code
                style="background: var(--bg-panel); padding: 2px 6px; border-radius: var(--radius-xs);"
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
            void this._fetchDiagnostics();
          }}
        >
          ${refresh} Refresh
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
          return update ? { ...p, hasUpdate: true, updateVersion: update.latestVersion } : p;
        });
        // Also update selected photon if it has an update
        if (this._selectedPhoton) {
          const selUpdate = this._updatesAvailable.find(
            (u) => u.name === this._selectedPhoton?.name
          );
          if (selUpdate) {
            this._selectedPhoton = {
              ...this._selectedPhoton,
              hasUpdate: true,
              updateVersion: selUpdate.latestVersion,
            };
          }
        }
      }
    } catch (error) {
      console.debug('Update check failed:', error);
    }
  }

  private _log(type: string, message: string, verbose = false, durationMs?: number) {
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
        photonName: this._selectedPhoton?.name,
        ...(durationMs != null ? { durationMs } : {}),
      },
      ...this._activityLog,
    ];
  }

  render() {
    return html`
      <a
        class="skip-link"
        href="#main-content"
        @click=${(e: Event) => {
          e.preventDefault();
          const main = this.shadowRoot?.querySelector('#main-content') as HTMLElement;
          main?.focus();
        }}
        >Skip to main content</a
      >
      ${!this._connected
        ? html`
            <div
              class="connection-banner ${this._reconnecting ? 'reconnecting' : ''}"
              role="alert"
              aria-live="assertive"
            >
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
                        style="background: rgba(255,255,255,0.2); padding: 1px 4px; border-radius: var(--radius-xs);"
                        >photon beam</code
                      >
                    </div>`
                  : ''}
              </div>
              <button
                @click=${() => {
                  this._connectRetries = 0;
                  void this._connectMCP();
                }}
              >
                Retry Now
              </button>
            </div>
          `
        : ''}

      <!-- Mobile Menu Button: shows back arrow when in method detail, hamburger otherwise -->
      <button
        class="mobile-menu-btn ${this._sidebarVisible ? 'open' : ''}"
        @click=${() => {
          if (
            !this._sidebarVisible &&
            this._selectedMethod &&
            this._selectedPhoton &&
            !this._selectedPhoton.isApp
          ) {
            void this._handleBackFromMethod();
          } else {
            this._toggleSidebar();
          }
        }}
        aria-label="${this._sidebarVisible
          ? 'Close menu'
          : this._selectedMethod && this._selectedPhoton && !this._selectedPhoton.isApp
            ? 'Back'
            : 'Open menu'}"
      >
        ${this._sidebarVisible
          ? xMark
          : this._selectedMethod && this._selectedPhoton && !this._selectedPhoton.isApp
            ? html`<svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>`
            : menu}
      </button>

      <!-- Sidebar Overlay (mobile) -->
      <div
        class="sidebar-overlay ${this._sidebarVisible ? 'visible' : ''}"
        @click=${() => this._closeSidebar()}
        aria-hidden="true"
      ></div>

      <nav
        class="sidebar-area glass-panel ${this._sidebarVisible ? 'visible' : ''}"
        style="margin: var(--space-sm); border-radius: var(--radius-md); --sidebar-width: ${this
          ._sidebarWidth}px;"
        aria-label="Photon navigation"
      >
        <beam-sidebar
          .photons=${this._photons}
          .externalMCPs=${this._externalMCPs}
          .selectedPhoton=${this._selectedPhoton?.name}
          .theme=${this._theme}
          .connected=${this._connected}
          .reconnecting=${this._reconnecting}
          .updatesAvailable=${this._updatesAvailable.length}
          .pendingApprovals=${this._pendingApprovalsList.length}
          .mainTab=${this._mainTab}
          .isApp=${!!(
            this._selectedPhoton?.isApp ||
            (this._selectedPhoton?.isExternalMCP && this._selectedPhoton?.hasMcpApp)
          )}
          .hasSettings=${!!(
            this._selectedPhoton?.hasSettings && !this._selectedPhoton?.isExternalMCP
          )}
          .hasSetup=${!!(
            this._selectedPhoton?.requiredParams?.length && !this._selectedPhoton?.isExternalMCP
          )}
          .isExternalMCP=${!!this._selectedPhoton?.isExternalMCP}
          .hasPath=${!!this._selectedPhoton?.path}
          @tab-change=${(e: CustomEvent) => {
            const tab = e.detail.tab;
            this._mainTab = tab;
            if (tab === 'methods') {
              this._closeSecondPanel();
              this._selectedMethod = null;
              this._view = 'list';
              this._updateRoute();
              return;
            }
            // Handle source tab
            if (tab === 'source') {
              void this._handleViewSourceInline();
              return;
            }
            // Handle help tab
            if (tab === 'help') {
              void this._loadPhotonHelp();
              return;
            }
            // Exit source/studio view when switching away
            if (this._view === 'source' || this._view === 'studio') {
              if (this._selectedMethod) {
                this._view = 'form';
              } else {
                this._view = 'list';
              }
            }
            // Handle settings tab. _selectedMethod is kept in sync with
            // the settings method so the Save button can route through
            // the existing invoke pipeline; no auto-invoke is needed —
            // the form shows schema defaults, and the user's submissions
            // persist via the daemon.
            if (tab === 'settings' && this._selectedPhoton) {
              const settingsMethod = this._selectedPhoton.methods?.find(
                (m: any) => m.name === 'settings'
              );
              if (settingsMethod) {
                this._selectedMethod = settingsMethod;
                this._view = 'form';
              } else {
                // Setup-only photon — clear method state so the form panel
                // doesn't render alongside the Setup view.
                this._selectedMethod = null;
                this._lastResult = null;
              }
              // Default sub-tab: configured + has settings → Configuration;
              // else → Setup. The user can flip via the in-view tab strip.
              const hasSetup =
                Array.isArray(this._selectedPhoton?.requiredParams) &&
                this._selectedPhoton.requiredParams.length > 0;
              const hasConfig = !!settingsMethod;
              const configured = this._selectedPhoton?.configured !== false;
              if (hasSetup && hasConfig) {
                this._settingsTab = configured ? 'configuration' : 'setup';
              } else if (hasSetup) {
                this._settingsTab = 'setup';
              } else {
                this._settingsTab = 'configuration';
              }
              return;
            }
            // Handle app tab for external MCPs
            if (
              tab === 'app' &&
              this._selectedPhoton?.isExternalMCP &&
              this._selectedPhoton?.hasMcpApp
            ) {
              this._view = 'mcp-app';
            }
            // Handle app tab for native apps
            if (tab === 'app' && this._selectedPhoton?.isApp && this._selectedPhoton?.appEntry) {
              this._selectedMethod = this._selectedPhoton.appEntry;
              this._view = 'form';
              this._maybeAutoInvoke(this._selectedPhoton.appEntry);
            }
          }}
          @toggle-focus=${() => this._toggleFocusMode()}
          @home=${this._goHome}
          @select=${(e: Event) => this._handlePhotonSelectMobile(e as CustomEvent)}
          @marketplace=${() => this._handleMarketplaceMobile()}
          @daemon=${() => {
            this._selectedPhoton = null;
            this._selectedMethod = null;
            this._lastResult = null;
            this._view = 'daemon';
            this._updateRoute();
          }}
          @theme-change=${this._handleThemeChange}
          @open-theme-settings=${() => (this._showThemeSettings = true)}
          @show-shortcuts=${this._showHelpModal}
          @show-approvals=${() => {
            this._showApprovals = true;
            void this._fetchPendingApprovals();
          }}
          @reconnect-mcp=${(e: Event) => {
            void this._handleReconnectMCP(e as CustomEvent);
          }}
          @diagnostics=${() => {
            this._view = 'diagnostics';
            this._updateRoute();
          }}
          @create-photon=${(e: CustomEvent) => {
            void this._handleCreatePhoton(e.detail.name as string, e.detail.template as string);
          }}
          @open-studio=${(e: CustomEvent) => {
            const photon = this._photons.find((p: any) => p.name === e.detail.photonName);
            if (photon?.editable && !photon?.isExternalMCP) {
              this._selectedPhoton = photon;
              this._view = 'studio';
            }
          }}
          @photon-settings=${(e: CustomEvent) => {
            const photon = this._photons.find((p: any) => p.name === e.detail.name);
            if (photon) {
              this._selectedPhoton = photon;
              this._selectedMethod = photon.methods?.find((m: any) => m.name === 'settings');
              this._view = 'detail';
            }
          }}
        ></beam-sidebar>
        <div
          class="sidebar-resize-handle"
          @pointerdown=${(e: PointerEvent) => this._handleSidebarResizeStart(e)}
        ></div>
      </nav>

      <main class="main-area" id="main-content" tabindex="-1" aria-label="Main content">
        <div
          class="main-content-scroll"
          style="${this._splitViewEnabled
            ? 'overflow: hidden !important; padding: 0;'
            : this._mainTab === 'app' &&
                (this._selectedPhoton?.isApp ||
                  (this._selectedPhoton?.isExternalMCP && this._selectedPhoton?.hasMcpApp))
              ? 'overflow: hidden; padding: 0;'
              : this._mainTab === 'source'
                ? 'padding: 0; overflow: hidden;'
                : this._view === 'studio'
                  ? 'padding: 0; overflow: hidden;'
                  : ''}"
        >
          ${this._focusMode && this._selectedPhoton
            ? html`<div class="focus-toolbar">
                ${this._selectedMethod && !this._selectedPhoton.isApp
                  ? html`<button
                      class="focus-toolbar-back"
                      @click=${() => this._handleBackFromMethod()}
                      @mouseenter=${(e: MouseEvent) => {
                        (e.target as HTMLElement).style.color = 'var(--t-primary)';
                        (e.target as HTMLElement).style.borderColor = 'var(--accent-primary)';
                      }}
                      @mouseleave=${(e: MouseEvent) => {
                        (e.target as HTMLElement).style.color = 'var(--t-muted)';
                        (e.target as HTMLElement).style.borderColor = 'var(--border-glass)';
                      }}
                      title="Back to ${this._selectedPhoton.name}"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>`
                  : ''}
                <button
                  @click=${this._toggleFocusMode}
                  @mouseenter=${(e: MouseEvent) => {
                    (e.target as HTMLElement).style.color = 'var(--t-primary)';
                    (e.target as HTMLElement).style.borderColor = 'var(--accent-primary)';
                  }}
                  @mouseleave=${(e: MouseEvent) => {
                    (e.target as HTMLElement).style.color = 'var(--t-muted)';
                    (e.target as HTMLElement).style.borderColor = 'var(--border-glass)';
                  }}
                  title="Exit focus mode"
                >
                  ${collapse}
                </button>
              </div>`
            : ''}
          ${this._selectedPhoton &&
          !this._selectedMethod &&
          this._mainTab === 'methods' &&
          this._view !== 'studio'
            ? html`<div class="main-toolbar">
                <div style="flex: 1; min-width: 0;">${this._renderPhotonToolbar()}</div>
              </div>`
            : ''}
          ${this._mainTab === 'log'
            ? html`<activity-log
                .items=${this._activityLog}
                .filter=${this._selectedPhoton?.name}
                .fullscreen=${true}
                @clear=${() => (this._activityLog = [])}
              ></activity-log>`
            : this._mainTab === 'help' && this._selectedPhoton
              ? this._renderPhotonHelpView()
              : this._mainTab === 'settings' && this._selectedPhoton
                ? this._renderSettingsView()
                : this._mainTab === 'methods' &&
                    !this._selectedMethod &&
                    (this._selectedPhoton?.isApp ||
                      (this._selectedPhoton?.isExternalMCP && this._selectedPhoton?.hasMcpApp))
                  ? this._renderMethodsBentoOnly()
                  : this._renderContent()}
        </div>
      </main>

      <toast-manager></toast-manager>

      ${this._showThemeSettings
        ? html`
            <div
              class="theme-settings-overlay"
              @click=${() => (this._showThemeSettings = false)}
            ></div>
            <div class="theme-settings-panel glass-panel">
              <theme-settings
                .currentTheme=${this._theme}
                @theme-change=${this._handleThemeChange}
                @oklch-theme-change=${this._handleOklchThemeChange}
                @oklch-theme-reset=${this._handleOklchThemeReset}
                @close=${() => (this._showThemeSettings = false)}
              ></theme-settings>
            </div>
          `
        : ''}
      ${this._showHelp ? this._renderHelpModal() : ''}
      ${this._selectedPrompt?.content ? this._renderPromptModal() : ''}
      ${this._selectedResource?.content ? this._renderResourceModal() : ''}
      ${this._showForkDialog
        ? html`<fork-dialog
            .photonName=${this._forkPhotonName}
            .originRepo=${this._forkOriginRepo}
            .requireNewName=${this._forkRequireNewName}
            .suggestedName=${this._forkSuggestedName}
            .targets=${this._forkTargets}
            @fork-confirm=${this._handleForkConfirm}
            @fork-cancel=${() => {
              this._showForkDialog = false;
            }}
          ></fork-dialog>`
        : ''}

      <elicitation-modal
        ?open=${this._showElicitation}
        .data=${this._elicitationData}
        @submit=${this._handleElicitationSubmit}
        @cancel=${this._handleElicitationCancel}
        @oauth-complete=${this._handleOAuthComplete}
      ></elicitation-modal>

      ${this._showApprovals
        ? html`
            <div class="approvals-overlay" @click=${() => (this._showApprovals = false)}></div>
            <div class="approvals-panel glass-panel">
              <pending-approvals
                .approvals=${this._pendingApprovalsList}
                @approval-response=${this._handleApprovalResponse}
                @close=${() => (this._showApprovals = false)}
              ></pending-approvals>
            </div>
          `
        : ''}
    `;
  }

  private _renderMethodsBentoOnly() {
    if (!this._selectedPhoton) return html``;
    const methods = this._getVisibleMethods();
    if (methods.length === 0)
      return html`<p style="color: var(--t-muted); padding: var(--space-md);">
        No methods available.
      </p>`;
    const hasTools = methods.some((m: any) => !m.isTemplate);
    const hasPrompts = methods.some((m: any) => m.isTemplate);
    const title = hasTools && hasPrompts ? 'Methods & Prompts' : hasPrompts ? 'Prompts' : 'Methods';
    return html`
      ${this._renderAnchorNav()}
      <div id="photon-methods" class="bento-methods">
        <h3 class="bento-section-title">${title}</h3>
        <div class="cards-grid">
          ${methods.map(
            (method: any) => html`
              <method-card
                .method=${method}
                .photonName=${this._selectedPhoton.name}
                .selected=${this._selectedMethod?.name === method.name}
                @select=${(e: CustomEvent) => {
                  this._selectedMethod = e.detail.method;
                  this._view = 'form';
                  this._mainTab = 'methods';
                  this._updateRoute();
                }}
              ></method-card>
            `
          )}
        </div>
      </div>
      <div id="photon-prompts" class="bento-bottom-grid">
        ${this._renderPromptsSection()} ${this._renderResourcesSection()}
      </div>
    `;
  }

  private _renderContent() {
    // Source view — inline source code display (Phase 2)
    if (this._view === 'source') {
      return this._renderSourceView();
    }

    if (this._view === 'studio') {
      return html`<photon-studio
        .photonName=${this._selectedPhoton?.name || ''}
        .theme=${this._theme}
        .hideCloseButton=${true}
        @studio-close=${() => (this._view = 'list')}
        @studio-saved=${async () => {
          const tools = await mcpClient.listTools();
          const { photons, externalMCPs } = mcpClient.toolsToPhotons(tools);
          this._photons = photons;
          this._externalMCPs = externalMCPs;
        }}
      ></photon-studio>`;
    }

    if (this._view === 'diagnostics') {
      return html`
        <div style="margin-bottom: var(--space-md);">
          <button
            style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
            @click=${() => {
              this._view = 'list';
              this._updateRoute();
            }}
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

    if (this._view === 'daemon') {
      return html`
        <div style="margin-bottom: var(--space-md);">
          <button
            style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
            @click=${() => {
              this._view = 'list';
              this._updateRoute();
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
        <daemon-panel></daemon-panel>
      `;
    }

    if (this._view === 'marketplace') {
      const globalMethods = this._globalStaticMethods;

      return html`
        <div style="margin-bottom: var(--space-md);">
          <button
            style="background:none; border:none; color:var(--accent-secondary); cursor:pointer;"
            @click=${() => {
              this._view = 'list';
              this._updateRoute();
            }}
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
          @install=${(e: Event) => this._handleInstall(e as CustomEvent)}
          @maker-action=${(e: Event) => this._handleMakerAction(e as CustomEvent)}
          @fork-photon=${this._handleForkFromMarketplace}
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
              @install=${(e: Event) => this._handleInstall(e as CustomEvent)}
              @maker-action=${(e: Event) => this._handleMakerAction(e as CustomEvent)}
              @fork-photon=${this._handleForkFromMarketplace}
            ></marketplace-view>
          `;
        }

        // Welcome screen: choose between marketplace and local photon
        return html`
          <div
            style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; text-align:center;"
          >
            <h1 class="text-gradient" style="font-size:2rem; margin-bottom: var(--space-sm);">
              Welcome to Photon Beam
            </h1>
            <p
              style="color: var(--t-muted); font-size: 1.05rem; max-width: 520px; margin: 0 auto var(--space-lg) auto; line-height: 1.6;"
            >
              Photon lets you build and run MCP tools — callable from Claude, Cursor, or any AI
              assistant.
            </p>
            <div
              style="display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: var(--space-sm); max-width: 580px; width: 100%; margin-bottom: var(--space-xl); align-items: center;"
            >
              <div class="glass-panel" style="padding: var(--space-md); text-align: center;">
                <div style="margin-bottom: 4px;">${fileIcon}</div>
                <div style="font-size: 0.75rem; font-weight: 600;">One .ts file</div>
                <div style="font-size: 0.65rem; color: var(--t-muted); font-family: monospace;">
                  app.photon.ts
                </div>
              </div>
              <div style="color: var(--t-muted); font-size: 1.2rem;">→</div>
              <div class="glass-panel" style="padding: var(--space-md); text-align: center;">
                <div style="font-size: 1.2rem; margin-bottom: 4px;">⚡</div>
                <div style="font-size: 0.75rem; font-weight: 600;">Methods = Tools</div>
                <div style="font-size: 0.65rem; color: var(--t-muted);">
                  Each method becomes an MCP tool
                </div>
              </div>
              <div style="color: var(--t-muted); font-size: 1.2rem;">→</div>
              <div class="glass-panel" style="padding: var(--space-md); text-align: center;">
                <div style="font-size: 1.2rem; margin-bottom: 4px;">🤖</div>
                <div style="font-size: 0.75rem; font-weight: 600;">Use anywhere</div>
                <div style="font-size: 0.65rem; color: var(--t-muted);">
                  CLI, Beam, Claude, Cursor
                </div>
              </div>
            </div>
            <div
              style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg); max-width: 520px; width:100%;"
            >
              <button
                class="glass-panel"
                style="padding: var(--space-lg); border:1px solid var(--border-glass); cursor:pointer; text-align:center; transition: border-color 0.2s, box-shadow 0.2s;"
                @mouseenter=${(e: Event) =>
                  ((e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-primary)')}
                @mouseleave=${(e: Event) =>
                  ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border-glass)')}
                @click=${() => (this._welcomePhase = 'marketplace')}
              >
                <div style="font-size: 2rem; margin-bottom: var(--space-sm);">📦</div>
                <div
                  style="font-weight:600; font-size:1.05rem; margin-bottom: var(--space-xs); color: var(--t-primary);"
                >
                  Browse & Install
                </div>
                <div style="color: var(--t-muted); font-size: 0.85rem; line-height:1.5;">
                  Install a ready-made photon from the marketplace
                </div>
              </button>
              <button
                class="glass-panel"
                style="padding: var(--space-lg); border:1px solid var(--border-glass); cursor:pointer; text-align:center; transition: border-color 0.2s, box-shadow 0.2s;"
                @mouseenter=${(e: Event) =>
                  ((e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-primary)')}
                @mouseleave=${(e: Event) =>
                  ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border-glass)')}
                @click=${() =>
                  this._handleMakerAction(
                    new CustomEvent('maker-action', { detail: { action: 'wizard' } })
                  )}
              >
                <div style="font-size: 2rem; margin-bottom: var(--space-sm);">🛠️</div>
                <div
                  style="font-weight:600; font-size:1.05rem; margin-bottom: var(--space-xs); color: var(--t-primary);"
                >
                  Create Your Own
                </div>
                <div style="color: var(--t-muted); font-size: 0.85rem; line-height:1.5;">
                  Build a custom photon from scratch with the guided wizard
                </div>
              </button>
            </div>
          </div>
        `;
      }

      // Has user photons but none selected — show home page
      return html`
        <div style="max-width: 780px;">
          <h1 class="text-gradient" style="font-size: 1.8rem; margin-bottom: var(--space-xs);">
            Photon Beam
          </h1>
          <p
            style="color: var(--t-muted); font-size: 1rem; margin: 0 0 var(--space-xl) 0; line-height: 1.6;"
          >
            Your local MCP runtime — turn TypeScript classes into AI tools, callable from Claude,
            Cursor, or any MCP client.
          </p>

          ${unconfiguredPhotons.length > 0
            ? html`
                <div
                  class="glass-panel"
                  style="padding: var(--space-md) var(--space-lg); border-left: 3px solid hsl(45, 80%, 50%); margin-bottom: var(--space-lg); display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap;"
                >
                  <div style="flex: 1; min-width: 200px;">
                    <div style="font-weight: 600; margin-bottom: 2px;">Setup required</div>
                    <div style="color: var(--t-muted); font-size: 0.85rem;">
                      ${unconfiguredPhotons.length}
                      photon${unconfiguredPhotons.length !== 1 ? 's need' : ' needs'} configuration
                      before use.
                    </div>
                  </div>
                  <div style="display: flex; flex-wrap: wrap; gap: var(--space-xs);">
                    ${unconfiguredPhotons.map(
                      (p) =>
                        html`<button
                          style="padding: 4px 10px; background: var(--bg-glass); border: 1px solid hsl(45,80%,50%,0.4); border-radius: var(--radius-sm); color: var(--t-secondary); font-size: 0.82rem; cursor: pointer; font-family: monospace; transition: border-color 0.15s;"
                          @click=${() => {
                            this._selectedPhoton = p;
                            this._view = 'config';
                          }}
                        >
                          ⚠ ${p.name}
                        </button>`
                    )}
                  </div>
                </div>
              `
            : ''}

          <div
            style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-md); margin-bottom: var(--space-xl);"
          >
            ${configuredPhotons.slice(0, 6).map(
              (p) => html`
                <button
                  class="glass-panel"
                  style="padding: var(--space-md); text-align: left; cursor: pointer; border: 1px solid var(--border-glass); transition: border-color 0.15s, background 0.15s;"
                  @mouseenter=${(e: Event) =>
                    ((e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-primary)')}
                  @mouseleave=${(e: Event) =>
                    ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border-glass)')}
                  @click=${() =>
                    this._handlePhotonSelect(new CustomEvent('select', { detail: { photon: p } }))}
                >
                  <div style="font-size: 1.4rem; margin-bottom: var(--space-xs);">
                    ${p.icon || '⚡'}
                  </div>
                  <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 2px;">
                    ${p.name}
                  </div>
                  <div style="color: var(--t-muted); font-size: 0.78rem; line-height: 1.4;">
                    ${p.description
                      ? p.description.length > 60
                        ? p.description.slice(0, 60) + '…'
                        : p.description
                      : `${p.methods?.length ?? 0} tool${p.methods?.length !== 1 ? 's' : ''}`}
                  </div>
                </button>
              `
            )}
            ${configuredPhotons.length > 6
              ? html`
                  <div
                    class="glass-panel"
                    style="padding: var(--space-md); display: flex; align-items: center; justify-content: center; color: var(--t-muted); font-size: 0.85rem;"
                  >
                    +${configuredPhotons.length - 6} more in sidebar
                  </div>
                `
              : ''}
          </div>

          <div
            style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-md); margin-bottom: var(--space-xl);"
          >
            <div class="glass-panel" style="padding: var(--space-lg);">
              <h3
                style="font-size: 0.85rem; font-weight: 600; color: var(--t-muted); text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 var(--space-sm) 0;"
              >
                How it works
              </h3>
              <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
                <div style="display: flex; gap: var(--space-sm); align-items: flex-start;">
                  <span
                    style="font-family: monospace; font-size: 0.75rem; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-xs); padding: 1px 5px; flex-shrink: 0; margin-top: 1px;"
                    >1</span
                  >
                  <span style="font-size: 0.85rem; color: var(--t-secondary); line-height: 1.4;"
                    >Write a
                    <code
                      style="font-size: 0.8rem; background: var(--bg-glass); padding: 1px 4px; border-radius: 3px;"
                      >.photon.ts</code
                    >
                    file with a TypeScript class</span
                  >
                </div>
                <div style="display: flex; gap: var(--space-sm); align-items: flex-start;">
                  <span
                    style="font-family: monospace; font-size: 0.75rem; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-xs); padding: 1px 5px; flex-shrink: 0; margin-top: 1px;"
                    >2</span
                  >
                  <span style="font-size: 0.85rem; color: var(--t-secondary); line-height: 1.4;"
                    >Each public method becomes an MCP tool automatically</span
                  >
                </div>
                <div style="display: flex; gap: var(--space-sm); align-items: flex-start;">
                  <span
                    style="font-family: monospace; font-size: 0.75rem; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-xs); padding: 1px 5px; flex-shrink: 0; margin-top: 1px;"
                    >3</span
                  >
                  <span style="font-size: 0.85rem; color: var(--t-secondary); line-height: 1.4;"
                    >Call tools from Claude Desktop, Cursor, CLI, or right here in Beam</span
                  >
                </div>
              </div>
            </div>

            <div class="glass-panel" style="padding: var(--space-lg);">
              <h3
                style="font-size: 0.85rem; font-weight: 600; color: var(--t-muted); text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 var(--space-sm) 0;"
              >
                Quick actions
              </h3>
              <div style="display: flex; flex-direction: column; gap: var(--space-xs);">
                <button
                  style="display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) var(--space-sm); background: none; border: none; color: var(--t-secondary); font-size: 0.85rem; cursor: pointer; border-radius: var(--radius-sm); text-align: left; transition: background 0.12s, color 0.12s; font-family: inherit;"
                  @mouseenter=${(e: Event) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-glass)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--t-primary)';
                  }}
                  @mouseleave=${(e: Event) => {
                    (e.currentTarget as HTMLElement).style.background = 'none';
                    (e.currentTarget as HTMLElement).style.color = 'var(--t-secondary)';
                  }}
                  @click=${() => {
                    this._view = 'marketplace';
                    this._updateRoute();
                  }}
                >
                  <span style="font-size: 1rem; width: 20px; text-align: center;">📦</span>
                  Browse Marketplace
                </button>
                <button
                  style="display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) var(--space-sm); background: none; border: none; color: var(--t-secondary); font-size: 0.85rem; cursor: pointer; border-radius: var(--radius-sm); text-align: left; transition: background 0.12s, color 0.12s; font-family: inherit;"
                  @mouseenter=${(e: Event) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-glass)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--t-primary)';
                  }}
                  @mouseleave=${(e: Event) => {
                    (e.currentTarget as HTMLElement).style.background = 'none';
                    (e.currentTarget as HTMLElement).style.color = 'var(--t-secondary)';
                  }}
                  @click=${() =>
                    this._handleMakerAction(
                      new CustomEvent('maker-action', { detail: { action: 'wizard' } })
                    )}
                >
                  <span style="font-size: 1rem; width: 20px; text-align: center;">🛠️</span>
                  Create a Photon
                </button>
                <button
                  style="display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) var(--space-sm); background: none; border: none; color: var(--t-secondary); font-size: 0.85rem; cursor: pointer; border-radius: var(--radius-sm); text-align: left; transition: background 0.12s, color 0.12s; font-family: inherit;"
                  @mouseenter=${(e: Event) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-glass)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--t-primary)';
                  }}
                  @mouseleave=${(e: Event) => {
                    (e.currentTarget as HTMLElement).style.background = 'none';
                    (e.currentTarget as HTMLElement).style.color = 'var(--t-secondary)';
                  }}
                  @click=${this._showHelpModal}
                >
                  <span style="font-size: 1rem; width: 20px; text-align: center;">⌨️</span>
                  Keyboard shortcuts
                </button>
                <button
                  style="display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) var(--space-sm); background: none; border: none; color: var(--t-secondary); font-size: 0.85rem; cursor: pointer; border-radius: var(--radius-sm); text-align: left; transition: background 0.12s, color 0.12s; font-family: inherit;"
                  @mouseenter=${(e: Event) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-glass)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--t-primary)';
                  }}
                  @mouseleave=${(e: Event) => {
                    (e.currentTarget as HTMLElement).style.background = 'none';
                    (e.currentTarget as HTMLElement).style.color = 'var(--t-secondary)';
                  }}
                  @click=${() => {
                    this._view = 'diagnostics';
                    this._updateRoute();
                  }}
                >
                  <span style="font-size: 1rem; width: 20px; text-align: center;">🔍</span>
                  Diagnostics
                </button>
              </div>
            </div>
          </div>

          <div
            class="glass-panel"
            style="padding: var(--space-md) var(--space-lg); border: 1px solid var(--border-glass);"
          >
            <h3
              style="font-size: 0.85rem; font-weight: 600; color: var(--t-muted); text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 var(--space-sm) 0;"
            >
              Ecosystem
            </h3>
            <div
              style="display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; font-size: 0.82rem; color: var(--t-secondary);"
            >
              <div
                style="padding: 4px 10px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); font-family: monospace;"
              >
                .photon.ts
              </div>
              <span style="color: var(--t-muted);">→</span>
              <div
                style="padding: 4px 10px; background: var(--bg-glass); border: 1px solid var(--accent-primary); border-radius: var(--radius-sm);"
              >
                ⚡ Photon Runtime
              </div>
              <span style="color: var(--t-muted);">→</span>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <span
                  style="padding: 3px 8px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-sm);"
                  >Beam UI</span
                >
                <span
                  style="padding: 3px 8px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-sm);"
                  >Claude Desktop</span
                >
                <span
                  style="padding: 3px 8px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-sm);"
                  >Cursor</span
                >
                <span
                  style="padding: 3px 8px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-sm);"
                  >photon CLI</span
                >
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Show load error view for photons that failed to load
    if (
      this._selectedPhoton.configured === false &&
      this._selectedPhoton.errorReason === 'load-error'
    ) {
      const photon = this._selectedPhoton;
      return html`
        <div
          class="glass-panel"
          style="padding: var(--space-lg); max-width: 700px; border-left: 3px solid hsl(0, 70%, 55%);"
        >
          <h2 style="margin: 0 0 var(--space-sm) 0; color: hsl(0, 70%, 65%);">⚠ Failed to load</h2>
          <p
            style="color: var(--t-secondary); margin: 0 0 var(--space-md) 0; font-size: var(--text-md);"
          >
            <strong>${photon.name}</strong> could not be loaded. Fix the issue and Beam will reload
            it automatically.
          </p>
          ${photon.path
            ? html`<p
                style="color: var(--t-muted); font-size: var(--text-sm); margin: 0 0 var(--space-sm) 0; font-family: monospace;"
              >
                ${photon.path}
              </p>`
            : ''}
          <pre
            style="
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            border-radius: var(--radius-sm);
            padding: var(--space-md);
            font-size: var(--text-sm);
            color: hsl(0, 60%, 70%);
            white-space: pre-wrap;
            word-break: break-word;
            margin: 0;
            max-height: 400px;
            overflow-y: auto;
          "
          >
${photon.errorMessage || 'Unknown error'}</pre
          >
        </div>
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
            @configure=${(e: Event) => {
              void this._handleConfigure(e as CustomEvent);
            }}
          ></photon-config>
        </div>
      `;
    }

    // MCP App view for external MCPs with MCP Apps Extension
    if (
      this._view === 'mcp-app' &&
      this._selectedPhoton.isExternalMCP &&
      this._selectedPhoton.hasMcpApp
    ) {
      const uris =
        this._selectedPhoton.mcpAppUris?.length > 0
          ? this._selectedPhoton.mcpAppUris
          : [this._selectedPhoton.mcpAppUri];
      const hasMultipleUIs = uris.length > 1;
      // Use selected URI or default to first
      const currentUri =
        this._selectedMcpAppUri && uris.includes(this._selectedMcpAppUri)
          ? this._selectedMcpAppUri
          : uris[0];

      // Find the linked tool (the one with _meta.ui.resourceUri matching the current URI)
      // This tool provides initial data to the app
      // linkedUi is extracted path (e.g., "mcp-app.html"), mcpAppUri is full URI (e.g., "ui://server/mcp-app.html")
      const linkedMethod =
        this._selectedPhoton.methods?.find(
          (m: any) => m.linkedUi && currentUri?.endsWith('/' + m.linkedUi)
        ) ||
        // Fallback: external MCPs with standalone UI resources may not set _meta.ui on tools.
        // Use 'main' method as the linked tool (convention: main() provides initial app data).
        this._selectedPhoton.methods?.find((m: any) => m.name === 'main');

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
              <div
                class="mcp-app-tabs"
                style="
                display: flex;
                gap: var(--space-xs);
                padding: var(--space-sm) var(--space-md);
                background: var(--bg-glass);
                border-bottom: 1px solid var(--border-glass);
                border-radius: var(--radius-md) var(--radius-md) 0 0;
                margin-bottom: 0;
              "
              >
                ${uris.map(
                  (uri: string) => html`
                    <button
                      style="
                        padding: var(--space-xs) var(--space-md);
                        background: ${uri === currentUri
                        ? 'var(--accent-primary)'
                        : 'var(--bg-glass)'};
                        color: ${uri === currentUri ? 'white' : 'var(--t-muted)'};
                        border: 1px solid ${uri === currentUri
                        ? 'var(--accent-primary)'
                        : 'var(--border-glass)'};
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
          style="padding: 0; overflow: hidden; ${this._mainTab === 'app'
            ? 'flex: 1; display: flex; flex-direction: column;'
            : 'min-height: calc(100vh - 80px);'} position: relative; ${hasMultipleUIs
            ? 'border-radius: 0 0 var(--radius-md) var(--radius-md);'
            : ''}"
        >
          <mcp-app-renderer
            .mcpName=${this._selectedPhoton.name}
            .appUri=${currentUri}
            .linkedTool=${linkedMethod?.name || ''}
            .theme=${this._theme}
            style="${this._mainTab === 'app'
              ? 'flex: 1; height: 100%;'
              : `height: calc(100vh - ${hasMultipleUIs ? '120px' : '80px'});`}"
          ></mcp-app-renderer>
        </div>

        ${this._mainTab !== 'app'
          ? html`
              ${this._renderAnchorNav()}
              <div id="photon-methods" class="bento-methods">
                <h3 class="bento-section-title">
                  ${(() => {
                    const visible = this._getVisibleMethods();
                    const hasTools = visible.some((m: any) => !m.isTemplate);
                    const hasPrompts = visible.some((m: any) => m.isTemplate);
                    return hasTools && hasPrompts
                      ? 'Methods & Prompts'
                      : hasPrompts
                        ? 'Prompts'
                        : 'Methods';
                  })()}
                </h3>
                ${this._getVisibleMethods().length > 0
                  ? html`
                      <div class="cards-grid">
                        ${this._getVisibleMethods().map(
                          (method: any) => html`
                            <method-card
                              .method=${method}
                              .photonName=${this._selectedPhoton.name}
                              .selected=${this._selectedMethod?.name === method.name}
                              @select=${(e: CustomEvent) => {
                                this._selectedMethod = e.detail.method;
                                this._view = 'form';
                                this._updateRoute();
                              }}
                            ></method-card>
                          `
                        )}
                      </div>
                    `
                  : ''}
              </div>
              <div id="photon-prompts" class="bento-bottom-grid">
                ${this._renderPromptsSection()} ${this._renderResourcesSection()}
              </div>
            `
          : ''}
      `;
    }

    if (this._view === 'form' && this._selectedMethod) {
      const isAppMain = this._selectedPhoton.isApp && this._selectedMethod.name === 'main';

      if (isAppMain && !this._selectedMethod.linkedUi) {
        const otherMethods = this._getVisibleMethods().filter((m: any) => m.name !== 'main');

        const appTabActive = this._mainTab === 'app';
        return html`
          <app-layout
            .photonName=${this._selectedPhoton.name}
            .photonIcon=${this._selectedPhoton.appEntry?.icon || '📱'}
            .hideBelow=${appTabActive}
          >
            <div
              slot="app"
              style="${appTabActive
                ? 'height: calc(100vh - 80px);'
                : 'min-height: calc(100vh - 140px);'}"
            >
              <div
                class="glass-panel"
                style="${appTabActive
                  ? 'height: calc(100vh - 80px);'
                  : 'min-height: calc(100vh - 140px);'} overflow: hidden;"
              >
                ${this._renderMethodBody({
                  photon: this._selectedPhoton,
                  method: this._selectedMethod,
                  result: this._lastResult,
                  executing: this._isExecuting,
                  progress: this._progress,
                  formParams: this._lastFormParams,
                  onSubmit: (e: Event) => void this._handleExecute(e as CustomEvent),
                  onCancel: () => void this._handleBackFromMethod(),
                  appSurface: true,
                })}
              </div>
            </div>
            <div slot="popout" style="height: 100%;"></div>
            ${appTabActive
              ? html`<div slot="below-fold"></div>`
              : html`<div slot="below-fold">
                  ${this._renderAnchorNav()}
                  ${otherMethods.length > 0
                    ? html`
                        <div id="photon-methods" class="bento-methods">
                          <h3 class="bento-section-title">
                            ${(() => {
                              const hasTools = otherMethods.some((m: any) => !m.isTemplate);
                              const hasPrompts = otherMethods.some((m: any) => m.isTemplate);
                              return hasTools && hasPrompts
                                ? 'Methods & Prompts'
                                : hasPrompts
                                  ? 'Prompts'
                                  : 'Methods';
                            })()}
                          </h3>
                          <div class="cards-grid">
                            ${otherMethods.map(
                              (method: any) => html`
                                <method-card
                                  .method=${method}
                                  .photonName=${this._selectedPhoton.name}
                                  @select=${(e: Event) =>
                                    this._handleMethodSelect(e as CustomEvent)}
                                  @update-metadata=${this._handleMethodMetadataUpdate}
                                ></method-card>
                              `
                            )}
                          </div>
                        </div>
                      `
                    : ''}
                  <div id="photon-prompts" class="bento-bottom-grid">
                    ${this._renderPromptsSection()} ${this._renderResourcesSection()}
                  </div>
                </div>`}
          </app-layout>
        `;
      }

      // Check for Linked UI (Custom Interface)
      if (this._selectedMethod.linkedUi) {
        const otherMethods = isAppMain
          ? this._getVisibleMethods().filter((m: any) => m.name !== 'main')
          : [];

        // External MCPs use mcp-app-renderer (MCP Apps Extension protocol)
        // Internal photons use custom-ui-renderer (photon bridge protocol)
        const isExternalMCP = this._selectedPhoton.isExternalMCP;

        // Don't render the iframe until main() completes — this prevents the
        // iframe from loading data independently while an elicitation is pending
        const appFillStyle =
          this._mainTab === 'app' && isAppMain
            ? 'height: 100%; min-height: 0;'
            : 'height: calc(100vh - 140px);';
        const appRenderer = this._isExecuting
          ? html`
              <div
                style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; ${appFillStyle}"
              >
                <span class="spinner"></span>
                <span style="color: var(--t-muted); font-size: 13px;">
                  ${this._progress?.message || 'Starting up…'}
                </span>
              </div>
            `
          : isExternalMCP
            ? html`
                <mcp-app-renderer
                  .mcpName=${this._selectedPhoton.name}
                  .appUri=${`ui://${this._selectedPhoton.name}/${this._selectedMethod.linkedUi}`}
                  .linkedTool=${this._selectedMethod.name}
                  .theme=${this._theme}
                  style="${appFillStyle}"
                ></mcp-app-renderer>
              `
            : html`
                <custom-ui-renderer
                  .photon=${this._selectedPhoton.name}
                  .method=${this._selectedMethod.name}
                  .uiId=${this._selectedMethod.linkedUi}
                  .theme=${this._theme}
                  .initialResult=${this._lastResult}
                  .revision=${this._customUiRevision}
                  style="${appFillStyle}"
                ></custom-ui-renderer>
              `;

        // App-first layout for app main methods
        if (isAppMain) {
          // Split view: app on one side, additional panels on the other
          if (this._splitPanels.length > 0) {
            return html`
              <div
                style="display: flex; gap: 1px; height: calc(100vh - 60px); overflow: hidden; width: 100%;"
              >
                <!-- App Panel (primary) — no title bar, app has its own chrome -->
                <div style="flex: 1; min-width: 0; min-height: 0; overflow: hidden;">
                  ${appRenderer}
                </div>

                <!-- Additional Panels -->
                ${this._splitPanels.map(
                  (panel) => html`
                    <div
                      style="flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-panel);"
                    >
                      ${panel.type === 'method'
                        ? this._renderSinglePanel(this._buildAdditionalPanelOpts(panel))
                        : this._renderSourcePanel(panel.id)}
                    </div>
                  `
                )}
              </div>
            `;
          }

          const appTabActive2 = this._mainTab === 'app';
          return html`
            <app-layout
              .photonName=${this._selectedPhoton.name}
              .photonIcon=${this._selectedPhoton.appEntry?.icon || '📱'}
              .hideBelow=${appTabActive2}
            >
              <div
                slot="app"
                style="${appTabActive2
                  ? 'height: 100%; min-height: 0; display: flex; flex-direction: column;'
                  : 'min-height: calc(100vh - 140px);'}"
              >
                ${appRenderer}
              </div>
              <!-- Popout slot is lazily populated when app-layout toggles popout mode.
                   Eagerly creating a second renderer causes Safari to load two
                   iframes simultaneously (one with zero dimensions), leading to
                   blank screens. -->
              <div slot="popout" style="height: 100%;"></div>
              ${appTabActive2
                ? html`<div slot="below-fold"></div>`
                : html`<div slot="below-fold">
                    ${this._renderAnchorNav()}
                    ${otherMethods.length > 0
                      ? html`
                          <div id="photon-methods" class="bento-methods">
                            <h3 class="bento-section-title">
                              ${(() => {
                                const hasTools = otherMethods.some((m: any) => !m.isTemplate);
                                const hasPrompts = otherMethods.some((m: any) => m.isTemplate);
                                return hasTools && hasPrompts
                                  ? 'Methods & Prompts'
                                  : hasPrompts
                                    ? 'Prompts'
                                    : 'Methods';
                              })()}
                            </h3>
                            <div class="cards-grid">
                              ${otherMethods.map(
                                (method: any) => html`
                                  <method-card
                                    .method=${method}
                                    .photonName=${this._selectedPhoton.name}
                                    .editable=${!!this._selectedPhoton.editable &&
                                    !this._selectedPhoton.isExternalMCP}
                                    @select=${(e: Event) =>
                                      this._handleMethodSelect(e as CustomEvent)}
                                    @update-metadata=${this._handleMethodMetadataUpdate}
                                  ></method-card>
                                `
                              )}
                            </div>
                          </div>
                        `
                      : ''}
                    <div id="photon-prompts" class="bento-bottom-grid">
                      ${this._renderPromptsSection()} ${this._renderResourcesSection()}
                    </div>
                  </div>`}
            </app-layout>
          `;
        }

        // Non-app linked UI — split view support
        if (this._splitPanels.length > 0) {
          return html`
            <div
              style="display: flex; gap: 1px; height: calc(100vh - 60px); overflow: hidden; width: 100%;"
            >
              <!-- Linked UI Panel (primary) -->
              <div
                style="flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; position: relative;"
              >
                <div
                  style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-glass); background: var(--bg-glass); flex-shrink: 0;"
                >
                  <span style="font-size: 12px; font-weight: 500; color: var(--t-primary);"
                    >${this._selectedMethod.title || formatLabel(this._selectedMethod.name)}</span
                  >
                  <div style="position: relative; flex-shrink: 0;">
                    <button
                      @click=${() => {
                        this._methodPickerOpen = !this._methodPickerOpen;
                        this._methodPickerPanelId = null;
                      }}
                      style="padding: 4px 8px; background: none; color: var(--accent-secondary); border: 1px solid var(--accent-secondary); border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: 700; transition: all 0.2s ease;"
                      title="Add panel"
                    >
                      +
                    </button>
                    ${this._methodPickerOpen && this._methodPickerPanelId === null
                      ? this._renderMethodPickerPopover()
                      : ''}
                  </div>
                </div>
                <div style="flex: 1; min-height: 0; overflow: hidden;">${appRenderer}</div>
              </div>

              <!-- Additional Panels -->
              ${this._splitPanels.map(
                (panel) => html`
                  <div
                    style="flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-panel);"
                  >
                    ${panel.type === 'method'
                      ? this._renderSinglePanel(this._buildAdditionalPanelOpts(panel))
                      : this._renderSourcePanel(panel.id)}
                  </div>
                `
              )}
            </div>
          `;
        }

        // Non-app linked UI — linked UI renderer
        return html`
          <div style="position: relative;">
            <div style="position: absolute; top: 16px; right: 16px; z-index: 50;">
              <button
                @click=${() => {
                  this._methodPickerOpen = !this._methodPickerOpen;
                  this._methodPickerPanelId = null;
                }}
                style="padding: 4px 8px; background: var(--bg-glass); color: var(--accent-secondary); border: 1px solid var(--accent-secondary); border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: 700; transition: all 0.2s ease; backdrop-filter: blur(8px);"
                title="Add panel"
              >
                +
              </button>
              ${this._methodPickerOpen && this._methodPickerPanelId === null
                ? this._renderMethodPickerPopover()
                : ''}
            </div>
            <div
              class="glass-panel"
              style="padding: 0; overflow: hidden; min-height: calc(100vh - 80px); margin-top: var(--space-md);"
            >
              ${appRenderer}
            </div>
          </div>
        `;
      }

      // Default Form Interface — back button is now at <main> level
      return html` ${this._renderMethodContent()} `;
    }

    // For external MCPs, hide photon-specific toolbar actions in list view
    return html`
      ${this._editingIcon ? this._renderEmojiPicker() : ''} ${this._renderAnchorNav()}

      <div id="photon-methods" class="bento-methods">
        <h3 class="bento-section-title">
          ${(() => {
            const visible = this._getVisibleMethods();
            const hasTools = visible.some((m: any) => !m.isTemplate);
            const hasPrompts = visible.some((m: any) => m.isTemplate);
            return hasTools && hasPrompts
              ? 'Methods & Prompts'
              : hasPrompts
                ? 'Prompts'
                : 'Methods';
          })()}
        </h3>
        ${this._getVisibleMethods().length > 0
          ? html`
              <div class="cards-grid">
                ${this._getVisibleMethods().map(
                  (method: any) => html`
                    <method-card
                      .method=${method}
                      .photonName=${this._selectedPhoton.name}
                      @select=${(e: Event) => this._handleMethodSelect(e as CustomEvent)}
                      @update-metadata=${this._handleMethodMetadataUpdate}
                    ></method-card>
                  `
                )}
              </div>
            `
          : html`
              <div class="empty-state-inline">
                <span class="empty-state-icon">⚡</span>
                <span
                  >No methods available. Add public methods to this photon's class to expose them
                  here.</span
                >
              </div>
            `}
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
                    <span>${r.passed ? check : xMark}</span>
                    <span style="flex: 1;">${r.method}</span>
                    ${r.duration != null
                      ? html`<span style="color: var(--t-muted); font-size: 0.75rem;"
                          >${r.duration}ms</span
                        >`
                      : ''}
                    ${r.error
                      ? html`<span style="color: var(--color-error); font-size: 0.75rem;"
                          >${r.error}</span
                        >`
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

      <div id="photon-prompts" class="bento-bottom-grid">
        ${this._renderPromptsSection()} ${this._renderResourcesSection()}
      </div>
    `;
  }

  // ===== Mobile Sidebar Methods =====
  private _toggleSidebar() {
    this._sidebarVisible = !this._sidebarVisible;
  }

  private _closeSidebar() {
    this._sidebarVisible = false;
  }

  private _handleSplitResizeStart(e: PointerEvent) {
    e.preventDefault();
    const divider = e.currentTarget as HTMLElement;
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');

    const container = divider.parentElement!;
    const containerRect = container.getBoundingClientRect();
    const startX = e.clientX;
    const primaryPanel = divider.previousElementSibling as HTMLElement;
    const startWidth = primaryPanel.getBoundingClientRect().width;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const minWidth = 200;
      const maxWidth = containerRect.width - 200 - 5; // 5px divider
      this._splitPrimaryWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
    };

    const onUp = () => {
      divider.classList.remove('dragging');
      divider.removeEventListener('pointermove', onMove);
      divider.removeEventListener('pointerup', onUp);
    };

    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
  }

  private _handleSidebarResizeStart(e: PointerEvent) {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const startX = e.clientX;
    const startWidth = this._sidebarWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const newWidth = Math.min(500, Math.max(200, startWidth + moveEvent.clientX - startX));
      this._sidebarWidth = newWidth;
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      localStorage.setItem('beam-sidebar-width', String(this._sidebarWidth));
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  }

  private _handlePhotonSelectMobile(e: CustomEvent) {
    this._closeSidebar();
    void this._handlePhotonSelect(e);
  }

  private _handleMarketplaceMobile() {
    this._closeSidebar();
    this._view = 'marketplace';
    this._updateRoute();
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

  /** Update current instance and persist to sessionStorage for tab-refresh survival */
  private _setCurrentInstance(photonName: string, instance: string) {
    this._currentInstance = instance;
    if (instance && instance !== 'default') {
      sessionStorage.setItem(`photon-instance:${photonName}`, instance);
    } else {
      sessionStorage.removeItem(`photon-instance:${photonName}`);
    }
  }

  /** Restore instance from sessionStorage, silently calling _use if needed */
  private async _restoreInstance(photonName: string) {
    const saved = sessionStorage.getItem(`photon-instance:${photonName}`);
    if (saved && saved !== 'default') {
      try {
        await mcpClient.callTool(`${photonName}/_use`, { name: saved });
        this._currentInstance = saved;
      } catch {
        // Failed to restore — clear stale value
        sessionStorage.removeItem(`photon-instance:${photonName}`);
        this._currentInstance = 'default';
      }
    }
  }

  private async _handlePhotonSelect(e: CustomEvent) {
    // Clear split view when switching to a different photon
    this._closeSecondPanel();
    this._selectedPhoton = e.detail.photon;
    this._selectedMethod = null;
    this._lastResult = null;
    this._customFormatUri = null;
    this._selectedMcpAppUri = null; // Reset MCP App tab when switching MCPs
    this._currentInstance = 'default';

    // For unconfigured photons, show configuration view
    if (this._selectedPhoton.configured === false) {
      this._view = 'config';
      this._updateRoute();
      return;
    }

    // For external MCPs with MCP Apps, show the MCP App
    if (this._selectedPhoton.isExternalMCP && this._selectedPhoton.hasMcpApp) {
      this._view = 'mcp-app';
      this._mainTab = 'app';
      this._updateRoute();
      return;
    }

    // Restore saved instance for stateful photons (survives tab refresh)
    if (this._selectedPhoton.stateful && this._selectedPhoton.configured) {
      await this._restoreInstance(this._selectedPhoton.name);
    }

    // Fetch available instances for stateful photons (populates instance panel)
    if (this._selectedPhoton.stateful) {
      await this._fetchInstances(this._selectedPhoton.name);
      // Auto mode: switch to most recently active instance on first load
      // (only if the user hasn't explicitly picked an instance for this photon)
      const hasSessionInstance = !!sessionStorage.getItem(
        `photon-instance:${this._selectedPhoton.name}`
      );
      if (
        this._instanceSelectorMode === 'auto' &&
        !hasSessionInstance &&
        this._autoInstance &&
        this._autoInstance !== this._currentInstance
      ) {
        try {
          await mcpClient.callTool(`${this._selectedPhoton.name}/_use`, {
            name: this._autoInstance,
          });
          this._currentInstance = this._autoInstance;
        } catch {
          // Fall back to default silently
        }
      }
    }

    // For Apps, automatically select the main method to show Custom UI
    if (this._selectedPhoton.isApp && this._selectedPhoton.appEntry) {
      // Set _isExecuting BEFORE setting method to prevent iframe rendering before data loads
      if (this._willAutoInvoke(this._selectedPhoton.appEntry)) {
        this._isExecuting = true;
      }
      this._selectedMethod = this._selectedPhoton.appEntry;
      this._view = 'form';
      this._mainTab = 'app';
      this._updateRoute();
      // Auto-invoke to load initial data (e.g., kanban board)
      this._maybeAutoInvoke(this._selectedPhoton.appEntry);
      return;
    } else {
      this._view = 'list';
      this._mainTab = 'methods';
    }
    this._updateRoute();
  }

  /** Fetch available instances for a stateful photon from the server */
  private async _fetchInstances(photonName: string) {
    try {
      const res = await fetch(`/api/instances/${encodeURIComponent(photonName)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        this._instances = data.instances || [];
        this._autoInstance = data.autoInstance || '';
      }
    } catch {
      // Non-critical — instance selector just won't show
    }
  }

  /** Handle board/instance selection from app-layout dropdown */
  private async _handleInstanceChange(e: CustomEvent) {
    if (!this._selectedPhoton) return;
    const photonName = this._selectedPhoton.name;
    const selected = e.detail.instance as string;

    // Track whether user explicitly chose a board or left it on auto
    if (selected === '__auto__') {
      this._instanceSelectorMode = 'auto';
      // Re-fetch to get the most recently updated instance
      await this._fetchInstances(photonName);
    } else {
      this._instanceSelectorMode = 'manual';
    }

    const target = selected === '__auto__' ? this._autoInstance || 'default' : selected;
    if (target === this._currentInstance) return;
    try {
      await mcpClient.callTool(`${photonName}/_use`, { name: target });
      this._currentInstance = target;
      sessionStorage.setItem(`photon-instance:${photonName}`, target);
      // Re-invoke main() to load the new board
      if (this._selectedMethod) {
        void this._handleExecute(new CustomEvent('execute', { detail: { args: {} } }));
      }
    } catch {
      showToast('Failed to switch board', 'error');
    }
  }

  /**
   * Trigger instance switch via MCP elicitation (calls _use without name).
   * The transport layer shows an elicitation modal with available instances.
   * After _use succeeds, the transport broadcasts state-changed which
   * triggers _silentRefresh() to update the result and notifies custom UIs.
   */
  private async _switchInstance() {
    if (!this._selectedPhoton) return;
    const photonName = this._selectedPhoton.name;
    try {
      const result = await mcpClient.callTool(`${photonName}/_use`, {});
      // Parse result to update current instance for breadcrumb
      if (result && !result.isError) {
        const textContent = result.content?.find((c: any) => c.type === 'text')?.text;
        if (textContent && textContent !== 'Cancelled') {
          try {
            const parsed = JSON.parse(textContent);
            if (parsed.instance) {
              this._setCurrentInstance(photonName, parsed.instance);
              showToast(
                `Switched to instance: ${parsed.instance === 'default' ? '(default)' : parsed.instance}`,
                'success'
              );
            }
          } catch {
            // Non-JSON response — may be a simple status message
          }
        }
      }
    } catch {
      showToast('Failed to switch instance', 'error');
    }
  }

  private _handleMethodSelect(e: CustomEvent) {
    // Teardown any active custom-ui-renderer before switching methods
    this._teardownActiveCustomUI();
    this._canvasActive = false;
    this._lastFormParams = {};
    // Preserve shared params in view mode (they come from URL and need to survive method selection)
    if (this._viewMode === 'full') {
      this._sharedFormParams = null;
    }
    // Set _isExecuting BEFORE setting state to prevent iframe from rendering
    // before the tool call starts (which would bypass elicitation)
    if (this._willAutoInvoke(e.detail.method)) {
      this._isExecuting = true;
    }
    this._selectedMethod = e.detail.method;
    this._lastResult = null;
    this._customFormatUri = null;
    this._view = 'form';
    this._updateRoute();

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
    const customRenderer = this.shadowRoot?.querySelector('custom-ui-renderer');
    if (customRenderer?.teardown) {
      customRenderer.teardown().catch(() => {});
    }
    const mcpAppRenderer = this.shadowRoot?.querySelector('mcp-app-renderer');
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
  private _renderDescription(description?: string) {
    if (!description) return html``;
    // Strip docblock directive tags (@template, @internal, etc.) that may leak into descriptions.
    // Two cases handled:
    // 1. Line-starting @tags (tag on its own JSDoc line)
    // 2. Trailing @tags at end of string — when schema-extractor joins JSDoc lines with spaces
    //    and a tag like @template ends up inline: "Description text @title Say"
    //    Handle tags that may have one or more value words after them (e.g. @title Say, @menu.label Check Status)
    const cleaned = description
      .replace(/^\s*@\w+[^\n]*/gm, '')
      .replace(/(?:\s+@[\w.]+(?:\s+(?!@)[\w.]+)*)+\s*$/, '')
      // Collapse multiple spaces only (not newlines) so markdown structure is preserved
      .replace(/[ \t]{2,}/g, ' ')
      // Reconstruct list structure that may have been flattened during JSDoc extraction:
      // " - item" → newline before "- item", " 1. item" → newline before "1. item"
      .replace(/ (- (?!\d))/g, '\n$1')
      .replace(/ (\d+\. )/g, '\n$1')
      .trim();
    if (!cleaned) return html``;
    const marked = (window as any).marked;
    if (marked) {
      const htmlContent = marked.parse(cleaned) as string;
      return html`<div class="method-description">${unsafeHTML(htmlContent)}</div>`;
    }
    return html`<p>${cleaned}</p>`;
  }

  private _renderMethodContent() {
    const showBackButton = this._mainTab === 'methods' || !this._selectedPhoton?.isApp;

    // HTML UI mode: minimal chrome, just show the interactive content
    if (this._isHtmlUiMode()) {
      return html`
        <div class="glass-panel html-ui-panel" style="padding: 0; overflow: hidden;">
          <result-viewer
            .result=${this._lastResult}
            .outputFormat=${this._selectedMethod?.outputFormat}
            .layoutHints=${this._selectedMethod?.layoutHints}
            .photonName=${this._selectedPhoton?.name}
            .theme=${this._theme}
            .loading=${this._isExecuting && !this._lastResult}
            .live=${this._currentCollectionName !== null}
            .resultKey=${this._selectedPhoton && this._selectedMethod
              ? `${this._selectedPhoton.name}/${this._selectedMethod.name}`
              : undefined}
            @share=${() => this._handleShareResult()}
            @checklist-action=${(e: CustomEvent) => this._handleChecklistAction(e)}
          ></result-viewer>
        </div>
      `;
    }

    // Split view mode — N panels
    if (this._splitPanels.length > 0) {
      return html`
        <div style="display: flex; height: 100%; overflow: hidden; width: 100%;">
          <!-- Primary Panel -->
          <div
            style="${this._splitPrimaryWidth != null
              ? `width: ${this._splitPrimaryWidth}px; flex-shrink: 0;`
              : 'flex: 1;'} min-width: 0; min-height: 0; overflow: auto; background: var(--bg-panel);"
          >
            ${this._renderSinglePanel({
              photon: this._selectedPhoton,
              method: this._selectedMethod,
              result: this._lastResult,
              executing: this._isExecuting,
              progress: this._progress,
              formParams: this._lastFormParams,
              onSubmit: (e: Event) => void this._handleExecute(e as CustomEvent),
              onCancel: () => void this._handleBackFromMethod(),
              panelLabel: 'Primary',
              instance: this._currentInstance,
              instances: this._instances,
              onInstanceChange: (instance: string) => this._handleLeftPanelInstanceChange(instance),
              allMethods: this._selectedPhoton?.methods || [],
              onMethodChange: (method: any) => this._handleLeftPanelMethodChange(method),
              panelSide: 'primary',
              onPanelAction: (action: string) => this._handlePrimaryPanelAction(action),
              onInstanceAction: (detail: any) => void this._handleInstanceAction(detail),
              isStateful: !!this._selectedPhoton?.stateful,
              isLive: this._currentCollectionName !== null,
              overflowItems: this._buildOverflowItems({
                showRefresh: !this._selectedPhoton?.isExternalMCP,
                showRename: false,
                showViewSource: false,
                showDelete: false,
                showHelp: !this._selectedPhoton?.isExternalMCP,
              }),
              onOverflowSelect: (id: string) => this._handleOverflowAction(id),
              onBack: showBackButton ? () => void this._handleBackFromMethod() : undefined,
              backLabel: this._selectedPhoton?.name,
            })}
          </div>

          <!-- Additional Panels -->
          ${this._splitPanels.map(
            (panel) => html`
              <div
                class="split-divider"
                @pointerdown=${(e: PointerEvent) => this._handleSplitResizeStart(e)}
              ></div>
              <div
                style="flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-panel);"
              >
                ${panel.type === 'method'
                  ? this._renderSinglePanel(this._buildAdditionalPanelOpts(panel))
                  : this._renderSourcePanel(panel.id)}
              </div>
            `
          )}
        </div>
      `;
    }

    // Standard form mode (single panel) — uses same self-contained panel header
    return this._renderSinglePanel({
      photon: this._selectedPhoton,
      method: this._selectedMethod,
      result: this._lastResult,
      executing: this._isExecuting,
      progress: this._progress,
      formParams: this._lastFormParams,
      onSubmit: (e: Event) => void this._handleExecute(e as CustomEvent),
      onCancel: () => void this._handleBackFromMethod(),
      appSurface: this._viewMode !== 'full',
      panelLabel: 'Primary',
      instance: this._currentInstance,
      instances: this._instances,
      allMethods: this._selectedPhoton?.methods || [],
      onMethodChange: (method: any) => {
        this._selectedMethod = method;
        this._lastResult = null;
        this._customFormatUri = null;
        this._lastFormParams = {};
        if (this._willAutoInvoke(method)) {
          void this._handleExecute(new CustomEvent('execute', { detail: { args: {} } }));
        }
        this._updateRoute();
      },
      panelSide: 'primary',
      onPanelAction: (action: string) => this._handlePrimaryPanelAction(action),
      onInstanceAction: (detail: any) => void this._handleInstanceAction(detail),
      isStateful: !!this._selectedPhoton?.stateful,
      isLive: this._currentCollectionName !== null,
      overflowItems: this._buildOverflowItems({
        showRefresh: !this._selectedPhoton?.isExternalMCP,
        showRename: false,
        showViewSource: false,
        showDelete: false,
        showHelp: !this._selectedPhoton?.isExternalMCP,
      }),
      onOverflowSelect: (id: string) => this._handleOverflowAction(id),
      onBack: showBackButton ? () => void this._handleBackFromMethod() : undefined,
      backLabel: this._selectedPhoton?.name,
    });
  }

  /** Render a single panel with self-contained header */
  private _renderSinglePanel(opts: {
    photon: any;
    method: any;
    result: any;
    executing: boolean;
    progress: any;
    formParams: Record<string, any>;
    onSubmit: (e: Event) => void;
    onCancel: () => void;
    panelLabel: string;
    instance?: string;
    instances?: string[];
    allMethods?: any[];
    onMethodChange?: (method: any) => void;
    panelSide?: 'primary' | 'additional';
    onPanelAction?: (action: string) => void;
    onInstanceAction?: (detail: any) => void;
    isStateful?: boolean;
    isLive?: boolean;
    overflowItems?: import('./overflow-menu.js').OverflowMenuItem[];
    onOverflowSelect?: (id: string) => void;
    onBack?: () => void;
    backLabel?: string;
  }) {
    const isSplit = this._splitPanels.length > 0;
    return html`
      <div
        class="glass-panel method-detail"
        style="${isSplit
          ? 'border-radius: 0; height: 100%;'
          : ''} display: flex; flex-direction: column;"
      >
        <!-- Panel Header: LED + Method ▼ + instance-panel + [+] + [⋯] + [×] -->
        <div
          class="panel-header"
          style="display: flex; align-items: center; gap: 8px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border-glass); flex-shrink: 0; position: relative;"
        >
          <!-- Back button -->
          ${opts.onBack
            ? html`<button
                @click=${() => opts.onBack!()}
                style="padding: 0; width: 24px; height: 24px; background: none; border: 1px solid var(--border-glass); border-radius: var(--radius-xs, 4px); color: var(--t-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s ease;"
                @mouseenter=${(e: MouseEvent) => {
                  (e.target as HTMLElement).style.color = 'var(--t-primary)';
                  (e.target as HTMLElement).style.borderColor = 'var(--accent-primary)';
                }}
                @mouseleave=${(e: MouseEvent) => {
                  (e.target as HTMLElement).style.color = 'var(--t-muted)';
                  (e.target as HTMLElement).style.borderColor = 'var(--border-glass)';
                }}
                title="Back to ${opts.backLabel || 'methods'}"
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
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>`
            : ''}
          <!-- LED dot (stateful/live indicator) -->
          ${opts.isStateful
            ? html`<span
                style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${opts.isLive
                  ? 'var(--color-success, #22c55e)'
                  : 'var(--t-tertiary, #666)'}; box-shadow: ${opts.isLive
                  ? '0 0 6px var(--color-success, #22c55e)'
                  : 'none'};"
                title="${opts.isLive
                  ? 'Live — stateful photon with active subscription'
                  : 'Stateful photon'}"
              ></span>`
            : ''}

          <!-- Method Selector (name as dropdown) -->
          <select
            .value=${opts.method.name}
            @change=${(e: Event) => {
              const methodName = (e.target as HTMLSelectElement).value;
              const method = opts.allMethods?.find((m: any) => m.name === methodName);
              if (method && opts.onMethodChange) {
                opts.onMethodChange(method);
              }
            }}
            style="padding: 6px 28px 6px 10px; border-radius: 6px; border: 1px solid var(--border-glass); background: var(--bg-glass); color: var(--t-primary); font-size: 13px; font-weight: 600; flex-shrink: 0; appearance: none; -webkit-appearance: none; cursor: pointer; background-image: url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22><path d=%22M0 0l5 6 5-6z%22 fill=%22%23999%22/></svg>'); background-repeat: no-repeat; background-position: right 8px center;"
          >
            ${opts.allMethods?.map(
              (m: any) =>
                html`<option .selected=${m.name === opts.method.name} value=${m.name}>
                  ${m.title || formatLabel(m.name)}
                </option>`
            ) ||
            html`<option value=${opts.method.name}>
              ${opts.method.title || formatLabel(opts.method.name)}
            </option>`}
          </select>

          <div style="flex: 1;"></div>

          <!-- Rich Instance Selector -->
          ${opts.isStateful && opts.instances && opts.instances.length > 0 && opts.onInstanceAction
            ? html`
                <instance-panel
                  .instanceName=${opts.instance || 'default'}
                  .instances=${opts.instances}
                  .photonName=${opts.photon.name}
                  .selectorMode=${this._instanceSelectorMode}
                  .autoInstance=${this._autoInstance}
                  @instance-action=${(e: CustomEvent) => opts.onInstanceAction?.(e.detail)}
                ></instance-panel>
              `
            : ''}

          <!-- Add panel button (primary only) -->
          ${opts.panelSide === 'primary'
            ? html`
                <div style="position: relative; flex-shrink: 0;">
                  <button
                    @click=${() => opts.onPanelAction?.('toggle-picker')}
                    style="padding: 4px 8px; background: none; color: var(--accent-secondary); border: 1px solid var(--accent-secondary); border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: 700; transition: all 0.2s ease;"
                    title="Add panel"
                  >
                    +
                  </button>
                  ${this._methodPickerOpen && this._methodPickerPanelId === null
                    ? this._renderMethodPickerPopover()
                    : ''}
                </div>
              `
            : ''}

          <!-- Overflow menu -->
          ${opts.overflowItems && opts.overflowItems.length > 0
            ? html`
                <overflow-menu
                  .items=${opts.overflowItems}
                  @menu-select=${(e: CustomEvent) => opts.onOverflowSelect?.(e.detail.id)}
                ></overflow-menu>
              `
            : ''}

          <!-- Close button (additional panels only) -->
          ${opts.panelSide === 'additional'
            ? html`
                <button
                  @click=${() => opts.onPanelAction?.('close')}
                  style="padding: 4px 8px; background: none; color: var(--color-error); border: 1px solid var(--color-error); border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: 700; flex-shrink: 0; transition: all 0.2s ease;"
                  title="Close panel"
                >
                  ×
                </button>
              `
            : ''}
        </div>
        <!-- Panel Content (scrollable) -->
        ${this._renderMethodBody(opts)}
      </div>
    `;
  }

  private _renderMethodBody(opts: {
    photon: any;
    method: any;
    result: any;
    executing: boolean;
    progress: any;
    formParams: Record<string, any>;
    onSubmit: (e: Event) => void;
    onCancel: () => void;
    appSurface?: boolean;
  }) {
    const hasParams =
      !!opts.method?.params?.properties && Object.keys(opts.method.params.properties).length > 0;
    return html`
      <div style="display: flex; flex-direction: column; flex: 1; min-height: 0;">
        ${opts.appSurface ? '' : this._renderDescription(opts.method.description)}
        ${opts.appSurface && !hasParams
          ? ''
          : html`
              <invoke-form
                .params=${opts.method.params}
                .loading=${opts.executing}
                .photonName=${opts.photon.name}
                .methodName=${opts.method.name}
                .rememberValues=${this._rememberFormValues}
                .sharedValues=${this._sharedFormParams ?? opts.formParams}
                @submit=${opts.onSubmit}
                @cancel=${opts.onCancel}
              ></invoke-form>
              ${this._viewMode === 'full'
                ? html`
                    <div class="form-chrome">
                      ${hasParams
                        ? html`<button
                            class="btn-secondary"
                            @click=${(e: Event) => {
                              const panel = (e.target as HTMLElement).closest('.method-detail');
                              const form: any = panel?.querySelector('invoke-form');
                              form?.handleCancel();
                            }}
                            ?disabled=${opts.executing}
                          >
                            Cancel
                          </button>`
                        : ''}
                      <button
                        class="btn-primary"
                        @click=${(e: Event) => {
                          const panel = (e.target as HTMLElement).closest('.method-detail');
                          const form: any = panel?.querySelector('invoke-form');
                          form?.handleSubmit();
                        }}
                        ?disabled=${opts.executing}
                      >
                        ${opts.executing
                          ? html`<span class="btn-loading"
                              ><span class="spinner"></span>Executing...</span
                            >`
                          : hasParams
                            ? 'Execute'
                            : 'Re-execute'}
                      </button>
                    </div>
                  `
                : ''}
            `}
        ${opts.progress
          ? html`
              <div class="progress-container">
                <div class="progress-bar-wrapper">
                  <div
                    class="progress-bar ${opts.progress.value < 0 ? 'indeterminate' : ''}"
                    style="width: ${opts.progress.value < 0
                      ? '30%'
                      : Math.round(opts.progress.value * 100) + '%'}"
                  ></div>
                </div>
                <div class="progress-text">
                  <span>${opts.progress.message}</span>
                </div>
              </div>
            `
          : ''}
        ${opts.result !== null || this._canvasActive
          ? this._customFormatUri
            ? html`
                <custom-ui-renderer
                  .photon=${opts.photon?.name || ''}
                  .method=${opts.method?.name || ''}
                  .uiUri=${this._customFormatUri}
                  .theme=${this._theme}
                  .initialResult=${opts.result}
                  .revision=${this._customUiRevision}
                ></custom-ui-renderer>
              `
            : html`
                ${this._viewMode === 'full' &&
                opts.method?.outputFormat !== 'slides' &&
                !opts.appSurface
                  ? html`<div class="result-chrome">
                      <span class="result-chrome-title"></span>
                      <div class="result-chrome-actions">
                        <button
                          @click=${() => {
                            const rv: any = this.shadowRoot?.querySelector('result-viewer');
                            rv?.copy();
                          }}
                        >
                          Copy
                        </button>
                        <button
                          @click=${() => {
                            const rv: any = this.shadowRoot?.querySelector('result-viewer');
                            rv?.downloadSmart();
                          }}
                        >
                          ↓ Export
                        </button>
                        <button @click=${() => this._handleShareResult()}>Share</button>
                      </div>
                    </div>`
                  : ''}
                ${this._canvasActive
                  ? html`<canvas-renderer
                      .photon=${opts.photon?.name || ''}
                      .method=${opts.method?.name || ''}
                      .theme=${this._theme}
                    ></canvas-renderer>`
                  : html`<result-viewer
                      .result=${opts.result}
                      .outputFormat=${opts.method?.outputFormat}
                      .layoutHints=${opts.method?.layoutHints}
                      .photonName=${opts.photon?.name}
                      .theme=${this._theme}
                      .live=${this._currentCollectionName !== null}
                      .resultKey=${opts.photon && opts.method
                        ? `${opts.photon.name}/${opts.method.name}`
                        : undefined}
                      @share=${() => this._handleShareResult()}
                      @checklist-action=${(e: CustomEvent) => this._handleChecklistAction(e)}
                    ></result-viewer>`}
              `
          : html`
              <div class="empty-state-inline result-empty">
                <span class="empty-state-icon">${play}</span>
                <span>Run the method to see results here</span>
              </div>
            `}
      </div>
    `;
  }

  /** Close all split panels and return to single-panel mode */
  private _closeSecondPanel() {
    this._splitPanels = [];
    this._splitPrimaryWidth = null;
    this._methodPickerOpen = false;
    this._methodPickerPanelId = null;
    this._updateRoute();
  }

  /** Handle instance change for primary panel */
  private _handleLeftPanelInstanceChange(instance: string) {
    this._currentInstance = instance;
    sessionStorage.setItem(`photon-instance:${this._selectedPhoton.name}`, instance);
    this._lastResult = null;
    this._customFormatUri = null;
  }

  /** Add a new split panel */
  private _addPanel(type: 'method' | 'source', method?: any) {
    if (this._splitPanels.length >= 2) return; // max 3 total (primary + 2)
    const panel = {
      id: `panel-${++this._nextPanelId}`,
      type,
      method,
      result: null as any,
      executing: false,
      progress: null as { value: number; message: string } | null,
      formParams: {} as Record<string, any>,
      instance: this._currentInstance || 'default',
    };
    this._splitPanels = [...this._splitPanels, panel];

    // Auto-execute zero-param methods
    if (type === 'method' && method && this._willAutoInvoke(method)) {
      void this._executePanelMethod(panel.id, {});
    }
    this._methodPickerOpen = false;
    this._methodPickerPanelId = null;
    this._cleanupPickerDismiss();
    this._updateRoute();
  }

  /** Remove a split panel by id */
  private _removePanel(panelId: string) {
    this._splitPanels = this._splitPanels.filter((p) => p.id !== panelId);
    this._updateRoute();
  }

  /** Update a split panel's state */
  private _updatePanel(panelId: string, updates: Partial<(typeof this._splitPanels)[0]>) {
    this._splitPanels = this._splitPanels.map((p) => (p.id === panelId ? { ...p, ...updates } : p));
  }

  /** Execute a method in a split panel */
  private async _executePanelMethod(panelId: string, args: Record<string, any>) {
    const panel = this._splitPanels.find((p) => p.id === panelId);
    if (!panel || panel.type !== 'method' || !panel.method) return;

    this._updatePanel(panelId, { executing: true, result: null, progress: null, formParams: args });

    // Generate a unique progressToken so progress events route to this panel
    const progressToken = `panel_${panelId}_${Date.now()}`;
    this._panelProgressTokens.set(progressToken, panelId);

    try {
      const toolName = `${this._selectedPhoton.name}/${panel.method.name}`;
      const result = await mcpClient.callTool(toolName, args, progressToken);

      this._updatePanel(panelId, {
        result: mcpClient.parseToolResult(result),
        executing: false,
        progress: null,
      });
    } catch (error: any) {
      showToast(`Error: ${error.message}`, { type: 'error' });
      this._updatePanel(panelId, {
        result: { error: error.message },
        executing: false,
        progress: null,
      });
    } finally {
      this._panelProgressTokens.delete(progressToken);
    }
  }

  /** Change the method in a split panel */
  private _changePanelMethod(panelId: string, method: any) {
    this._updatePanel(panelId, { method, result: null, formParams: {} });
    if (this._willAutoInvoke(method)) {
      void this._executePanelMethod(panelId, {});
    }
    this._updateRoute();
  }

  /** Change the instance in a split panel */
  private _changePanelInstance(panelId: string, instance: string) {
    this._updatePanel(panelId, { instance, result: null });
  }

  /** Open a method in a new split panel (backwards-compatible entry point) */
  private _openInSecondPanel(photon: any, method: any) {
    this._addPanel('method', method);
  }

  /** Show method picker popover */
  private _showMethodPicker() {
    this._methodPickerOpen = !this._methodPickerOpen;
    this._methodPickerPanelId = null; // picker for adding new panel
  }

  /** Clean up picker dismiss listener */
  private _cleanupPickerDismiss() {
    if (this._pickerDismissHandler) {
      window.removeEventListener('mousedown', this._pickerDismissHandler, true);
      this._pickerDismissHandler = null;
    }
  }

  /** Handle method change in primary panel */
  private _handleLeftPanelMethodChange(method: any) {
    this._selectedMethod = method;
    this._lastResult = null;
    this._customFormatUri = null;
    this._lastFormParams = {};
    this._sharedFormParams = null;
    this._updateRoute();
  }

  /** Handle panel action for primary panel */
  private _handlePrimaryPanelAction(action: string) {
    if (action === 'toggle-picker') {
      this._methodPickerOpen = !this._methodPickerOpen;
      this._methodPickerPanelId = null;
    }
  }

  /** Build opts for an additional (non-primary) split panel */
  private _buildAdditionalPanelOpts(panel: (typeof this._splitPanels)[0]) {
    return {
      photon: this._selectedPhoton,
      method: panel.method,
      result: panel.result,
      executing: panel.executing || false,
      progress: panel.progress,
      formParams: panel.formParams || {},
      onSubmit: (e: Event) => {
        const args = (e as CustomEvent).detail?.args || {};
        void this._executePanelMethod(panel.id, args);
      },
      onCancel: () => this._removePanel(panel.id),
      panelLabel: panel.id,
      instance: panel.instance,
      instances: this._instances,
      onInstanceChange: (inst: string) => this._changePanelInstance(panel.id, inst),
      allMethods: this._selectedPhoton?.methods || [],
      onMethodChange: (m: any) => this._changePanelMethod(panel.id, m),
      panelSide: 'additional' as const,
      onPanelAction: (action: string) => {
        if (action === 'close') this._removePanel(panel.id);
      },
      onInstanceAction: (detail: any) => {
        // For additional panels, handle switch/create inline
        if (detail.action === 'switch') {
          this._changePanelInstance(panel.id, detail.instance);
        }
      },
      isStateful: !!this._selectedPhoton?.stateful,
      isLive: this._currentCollectionName !== null,
      overflowItems: this._buildOverflowItems({
        showRefresh: false,
        showRename: false,
        showViewSource: false,
        showDelete: false,
        showHelp: false,
        showRunTests: false,
      }),
      onOverflowSelect: (id: string) => this._handleOverflowAction(id),
    };
  }

  /** Handle overflow menu actions from panel headers */
  private _handleOverflowAction(id: string) {
    switch (id) {
      case 'refresh':
        if (this._selectedMethod && this._willAutoInvoke(this._selectedMethod)) {
          void this._handleExecute(new CustomEvent('execute', { detail: { args: {} } }));
        }
        break;
      case 'remember-values':
        this._toggleRememberValues();
        break;
      case 'verbose-logging':
        this._toggleVerboseLogging();
        break;
      case 'run-tests':
        void this._runTests();
        break;
      case 'copy-config-stdio':
        void this._copyConfigSnippet('stdio');
        break;
      case 'copy-config-url':
        void this._copyConfigSnippet('url');
        break;
      case 'help':
        this._mainTab = 'help';
        void this._loadPhotonHelp();
        break;
      default:
        // Delegate to existing context action handler
        this._handleContextAction(new CustomEvent('context-action', { detail: { action: id } }));
        break;
    }
  }

  /** Render source panel for split view */
  private _renderSourcePanel(panelId: string) {
    return html`
      <div style="height: 100%; overflow: hidden;">
        <photon-studio
          .photonName=${this._selectedPhoton?.name}
          .theme=${this._theme}
          @studio-saved=${() => (this as any)._handleStudioSaved?.()}
          @studio-close=${() => this._removePanel(panelId)}
        ></photon-studio>
      </div>
    `;
  }

  private _pickerDismissHandler: (() => void) | null = null;

  /** Render the method picker popover for adding new panels */
  private _renderMethodPickerPopover() {
    const methods = this._getVisibleMethods();
    // Filter out methods already open (primary + panels)
    const openMethodNames = new Set<string>();
    if (this._selectedMethod) openMethodNames.add(this._selectedMethod.name);
    for (const p of this._splitPanels) {
      if (p.type === 'method' && p.method) openMethodNames.add(p.method.name);
    }
    const availableMethods = methods.filter((m: any) => !openMethodNames.has(m.name));
    const hasSourcePanel = this._splitPanels.some((p) => p.type === 'source');
    const canAddMore = this._splitPanels.length < 2;

    if (!canAddMore) return '';

    // Register click-outside dismissal (one-shot, delayed so opening click doesn't fire it)
    if (!this._pickerDismissHandler) {
      const handler = (e: MouseEvent) => {
        // Check if click is inside the popover via composedPath (works across shadow DOM)
        const path = e.composedPath();
        const popover = this.renderRoot.querySelector('.method-picker-popover');
        if (popover && path.includes(popover)) return; // click inside popover — ignore
        this._methodPickerOpen = false;
        this._pickerDismissHandler = null;
        window.removeEventListener('mousedown', handler, true);
      };
      this._pickerDismissHandler = handler;
      setTimeout(() => window.addEventListener('mousedown', handler, true), 0);
    }

    return html`
      <div
        class="method-picker-popover"
        @click=${(e: Event) => e.stopPropagation()}
        style="position: absolute; top: 100%; right: 0; z-index: 9999; min-width: 200px; max-height: 360px; overflow-y: auto; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); backdrop-filter: blur(20px); margin-top: 4px;"
      >
        <!-- Header -->
        <div style="padding: 10px 12px 8px; border-bottom: 1px solid var(--border-glass);">
          <div
            style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--t-tertiary);"
          >
            Split Pane
          </div>
        </div>

        <!-- Methods section -->
        ${availableMethods.length > 0
          ? html`
              <div style="padding: 4px 0;">
                <div
                  style="padding: 4px 12px 2px; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: var(--t-tertiary);"
                >
                  Methods
                </div>
                ${availableMethods.map(
                  (m: any) => html`
                    <div
                      @click=${() => this._addPanel('method', m)}
                      style="padding: 6px 12px 6px 16px; cursor: pointer; font-size: 12px; color: var(--t-primary); transition: background 0.15s ease; display: flex; align-items: center; gap: 6px;"
                      @mouseenter=${(e: Event) =>
                        ((e.target as HTMLElement).style.background = 'var(--bg-hover)')}
                      @mouseleave=${(e: Event) =>
                        ((e.target as HTMLElement).style.background = 'transparent')}
                    >
                      <span style="color: var(--t-tertiary); font-size: 10px;">&#9656;</span>
                      ${m.name}
                    </div>
                  `
                )}
              </div>
            `
          : html`
              <div
                style="padding: 8px 12px; font-size: 11px; color: var(--t-tertiary); font-style: italic;"
              >
                All methods already open
              </div>
            `}

        <!-- Tools section -->
        ${!hasSourcePanel
          ? html`
              <div style="border-top: 1px solid var(--border-glass); padding: 4px 0;">
                <div
                  style="padding: 4px 12px 2px; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: var(--t-tertiary);"
                >
                  Tools
                </div>
                <div
                  @click=${() => this._addPanel('source')}
                  style="padding: 6px 12px 6px 16px; cursor: pointer; font-size: 12px; color: var(--t-primary); transition: background 0.15s ease; display: flex; align-items: center; gap: 6px;"
                  @mouseenter=${(e: Event) =>
                    ((e.target as HTMLElement).style.background = 'var(--bg-hover)')}
                  @mouseleave=${(e: Event) =>
                    ((e.target as HTMLElement).style.background = 'transparent')}
                >
                  <span style="font-size: 11px; color: var(--accent-primary);">&lt;/&gt;</span>
                  Source Editor
                </div>
              </div>
            `
          : ''}
      </div>
    `;
  }

  /**
   * Check if a method will auto-invoke (without actually invoking).
   * Used to set _isExecuting early to prevent iframe from rendering before tool call starts.
   */
  private _willAutoInvoke(method: any): boolean {
    if (!method || !this._mcpReady) return false;
    // Never auto-invoke destructive methods — require explicit user action
    if (method.destructiveHint) return false;
    const shouldAutorun = method.autorun === true;
    const params = method.params || {};
    const properties = params.properties || {};
    const hasNoParams = Object.keys(properties).length === 0;
    return shouldAutorun || hasNoParams;
  }

  /**
   * Check if a method should auto-invoke and invoke it if so.
   * Auto-invokes when: method.autorun === true OR method has no parameters at all
   */
  private _maybeAutoInvoke(method: any) {
    // In result view mode, always auto-invoke (using shared params from URL if available)
    const forceInvoke = this._viewMode === 'result';
    if (!forceInvoke && !this._willAutoInvoke(method)) return;
    // Auto-invoke with shared params or empty args
    const args = this._sharedFormParams ?? {};
    void this._handleExecute(new CustomEvent('execute', { detail: { args } }));
  }

  private async _handleBackFromMethod() {
    // Check for unsaved form changes
    const form = this.shadowRoot?.querySelector('invoke-form');
    if (
      form?.isDirty &&
      !(await confirmElicit('You have unsaved changes. Discard them?', {
        confirm: 'Discard',
        destructive: true,
      }))
    ) {
      return;
    }
    // Close all split panels when navigating back
    this._closeSecondPanel();
    if (this._selectedPhoton.internal) {
      // For internal photons, go back to welcome screen
      this._selectedMethod = null;
      this._selectedPhoton = null;
      this._welcomePhase = 'welcome';
      this._view = 'list';
      this._updateRoute(true);
    } else {
      // For regular photons, go back to methods list
      this._view = 'list';
      this._selectedMethod = null;
      this._updateRoute(true);
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
    if (!this._selectedPhoton) return;

    if (this._pwaInstallPrompt) {
      // Chrome/Edge — trigger the native install prompt
      void (async () => {
        try {
          await fetch('/api/pwa/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              photon: this._selectedPhoton!.name,
              port: location.port || '4100',
            }),
            signal: AbortSignal.timeout(5000),
          });
        } catch {
          // Non-fatal — configure is best-effort
        }

        // Prevent Chrome's default behavior of closing this tab when the PWA
        // launches.  We listen for the `appinstalled` event and open the
        // standalone app URL ourselves; Chrome sees the app is already open
        // and leaves the original browser tab alone.
        const photonName = this._selectedPhoton!.name;
        const onInstalled = () => {
          window.open(`/app/${encodeURIComponent(photonName)}`, '_blank');
        };
        window.addEventListener('appinstalled', onInstalled, { once: true });

        const result = await this._pwaInstallPrompt.prompt();
        this._log('info', `PWA install prompt result: ${result?.outcome}`);
        if (result?.outcome !== 'accepted') {
          window.removeEventListener('appinstalled', onInstalled);
        }
        this._pwaInstallPrompt = null;
      })();
    } else {
      // Safari / non-Chromium — show install guidance
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isSafari || isIOS) {
        const hint = isIOS
          ? 'Tap the Share button, then "Add to Home Screen"'
          : 'Use File > Add to Dock to install this app';
        showToast(hint, 'info');
      } else {
        // Chrome/Edge without beforeinstallprompt — installability criteria not met yet
        showToast(
          'Install not ready yet — the service worker needs a moment to generate icons. Try again in a few seconds.',
          'info'
        );
      }
    }
  };

  private _handleRemove = async () => {
    this._closeSettingsMenu();
    if (this._selectedPhoton && this._mcpReady) {
      if (
        await confirmElicit(`Remove ${this._selectedPhoton.name} from this workspace?`, {
          confirm: 'Remove',
          destructive: true,
        })
      ) {
        const result = await mcpClient.removePhoton(this._selectedPhoton.name);
        if (!result.success) {
          showToast(result.error || 'Remove failed', 'error');
        }
      }
    }
  };

  private _copyConfigSnippet = async (transport: 'stdio' | 'url') => {
    if (!this._selectedPhoton) return;
    const name = this._selectedPhoton.name;
    try {
      let config: Record<string, unknown>;
      if (transport === 'url') {
        const beamUrl = `${location.protocol}//${location.host}/mcp`;
        config = { mcpServers: { [name]: { url: beamUrl } } };
      } else {
        // Fetch from backend — it detects whether `photon` is globally installed
        const res = await fetch('/api/export/mcp-config', {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const all = await res.json();
          const entry = all.mcpServers?.[name];
          if (entry) {
            config = { mcpServers: { [name]: entry } };
          } else {
            // Photon not in backend list (still loading?) — use name directly
            config = {
              mcpServers: {
                [name]: { command: 'npx', args: ['-y', '@portel/photon', 'mcp', name] },
              },
            };
          }
        } else {
          config = {
            mcpServers: { [name]: { command: 'npx', args: ['-y', '@portel/photon', 'mcp', name] } },
          };
        }
      }
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      const label = transport === 'url' ? 'HTTP config' : 'Claude Desktop config';
      showToast(`${label} copied to clipboard`, 'success');
    } catch (error) {
      console.warn('Copy MCP config failed:', error);
      showToast('Failed to copy config', 'error');
    }
  };

  private _handleUpgrade = async () => {
    if (!this._selectedPhoton) return;
    const name = this._selectedPhoton.name;
    showToast(`Upgrading ${name}...`, 'info');

    try {
      const res = await fetch('/api/marketplace/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Photon-Request': '1' },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) throw new Error('Upgrade failed');
      const result = await res.json();

      showToast(`${name} upgraded${result.version ? ` to ${result.version}` : ''}`, 'success');

      // Clear hasUpdate flag
      this._photons = this._photons.map((p) =>
        p.name === name ? { ...p, hasUpdate: false, updateVersion: undefined } : p
      );
      this._updatesAvailable = this._updatesAvailable.filter((u) => u.name !== name);
      if (this._selectedPhoton?.name === name) {
        this._selectedPhoton = {
          ...this._selectedPhoton,
          hasUpdate: false,
          updateVersion: undefined,
        };
      }
    } catch (error) {
      console.warn('Upgrade failed:', error);
      showToast(
        `Failed to upgrade ${name}. Check marketplace connectivity and try again.`,
        'error'
      );
    }
  };

  @state() private _showForkDialog = false;
  @state() private _forkPhotonName = '';
  @state() private _forkOriginRepo = '';
  @state() private _forkRequireNewName = false;
  @state() private _forkSuggestedName = '';
  @state() private _forkTargets: Array<{ name: string; repo: string; sourceType: string }> = [];

  private _handleFork = async () => {
    if (!this._selectedPhoton) return;
    this._forkPhotonName = this._selectedPhoton.qualifiedName || this._selectedPhoton.name;
    this._forkOriginRepo = this._selectedPhoton.installSource?.marketplace || '';
    this._forkRequireNewName = !this._selectedPhoton.installSource;
    this._forkSuggestedName = `${this._selectedPhoton.shortName || this._selectedPhoton.name}-copy`;
    await this._openForkDialog();
  };

  private async _openForkDialog() {
    try {
      const res = await fetch('/api/marketplace/fork-targets', {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        this._forkTargets = data.targets || [];
      }
    } catch {
      this._forkTargets = [];
    }
    this._showForkDialog = true;
  }

  private _handleForkConfirm = async (e: CustomEvent) => {
    const { target, newName } = e.detail;
    const name = this._forkPhotonName;
    if (!name) return;

    this._showForkDialog = false;
    showToast(`Forking ${name}...`, 'info');

    try {
      const res = await fetch('/api/marketplace/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Photon-Request': '1' },
        body: JSON.stringify({ name, target, newName }),
        signal: AbortSignal.timeout(30000),
      });

      const result = await res.json();
      if (result.success) {
        showToast(result.message, 'success');
        // Clear install source and update flag
        this._photons = this._photons.map((p) =>
          p.name === name ? { ...p, installSource: undefined, hasUpdate: false } : p
        );
        if (this._selectedPhoton?.name === name) {
          this._selectedPhoton = {
            ...this._selectedPhoton,
            installSource: undefined,
            hasUpdate: false,
          };
        }
      } else {
        showToast(result.message || 'Fork failed', 'error', 5000);
      }
    } catch {
      showToast('Fork failed', 'error', 5000);
    }
  };

  private _handleForkFromMarketplace = async (e: CustomEvent) => {
    const { name } = e.detail;
    this._forkPhotonName = name;
    this._forkOriginRepo = '';
    this._forkRequireNewName = false;
    this._forkSuggestedName = `${name}-copy`;
    await this._openForkDialog();
  };

  private _handleContribute = async () => {
    if (!this._selectedPhoton) return;
    const name = this._selectedPhoton.name;

    showToast(`Contributing ${name} upstream...`, 'info');

    try {
      const res = await fetch('/api/marketplace/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Photon-Request': '1' },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(60000),
      });

      const result = await res.json();
      if (result.success) {
        if (result.prUrl) {
          showToast(`PR created: ${result.prUrl}`, 'success', 8000);
        } else {
          showToast(result.message, 'info');
        }
      } else {
        // Graceful fallback — suggest CLI if gh is unavailable
        if (result.message?.includes('GitHub CLI')) {
          showToast(`Run in terminal: photon contribute ${name}`, 'info', 8000);
        } else {
          showToast(result.message || 'Contribute failed', 'error', 5000);
        }
      }
    } catch {
      showToast('Contribute failed', 'error', 5000);
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
              envVar: prop['x-env-var'] || key,
              type: prop.type || 'string',
              isOptional: !photonSchema.required?.includes(key),
              hasDefault: prop.default !== undefined,
              defaultValue: prop.default,
            })
          ),
        };
      }
    }

    this._view = 'config';
    this._updateRoute();
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
      void this._invokeMakerMethod('rename', { name: newName });
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
            this._mainTab = 'source';
            this._view = 'source';
          } else {
            showToast('No source code returned', 'error');
          }
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to load source', 'error');
      }
    }
  };

  /** Navigate to inline source view (Phase 2) */
  private _handleViewSourceInline = async () => {
    if (this._view === 'source' || this._view === 'studio') {
      return; // Already showing source/studio
    }
    const isEditable = this._selectedPhoton?.editable && !this._selectedPhoton?.isExternalMCP;
    this._mainTab = 'source';

    if (isEditable) {
      // Editable photons get the full studio editor
      this._view = 'studio';
    } else {
      // Protected photons get read-only source view
      await this._handleViewSource();
      if (this._sourceData) {
        this._view = 'source';
      }
    }
  };

  /** Open settings for the current photon (Phase 3) */
  private _handleOpenSettings = () => {
    if (!this._selectedPhoton) return;
    const settingsMethod = this._selectedPhoton.methods?.find((m: any) => m.name === 'settings');
    if (settingsMethod) {
      this._selectedMethod = settingsMethod;
      this._view = 'form';
      this._maybeAutoInvoke(settingsMethod);
    }
  };

  /** Handle instance panel CRUD actions (Phase 1) */
  private _handleInstanceAction = async (detail: any) => {
    if (!this._selectedPhoton) return;
    const photonName = this._selectedPhoton.name;
    const { action } = detail;

    switch (action) {
      case 'switch': {
        const selected = detail.instance as string;

        // Auto mode: follow the most recently active instance
        if (selected === '__auto__') {
          this._instanceSelectorMode = 'auto';
          await this._fetchInstances(photonName);
          const target = this._autoInstance || 'default';
          if (target !== this._currentInstance) {
            try {
              await mcpClient.callTool(`${photonName}/_use`, { name: target });
              this._setCurrentInstance(photonName, target);
              if (this._selectedMethod) {
                void this._handleExecute(new CustomEvent('execute', { detail: { args: {} } }));
              }
            } catch {
              showToast('Failed to switch to auto instance', 'error');
            }
          }
          showToast('Auto mode: following most recently active instance', 'info');
          break;
        }

        this._instanceSelectorMode = 'manual';
        const target = selected;
        if (target === this._currentInstance) return;
        try {
          await mcpClient.callTool(`${photonName}/_use`, { name: target });
          this._setCurrentInstance(photonName, target);
          showToast(`Switched to: ${target === 'default' ? '(default)' : target}`, 'success');
          // Re-invoke current method to refresh data
          if (this._selectedMethod) {
            void this._handleExecute(new CustomEvent('execute', { detail: { args: {} } }));
          }
        } catch {
          showToast('Failed to switch instance', 'error');
        }
        break;
      }
      case 'create': {
        const name = detail.instance;
        try {
          await mcpClient.callTool(`${photonName}/_use`, { name });
          this._setCurrentInstance(photonName, name);
          await this._fetchInstances(photonName);
          showToast(`Created instance: ${name}`, 'success');
        } catch {
          showToast('Failed to create instance', 'error');
        }
        break;
      }
      case 'clone': {
        const newName = detail.cloneName;
        if (!newName) return;
        try {
          const res = await fetch(
            `/api/instances/${encodeURIComponent(photonName)}/${encodeURIComponent(detail.instance)}/clone`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newName }),
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            }
          );
          if (res.ok) {
            await this._fetchInstances(photonName);
            showToast(`Cloned as: ${newName}`, 'success');
          } else {
            const err = await res.json();
            showToast(err.error || 'Clone failed', 'error');
          }
        } catch {
          showToast('Failed to clone instance', 'error');
        }
        break;
      }
      case 'rename': {
        const newName = detail.newName;
        if (!newName) return;
        try {
          const res = await fetch(
            `/api/instances/${encodeURIComponent(photonName)}/${encodeURIComponent(detail.instance)}/rename`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newName }),
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            }
          );
          if (res.ok) {
            // Switch to the renamed instance
            await mcpClient.callTool(`${photonName}/_use`, { name: newName });
            this._setCurrentInstance(photonName, newName);
            await this._fetchInstances(photonName);
            showToast(`Renamed to: ${newName}`, 'success');
          } else {
            const err = await res.json();
            showToast(err.error || 'Rename failed', 'error');
          }
        } catch {
          showToast('Failed to rename instance', 'error');
        }
        break;
      }
      case 'delete': {
        const instanceToDelete = detail.instance;
        if (instanceToDelete === 'default') {
          showToast('Cannot delete default instance', 'error');
          return;
        }
        try {
          const res = await fetch(
            `/api/instances/${encodeURIComponent(photonName)}/${encodeURIComponent(instanceToDelete)}`,
            {
              method: 'DELETE',
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            }
          );
          if (res.ok) {
            // Switch to default
            await mcpClient.callTool(`${photonName}/_use`, { name: 'default' });
            this._setCurrentInstance(photonName, 'default');
            await this._fetchInstances(photonName);
            showToast(`Deleted: ${instanceToDelete}`, 'success');
          } else {
            const err = await res.json();
            showToast(err.error || 'Delete failed', 'error');
          }
        } catch {
          showToast('Failed to delete instance', 'error');
        }
        break;
      }
    }
  };

  private _handleDeletePhoton = async () => {
    this._closeSettingsMenu();
    if (
      await confirmElicit(`Remove "${this._selectedPhoton?.name}"? It will be moved to trash.`, {
        confirm: 'Remove',
        destructive: true,
      })
    ) {
      const deletedName = this._selectedPhoton?.name;
      await this._invokeMakerMethod('delete');
      // Navigate away from deleted photon and refresh sidebar
      if (deletedName) {
        this._photons = this._photons.filter((p) => p.name !== deletedName);
        this._selectedPhoton = this._photons[0] || null;
        this._selectedMethod = null;
        this._lastResult = null;
        this.requestUpdate();
      }
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
            // Source data handled by caller
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
    this._sidebar?.trackRecentPhoton(this._selectedPhoton.name);
    this._log('info', `Invoking ${this._selectedMethod.name}...`, true);
    this._lastResult = null;
    this._customFormatUri = null;
    this._isExecuting = true;
    this._progress = null;

    // Clean up previous collection subscriptions
    this._cleanupCollectionSubscriptions();

    // Use MCP for all tool invocations
    if (this._mcpReady) {
      try {
        const toolName = `${this._selectedPhoton.name}/${this._selectedMethod.name}`;
        const execStart = Date.now();
        const result = await mcpClient.callTool(toolName, args);
        const execDuration = Date.now() - execStart;

        if (result.isError) {
          const errorText = result.content.find((c) => c.type === 'text')?.text || 'Unknown error';
          // Elicitation cancellation is already handled by the cancel event handler
          if (errorText !== 'Elicitation cancelled by user') {
            this._log('error', errorText);
            showToast(errorText, 'error', 5000);
            // Show error in result panel (persists, not just a toast)
            this._lastResult = { _error: true, message: errorText };
          }
        } else {
          this._lastResult = mcpClient.parseToolResult(result);

          // Auto-wrap array results with pagination metadata if needed
          if (
            this._selectedPhoton?.stateful &&
            Array.isArray(this._lastResult) &&
            this._selectedMethod
          ) {
            this._lastResult = this._autoWrapPaginationIfNeeded(
              this._lastResult,
              this._selectedPhoton.name,
              this._selectedMethod
            );
          }

          this._log('success', 'Execution completed', false, execDuration);

          // Initialize global photon instance for @stateful photons
          if (
            this._selectedPhoton?.stateful &&
            this._lastResult != null &&
            typeof this._lastResult === 'object'
          ) {
            this._initializeGlobalInstance(this._selectedPhoton.name, this._lastResult);
          }

          // Scroll result into view on mobile
          void this.updateComplete.then(() => {
            const rv = this.shadowRoot?.querySelector('result-viewer');
            if (rv && window.innerWidth <= 768) {
              rv.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          });

          // Auto-subscribe to collection events for live updates
          // Convention: method name is the collection name (e.g., tasks() -> tasks:added)
          // Works for arrays (added/removed/updated) AND objects (changed) like gauges/metrics
          if (this._lastResult != null) {
            this._setupCollectionSubscriptions(this._selectedMethod.name);
          }
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

  /**
   * Silently re-execute the current method to refresh results (no spinner, no clearing)
   * Used when external state changes are detected (e.g., CLI mutated stateful photon)
   */
  private _isSilentRefreshing = false;

  private async _silentRefresh(): Promise<void> {
    if (!this._mcpReady || !this._selectedPhoton || !this._selectedMethod) return;
    if (this._isSilentRefreshing) return; // Prevent feedback loop

    this._isSilentRefreshing = true;
    try {
      const toolName = `${this._selectedPhoton.name}/${this._selectedMethod.name}`;
      const result = await mcpClient.callTool(toolName, this._lastFormParams || {});

      if (!result.isError) {
        this._lastResult = mcpClient.parseToolResult(result);

        // Auto-wrap array results with pagination metadata if needed
        if (
          this._selectedPhoton.stateful &&
          Array.isArray(this._lastResult) &&
          this._selectedMethod
        ) {
          this._lastResult = this._autoWrapPaginationIfNeeded(
            this._lastResult,
            this._selectedPhoton.name,
            this._selectedMethod
          );
        }

        // Reinitialize global instance on silent refresh
        if (
          this._selectedPhoton.stateful &&
          this._lastResult != null &&
          typeof this._lastResult === 'object'
        ) {
          this._initializeGlobalInstance(this._selectedPhoton.name, this._lastResult);
        }
      }
    } catch {
      // Silent refresh failure is not critical - user can manually re-execute
    } finally {
      this._isSilentRefreshing = false;
    }
  }

  /**
   * Set up automatic subscriptions for collection events (ReactiveArray/Map/Set)
   * When a method returns an array, we subscribe to {methodName}:added, :removed, :updated, :changed
   * and forward those events to result-viewer for incremental updates with animations.
   */
  private _setupCollectionSubscriptions(collectionName: string): void {
    this._currentCollectionName = collectionName;

    // Handler for channel-event that filters by collection name
    const handler = (eventData: unknown) => {
      const data = eventData as { event?: string; data?: unknown };
      if (!data?.event) return;

      // Check if this event matches our collection pattern
      // Event format: "{collectionName}:{eventType}" (e.g., "tasks:added")
      const pattern = `${collectionName}:`;
      if (!data.event.startsWith(pattern)) return;

      const eventType = data.event.slice(pattern.length);
      if (['added', 'removed', 'updated', 'changed'].includes(eventType)) {
        this._handleCollectionEvent(
          eventType as 'added' | 'removed' | 'updated' | 'changed',
          data.data
        );
      }
    };

    // Subscribe to channel-event and store the handler for cleanup
    mcpClient.on('channel-event', handler);
    this._collectionUnsubscribes.push(() => mcpClient.off('channel-event', handler));

    if (this._verboseLogging) {
      this._log('info', `Auto-subscribed to ${collectionName}:* collection events`);
    }
  }

  /**
   * Handle a collection event and forward to result-viewer
   */
  private _handleCollectionEvent(
    type: 'added' | 'removed' | 'updated' | 'changed',
    data: unknown
  ): void {
    // Get the result-viewer component and forward the event
    if (this._resultViewer) {
      this._resultViewer.handleCollectionEvent(type, data);
    }
  }

  /**
   * Clean up collection event subscriptions
   */
  private _cleanupCollectionSubscriptions(): void {
    for (const unsubscribe of this._collectionUnsubscribes) {
      unsubscribe();
    }
    this._collectionUnsubscribes = [];
    this._currentCollectionName = null;
  }

  /**
   * Initialize global photon instance for @stateful photons
   * Makes the photon instance available as window.{photonName}
   * and keeps it in sync with server state via state-changed patches
   * Wraps paginated array properties with ViewportAwareProxy for smart fetching
   */
  /**
   * Auto-wrap array results with pagination metadata for @stateful photons
   * If method has (start, limit) parameters, detect them and use global instance
   * to calculate pagination metadata from the full array
   */
  private _autoWrapPaginationIfNeeded(items: unknown[], photonName: string, method: any): unknown {
    // Check if method signature includes start/limit parameters
    const hasStartLimitParams = method.parameters?.some(
      (p: any) => (p.name === 'start' || p.name === 'limit') && p.required !== true
    );

    if (!hasStartLimitParams || items.length === 0) {
      return items; // No pagination, return array as-is
    }

    // Try to get the full array from global instance
    try {
      const manager = getGlobalInstanceManager();
      const instance = manager.getInstance(photonName);

      if (!instance) {
        return items; // Instance not found, return array as-is
      }

      // Look for array property (likely "items")
      const arrayProp = Object.keys(instance).find((key) => {
        const value = instance[key];
        return Array.isArray(value) && value.length > 0;
      });

      if (!arrayProp) {
        return items; // No array property found, return array as-is
      }

      const fullArray = instance[arrayProp] as unknown[];

      // Calculate pagination metadata based on position of returned items in full array
      // The returned items are a subset, so find their position
      const totalCount = fullArray.length;
      const start = 0; // Default assumption - returned from beginning
      const end = items.length;

      // Return wrapped response with pagination metadata
      return {
        items,
        _pagination: {
          totalCount,
          start,
          end,
          hasMore: end < totalCount,
        },
      };
    } catch (error) {
      // If anything goes wrong, just return the array as-is
      if (this._verboseLogging) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this._log('warn', `Could not auto-wrap pagination: ${msg}`);
      }
      return items;
    }
  }

  private _initializeGlobalInstance(photonName: string, initialState: Record<string, any>): void {
    try {
      // Detect paginated properties (those with _pagination metadata)
      const paginatedProps = this._detectPaginatedProperties(initialState);

      // Initialize global session
      const instance = initializeGlobalPhotonSession(photonName, initialState);

      // Wrap paginated arrays with ViewportAwareProxy
      for (const [propName, paginationMeta] of Object.entries(paginatedProps)) {
        this._wrapWithViewportProxy(instance, propName, paginationMeta);
      }

      if (this._verboseLogging) {
        const message =
          paginatedProps.size > 0
            ? `📡 Global instance initialized with ${paginatedProps.size} paginated array(s): window.${photonName.toLowerCase()}`
            : `📡 Global instance initialized: window.${photonName.toLowerCase()}`;
        this._log('info', message);
      }
    } catch (error) {
      console.error('Failed to initialize global photon instance', error);
    }
  }

  /**
   * Detect which properties have pagination metadata
   */
  private _detectPaginatedProperties(initialState: Record<string, any>): Map<string, any> {
    const paginated = new Map<string, any>();

    if (!initialState || typeof initialState !== 'object') {
      return paginated;
    }

    for (const [key, value] of Object.entries(initialState)) {
      // Check if this property has pagination metadata
      if (value && typeof value === 'object' && value._pagination) {
        paginated.set(key, value._pagination);
      }
    }

    return paginated;
  }

  /**
   * Wrap a property with ViewportAwareProxy for smart pagination
   */
  private _wrapWithViewportProxy(instance: any, propertyName: string, paginationMeta: any): void {
    try {
      // Determine page size based on device type
      const pageSize = getPageSizeForClient();

      // Create viewport-aware proxy
      const proxy = new ViewportAwareProxy(
        this._selectedPhoton?.name || 'unknown',
        this._selectedMethod?.name || propertyName,
        mcpClient,
        {
          pageSize,
          bufferSize: 5, // Items to buffer above/below viewport
          maxCacheSize: 500, // Max items to keep in cache
        }
      );

      // Initialize with current data
      proxy.initializeWithResponse({
        items: instance[propertyName] || [],
        _pagination: paginationMeta,
      });

      // Replace the array property with the proxy
      instance.makeProperty(propertyName);
      Object.defineProperty(instance, propertyName, {
        configurable: true,
        enumerable: true,
        get: () => proxy.items,
        set: (value: any) => {
          // Reset proxy with new data
          proxy.clearCache();
          proxy.initializeWithResponse({
            items: value || [],
            _pagination: paginationMeta,
          });
        },
      });

      // Listen for patches and apply to proxy
      const patchHandler = (data: any) => {
        if (data?.patches) {
          proxy.applyPatches(data.patches);
        }
      };

      instance.on('state-changed', patchHandler);

      // Set up automatic viewport tracking
      // Use microtask to ensure DOM is ready
      queueMicrotask(() => {
        try {
          // Find the result viewer container that will host the paginated list
          const resultViewer = this._resultViewer;
          if (resultViewer?.shadowRoot) {
            // Look for a scrollable container within result viewer
            const scrollContainer = resultViewer.shadowRoot.querySelector(
              '.result-content'
            ) as HTMLElement;
            if (scrollContainer) {
              const manager = new ViewportManager(proxy, {
                container: scrollContainer,
                itemSelector: '[data-index]',
                pageSize,
                bufferSize: 5,
              });
              manager.start();
            }
          }
        } catch (error) {
          // Fallback: just use the proxy without automatic viewport tracking
          if (this._verboseLogging) {
            this._log('warn', `Could not set up automatic viewport tracking for ${propertyName}`);
          }
        }
      });

      if (this._verboseLogging) {
        this._log(
          'info',
          `✨ Paginated proxy enabled for ${propertyName} (page size: ${pageSize})`
        );
      }
    } catch (error) {
      console.error(`Failed to wrap ${propertyName} with ViewportAwareProxy`, error);
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
   * Forward render events to bridge iframes inside result-viewer (slide embeds).
   * The bridge inside the iframe receives these as host-context notifications
   * and its onResult listeners update live data-method elements.
   */
  private _forwardRenderToSlideIframes(data: any): void {
    // Find bridge iframes inside result-viewer's shadow DOM
    const rv = this.shadowRoot?.querySelector('result-viewer');
    const slideIframe = rv?.shadowRoot?.querySelector('.slide-bridge-frame') as HTMLIFrameElement;
    if (slideIframe?.contentWindow && data?.method && data?.value !== undefined) {
      // Forward as photon:result (legacy format) — the bridge's onResult listeners
      // in _bindElements match by data.method and call renderResult(data.result)
      slideIframe.contentWindow.postMessage(
        {
          type: 'photon:result',
          data: {
            method: data.method,
            result: data.value,
            format: data.format,
          },
        },
        '*'
      );
    }
  }

  /**
   * Forward a message to all custom-ui-renderer iframes
   */
  private _forwardToIframes(message: any): void {
    const iframes: HTMLIFrameElement[] = [];
    this.shadowRoot?.querySelectorAll('custom-ui-renderer, canvas-renderer').forEach((renderer) => {
      const iframe = renderer.shadowRoot?.querySelector('iframe');
      if (iframe) iframes.push(iframe);
    });
    this.shadowRoot?.querySelectorAll('iframe').forEach((iframe) => iframes.push(iframe));
    iframes.forEach((iframe) => {
      iframe.contentWindow?.postMessage(message, '*');
    });
  }

  private _handleBridgeMessage = (event: MessageEvent) => {
    void (async () => {
      // Only accept messages from same origin (srcdoc iframes) or null (about:srcdoc)
      if (event.origin !== window.location.origin && event.origin !== 'null') return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      // Skip JSON-RPC messages for external MCPs — handled by AppBridge in mcp-app-renderer
      if (msg?.jsonrpc === '2.0' && this._selectedPhoton?.isExternalMCP) return;

      // MCP Apps standard: JSON-RPC tools/call from iframes
      if (msg.jsonrpc === '2.0' && msg.method === 'tools/call' && msg.id != null) {
        if (this._selectedPhoton && this._mcpReady) {
          // Pass args through as-is — _targetInstance is extracted by the transport layer
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
              const isExternalMCP = this._selectedPhoton.isExternalMCP;
              const result = isExternalMCP
                ? {
                    content: mcpResult.content || [],
                    structuredContent: mcpResult.structuredContent,
                    isError: mcpResult.isError ?? false,
                  }
                : mcpClient.parseToolResult(mcpResult);

              if (event.source) {
                (event.source as Window).postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
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

      // Handle toast notifications from @ui template iframes
      if (msg.type === 'photon:toast') {
        const validTypes = ['success', 'error', 'info', 'warning'] as const;
        const toastType = validTypes.includes(msg.toastType) ? msg.toastType : 'info';
        showToast(msg.message || 'Notification', toastType, msg.duration || 3000);
      }

      // Handle custom UI notifying what resource it's viewing
      // This enables on-demand channel subscriptions
      // photonId: hash of photon path (from selected photon)
      // itemId: whatever the photon uses to identify the item (e.g., board name)
      if (msg.type === 'photon:viewing') {
        const photonId = this._selectedPhoton?.id;
        const itemId = msg.itemId || msg.board; // Support both new and legacy field names
        if (photonId && itemId) {
          void mcpClient.notifyViewing(photonId, itemId);
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
    })();
  };

  // ===== Checklist Interactive Actions =====
  private async _handleChecklistAction(e: CustomEvent) {
    const { action, args } = e.detail;
    if (!this._selectedPhoton) return;
    const toolName = `${this._selectedPhoton.name}/${action}`;
    try {
      await mcpClient.callTool(toolName, args);
    } catch {
      // Silent — optimistic UI already updated
    }
  }

  // ===== Share Result Link =====
  private _handleShareResult() {
    if (!this._selectedPhoton || !this._selectedMethod) {
      showToast('No method selected to share', 'error');
      return;
    }

    // Build shareable URL with path and query params
    const pathSegment = `${this._selectedPhoton.name}/${this._selectedMethod.name}`;

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

    let shareUrl = `${window.location.origin}/${pathSegment}`;
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
    // Re-apply OKLCH if enabled
    if (this._oklchEnabled) {
      const saved = loadSavedThemeConfig();
      if (saved) {
        this._applyOklchTheme({
          hue: saved.hue,
          chroma: saved.chroma,
          lightness: saved.lightness,
          theme: newTheme,
        });
      }
    }
    this._broadcastThemeToIframes();
  };

  private _handleOklchThemeChange = (e: CustomEvent) => {
    const { cssVars } = e.detail as { config: ThemeConfig; cssVars: Record<string, string> };
    this._oklchEnabled = true;
    for (const [prop, value] of Object.entries(cssVars)) {
      this.style.setProperty(prop, value);
    }
    this._broadcastThemeToIframes();
  };

  private _handleOklchThemeReset = () => {
    // Clear any existing OKLCH overrides first
    const oldVars = beamThemeToCSS(
      generateBeamThemeColors({ hue: 0, chroma: 0, lightness: 0.5, theme: 'dark' })
    );
    for (const prop of Object.keys(oldVars)) {
      this.style.removeProperty(prop);
    }
    // Re-apply Amber preset as the baseline
    const theme = (this._theme || 'dark') as 'light' | 'dark';
    const defaultAmber = { hue: 75, chroma: 0.14, lightness: 0.7, theme };
    this._oklchEnabled = true;
    this._applyOklchTheme(defaultAmber);
    this._broadcastThemeToIframes();
    showToast('Theme reset to default', 'info');
  };

  private _applyOklchTheme(config: ThemeConfig) {
    const beamColors = generateBeamThemeColors(config);
    const cssVars = beamThemeToCSS(beamColors);
    for (const [prop, value] of Object.entries(cssVars)) {
      this.style.setProperty(prop, value);
    }
  }

  // ── Local elicitation (non-MCP, from confirmElicit/promptElicit/elicit) ──

  private _localElicitResolve?: (result: { action: 'accept' | 'cancel'; value?: any }) => void;

  private _handleLocalElicit = (e: CustomEvent) => {
    const { data, resolve } = e.detail;
    this._localElicitResolve = resolve;
    this._elicitationData = { ...data };
    this._showElicitation = true;
  };

  private _handleElicitationSubmit = async (e: CustomEvent) => {
    const { value } = e.detail;
    const elicitationId = (this._elicitationData as any)?.elicitationId;

    this._showElicitation = false;
    this._elicitationData = null;

    // Local elicitation (from confirmElicit/promptElicit)
    if (this._localElicitResolve) {
      this._localElicitResolve({ action: 'accept', value });
      this._localElicitResolve = undefined;
      return;
    }

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

    // Local elicitation (from confirmElicit/promptElicit)
    if (this._localElicitResolve) {
      this._localElicitResolve({ action: 'cancel' });
      this._localElicitResolve = undefined;
      return;
    }

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

  // ── Pending Approvals ──

  private _approvalsRefreshInterval?: ReturnType<typeof setInterval>;

  private async _fetchPendingApprovals(): Promise<void> {
    if (!this._mcpReady) return;
    this._pendingApprovalsList = await mcpClient.fetchPendingApprovals();
  }

  private _startApprovalsPolling(): void {
    this._stopApprovalsPolling();
    void this._fetchPendingApprovals();
    this._approvalsRefreshInterval = setInterval(() => void this._fetchPendingApprovals(), 60_000);
  }

  private _stopApprovalsPolling(): void {
    if (this._approvalsRefreshInterval) {
      clearInterval(this._approvalsRefreshInterval);
      this._approvalsRefreshInterval = undefined;
    }
  }

  private _handleApprovalResponse = async (e: CustomEvent) => {
    const { approvalId, photon, approved } = e.detail;
    // Optimistically remove from list
    this._pendingApprovalsList = this._pendingApprovalsList.filter((a) => a.id !== approvalId);
    if (this._pendingApprovalsList.length === 0) {
      this._showApprovals = false;
    }
    const result = await mcpClient.sendApprovalResponse(approvalId, photon, approved);
    if (!result.success) {
      showToast('Failed to send approval response', 'error');
      void this._fetchPendingApprovals(); // Re-fetch to restore accurate state
    }
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

    // When OKLCH theme is active, map Beam-internal vars to common aliases
    // so custom UIs using --bg, --card, --accent, --border see the OKLCH colors
    if (this._oklchEnabled) {
      const style = this.style;
      const get = (prop: string) => style.getPropertyValue(prop).trim();
      // Map Beam vars → common aliases that custom UIs use
      if (get('--bg-app')) {
        themeTokens['--bg'] = get('--bg-app');
        themeTokens['--background'] = get('--bg-app');
      }
      if (get('--bg-panel')) {
        themeTokens['--card'] = get('--bg-panel');
        themeTokens['--bg-secondary'] = get('--bg-panel');
        themeTokens['--bg-card'] = get('--bg-panel');
      }
      if (get('--bg-glass-strong')) {
        themeTokens['--bg-tertiary'] = get('--bg-glass-strong');
      }
      if (get('--t-primary')) {
        themeTokens['--text'] = get('--t-primary');
        themeTokens['--foreground'] = get('--t-primary');
      }
      if (get('--t-muted')) {
        themeTokens['--muted'] = get('--t-muted');
        themeTokens['--text-muted'] = get('--t-muted');
      }
      if (get('--border-glass')) {
        themeTokens['--border'] = get('--border-glass');
        themeTokens['--border-color'] = get('--border-glass');
      }
      if (get('--accent-primary')) {
        themeTokens['--accent'] = get('--accent-primary');
        themeTokens['--primary'] = get('--accent-primary');
      }
    }

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
        // Also send standard MCP host-context notification
        iframe.contentWindow.postMessage(
          {
            jsonrpc: '2.0',
            method: 'ui/notifications/host-context-changed',
            params: { theme: this._theme, styles: { variables: themeTokens } },
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
      // Also send standard MCP host-context notification
      iframe.contentWindow?.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/host-context-changed',
          params: { theme: this._theme, styles: { variables: themeTokens } },
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

    // Cmd/Ctrl+Shift+Enter to re-execute last method with last args
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      if (this._selectedMethod && this._lastFormParams && !this._isExecuting) {
        void this._handleExecute(
          new CustomEvent('execute', { detail: { args: this._lastFormParams } })
        );
        showToast('Re-executing with last parameters', 'info');
      }
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
      if (this._mainTab === 'help' || this._mainTab === 'source') {
        this._mainTab = 'methods';
        if (this._view === 'source') this._view = 'list';
        return;
      }
      if (this._view === 'form' && this._selectedMethod) {
        void this._handleBackFromMethod();
        return;
      }
      if (this._view === 'marketplace') {
        this._view = 'list';
        this._updateRoute();
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

    // t to open theme settings panel
    if (e.key === 't') {
      this._showThemeSettings = !this._showThemeSettings;
      return;
    }

    // p to show marketplace
    if (e.key === 'p') {
      this._view = 'marketplace';
      this._updateRoute();
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
        void this._handleBackFromMethod();
      } else if (this._view === 'marketplace') {
        this._view = 'list';
        this._updateRoute();
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
        void this._handlePhotonSelect(new CustomEvent('select', { detail: { photon: newPhoton } }));
        // Scroll sidebar item into view and flash highlight
        this._sidebar?.scrollPhotonIntoView(newPhoton.name);
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
      // Scroll method card into view and flash highlight
      void this.updateComplete.then(() => {
        const cards = this.shadowRoot?.querySelectorAll('method-card');
        const card = cards?.[newIndex] as HTMLElement | undefined;
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          card.classList.add('flash-highlight');
          setTimeout(() => card.classList.remove('flash-highlight'), 600);
        }
      });
      return;
    }

    // Enter to select highlighted method
    if (e.key === 'Enter' && this._selectedMethod && this._view === 'list') {
      this._view = 'form';
      this._updateRoute();
      return;
    }

    // r to re-execute last method
    if (e.key === 'r') {
      if (
        this._view === 'form' &&
        this._selectedMethod &&
        this._lastFormParams &&
        !this._isExecuting
      ) {
        void this._handleExecute(
          new CustomEvent('execute', { detail: { args: this._lastFormParams } })
        );
        showToast('Re-executing with last parameters', 'info');
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

  /** Load help content for inline help tab view */
  private _loadPhotonHelp = async () => {
    if (!this._selectedPhoton) return;
    this._photonHelpMarkdown = '';
    this._photonHelpLoading = true;

    const markdown = await mcpClient.getPhotonHelp(this._selectedPhoton.name);
    if (markdown) {
      this._photonHelpMarkdown = markdown;
    } else {
      this._photonHelpMarkdown = this._generatePhotonHelpMarkdown();
    }
    this._photonHelpLoading = false;

    // Exit source/studio view
    if (this._view === 'source' || this._view === 'studio') {
      if (this._selectedMethod) {
        this._view = 'form';
      } else {
        this._view = 'list';
      }
    }
  };

  /** Render the inline help view (used as a tab, not a modal) */
  private _renderPhotonHelpView() {
    const markdown = this._photonHelpLoading
      ? this._generatePhotonHelpMarkdown()
      : this._photonHelpMarkdown || this._generatePhotonHelpMarkdown();
    let htmlContent = markdown;

    if ((window as any).marked) {
      const mermaidBlocks: { id: string; code: string }[] = [];
      let processed = markdown.replace(
        /```mermaid\s*\n([\s\S]*?)```/g,
        (_match: string, code: string) => {
          const id = `help-mermaid-${Math.random().toString(36).substr(2, 9)}`;
          mermaidBlocks.push({ id, code: code.trim() });
          return `<div data-mermaid-id="${id}" style="min-height: 80px; display: flex; align-items: center; justify-content: center; color: var(--t-muted);">Loading diagram...</div>`;
        }
      );
      htmlContent = (window as any).marked.parse(processed);

      if (mermaidBlocks.length > 0 && (window as any).mermaid) {
        const mermaid = (window as any).mermaid;
        const isDark = this.getAttribute('data-theme') !== 'light';
        mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
        requestAnimationFrame(() => {
          for (const { id, code } of mermaidBlocks) {
            const el = this.shadowRoot?.querySelector(`[data-mermaid-id="${id}"]`);
            if (el) {
              mermaid
                .render(id + '-svg', code)
                .then(({ svg }: { svg: string }) => {
                  el.innerHTML = svg;
                  (el as HTMLElement).style.minHeight = '';
                  (el as HTMLElement).style.background = isDark
                    ? 'hsla(220, 15%, 18%, 0.8)'
                    : 'hsla(0, 0%, 97%, 0.8)';
                  (el as HTMLElement).style.borderRadius = '8px';
                  (el as HTMLElement).style.padding = '12px';
                })
                .catch(() => {
                  el.textContent = 'Diagram rendering failed';
                });
            }
          }
        });
      }
    }

    return html`
      <div
        style="display: flex; flex-direction: column; height: 100%; overflow: auto; padding: var(--space-lg);"
      >
        <div style="max-width: 700px; width: 100%;">
          <h2 class="text-gradient" style="margin: 0 0 var(--space-md) 0;">
            Help
            ${this._photonHelpLoading
              ? html`<span style="font-size: 0.7em; opacity: 0.6; margin-left: 8px;"
                  >Loading...</span
                >`
              : ''}
          </h2>
          <div class="markdown-body" style="color: var(--t-default);">
            ${(window as any).marked
              ? html`${unsafeHTML(htmlContent)}`
              : html`<pre style="white-space: pre-wrap;">${markdown}</pre>`}
          </div>
        </div>
      </div>
    `;
  }

  private _generatePhotonHelpMarkdown(): string {
    if (!this._selectedPhoton) return '';

    const photon = this._selectedPhoton;
    const name = photon.name;
    const displayName =
      photon.label ||
      name
        .split('-')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
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
      lines.push(
        "That's it — no prior setup needed. Photon auto-installs from the marketplace and prompts for any missing configuration."
      );
      lines.push('');
      if (photon.installSource?.marketplace) {
        lines.push(
          `From a custom marketplace: \`npx @portel/photon mcp ${photon.installSource.marketplace}:${name}\``
        );
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
          const cliPfx = (window as any).__PHOTON_SHELL_INIT ? name : `photon cli ${name}`;
          lines.push(`CLI: \`${cliPfx} ${method.name}${paramHints ? ' ' + paramHints : ''}\``);
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

  private _shouldShowFullscreen(): boolean {
    if (!this._selectedPhoton) return false;
    // MCP app view (always has content)
    if (
      this._view === 'mcp-app' &&
      this._selectedPhoton.isExternalMCP &&
      this._selectedPhoton.hasMcpApp
    )
      return true;
    // Native photon app view (always has content)
    if (this._selectedPhoton.isApp && this._selectedMethod?.name === 'main') return true;
    // Regular photon: only when a result is displayed
    if (this._view === 'form' && this._selectedMethod && this._lastResult !== null) return true;
    return false;
  }

  private _toggleFocusMode = () => {
    this._focusMode = !this._focusMode;
    if (this._focusMode) {
      this.classList.add('focus-mode');
      // Add ?focus=1 to the current path without triggering navigation
      const path = window.location.pathname;
      history.replaceState(null, '', path + '?focus=1');
    } else {
      this.classList.remove('focus-mode');
      // Remove query string, keep path only
      const path = window.location.pathname;
      history.replaceState(null, '', path);
    }
  };

  private _handleFullscreen = () => {
    this._toggleFocusMode();
  };

  private _scrollToSection(id: string) {
    this.shadowRoot?.getElementById(`photon-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  }

  private _renderAnchorNav() {
    return html`
      <div class="anchor-nav">
        <span class="anchor-link" @click=${() => this._scrollToSection('methods')}>Methods</span>
        <span class="anchor-link" @click=${() => this._scrollToSection('prompts')}>Prompts</span>
        <span class="anchor-link" @click=${() => this._scrollToSection('resources')}
          >Resources</span
        >
      </div>
    `;
  }

  /**
   * Render the photon toolbar (context-bar) used in both list view and app below-fold.
   * Single source of truth for overflow items and toolbar props.
   */
  private _renderPhotonToolbar(options?: { showConfigure?: boolean; showCopyConfig?: boolean }) {
    const isExternalMCP = this._selectedPhoton?.isExternalMCP;
    const hasPath = !!this._selectedPhoton?.path;
    const hasInstallSource = !!this._selectedPhoton?.installSource;
    const isStateful = !!this._selectedPhoton?.stateful;
    const hasSettings = !!this._selectedPhoton?.hasSettings;
    // Editable: photon file sits directly in the base dir (user-owned).
    // Marketplace-installed or external MCPs are read-only — show Fork instead.
    const isEditable = !!this._selectedPhoton?.editable && !isExternalMCP;
    // Source mode: show source button for editable photons, hidden for read-only
    const sourceMode = isExternalMCP
      ? 'hidden'
      : this._view === 'source'
        ? 'edit'
        : hasPath && !this._selectedPhoton?.internal && isEditable
          ? 'source'
          : 'hidden';
    return html`
      <context-bar
        .photon=${this._selectedPhoton}
        .showEdit=${false}
        .showConfigure=${options?.showConfigure ?? !isExternalMCP}
        .showCopyConfig=${options?.showCopyConfig ?? true}
        .isStateful=${isStateful}
        .instanceName=${this._currentInstance}
        .instances=${this._instances}
        .instanceSelectorMode=${this._instanceSelectorMode}
        .autoInstance=${this._autoInstance}
        .sourceMode=${'hidden'}
        .hasSettings=${false}
        .overflowItems=${this._buildOverflowItems({
          showRefresh: !isExternalMCP,
          showEdit: false,
          showUpgrade: !!this._selectedPhoton?.hasUpdate,
          showRename: isEditable,
          showViewSource: false,
          showFork: !isEditable && !isExternalMCP,
          showContribute: hasInstallSource && !isExternalMCP,
          showDelete: isEditable,
          showHelp: !isExternalMCP,
        })}
        @context-action=${this._handleContextAction}
      ></context-bar>
    `;
  }

  /**
   * Build overflow menu items for the context bar ⋯ menu
   */
  private _buildOverflowItems(
    opts: {
      showRefresh?: boolean;
      showEdit?: boolean;
      showUpgrade?: boolean;
      showRename?: boolean;
      showViewSource?: boolean;
      showFork?: boolean;
      showContribute?: boolean;
      showDelete?: boolean;
      showHelp?: boolean;
      showRunTests?: boolean;
      showRemove?: boolean;
      showFullscreen?: boolean;
      showInstallApp?: boolean;
    } = {}
  ): import('./overflow-menu.js').OverflowMenuItem[] {
    const {
      showRefresh = true,
      showEdit = false,
      showUpgrade = false,
      showRename = this._selectedPhoton?.name !== 'maker',
      showViewSource = this._selectedPhoton?.name !== 'maker',
      showFork = false,
      showContribute = false,
      showDelete = this._selectedPhoton?.name !== 'maker',
      showHelp = true,
      showRunTests = this._getTestMethods().length > 0,
      showRemove = false,
      showFullscreen = false,
      showInstallApp = !this._pwaIsStandalone && !!this._selectedPhoton?.isApp,
    } = opts;

    const items: import('./overflow-menu.js').OverflowMenuItem[] = [];
    if (showFullscreen) {
      items.push({
        id: 'fullscreen',
        label: 'Full Screen',
        iconSvg: iconSvgString(iconPaths.expand),
      });
    }
    if (showRefresh) {
      items.push({ id: 'refresh', label: 'Refresh', iconSvg: iconSvgString(iconPaths.refresh) });
    }
    if (showRunTests) {
      items.push({
        id: 'run-tests',
        label: this._runningTests ? 'Running...' : 'Run Tests',
        iconSvg: iconSvgString(iconPaths.flask),
        disabled: this._runningTests,
      });
    }
    if (showEdit) {
      items.push({ id: 'edit', label: 'Edit', iconSvg: iconSvgString(iconPaths.pencil) });
    }
    if (showUpgrade) {
      const updateVersion = this._selectedPhoton?.updateVersion;
      items.push({
        id: 'upgrade',
        label: updateVersion ? `Update → ${updateVersion}` : 'Update',
        iconSvg: iconSvgString(iconPaths.upload),
      });
    }
    items.push({
      id: 'remember-values',
      label: 'Remember Values',
      iconSvg: iconSvgString(iconPaths.save),
      toggle: true,
      toggleActive: this._rememberFormValues,
    });
    items.push({
      id: 'verbose-logging',
      label: 'Verbose Logging',
      iconSvg: iconSvgString(iconPaths.scrollText),
      toggle: true,
      toggleActive: this._verboseLogging,
    });
    items.push({
      id: 'copy-config-stdio',
      label: 'Copy Config (Claude Desktop)',
      iconSvg: iconSvgString(iconPaths.clone),
      dividerBefore: true,
    });
    items.push({
      id: 'copy-config-url',
      label: 'Copy Config (HTTP)',
      iconSvg: iconSvgString(iconPaths.clone),
    });
    if (showInstallApp) {
      items.push({
        id: 'install-app',
        label: 'Install as App',
        iconSvg: iconSvgString(iconPaths.installApp),
      });
    }
    if (showRename || showViewSource || showFork || showContribute || showDelete || showRemove) {
      const first = [
        showRename,
        showViewSource,
        showFork,
        showContribute,
        showDelete,
        showRemove,
      ].findIndex(Boolean);
      if (showRename)
        items.push({
          id: 'rename',
          label: 'Rename',
          iconSvg: iconSvgString(iconPaths.pencil),
          dividerBefore: first === 0,
        });
      if (showViewSource)
        items.push({
          id: 'view-source',
          label: 'View Source',
          iconSvg: iconSvgString(iconPaths.source),
          dividerBefore: !showRename && first === 1,
        });
      if (showFork)
        items.push({
          id: 'fork',
          label: 'Fork',
          iconSvg: iconSvgString(iconPaths.fork),
          dividerBefore: !showRename && !showViewSource && first === 2,
        });
      if (showContribute)
        items.push({
          id: 'contribute',
          label: 'Contribute',
          iconSvg: iconSvgString(iconPaths.handHelping),
          dividerBefore: !showRename && !showViewSource && !showFork && first === 3,
        });
      if (showDelete)
        items.push({
          id: 'delete',
          label: 'Delete',
          iconSvg: iconSvgString(iconPaths.trash),
          danger: true,
          dividerBefore:
            !showRename && !showViewSource && !showFork && !showContribute && first === 4,
        });
      if (showRemove)
        items.push({
          id: 'remove',
          label: 'Remove',
          iconSvg: iconSvgString(iconPaths.trash),
          danger: true,
          dividerBefore:
            !showRename &&
            !showViewSource &&
            !showFork &&
            !showContribute &&
            !showDelete &&
            first === 5,
        });
    }
    if (showHelp) {
      items.push({
        id: 'help',
        label: 'Help',
        iconSvg: iconSvgString(iconPaths.docs),
        dividerBefore: true,
      });
    }
    return items;
  }

  /**
   * Handle events from the context-bar component
   */
  private _handleContextAction = (e: CustomEvent) => {
    const { action } = e.detail;
    switch (action) {
      case 'back':
        void this._handleBackFromMethod();
        break;
      case 'edit-studio':
        if (this._selectedPhoton) {
          // From source view, go to studio; otherwise go to studio directly
          this._view = 'studio';
        }
        break;
      case 'view-source':
        void this._handleViewSourceInline();
        break;
      case 'open-settings':
        this._handleOpenSettings();
        break;
      case 'instance-action':
        void this._handleInstanceAction(e.detail.instanceDetail);
        break;
      case 'configure':
        this._handleReconfigure();
        break;
      case 'copy-config':
        void this._copyConfigSnippet('stdio');
        break;
      case 'upgrade':
        void this._handleUpgrade();
        break;
      case 'select-method': {
        const method = this._selectedPhoton?.methods?.find(
          (m: any) => m.name === e.detail.methodName
        );
        if (method) {
          this._handleMethodSelect(new CustomEvent('select', { detail: { method } }));
        }
        break;
      }
      case 'edit-icon':
        this._startEditingIcon();
        break;
      case 'update-description':
        this._editedDescription = e.detail.description || '';
        void this._saveDescription();
        break;
      case 'overflow': {
        const { id } = e.detail;
        switch (id) {
          case 'refresh':
            void this._handleRefresh();
            break;
          case 'run-tests':
            void this._runTests();
            break;
          case 'remember-values':
            this._toggleRememberValues();
            break;
          case 'verbose-logging':
            this._toggleVerboseLogging();
            break;
          case 'rename':
            this._handleRenamePhoton();
            break;
          case 'view-source':
            void this._handleViewSource();
            break;
          case 'edit':
            if (this._selectedPhoton) this._view = 'studio';
            break;
          case 'upgrade':
            void this._handleUpgrade();
            break;
          case 'fork':
            void this._handleFork();
            break;
          case 'contribute':
            void this._handleContribute();
            break;
          case 'delete':
            void this._handleDeletePhoton();
            break;
          case 'remove':
            void this._handleRemove();
            break;
          case 'help':
            this._mainTab = 'help';
            void this._loadPhotonHelp();
            break;
          case 'fullscreen':
            this._handleFullscreen();
            break;
          case 'install-app':
            this._launchAsApp();
            break;
        }
        break;
      }
      case 'split-view:add':
        this._showMethodPicker();
        break;
      case 'split-view:change': {
        const method = this._selectedPhoton?.methods?.find((m: any) => m.name === e.detail.method);
        if (method && this._splitPanels.length > 0) {
          this._changePanelMethod(this._splitPanels[0].id, method);
        }
        break;
      }
      case 'split-view:remove':
        this._closeSecondPanel();
        break;
    }
  };

  private _renderPhotonHeader() {
    if (!this._selectedPhoton) return '';

    const isApp = this._selectedPhoton.isApp;
    const isEditable = !!this._selectedPhoton.editable && !this._selectedPhoton.isExternalMCP;
    const methods = this._selectedPhoton.methods || [];
    const templateCount = methods.filter((m: any) => m.isTemplate).length;
    const toolCount = methods.filter((m: any) => !m.isTemplate).length;
    const methodCount = methods.length;
    const description = this._selectedPhoton.description || `${this._selectedPhoton.name} MCP`;
    const isGenericDesc =
      description.endsWith(' MCP') ||
      description === 'Photon tool' ||
      /^add description/i.test(description.trim());

    // Get icon - check for custom icon first, then app icon, then initials
    const customIcon = this._selectedPhoton.icon;
    const photonInitials = this._selectedPhoton.name.substring(0, 2).toUpperCase();
    const defaultIcon = isApp ? '📱' : photonInitials;
    const displayIcon = customIcon || defaultIcon;

    return html`
      <header class="photon-header">
        ${isEditable
          ? html`<button
              type="button"
              class="photon-icon-large editable ${isApp ? '' : 'mcp-icon'}"
              @click=${this._startEditingIcon}
              title="Click to change icon"
              aria-label="Change icon"
            >
              ${displayIcon}
            </button>`
          : html`<span class="photon-icon-large ${isApp ? '' : 'mcp-icon'}">${displayIcon}</span>`}
        ${this._editingIcon ? this._renderEmojiPicker() : ''}
        <div class="photon-header-info">
          <h1 class="photon-header-name">${this._selectedPhoton.name}</h1>
          ${isEditable
            ? this._editingDescription
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
                  <button
                    type="button"
                    class="photon-header-desc editable ${isGenericDesc ? 'placeholder' : ''}"
                    @click=${this._startEditingDescription}
                    title="Click to edit description"
                    aria-label="Edit description"
                  >
                    ${isGenericDesc ? 'Click to add a description...' : description}
                  </button>
                `
            : html`<p class="photon-header-desc">${description}</p>`}
          <div class="photon-header-meta">
            ${isApp
              ? html`<span class="photon-badge app">App</span>`
              : html`<span class="photon-badge">MCP</span>`}
            ${templateCount > 0 && toolCount === 0
              ? html`<span class="photon-badge"
                  >${templateCount} prompt${templateCount !== 1 ? 's' : ''}</span
                >`
              : templateCount > 0
                ? html`<span class="photon-badge"
                    >${toolCount} tool${toolCount !== 1 ? 's' : ''}, ${templateCount}
                    prompt${templateCount !== 1 ? 's' : ''}</span
                  >`
                : html`<span class="photon-badge"
                    >${methodCount} method${methodCount !== 1 ? 's' : ''}</span
                  >`}
            ${this._selectedPhoton.version
              ? html`<span class="photon-badge">${this._selectedPhoton.version}</span>`
              : ''}
            ${this._selectedPhoton.hasUpdate
              ? html`<button
                  type="button"
                  class="photon-badge update"
                  title="${this._selectedPhoton.updateVersion
                    ? `A newer version (${this._selectedPhoton.updateVersion}) is available. Click to upgrade.`
                    : 'A newer version of this photon is available. Click to upgrade.'}"
                  @click=${this._handleUpgrade}
                >
                  ↑
                  Update${this._selectedPhoton.updateVersion
                    ? ` to ${this._selectedPhoton.updateVersion}`
                    : ' available'}
                </button>`
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
            ? html`<button
                type="button"
                class="photon-header-path"
                title="Click to copy: ${this._selectedPhoton.path}"
                aria-label="Copy path to clipboard"
                @click=${() => {
                  void navigator.clipboard.writeText(this._selectedPhoton!.path);
                  showToast('Path copied to clipboard');
                }}
              >
                ${this._selectedPhoton.path.replace(/^\/Users\/[^/]+\/|^\/home\/[^/]+\//, '~/')}
              </button>`
            : ''}
          <div class="photon-header-actions">
            <button
              class="btn-sm"
              @click=${this._handleCopyMCPConfig}
              title="Copy MCP config for Claude Desktop"
            >
              ${clipboard} Copy MCP Config
            </button>
            ${this._selectedPhoton.hasUpdate
              ? html`<button class="btn-sm primary" @click=${this._handleUpgrade}>
                  ${upload} Upgrade
                </button>`
              : ''}
          </div>
        </div>
      </header>
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
      void this._saveDescription();
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
        ${promptsIcon} Prompts
        <span class="count">${prompts.length}</span>
      </h3>
      <div class="cards-grid">
        ${prompts.map(
          (prompt: any) => html`
            <button
              type="button"
              class="asset-card glass-panel"
              @click=${() => this._handlePromptSelect(prompt)}
            >
              <div class="asset-header">
                <div class="asset-icon prompt">${promptsIcon}</div>
                <span class="asset-name">${prompt.id}</span>
              </div>
              <div class="asset-desc">
                ${prompt.description || 'Click to view and customize this prompt'}
              </div>
              <div class="asset-meta">${prompt.path}</div>
            </button>
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
            <button
              type="button"
              class="asset-card glass-panel"
              @click=${() => this._handleResourceSelect(resource)}
            >
              <div class="asset-header">
                <div class="asset-icon resource">📦</div>
                <span class="asset-name">${resource.id}</span>
              </div>
              <div class="asset-desc">${resource.description || 'Click to view this resource'}</div>
              <div class="asset-meta">${resource.mimeType || resource.path}</div>
            </button>
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._closePromptModal();
        }}
      >
        <div class="asset-viewer-modal glass-panel">
          <button class="close-btn" @click=${this._closePromptModal}>&times;</button>

          <h2 id="prompt-modal-title">
            <span class="icon">${promptsIcon}</span>
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

          <button class="copy-btn" @click=${this._copyPromptContent}>
            ${clipboard} Copy to Clipboard
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
      <div
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-modal-title"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._closeResourceModal();
        }}
      >
        <div class="asset-viewer-modal glass-panel">
          <button class="close-btn" @click=${this._closeResourceModal}>&times;</button>

          <h2 id="resource-modal-title">
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
                  ${clipboard} Copy to Clipboard
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
                <span class="shortcut-desc">Theme settings</span>
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
            @click=${() => this._closeHelp()}
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
      let processed = markdown.replace(
        /```mermaid\s*\n([\s\S]*?)```/g,
        (_match: string, code: string) => {
          const id = `help-mermaid-${Math.random().toString(36).substr(2, 9)}`;
          mermaidBlocks.push({ id, code: code.trim() });
          return `<div data-mermaid-id="${id}" style="min-height: 80px; display: flex; align-items: center; justify-content: center; color: var(--t-muted);">Loading diagram...</div>`;
        }
      );
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
              mermaid
                .render(id + '-svg', code)
                .then(({ svg }: { svg: string }) => {
                  el.innerHTML = svg;
                  (el as HTMLElement).style.minHeight = '';
                  (el as HTMLElement).style.background = isDark
                    ? 'hsla(220, 15%, 18%, 0.8)'
                    : 'hsla(0, 0%, 97%, 0.8)';
                  (el as HTMLElement).style.borderRadius = '8px';
                  (el as HTMLElement).style.padding = '12px';
                })
                .catch(() => {
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
                ? html`<span style="font-size: 0.7em; opacity: 0.6; margin-left: 8px;"
                    >Loading...</span
                  >`
                : ''}
            </h2>
            <button
              class="btn-secondary"
              style="padding: 6px 12px; font-size: 0.85rem;"
              @click=${() => this._closePhotonHelp()}
              aria-label="Close help"
            >
              ${xMark}
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

  /** Render the settings view — a professional two-column settings panel */
  private _renderSettingsView() {
    const photon = this._selectedPhoton;
    if (!photon) return '';
    const settingsMethod = photon.methods?.find((m: any) => m.name === 'settings');
    const hasSetup = Array.isArray(photon.requiredParams) && photon.requiredParams.length > 0;
    const hasConfiguration = !!settingsMethod;

    if (!hasSetup && !hasConfiguration) {
      return html`<div style="padding: var(--space-xl); color: var(--t-muted); text-align: center;">
        No settings available for this photon.
      </div>`;
    }

    const showTabs = hasSetup && hasConfiguration;
    const activeTab: 'setup' | 'configuration' =
      hasConfiguration && this._settingsTab === 'configuration'
        ? 'configuration'
        : hasSetup && this._settingsTab === 'setup'
          ? 'setup'
          : hasConfiguration
            ? 'configuration'
            : 'setup';

    return html`
      <div style="padding: var(--space-lg); max-width: 900px; margin: 0 auto; width: 100%;">
        <div style="margin-bottom: var(--space-lg);">
          <h2
            style="font-family: var(--font-display); font-size: var(--text-xl); font-weight: 700; color: var(--t-primary); margin: 0 0 4px 0;"
          >
            ${photon.name} Settings
          </h2>
          <p style="color: var(--t-muted); font-size: var(--text-sm); margin: 0; line-height: 1.5;">
            ${activeTab === 'setup'
              ? 'What this photon needs to run. Applies to every instance; changes take effect on next load.'
              : 'How this photon behaves. Applies to the current instance only; changes are saved immediately.'}
          </p>
        </div>

        ${showTabs ? this._renderSettingsTabStrip(activeTab) : ''}
        ${activeTab === 'setup'
          ? this._renderSettingsSetup(photon)
          : this._renderSettingsConfiguration(photon, settingsMethod)}
      </div>
    `;
  }

  private _renderSettingsTabStrip(active: 'setup' | 'configuration') {
    const tab = (id: 'setup' | 'configuration', label: string) => html`
      <button
        type="button"
        @click=${() => {
          this._settingsTab = id;
        }}
        style="
          padding: 8px 16px;
          background: ${active === id ? 'var(--bg-glass-strong)' : 'transparent'};
          color: ${active === id ? 'var(--t-primary)' : 'var(--t-muted)'};
          border: none;
          border-bottom: 2px solid ${active === id ? 'var(--accent-primary)' : 'transparent'};
          cursor: pointer;
          font-size: var(--text-sm);
          font-weight: ${active === id ? '600' : '500'};
          transition: all 0.15s;
        "
      >
        ${label}
      </button>
    `;
    return html`
      <div
        role="tablist"
        style="display: flex; gap: 4px; border-bottom: 1px solid var(--border-glass); margin-bottom: var(--space-lg);"
      >
        ${tab('setup', 'Setup')} ${tab('configuration', 'Configuration')}
      </div>
    `;
  }

  private _renderSettingsSetup(photon: any) {
    const isInitial = photon.configured === false;
    return html`
      <div class="glass-panel" style="overflow: hidden;">
        <div
          style="padding: var(--space-sm) var(--space-md); border-bottom: 1px solid var(--border-glass); background: var(--bg-glass);"
        >
          <span
            style="font-family: var(--font-display); font-size: var(--text-sm); font-weight: 600; color: var(--t-primary); text-transform: uppercase; letter-spacing: 0.05em;"
            >Setup</span
          >
        </div>
        <div style="padding: var(--space-lg);">
          <photon-config
            embedded
            .photon=${{
              ...photon,
              // photon-config expects an UnconfiguredPhoton-shape with a
              // requiredParams field. Pass the existing data through.
              requiredParams: photon.requiredParams || [],
            }}
            .mode=${isInitial ? 'initial' : 'edit'}
            @configure=${(e: Event) => {
              void this._handleConfigure(e as CustomEvent);
            }}
          ></photon-config>
        </div>
      </div>
    `;
  }

  private _renderSettingsConfiguration(photon: any, settingsMethod: any) {
    const params = settingsMethod.params;
    const properties = params?.properties || {};
    const propEntries = Object.entries(properties);
    // Instance label: only relevant when the photon is stateful or has
    // more than one instance loaded. The picker itself lives in the
    // context-bar above; here we just give the user a "you are here"
    // anchor so they don't accidentally edit the wrong instance.
    const showInstanceLabel =
      !!photon?.stateful || (Array.isArray(this._instances) && this._instances.length > 1);
    const instanceName = this._currentInstance || 'default';

    return html`
      ${showInstanceLabel
        ? html`
            <div
              style="display: flex; align-items: center; gap: var(--space-xs); margin-bottom: var(--space-sm); font-size: var(--text-sm); color: var(--t-muted);"
            >
              <span>Instance:</span>
              <span
                style="font-family: var(--font-mono); color: var(--t-primary); background: var(--bg-glass); padding: 2px 8px; border-radius: var(--radius-xs);"
                >${instanceName}</span
              >
              <span style="font-size: var(--text-xs);">
                — switch via the picker in the header above
              </span>
            </div>
          `
        : ''}
      ${propEntries.length > 0
        ? html`
            <div class="glass-panel" style="margin-bottom: var(--space-lg); overflow: hidden;">
              <div
                style="padding: var(--space-sm) var(--space-md); border-bottom: 1px solid var(--border-glass); background: var(--bg-glass);"
              >
                <span
                  style="font-family: var(--font-display); font-size: var(--text-sm); font-weight: 600; color: var(--t-primary); text-transform: uppercase; letter-spacing: 0.05em;"
                  >Configuration</span
                >
              </div>
              <div class="method-detail" style="padding: 0;">
                <invoke-form
                  .params=${params}
                  .loading=${this._isExecuting}
                  .photonName=${photon.name}
                  .methodName=${'settings'}
                  .rememberValues=${this._rememberFormValues}
                  .sharedValues=${this._sharedFormParams ?? this._lastFormParams}
                  .settingsLayout=${true}
                  @submit=${(e: Event) => void this._handleExecute(e as CustomEvent)}
                  @cancel=${() => {}}
                ></invoke-form>
                <div
                  style="display: flex; justify-content: flex-end; padding: var(--space-sm) var(--space-md); border-top: 1px solid var(--border-glass);"
                >
                  <button
                    class="btn-primary"
                    style="font-size: var(--text-sm); padding: 6px 20px;"
                    @click=${(e: Event) => {
                      const panel = (e.target as HTMLElement).closest('.glass-panel');
                      const form: any = panel?.querySelector('invoke-form');
                      form?.handleSubmit();
                    }}
                    ?disabled=${this._isExecuting}
                  >
                    ${this._isExecuting
                      ? html`<span class="btn-loading"
                          ><span class="spinner"></span>Saving...</span
                        >`
                      : 'Save Settings'}
                  </button>
                </div>
              </div>
            </div>
          `
        : ''}
    `;
  }

  /** Render source code as an inline view (not a modal) — Phase 2 */
  private _renderSourceView() {
    if (!this._sourceData) {
      return html`
        <div
          style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--t-muted);"
        >
          Loading source...
        </div>
      `;
    }

    const filename = this._sourceData.path.split('/').pop() || 'source.ts';
    const ext = filename.split('.').pop()?.toLowerCase() || 'ts';
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

    let highlightedCode = this._sourceData.code;
    const Prism = (window as any).Prism;
    if (Prism && Prism.languages[language]) {
      highlightedCode = Prism.highlight(this._sourceData.code, Prism.languages[language], language);
    }

    const isProtected = !this._selectedPhoton?.editable;

    return html`
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div
          style="display: flex; justify-content: space-between; align-items: center; padding: 6px var(--space-md); border-bottom: 1px solid var(--border-glass); flex-shrink: 0; background: var(--bg-panel);"
        >
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--t-muted);">
              ${filename}
            </div>
            ${isProtected
              ? html`<span
                  style="font-size: var(--text-2xs); padding: 2px 6px; background: var(--bg-glass-strong); border: 1px solid var(--border-glass); border-radius: var(--radius-xs); color: var(--t-muted); text-transform: uppercase; letter-spacing: 0.05em;"
                  >Protected</span
                >`
              : ''}
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            ${isProtected
              ? html`<button
                  class="action-btn"
                  style="display: inline-flex; align-items: center; background: var(--bg-glass); border: 1px solid var(--accent-secondary); color: var(--accent-secondary); padding: 4px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--text-xs);"
                  @click=${this._handleFork}
                  title="Fork to create an editable local copy"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    style="margin-right: 3px;"
                  >
                    <circle cx="12" cy="18" r="3" />
                    <circle cx="6" cy="6" r="3" />
                    <circle cx="18" cy="6" r="3" />
                    <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
                    <path d="M12 12v3" />
                  </svg>
                  Fork
                </button>`
              : ''}
            <button
              class="action-btn"
              style="display: inline-flex; align-items: center; background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--t-muted); padding: 4px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--text-xs);"
              @click=${this._copySourceCode}
              title="Copy source code"
            >
              ${clipboard} Copy
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
    `;
  }

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
              ${this._selectedPhoton?.editable && !this._selectedPhoton?.isExternalMCP
                ? html`
                    <button
                      class="toolbar-btn"
                      style="padding: 6px 12px; font-size: 0.85rem; background: var(--accent-primary); border-color: var(--accent-primary); color: white;"
                      @click=${() => {
                        this._closeSourceModal();
                        this._view = 'studio';
                      }}
                      title="Edit this photon in Studio"
                    >
                      ${pencil} Open in Studio
                    </button>
                  `
                : ''}
              <button
                class="toolbar-btn"
                style="padding: 6px 12px; font-size: 0.85rem;"
                @click=${this._copySourceCode}
                title="Copy source code"
              >
                ${clipboard} Copy
              </button>
              <button
                class="toolbar-btn"
                style="padding: 6px 12px; font-size: 0.85rem;"
                @click=${this._closeSourceModal}
                aria-label="Close"
              >
                ${xMark}
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
