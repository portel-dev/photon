/**
 * Photon-owned style contract for generated human and agent UI surfaces.
 *
 * The values are intentionally small and framework-neutral. They map the
 * token ideas we would otherwise borrow from a design utility framework into
 * stable `--photon-*` aliases that Beam, custom UIs, MCP Apps, and tests can
 * share without carrying a runtime CSS dependency.
 */

export const PHOTON_TOKEN_CSS = `
:root,
:host,
.photon-render-surface {
  --photon-space-0: 0;
  --photon-space-1: 4px;
  --photon-space-2: 8px;
  --photon-space-3: 12px;
  --photon-space-4: 16px;
  --photon-space-5: 20px;
  --photon-space-6: 24px;
  --photon-space-8: 32px;
  --photon-space-10: 40px;
  --photon-space-12: 48px;

  --photon-radius-1: 4px;
  --photon-radius-2: 6px;
  --photon-radius-3: 8px;
  --photon-radius-4: 12px;
  --photon-radius-5: 16px;
  --photon-radius-pill: 9999px;

  --photon-font-sans: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  --photon-font-mono: var(--font-mono, "SFMono-Regular", Consolas, "Liberation Mono", monospace);
  --photon-line-height: 1.45;
  --photon-line-height-tight: 1.2;
  --photon-touch-target: 44px;

  --photon-container-xs: 20rem;
  --photon-container-sm: 28rem;
  --photon-container-md: 40rem;
  --photon-container-lg: 56rem;
  --photon-container-xl: 72rem;

  --photon-layout-gap: var(--photon-space-4);
  --photon-layout-gap-sm: var(--photon-space-2);
  --photon-layout-gap-lg: var(--photon-space-6);
  --photon-layout-padding: var(--photon-space-4);
  --photon-layout-measure: 70ch;
  --photon-control-height: var(--photon-touch-target);

  --space-xs: var(--photon-space-1);
  --space-sm: var(--photon-space-2);
  --space-md: var(--photon-space-4);
  --space-lg: var(--photon-space-6);
  --space-xl: var(--photon-space-8);

  --radius-xs: var(--photon-radius-1);
  --radius-sm: var(--photon-radius-2);
  --radius-md: var(--photon-radius-4);
  --radius-lg: var(--photon-radius-5);
  --radius-full: var(--photon-radius-pill);
}
`.trim();

export const PHOTON_LAYOUT_CSS = `
.photon-render-surface,
.photon-render-surface *,
.photon-layout,
.photon-layout * {
  box-sizing: border-box;
}

.photon-render-surface,
.photon-layout {
  container-type: inline-size;
  min-width: 0;
  max-width: 100%;
  color: var(--photon-color-text, var(--t-primary, currentColor));
  font-family: var(--photon-font-sans);
  line-height: var(--photon-line-height);
  overflow-wrap: break-word;
}

.photon-render-surface :where(img, svg, canvas, video, iframe, table, pre) {
  max-width: 100%;
}

.photon-render-surface :where(pre, code) {
  font-family: var(--photon-font-mono);
  overflow-wrap: anywhere;
}

.photon-stack {
  display: flex;
  flex-direction: column;
  gap: var(--photon-layout-gap);
  min-width: 0;
  max-width: 100%;
}

.photon-cluster {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--photon-layout-gap-sm);
  min-width: 0;
  max-width: 100%;
}

.photon-grid {
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(min(100%, var(--photon-grid-min, 14rem)), 1fr)
  );
  gap: var(--photon-layout-gap);
  min-width: 0;
  max-width: 100%;
}

.photon-split {
  display: grid;
  grid-template-columns: repeat(
    var(--photon-split-columns, 2),
    minmax(min(100%, var(--photon-split-min, 16rem)), 1fr)
  );
  gap: var(--photon-layout-gap);
  align-items: stretch;
  min-width: 0;
  max-width: 100%;
}

.photon-surface {
  min-width: 0;
  max-width: 100%;
  padding: var(--photon-layout-padding);
  border: 1px solid var(--photon-color-border, var(--border-glass, currentColor));
  border-radius: var(--photon-radius-4);
  background: var(--photon-color-surface, var(--bg-glass-strong, transparent));
}

.photon-control,
.photon-render-surface :where(input, select, textarea, button) {
  min-width: 0;
  max-width: 100%;
  min-height: var(--photon-control-height);
}

/* Icon controls own their square touch target. The general form-control rule
 * must not stretch a circular close, expand, or navigation button vertically. */
.photon-render-surface :where(button[data-photon-icon-button]) {
  min-width: 0;
  max-width: none;
  min-height: 0;
  max-height: none;
}

@container (max-width: 36rem) {
  .photon-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 560px) {
  .photon-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
`.trim();

export function generatePhotonStyleContractCSS(): string {
  return `${PHOTON_TOKEN_CSS}\n\n${PHOTON_LAYOUT_CSS}`;
}
