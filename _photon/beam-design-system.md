# Beam Design System Specification

## Overview

Beam is the Photon runtime's browser-based UI — a developer tool / MCP browser with a glassmorphism dark-first design and professional light mode.

---

## Color System

### Dark Theme (Default)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-app` | `hsl(220, 15%, 10%)` | Page background |
| `--bg-glass` | `hsla(220, 15%, 14%, 0.6)` | Glass panel background |
| `--bg-glass-strong` | `hsla(220, 15%, 14%, 0.85)` | Elevated glass surfaces |
| `--bg-panel` | `hsl(220, 15%, 12%)` | Sidebar, modals |
| `--t-primary` | `hsl(220, 10%, 95%)` | Primary text |
| `--t-muted` | `hsl(220, 10%, 65%)` | Secondary/muted text |
| `--border-glass` | `hsla(220, 10%, 80%, 0.1)` | Borders |
| `--accent-primary` | `hsl(260, 100%, 65%)` | Purple accent |
| `--accent-secondary` | `hsl(190, 100%, 50%)` | Cyan accent |
| `--glow-primary` | `hsla(260, 100%, 65%, 0.3)` | Focus glow ring |

### Light Theme

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-app` | `#eae4dd` | Warm paper background |
| `--bg-panel` | `#f8f5f1` | Sidebar, modals |
| `--t-primary` | `#2c2420` | Dark warm text |
| `--t-muted` | `#6b5e54` | Muted warm text (5.76:1 on bg-panel) |
| `--border-glass` | `rgba(120, 90, 60, 0.2)` | Warm borders (was 0.12) |
| `--accent-primary` | `hsl(215, 55%, 45%)` | Professional blue |
| `--accent-secondary` | `hsl(165, 45%, 35%)` | Teal accent |

### Status Colors

| Token | Dark | Light |
|-------|------|-------|
| `--color-error` | `#f87171` | `hsl(0, 55%, 48%)` |
| `--color-success` | `#4ade80` | `hsl(142, 55%, 40%)` |
| `--color-warning` | `#fbbf24` | `hsl(35, 70%, 42%)` |
| `--color-info` | `var(--accent-secondary)` | `var(--accent-secondary)` |

---

## Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-display` | Space Grotesk, Inter | Headings, titles |
| `--font-sans` | Inter | Body text |
| `--font-mono` | JetBrains Mono | Code, CLI preview |

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `--text-3xl` | 2rem | Hero text |
| `--text-2xl` | 1.5rem | Section headers |
| `--text-xl` | 1.25rem | Card titles |
| `--text-lg` | 1.1rem | Method names |
| `--text-md` | 0.9rem | Body text |
| `--text-sm` | 0.8rem | Captions, metadata |
| `--text-xs` | 0.7rem | Labels, tags |
| `--text-2xs` | 0.7rem | Micro text (bumped from 0.6rem for readability) |

---

## Spacing & Radius

| Token | Value |
|-------|-------|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 32px |

| Token | Value |
|-------|-------|
| `--radius-xs` | 4px |
| `--radius-sm` | 6px |
| `--radius-md` | 12px |
| `--radius-lg` | 18px |
| `--radius-full` | 9999px |

---

## Icon System

### UI Chrome Icons

UI chrome uses **inline SVG icons** from `src/auto-ui/frontend/icons.ts`:
- 20x20 viewBox, 1.5px stroke, `currentColor` fill/stroke
- Exported as Lit `TemplateResult` tagged template literals
- `aria-hidden="true"` by default (decorative when paired with text)
- 35+ icons covering all UI chrome needs

### Photon Identity Icons

Photon/method icons use **emoji by default** with file-based option:
- `@icon 🎮` — emoji (1-2 chars, rendered as text)
- `@icon ./icon.svg` — custom file (>2 chars, treated as path)
- Fallback chain: custom file → emoji → text initials → `appDefault` SVG icon

### Anti-patterns

- Never use emoji for UI chrome (navigation, actions, status)
- Never hardcode emoji as string literals in component templates
- Always pair icons with text labels or `aria-label`

---

## Accessibility Standards

### WCAG 2.1 AA Compliance

| Area | Requirement | Implementation |
|------|-------------|----------------|
| **Focus** | 2.4.7 Focus Visible | Global `*:focus-visible` outline; inputs use glow ring |
| **Keyboard** | 2.1.1 Keyboard | All interactive elements have `tabindex`, `role`, keydown handlers |
| **Color** | 1.4.3 Contrast | All text meets 4.5:1 minimum; large text meets 3:1 |
| **Semantics** | 4.1.2 Name/Role/Value | Clickable elements use `button`/`role="button"` + `tabindex` |
| **Skip** | 2.4.1 Bypass Blocks | Skip-to-main-content link as first focusable element |
| **Modals** | `role="dialog"` | All modals have `aria-modal`, `aria-labelledby`, focus traps |
| **Live** | 4.1.3 Status Messages | Activity log uses `role="log"` + `aria-live="polite"` |
| **Motion** | 2.3.3 Animation | `prefers-reduced-motion` kills all animation/transition |

### Focus Trap Pattern

```typescript
import { trapFocus } from '../utils/focus-trap.js';

// On modal open
const release = trapFocus(modalElement, { returnFocusTo: triggerButton });

// On modal close
release();
```

---

## Component Patterns

### Glass Panel

```css
.glass-panel {
  background: var(--bg-glass-strong);
  backdrop-filter: blur(24px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
```

### Edit Affordance

Edit pencils are always visible at low opacity (0.3), brightening on hover/focus:

```css
.edit-pencil {
  opacity: 0.3;        /* Always visible */
  /* NOT opacity: 0 — invisible to keyboard/touch users */
}
.editable:hover .edit-pencil,
.edit-pencil:focus-visible {
  opacity: 0.7;
}
```

### Activity Log Type Icons

Each log entry type has an SVG icon prefix alongside the color indicator:

| Type | Icon | Color |
|------|------|-------|
| Success | `check` | `--color-success` |
| Error | `xMark` | `--color-error` |
| Warning | `warning` | `--color-warning` |
| Info | `info` | `--accent-secondary` |

---

## Anti-Pattern Checklist

- [ ] Don't use `opacity: 0` for interactive elements (use 0.3+ minimum)
- [ ] Don't suppress `outline: none` without providing replacement focus indicator
- [ ] Don't use `<div @click>` for interactive elements — use `role="button" tabindex="0"`
- [ ] Don't rely on color alone to convey information
- [ ] Don't use emoji for UI chrome icons
- [ ] Don't create modals without `role="dialog"`, `aria-modal`, and focus traps
- [ ] Don't use hover-only affordances without touch/keyboard alternatives
