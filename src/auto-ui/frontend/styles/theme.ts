import { css } from 'lit';

export type Theme = 'dark' | 'light';

/**
 * Base theme - only defines spacing, radius, typography
 * Color variables are inherited from beam-app root
 */
export const theme = css`
  :host {
    /* Spacing - same for all themes */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 32px;

    /* Radius - same for all themes */
    --radius-xs: 4px;
    --radius-sm: 6px;
    --radius-md: 12px;
    --radius-lg: 18px;
    --radius-full: 9999px;

    /* Typography - same for all themes */
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-mono: 'JetBrains Mono', monospace;

    /* Bento layout */
    --bento-border: 1px solid var(--border-glass);
    --bento-shadow: 2px 2px 0px var(--border-glass);
    --bento-radius: var(--radius-md);

    /* Method type accent colors */
    --accent-autorun: hsl(160, 60%, 45%);
    --accent-webhook: hsl(45, 80%, 50%);
    --accent-cron: hsl(215, 80%, 60%);
    --accent-locked: hsl(0, 65%, 55%);
  }

  /* Shared Utility Classes */
  .glass {
    background: var(--bg-glass);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--border-glass);
    box-shadow: var(--shadow-md);
  }

  .glass-panel {
    background: var(--bg-glass-strong);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--border-glass);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  .text-gradient {
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* Focus visibility — WCAG 2.4.7 */
  *:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  /* Input elements use glow ring instead of outline */
  input:focus-visible,
  textarea:focus-visible,
  select:focus-visible {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px var(--glow-primary);
  }

  /* Inline editable inputs — focus inherited from parent container */
  .editable-input,
  .description-input {
    background: transparent;
    border: none;
    color: var(--t-primary);
    font: inherit;
    padding: 0;
    margin: 0;
  }

  .editable-input:focus-visible,
  .description-input:focus-visible {
    outline: none;
  }

  /* Scrollbar */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--border-glass);
    border-radius: var(--radius-xs);
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--t-muted);
    opacity: 0.5;
  }
  /* Toggle Switch */
  .switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--bg-glass);
    border: 1px solid var(--border-glass);
    transition: 0.4s;
    border-radius: var(--radius-full);
  }

  .slider:before {
    position: absolute;
    content: '';
    height: 18px;
    width: 18px;
    left: 2px;
    bottom: 2px;
    background-color: var(--t-muted);
    transition: 0.4s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  input:checked + .slider:before {
    transform: translateX(20px);
    background-color: white;
  }

  input:focus-visible + .slider {
    box-shadow: 0 0 0 2px var(--glow-primary);
  }

  /* Reduced motion — WCAG 2.3.3 */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;
