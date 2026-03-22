# Rendering Engine — Design Document

> Status: Draft
> Date: 2026-03-22

## Vision

A universal rendering engine that makes every UI element in Beam visually alive. Transitions, depth, and animation are **not slide-specific** — they are rendering primitives available to every component: result panels, dashboard cards, sidebar items, format blocks, and slides alike.

Any photon format (table, chart, code, mermaid, metric) is a building block that can declare how it enters, exits, and sits in visual space. Slides are just one composition mode of these blocks. The same primitives make a dashboard card fade in on load, a chart zoom out on removal, or a metric tilt with perspective in a panel.

No external presentation framework dependency. We own the full stack.

## Architecture

```
Photon Method
  │  returns markdown or structured data
  │  tagged with @format slides
  ▼
Server-Side Pipeline
  │  Split markdown on ---
  │  Parse frontmatter (theme, transitions, layout)
  │  Render each slide's markdown → HTML (our existing pipeline)
  │  Return structured data: { slides[], theme, config }
  ▼
Transport Layer
  ├─ Beam → Full visual rendering (transitions, effects, 3D, mattes)
  ├─ CLI  → Text fallback (slide content as plain text)
  ├─ MCP  → Structured JSON (slides array for any client)
  ├─ PDF  → Headless capture of rendered slides
  └─ Video → Frame capture with effects rendered
```

## Universal Animation Primitives

These are rendering-level primitives, not slide features. Any UI element in Beam can use them.

### Enter / Exit Lifecycle

Every rendered element can declare behavior for three lifecycle phases:

| Phase | When | Example |
|-------|------|---------|
| `enter` | Element appears in DOM | Fade in, slide up, scale from 0 |
| `present` | Element is visible and stable | Subtle float, pulse, perspective tilt |
| `exit` | Element is removed from DOM | Fade out, shrink, slide away |

Declaration via CSS classes or data attributes:

```html
<!-- Any Beam component -->
<div data-enter="fade-in" data-exit="zoom-out" data-depth="tilt(-3, 2)">
  ...content...
</div>
```

The rendering engine observes element insertion/removal (MutationObserver or View Transitions API) and applies the declared animations automatically.

### Available Effects

**Enter effects:**
| Name | CSS | Use anywhere |
|------|-----|-------------|
| `fade-in` | `opacity: 0 → 1` | Result panels, cards, slides |
| `slide-up` | `translateY(20px) → 0` + fade | List items, notifications |
| `slide-in` | `translateX(-20px) → 0` + fade | Sidebar items, tabs |
| `scale-in` | `scale(0.9) → 1` + fade | Charts, images, modals |
| `stagger` | Sequential delay on children | Lists, grids, table rows |
| `typewriter` | Characters appear sequentially | Headings, status text |
| `flip-in` | `rotateY(90deg) → 0` | Cards, panels |

**Exit effects:**
| Name | CSS |
|------|-----|
| `fade-out` | `opacity: 1 → 0` |
| `slide-down` | `translateY(0) → 20px` + fade |
| `scale-out` | `scale(1) → 0.9` + fade |
| `zoom-out` | `scale(1) → 0.5` + fade |
| `flip-out` | `rotateY(0) → -90deg` |

**Persistent effects (while visible):**
| Name | CSS |
|------|-----|
| `float` | Gentle Y oscillation |
| `pulse` | Subtle scale breathing |
| `glow` | Box-shadow pulse |

### Depth and Perspective

Any element can declare depth placement:

```html
<div data-depth="tilt(-5, 2)">        <!-- rotateY(-5deg) rotateX(2deg) -->
<div data-depth="front">              <!-- translateZ(30px) -->
<div data-depth="back">               <!-- translateZ(-20px), slight blur -->
<div data-depth="float">              <!-- translateZ(15px) + shadow -->
```

The parent container gets `perspective: 1200px` automatically when any child declares depth.

### Matte Transitions

For transitions between any two states (not just slides — could be tab switches, panel replacements, route changes):

```html
<div data-transition="matte:splash">
```

The engine captures the outgoing state as a bitmap, applies a grayscale mask to reveal the incoming state. Works anywhere two views swap.

### Implementation

These primitives are implemented as a single CSS file + a small JS observer (~2KB):

```
src/auto-ui/frontend/styles/motion.css    — keyframes and effect classes
src/auto-ui/frontend/services/motion.ts   — MutationObserver that applies effects
```

The observer watches for `data-enter`, `data-exit`, `data-depth` attributes on any element and applies the corresponding CSS classes. Components don't need to import anything — just add the data attributes.

**Reduced motion**: All effects respect `prefers-reduced-motion: reduce`. When active, elements appear/disappear instantly with no animation.

---

## Slides-Specific Concepts

The slide format builds on top of these universal primitives. Everything below uses the same enter/exit/depth/matte system — slides just add composition (layouts, navigation, sequencing).

### 1. Blocks

A block is the smallest renderable unit. Every existing `@format` is a block:

- `text` — rendered markdown/HTML
- `code` — syntax-highlighted code
- `table` — structured data table
- `chart:bar`, `chart:line` — data visualization
- `mermaid` — diagrams
- `metric`, `gauge` — single-value displays
- `photon-output` — live output from any photon method call
- `image`, `video` — media

Blocks are the same renderers we already have. No new abstraction needed.

### 2. Slides

A slide is a composition of blocks with a layout:

```markdown
---
layout: two-column
transition: fade
---

## Revenue Growth

::left::
@chart:bar revenue-data

::right::
Key takeaways:
- 40% YoY growth
- APAC leading
```

Layout types:
- `default` — single column, centered
- `two-column` — side by side (::left:: / ::right::)
- `title` — large heading centered
- `image` — full-bleed background
- `grid` — CSS grid with named areas
- `blank` — no chrome, free positioning

### 3. Subsections (Vertical Navigation)

Slides can contain subsections for deep-dive content. The main flow is horizontal navigation. Pressing down enters a subsection (vertical). Pressing right skips to the next top-level slide.

```markdown
---
# Slide 1: Overview
---

High-level summary.

--v--

### Detail A

Deep dive into A.

--v--

### Detail B

Deep dive into B.

---
# Slide 2: Next Topic
---
```

Separator convention:
- `---` = new slide (horizontal)
- `--v--` = new subsection (vertical, nested under current slide)

Navigation:
- Left/Right = previous/next top-level slide
- Up/Down = navigate within subsections
- Visual indicator shows subsection depth (dots below slide counter)

### 4. Transitions

Three tiers of visual effects, all CSS-based, zero dependencies:

#### Tier 1: Transform Transitions

Applied between slides using View Transitions API + CSS transforms.

| Name | Effect |
|------|--------|
| `fade` | Opacity crossfade |
| `slide` | Horizontal slide left/right |
| `slide-up` | Vertical slide up |
| `zoom` | Scale from center |
| `flip` | 3D card flip |
| `rotate` | 3D rotation on Y axis |
| `none` | Instant cut |

Declared per-slide in frontmatter or markdown comments:

```markdown
<!-- transition: flip -->
```

#### Tier 2: Alpha Matte Transitions

A grayscale image masks the incoming slide. White reveals first, black reveals last.

```css
.slide-incoming {
  mask-image: url('/transitions/water-splash.png');
  mask-size: 0% auto;
  animation: matte-reveal 1.2s ease-out forwards;
}
```

Built-in matte library (shipped as PNGs):
- `splash` — water splash reveal
- `dissolve` — organic dissolve
- `paint` — paint stroke wipe
- `smoke` — smoke/fog reveal
- `shatter` — glass break pattern
- `radial` — circular reveal from center
- `diagonal` — diagonal wipe

Declared via:
```markdown
<!-- transition: matte:splash -->
```

Animated mattes (WebM video masks) for flowing effects:
```markdown
<!-- transition: matte:water-flow -->
```

#### Tier 3: Depth and Camera Feel

CSS perspective + transforms create cinematic depth without any 3D library.

```css
.slide-container {
  perspective: 1200px;
}

.element-hero {
  transform: rotateY(-5deg) rotateX(2deg) translateZ(30px);
}

.element-background {
  transform: translateZ(-20px) scale(1.05);
  opacity: 0.7;
}
```

Effects:
- **Tilt** — slight rotation suggesting a camera angle
- **Depth layers** — elements at different Z positions
- **Parallax** — background moves slower than foreground on transition
- **Focus pull** — blur shifts between elements (CSS `filter: blur()`)

Declared via slide-level or element-level directives:

```markdown
<!-- depth: tilt(-5, 2) -->

## Title {depth: front}

Background text {depth: back, blur: 2px}
```

### 5. Element-Level Animations

Individual elements within a slide can animate on entry:

| Name | Effect |
|------|--------|
| `fade-in` | Opacity 0 → 1 |
| `slide-up` | Translate from below + fade |
| `slide-in` | Translate from side + fade |
| `typewriter` | Characters appear sequentially |
| `scale-in` | Scale from 0 → 1 |
| `stagger` | Sequential reveal of list items |

Declared via inline directives:

```markdown
## Title {animate: fade-in}

- Point one {animate: stagger}
- Point two
- Point three
```

### 6. Embedded Format Blocks

Any `@format` output can be embedded in a slide. This is the key differentiator — live photon output inside presentations.

```markdown
---
## System Status

Current metrics:

@embed photon-name/method-name --format gauge
@embed photon-name/other-method --format chart:line

These update in real-time during the presentation.
```

The `@embed` directive calls a photon method and renders its output using the specified format renderer. In Beam, these are live. In PDF/video export, they're captured at render time.

## Server-Side Pipeline

### Slide Parsing

The server receives raw markdown from a photon method tagged `@format slides`:

1. **Split** — Parse frontmatter, split on `---` (horizontal) and `--v--` (vertical)
2. **Render** — Each slide's markdown → HTML using existing markdown pipeline (with code highlighting via shiki/our existing highlighter)
3. **Extract directives** — Parse `<!-- transition: -->`, `{animate: }`, `{depth: }` from HTML comments and attributes
4. **Structure** — Return structured data:

```typescript
interface SlidesDeck {
  theme: string;
  config: Record<string, string>;  // frontmatter key-values
  slides: SlideGroup[];
}

interface SlideGroup {
  main: Slide;
  subsections: Slide[];  // vertical slides
}

interface Slide {
  html: string;          // pre-rendered HTML
  layout: string;        // layout type
  transition: string;    // transition name
  animations: string[];  // element animation directives
  depth: string;         // depth/camera directive
  notes: string;         // speaker notes
}
```

### Runtime Dependency

The markdown → HTML rendering uses our existing pipeline. No Marp dependency. Code highlighting uses our existing highlighter. Math rendering (if needed) can use KaTeX as an optional runtime dependency.

The transition mattes (PNG/WebM files) ship as static assets with the runtime, served via the existing `/api/assets/` endpoint.

## Client-Side Rendering

### Beam (Full Effects)

The `@format slides` renderer in `result-viewer.ts` becomes a thin composition layer:

1. Receives pre-rendered HTML per slide from server
2. Injects HTML into a 16:9 viewport container
3. Applies CSS zoom to scale content to fill viewport
4. Handles navigation (horizontal + vertical subsections)
5. Applies transitions between slides (View Transitions API + mask-image)
6. Applies element animations on slide entry
7. Applies depth/perspective transforms
8. Handles fullscreen, keyboard shortcuts

### CLI (Text Fallback)

Renders slides as numbered text sections:

```
━━━ Slide 1 of 5 ━━━

# Revenue Growth

- 40% YoY growth
- APAC leading

━━━ Slide 2 of 5 ━━━
...
```

### MCP (Structured Data)

Returns the `SlidesDeck` JSON structure so any MCP client can render slides however it wants.

## Export Targets

### PDF Export

1. Render each slide in headless Chrome at 1920×1080
2. Capture as image
3. Assemble into PDF (one slide per page)
4. Triggered via `photon cli slides export --format pdf`

### Video Export (Future)

1. Render each slide + transitions in headless Chrome
2. Capture frames at target FPS
3. Assemble via ffmpeg (or hand off to Remotion for complex compositions)
4. AI-generated narration audio can be synced to slide timing
5. Triggered via `photon cli slides export --format video`

## Transition Asset Library

Ships with the runtime at `assets/transitions/`:

```
assets/transitions/
  mattes/
    splash.png
    dissolve.png
    paint.png
    smoke.png
    shatter.png
    radial.png
    diagonal.png
  animated/
    water-flow.webm
    ink-drop.webm
```

Served via `/api/assets/transitions/` for client-side `mask-image` references.

## Implementation Order

1. **Server-side slide parsing** — Split, render, structure (replaces Marp dependency)
2. **Client-side viewer rewrite** — Thin HTML viewer with CSS zoom scaling
3. **Tier 1 transitions** — View Transitions API (fade, slide, flip, zoom)
4. **Element animations** — Stagger, fade-in, slide-up on entry
5. **Subsection navigation** — Vertical slides with --v-- separator
6. **Tier 2 matte transitions** — mask-image with PNG mattes
7. **Depth/perspective** — CSS 3D transforms
8. **Embedded format blocks** — @embed directive for live photon output
9. **PDF export** — Headless capture
10. **Video export** — Frame capture + ffmpeg assembly
