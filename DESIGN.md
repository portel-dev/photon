# Design System — Photon

## Product Context
- **What this is:** Open source TypeScript runtime that turns a single .ts file into MCP server + CLI + web UI
- **Who it's for:** Developers building AI-powered tools
- **Space/industry:** Developer tools, MCP ecosystem, AI infrastructure
- **Project type:** Runtime with web dashboard (Beam), CLI, and embeddable views
- **Primary visual surface:** Beam (localhost web dashboard with iframe app views)

## Aesthetic Direction
- **Direction:** Precision Optics
- **Decoration level:** Intentional — no glass/blur. Subtle grain texture on surfaces, 1px directional borders (top/left brighter), selective glow on active states only
- **Mood:** A scientific instrument that produces light, not reflects it. Calm, authoritative, alive. Beam should feel like a runtime console, not a marketing page.
- **Design thesis:** Light is a signal, not decoration. Every amber glow means something is active, selected, or needs attention.

### Anti-patterns (never use)
- Purple/violet gradients (AI slop — every tool uses these now)
- Glassmorphism / backdrop-filter blur
- 3-column icon grids with colored circles
- Centered-everything layouts
- Decorative ambient blobs or bokeh
- Generic stock-photo hero sections

## Typography
- **Display/Hero:** Sora — future-facing geometric with optical curves that evoke light particles. Not as generic as Space Grotesk.
- **Body:** DM Sans (with tabular-nums for data) — clean readability at small sizes, better than Inter for text-dense dashboards
- **UI/Labels:** Azeret Mono — monospace for navigation, metadata, timestamps, badges. This makes Beam feel like a runtime console.
- **Code:** Berkeley Mono (fallback: JetBrains Mono, Fira Code) — sharper and more editorial than JetBrains Mono
- **Loading:** Google Fonts for Sora, DM Sans, Azeret Mono. Berkeley Mono is licensed/self-hosted or falls back.
- **Scale:** 14px base, modular scale 1.2 (minor third)
  - 3xl: 2rem (32px) — page titles
  - 2xl: 1.5rem (24px) — section headers
  - xl: 1.25rem (20px) — panel titles
  - lg: 1.1rem (17.6px) — method names
  - md: 0.9rem (14.4px) — body text
  - sm: 0.8rem (12.8px) — secondary text
  - xs: 0.7rem (11.2px) — metadata, timestamps

### Token mapping
```
--font-display: 'Sora', 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif
--font-sans:    'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif
--font-mono:    'Berkeley Mono', 'JetBrains Mono', 'Fira Code', monospace
```

Azeret Mono is used directly in component styles for labels/badges/nav — it does not replace `--font-mono` (which is for code blocks).

## Color

### Approach: Restrained + one electric accent
Electric amber (#FFB000) as the sole accent. Nobody in the dev tools space uses warm amber — it reads as energy/light/warmth (photon!) without the AI-purple or Supabase-green cliches.

### Dark Theme (Default)
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-app` | `#0B1018` | App background (deep ocean) |
| `--bg-glass` | `hsla(215, 25%, 12%, 0.6)` | Panel backgrounds (opaque, no blur) |
| `--bg-glass-strong` | `hsla(215, 25%, 12%, 0.85)` | Elevated panels |
| `--bg-panel` | `#131B28` | Card/panel surface |
| `--t-primary` | `#F0EDE6` | Primary text (warm white) |
| `--t-muted` | `#6B8A8A` | Secondary text (steel-teal) |
| `--border-glass` | `hsla(210, 20%, 50%, 0.12)` | Default border |
| `--accent-primary` | `#FFB000` | Primary accent (electric amber) |
| `--accent-secondary` | `#78E6FF` | Secondary accent (cool cyan) |
| `--glow-primary` | `rgba(255, 176, 0, 0.3)` | Accent glow for focus/active |
| `--color-error` | `#FF6B6B` | Error (coral, not pure red) |
| `--color-success` | `#58D68D` | Success |
| `--color-warning` | `#FFB347` | Warning (amber family) |
| `--color-info` | `var(--accent-secondary)` | Info (cool cyan) |
| `--cli-bg` | `#080C12` | Terminal background |
| `--cli-text` | `#58D68D` | Terminal text (green) |

### Light Theme
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-app` | `#EEF1F5` | App background (mineral paper) |
| `--bg-glass` | `rgba(255, 255, 255, 0.75)` | Panel backgrounds |
| `--bg-glass-strong` | `rgba(255, 255, 255, 0.9)` | Elevated panels |
| `--bg-panel` | `#FFFFFF` | Card/panel surface |
| `--t-primary` | `#0D1420` | Primary text (dark ink) |
| `--t-muted` | `#5F6B7A` | Secondary text |
| `--border-glass` | `rgba(100, 120, 150, 0.15)` | Default border |
| `--accent-primary` | `#D98A00` | Primary accent (deeper amber for contrast) |
| `--accent-secondary` | `#0EA5C6` | Secondary accent (teal) |
| `--glow-primary` | `rgba(217, 138, 0, 0.15)` | Accent glow |
| `--color-error` | `#D64545` | Error |
| `--color-success` | `#1F9D68` | Success |
| `--color-warning` | `#D98A00` | Warning |
| `--color-info` | `var(--accent-secondary)` | Info |

### OKLCH Preset
The amber direction maps to an OKLCH preset with approximately:
- Hue: 75 (amber/gold range)
- Chroma: 0.15
- Lightness: follows existing preset structure

### iframe Token Injection
Color tokens flow to iframe app views via MCP Apps protocol:
1. `ui/initialize` handshake — host responds with `hostContext.styles.variables`
2. `ui/notifications/host-context-changed` — push on theme change
3. Bridge script applies via `document.documentElement.style.setProperty()`

All existing token NAMES stay unchanged. Only VALUES change. The `getBeamThemeTokens()` override in both `custom-ui-renderer.ts` and `mcp-app-renderer.ts` must be updated to use the new surface colors so iframes blend with Beam chrome.

## Surface Treatment
Replace glass/blur with precision surfaces:

```css
/* OLD — kill this */
.glass {
  backdrop-filter: blur(16px);
}

/* NEW — precision surface */
.glass {
  background: var(--bg-glass);
  border: 1px solid var(--border-glass);
  /* Directional brightness: top-left edges slightly brighter */
  border-top-color: color-mix(in srgb, var(--border-glass) 100%, white 8%);
  border-left-color: color-mix(in srgb, var(--border-glass) 100%, white 5%);
  box-shadow: var(--shadow-sm);
}
```

Grain texture: applied via CSS `background-image` with SVG feTurbulence noise at very low opacity (0.03 dark, 0.015 light). Applied once at the app root level.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

No changes from current values. Token names unchanged.

## Layout
- **Approach:** Keep existing layout as-is
- **No structural changes** — sidebar, main area, telemetry panels stay in current positions
- **Border radius:** Keep current scale: xs(4px) sm(6px) md(12px) lg(18px) full(9999px)

## Motion
- **Approach:** Minimal-functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms) long(400-700ms)
- **Special:** Subtle pulse animation on active tool invocations (accent glow breathe)
- **Reduced motion:** Respect `prefers-reduced-motion: reduce` (already implemented)

## Implementation Guide

### Files to modify
| File | Change |
|------|--------|
| `src/auto-ui/frontend/components/beam-app.ts` | Dark + light theme token values |
| `src/auto-ui/frontend/styles/theme.ts` | Font stacks, `.glass`/`.glass-panel` classes (remove blur, add directional borders) |
| `src/auto-ui/frontend/styles/beam-tokens.ts` | `--font-display` value |
| `src/auto-ui/frontend/components/custom-ui-renderer.ts` | `getBeamThemeTokens()` surface overrides |
| `src/auto-ui/frontend/components/mcp-app-renderer.ts` | `getBeamThemeTokens()` surface overrides |
| `src/auto-ui/frontend/index.html` | Google Fonts `<link>` tags for Sora, DM Sans, Azeret Mono |
| `photon-core/src/design-system/tokens.ts` | `colorsDark`/`colorsLight` base palette |
| `photon-core/src/design-system/oklch.ts` | New amber OKLCH preset |

### What stays unchanged
- All CSS variable NAMES
- MCP Apps protocol (ui/initialize, host-context-changed)
- Bridge script injection mechanism
- Layout structure, component placement
- Spacing scale, radius scale
- `@portel/photon-core/design-system/tokens` export API

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-12 | Amber accent (#FFB000) replaces purple (#7C3AED) | Purple is overused in AI tools. Amber reads as light/energy, fits "photon" brand. Codex + Claude subagent both agreed: kill purple. |
| 2026-04-12 | Sora replaces Space Grotesk for display | More optical, future-facing curves. Space Grotesk is now common in dev tools. |
| 2026-04-12 | DM Sans replaces Inter for body | Better at small sizes in data-dense dashboards. Inter is overused. |
| 2026-04-12 | Azeret Mono for UI labels/nav/metadata | Makes Beam feel like a runtime console. Monospace discipline for non-code UI is the key differentiator. |
| 2026-04-12 | Kill glass/blur, add precision surfaces | Glass is a 2023 trend. Precision surfaces (grain, directional borders, selective glow) feel like infrastructure. Both outside voices agreed. |
| 2026-04-12 | Mineral paper light theme replaces warm cream | Cool mineral (#EEF1F5) reads faster and more professional than nostalgic parchment (#eae4dd). |
| 2026-04-12 | Keep existing layout unchanged | User confirmed happy with current element placement. Design system is aesthetic-only. |
| 2026-04-12 | Token names unchanged, values only | Existing MCP Apps protocol, bridge injection, and iframe token flow must not break. |
