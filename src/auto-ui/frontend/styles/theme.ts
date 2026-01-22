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
    --radius-sm: 6px;
    --radius-md: 12px;
    --radius-lg: 18px;

    /* Typography - same for all themes */
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }

  /* Shared Utility Classes */
  .glass {
    background: var(--bg-glass);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--border-glass);
    box-shadow: 0 4px 24px -1px rgba(0, 0, 0, 0.2);
  }

  .glass-panel {
    background: var(--bg-glass-strong);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--border-glass);
    border-radius: var(--radius-md);
  }

  .text-gradient {
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
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
    border-radius: 4px;
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
    transition: .4s;
    border-radius: 24px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 2px;
    bottom: 2px;
    background-color: var(--t-muted);
    transition: .4s;
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

  input:focus + .slider {
    box-shadow: 0 0 1px var(--accent-primary);
  }
`;
