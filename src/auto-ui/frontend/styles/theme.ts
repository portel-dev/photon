import { css } from 'lit';

export const theme = css`
  :host {
    /* Colors - HSL for easy manipulation */
    --hsl-bg: 220, 15%, 10%;
    --hsl-glass: 220, 15%, 14%;
    --hsl-primary: 260, 100%, 65%; /* Neon Violet */
    --hsl-secondary: 190, 100%, 50%; /* Cyan */
    --hsl-text: 220, 10%, 95%;
    --hsl-text-muted: 220, 10%, 65%;
    --hsl-border: 220, 10%, 25%;

    /* Semantic Colors */
    --bg-app: hsl(var(--hsl-bg));
    --bg-glass: hsla(220, 15%, 14%, 0.6);
    --bg-glass-strong: hsla(220, 15%, 14%, 0.85);
    --t-primary: hsl(var(--hsl-text));
    --t-muted: hsl(var(--hsl-text-muted));
    --border-glass: hsla(220, 10%, 80%, 0.1);
    
    /* Accents */
    --accent-primary: hsl(var(--hsl-primary));
    --accent-secondary: hsl(var(--hsl-secondary));
    --glow-primary: hsla(var(--hsl-primary), 0.3);

    /* Spacing */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 32px;

    /* Radius */
    --radius-sm: 6px;
    --radius-md: 12px;
    --radius-lg: 18px;

    /* Typography */
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
    background: hsla(220, 10%, 80%, 0.1);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: hsla(220, 10%, 80%, 0.2);
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
