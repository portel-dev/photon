/**
 * Beam SVG Icon System
 *
 * Inline SVG icons for UI chrome. Each icon uses currentColor
 * for fill/stroke so it inherits text color from its container.
 *
 * All icons: 20x20 viewBox, 1.5px stroke, no fill (stroke-based).
 * Usage: html`<span class="icon">${icons.search}</span>`
 */
import { html, type TemplateResult } from 'lit';

function icon(svg: string): TemplateResult {
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${unsafeSVG(svg)}
  </svg>`;
}

// Lit doesn't have unsafeSVG built into every version, so we inline it
// via the unsafeHTML directive for SVG content inside an svg element.
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

// ---------- Navigation & Actions ----------

/** Magnifying glass */
export const search = icon(
  `<circle cx="9" cy="9" r="5.5"/><line x1="13.5" y1="13.5" x2="17" y2="17"/>`
);

/** Three horizontal dots */
export const moreHorizontal = icon(
  `<circle cx="4" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/>`
);

/** Plus sign */
export const plus = icon(
  `<line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/>`
);

/** X mark (close) */
export const xMark = icon(
  `<line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>`
);

/** Refresh / reconnect arrow */
export const refresh = icon(
  `<path d="M3 10a7 7 0 0 1 12.9-3.7"/><polyline points="16 2 16 7 11 7"/><path d="M17 10a7 7 0 0 1-12.9 3.7"/><polyline points="4 18 4 13 9 13"/>`
);

/** Trash can */
export const trash = icon(
  `<polyline points="4 5 16 5"/><path d="M7 5V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1"/><path d="M5 5l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"/>`
);

/** Copy / clipboard */
export const clipboard = icon(
  `<rect x="7" y="3" width="9" height="13" rx="1.5"/><path d="M4 7h-0.5a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5V17"/>`
);

/** Upload arrow */
export const upload = icon(
  `<path d="M4 14v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3"/><polyline points="14 7 10 3 6 7"/><line x1="10" y1="3" x2="10" y2="14"/>`
);

// ---------- Edit & Configure ----------

/** Pencil */
export const pencil = icon(
  `<path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z"/><line x1="11" y1="6" x2="14" y2="9"/>`
);

/** Gear / settings */
export const settings = icon(
  `<circle cx="10" cy="10" r="2.5"/><path d="M10 1.5v2M10 16.5v2M3.3 3.3l1.4 1.4M15.3 15.3l1.4 1.4M1.5 10h2M16.5 10h2M3.3 16.7l1.4-1.4M15.3 4.7l1.4-1.4"/>`
);

// ---------- Stars ----------

/** Filled star */
export const starFilled = icon(
  `<polygon points="10,2 12.5,7.5 18,8 13.8,12 15,17.5 10,14.8 5,17.5 6.2,12 2,8 7.5,7.5" fill="currentColor" stroke="currentColor"/>`
);

/** Outline star */
export const starOutline = icon(
  `<polygon points="10,2 12.5,7.5 18,8 13.8,12 15,17.5 10,14.8 5,17.5 6.2,12 2,8 7.5,7.5"/>`
);

// ---------- Media Controls ----------

/** Play triangle */
export const play = icon(`<polygon points="6,3 17,10 6,17" fill="currentColor" stroke="none"/>`);

// ---------- Status Indicators ----------

/** Checkmark */
export const check = icon(`<polyline points="4 10 8 14 16 6"/>`);

/** Warning triangle */
export const warning = icon(
  `<path d="M10 2L1 18h18L10 2z" fill="none"/><line x1="10" y1="8" x2="10" y2="12"/><circle cx="10" cy="15" r="0.5" fill="currentColor" stroke="none"/>`
);

/** Info circle */
export const info = icon(
  `<circle cx="10" cy="10" r="7.5"/><line x1="10" y1="9" x2="10" y2="14"/><circle cx="10" cy="6.5" r="0.5" fill="currentColor" stroke="none"/>`
);

// ---------- Navigation ----------

/** Expand (enter fullscreen) */
export const expand = icon(
  `<polyline points="14 2 18 2 18 6"/><polyline points="6 18 2 18 2 14"/><line x1="18" y1="2" x2="12" y2="8"/><line x1="2" y1="18" x2="8" y2="12"/>`
);

/** Collapse (exit fullscreen) */
export const collapse = icon(
  `<polyline points="4 10 10 10 10 16"/><polyline points="16 10 10 10 10 4"/><line x1="2" y1="18" x2="10" y2="10"/><line x1="18" y1="2" x2="10" y2="10"/>`
);

/** Keyboard */
export const keyboard = icon(
  `<rect x="1" y="4" width="18" height="12" rx="2"/><line x1="5" y1="8" x2="6" y2="8"/><line x1="9" y1="8" x2="11" y2="8"/><line x1="14" y1="8" x2="15" y2="8"/><line x1="5" y1="12" x2="15" y2="12"/>`
);

// ---------- Content Types ----------

/** Marketplace / shopping bag */
export const marketplace = icon(
  `<path d="M5 5h10l1 12H4L5 5z"/><path d="M7 5V4a3 3 0 0 1 6 0v1"/>`
);

/** Palette / theme */
export const palette = icon(
  `<circle cx="10" cy="10" r="8"/><circle cx="7" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="7" cy="13" r="1.2" fill="currentColor" stroke="none"/><path d="M12.5 12.5a2 2 0 1 1 2 2h-2v-2"/>`
);

/** Folder */
export const folder = icon(
  `<path d="M2 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5z"/>`
);

/** File / document */
export const file = icon(
  `<path d="M5 2h7l4 4v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><polyline points="12 2 12 6 16 6"/>`
);

/** Fork */
export const fork = icon(
  `<circle cx="10" cy="4" r="2"/><circle cx="5" cy="16" r="2"/><circle cx="15" cy="16" r="2"/><path d="M10 6v4M10 10c-3 0-5 2-5 4M10 10c3 0 5 2 5 4"/>`
);

/** Copy / clone */
export const clone = icon(
  `<rect x="6" y="6" width="11" height="11" rx="1.5"/><path d="M3 14V4.5A1.5 1.5 0 0 1 4.5 3H14"/>`
);

/** Source code */
export const source = icon(
  `<polyline points="7 7 3 10 7 13"/><polyline points="13 7 17 10 13 13"/><line x1="11" y1="4" x2="9" y2="16"/>`
);

/** Plug / connection */
export const plug = icon(
  `<line x1="7" y1="2" x2="7" y2="7"/><line x1="13" y1="2" x2="13" y2="7"/><path d="M4 7h12v3a6 6 0 0 1-12 0V7z"/><line x1="10" y1="16" x2="10" y2="19"/>`
);

/** App default (grid) */
export const appDefault = icon(
  `<rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/>`
);

/** Prompts / chat bubble */
export const prompts = icon(
  `<path d="M3 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-4 3v-3a2 2 0 0 1-2-2V4z"/>`
);

/** Docs / book open */
export const docs = icon(
  `<path d="M2 3h7a2 2 0 0 1 2 2v12l-3-2H2V3z"/><path d="M18 3h-7a2 2 0 0 0-2 2v12l3-2h6V3z"/>`
);

/** Chevron down */
export const chevronDown = icon(`<polyline points="5 7 10 13 15 7"/>`);

/** External link */
export const externalLink = icon(
  `<path d="M11 3h6v6"/><line x1="17" y1="3" x2="9" y2="11"/><path d="M15 11v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>`
);

/** Hamburger menu */
export const menu = icon(
  `<line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/>`
);

/** Hourglass / timer */
export const hourglass = icon(
  `<path d="M5 2h10M5 18h10"/><path d="M6 2v4l4 4-4 4v4"/><path d="M14 2v4l-4 4 4 4v4"/>`
);

/** Package / box */
export const packageBox = icon(
  `<path d="M2 6l8-4 8 4v8l-8 4-8-4V6z"/><line x1="10" y1="2" x2="10" y2="18"/><polyline points="2 6 10 10 18 6"/>`
);

/** Sparkle / new */
export const sparkle = icon(
  `<path d="M10 2l1.5 5L17 8l-5.5 1L10 14l-1.5-5L3 8l5.5-1L10 2z" fill="currentColor" stroke="none"/>`
);

/** Skip arrow (skip to content) */
export const skipArrow = icon(
  `<line x1="4" y1="10" x2="16" y2="10"/><polyline points="12 6 16 10 12 14"/>`
);

// ---------- Sized icon helper ----------

/**
 * Render an icon at a specific size.
 * Usage: html`${sizedIcon(icons.search, 16)}`
 */
export function sizedIcon(iconTpl: TemplateResult, size: number): TemplateResult {
  // Clone by re-rendering with modified size
  return html`<span
    class="icon"
    style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px"
    >${iconTpl}</span
  >`;
}

/**
 * All icons as a map for programmatic access.
 */
export const icons = {
  search,
  moreHorizontal,
  plus,
  xMark,
  refresh,
  trash,
  clipboard,
  upload,
  pencil,
  settings,
  starFilled,
  starOutline,
  play,
  check,
  warning,
  info,
  expand,
  collapse,
  keyboard,
  marketplace,
  palette,
  folder,
  file,
  fork,
  clone,
  source,
  plug,
  appDefault,
  prompts,
  docs,
  chevronDown,
  externalLink,
  menu,
  hourglass,
  packageBox,
  sparkle,
  skipArrow,
} as const;

export type IconName = keyof typeof icons;
