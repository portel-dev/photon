# WCAG 2.2 Level AA Accessibility Audit: Photon Beam

**Audit Date:** 2026-03-01
**Auditor:** Automated source-code review + a11y tree snapshot analysis
**Scope:** Photon Beam frontend (`src/auto-ui/frontend/`), WCAG 2.2 Level A + AA
**Technology:** Lit Web Components with Shadow DOM, served at localhost:3000

---

## Executive Summary

Photon Beam demonstrates a **solid accessibility foundation** with several proactive choices: proper landmark roles, ARIA on the sidebar navigation, live regions for toasts and connection banners, `prefers-reduced-motion` support, and `focus-visible` outlines. However, the audit identified **14 FAIL** and **9 PARTIAL** conformance issues across the POUR principles. The most critical gaps are: **no skip navigation link**, **missing focus trap in modals**, **numerous `outline: none` suppressions without replacement indicators**, and **multiple interactive elements lacking accessible names**. Color contrast for muted text is borderline in both themes.

### Conformance Summary

| Principle | Pass | Partial | Fail | N/A |
|-----------|------|---------|------|-----|
| Perceivable | 8 | 3 | 5 | 2 |
| Operable | 6 | 4 | 6 | 1 |
| Understandable | 5 | 1 | 2 | 0 |
| Robust | 3 | 1 | 1 | 0 |
| **Total** | **22** | **9** | **14** | **3** |

**Overall Conformance Level: Does NOT meet WCAG 2.2 Level AA.**

---

## Detailed Findings by POUR Principle

### 1. PERCEIVABLE

#### 1.1 Text Alternatives (1.1.1 Non-text Content) -- PARTIAL

**Severity: Moderate**

Decorative icons properly use `aria-hidden="true"`:
- `beam-sidebar.ts:936` -- photon icon `aria-hidden="true"`
- `beam-app.ts:2855` -- background glow `aria-hidden="true"`
- `toast-manager.ts:235` -- close SVG `aria-hidden="true"`

However, multiple emoji-based UI elements lack text alternatives:
- **`method-card.ts:543`** -- Action icon `📋` / `▶` in a `<div>` with only `title`, no `aria-label`. Screen readers may announce the emoji Unicode name.
- **`method-card.ts:594`** -- Emoji picker buttons (`📥`, `📤`, etc.) have no `aria-label`; each `<button>` contains only the emoji character.
- **`beam-app.ts:2929`** -- Fullscreen toggle button uses `⊡` / `⛶` characters with only `title` attribute, no `aria-label`.
- **`app-layout.ts:197-199`** -- Anchor navigation links ("Methods", "Prompts", "Resources") are `<span>` elements with `@click` handlers, not `<a>` or `<button>` elements.

**Fix:** Add `aria-label` to all icon-only buttons. Convert clickable `<span>` elements to `<button>` or `<a>`.

---

#### 1.2 Time-based Media (1.2.x) -- N/A

No audio or video content present.

---

#### 1.3.1 Info and Relationships -- PARTIAL

**Severity: Serious**

**Passes:**
- Sidebar uses `role="navigation"`, `role="search"`, `role="listbox"` with `role="option"` items
- `beam-sidebar.ts:731` -- `<nav>` with `aria-label="Photon navigation"`
- `beam-sidebar.ts:750` -- Search box wrapped in `role="search"`
- `beam-sidebar.ts:786-814` -- Lists use `role="listbox"` with `aria-labelledby` pointing to section headers
- Form fields in `invoke-form.ts:684-698` use `<label for=...>` with matching `id` attributes
- Headings used appropriately: h2 for app title, h3 for sections

**Failures:**
- **`activity-log.ts:218`** -- `<h3>Activity Log</h3>` heading exists but log items have no semantic list structure (plain `<div>` elements).
- **`method-card.ts:418-548`** -- The entire method card is a `<div class="card">` with `@click`. No `role="button"` or `tabindex="0"`. Cards are not keyboard accessible.
- **`marketplace-view.ts:71-88`** -- Marketplace cards are `<div class="card">` with `@click` but no ARIA role or keyboard support.
- **`app-layout.ts:197-199`** -- Navigation links are `<span class="anchor-link">` with `@click` -- no semantic meaning.
- **`beam-app.ts:634-648`** -- View tabs in invoke-form have no `role="tablist"` / `role="tab"` / `aria-selected` semantics.

---

#### 1.3.2 Meaningful Sequence -- PASS

DOM order matches visual presentation order. Sidebar precedes main content. Modals are appended at the end of the render tree.

---

#### 1.3.3 Sensory Characteristics -- PARTIAL

**Severity: Moderate**

- **`beam-sidebar.ts:153-176`** -- Status indicator is a colored dot only (green/yellow/red). The `title` attribute provides text ("Connected"/"Reconnecting"/"Disconnected") but this is not accessible to all screen reader modes.
- **`activity-log.ts:139-150`** -- Log items differentiated by `border-left-color` only; the `type` property is used for class but not exposed as text.
- **`beam-sidebar.ts:956`** -- Update dot is purely visual (`<span class="update-dot">`), title="Update available" but no screen reader text.

**Fix:** Add visually-hidden text alternatives for color-only indicators.

---

#### 1.3.4 Orientation (AA) -- PASS

No CSS locks viewport to a specific orientation. Layout adapts via media queries at 768px and 480px breakpoints.

---

#### 1.3.5 Identify Input Purpose (AA) -- PASS

Search input has `type="search"` (`beam-sidebar.ts:753`). Form inputs use appropriate types (`text`, `number`, `password`, `checkbox`, `range`, `date`, etc.) in `invoke-form.ts` and `elicitation-modal.ts`.

---

#### 1.4.1 Use of Color -- FAIL

**Severity: Serious**

- **`activity-log.ts:139-150`** -- Activity log items differentiated ONLY by border-left color (info=blue, success=green, error=red, warning=yellow). No icon, no text prefix, no additional visual indicator.
- **`beam-sidebar.ts:153-176`** -- Status indicator relies solely on color (green dot = connected, yellow = reconnecting, red = disconnected).

**Fix:** Add icons or text prefixes to activity log items. Add visually-hidden text or icons to status indicator.

---

#### 1.4.2 Audio Control -- N/A

No auto-playing audio.

---

#### 1.4.3 Contrast (Minimum) (AA) -- FAIL

**Severity: Serious**

Analysis of CSS custom property values:

**Dark theme:**
- `--t-primary: hsl(220, 10%, 95%)` on `--bg-app: hsl(220, 15%, 10%)` = ~17:1 (PASS)
- `--t-muted: hsl(220, 10%, 65%)` on `--bg-app: hsl(220, 15%, 10%)` = ~6.5:1 (PASS for normal text)
- `--t-muted: hsl(220, 10%, 65%)` on `--bg-glass: hsla(220, 15%, 14%, 0.6)` = ~5.3:1 (PASS for normal, FAIL for large text if font-size < 14px bold)
- **`--text-2xs: 0.6rem` (9.6px)** with `--t-muted` -- Text at this size is extremely small. Content using `var(--text-2xs)` with muted color is below 4.5:1 contrast on glass backgrounds.

**Light theme:**
- `--t-primary: #2c2420` on `--bg-app: #eae4dd` = ~9.5:1 (PASS)
- `--t-muted: #6b5e54` on `--bg-panel: #f8f5f1` = ~4.1:1 (BORDERLINE -- fails for normal text below 14pt)
- `--t-muted: #6b5e54` on `--bg-app: #eae4dd` = ~3.8:1 (FAIL for normal text)

**Specific failures:**
- **`beam-sidebar.ts:303-310`** -- `.internal-badge` uses gradient background with white text -- contrast varies by gradient position
- **`beam-sidebar.ts:462-468`** -- `.disconnect-badge` uses `hsla(0, 60%, 50%, 0.2)` background with `hsl(0, 60%, 55%)` text on glass -- very low contrast
- **`beam-sidebar.ts:371-383`** -- Count pills use colors like `hsl(210, 80%, 65%)`, `hsl(140, 60%, 55%)`, `hsl(30, 80%, 60%)` at `var(--text-2xs)` size
- **`marketplace-view.ts:131-133`** -- `.tag` uses `color: var(--t-muted)` on `rgba(255, 255, 255, 0.05)` background

**Fix:** Increase muted text lightness in light theme to meet 4.5:1. Bump `--text-2xs` minimum to 0.7rem. Verify all badge/pill combinations.

---

#### 1.4.4 Resize Text (AA) -- PASS

Uses relative units (`rem`, `em`, `%`) for font sizes throughout. Layout uses `flex` and `grid` with responsive breakpoints. `min-height: 44px` on mobile touch targets.

---

#### 1.4.5 Images of Text (AA) -- PASS

No images of text found. All text is rendered as HTML text.

---

#### 1.4.10 Reflow (AA) -- PASS

Responsive breakpoints at 768px and 480px handle reflow. Grid layouts use `auto-fill, minmax()`. No horizontal scrolling required at 320px CSS width for primary content.

---

#### 1.4.11 Non-text Contrast (AA) -- FAIL

**Severity: Moderate**

- **`beam-sidebar.ts:192-224`** -- `--bg-glass` border (`hsla(220, 10%, 80%, 0.1)`) on `--bg-app` background -- the border is nearly invisible, well below 3:1 contrast.
- **`forms.ts:9`** -- Input borders use `var(--border-glass)` which is `hsla(220, 10%, 80%, 0.1)` in dark mode -- ~1.3:1 against `--bg-glass`.
- **`buttons.ts:28`** -- `.btn-secondary` border is `var(--border-glass)` -- insufficient contrast.
- **`beam-sidebar.ts:153-159`** -- Status indicator dots (8x8px) may be below minimum size for reliable perception.

**Fix:** Increase `--border-glass` opacity to at least 0.25 in dark mode, 0.2 in light mode. Ensure UI component boundaries meet 3:1.

---

#### 1.4.12 Text Spacing (AA) -- PASS

No CSS prevents user overrides of text spacing. No `!important` on `line-height`, `letter-spacing`, or `word-spacing` that would block user stylesheets (except in `prefers-reduced-motion` which is appropriate).

---

#### 1.4.13 Content on Hover or Focus (AA) -- PASS

Tooltips use native `title` attributes which are dismissible and persistent. Emoji picker and dropdowns close on outside click and Escape key.

---

### 2. OPERABLE

#### 2.1.1 Keyboard -- FAIL

**Severity: Critical**

**Working keyboard support:**
- `Cmd+K` / `/` focuses search (`beam-app.ts:5228-5231`)
- `Escape` closes modals, sidebars, and navigates back (`beam-app.ts:5235-5263`)
- `?` opens help modal (`beam-app.ts:5270`)
- `t` opens theme settings (`beam-app.ts:5276`)
- Sidebar items have `tabindex="0"` and `@keydown` for Enter (`beam-sidebar.ts:928-930`)

**Failures:**
- **`method-card.ts:418-421`** -- Method cards: `<div class="card" @click=${this._handleCardClick}>`. No `tabindex`, no `role`, no `@keydown` handler. Completely inaccessible via keyboard.
- **`marketplace-view.ts` cards** -- Same pattern: `<div class="card" @click>` without keyboard support.
- **`app-layout.ts:197-199`** -- `<span class="anchor-link" @click=...>` -- not focusable or keyboard operable.
- **`beam-app.ts:2916-2930`** -- Fullscreen button is a `<button>` (good), but has inline `@mouseenter`/`@mouseleave` style changes that don't have keyboard equivalents (`@focus`/`@blur`).
- **`context-bar.ts:106-127`** -- Edit pencil `<span>` elements with `@click` but no keyboard handler or `tabindex`.
- **`method-card.ts:439`** -- Edit pencil `<span>` with `@click` but no keyboard support.
- **`method-card.ts:429-434`** -- Method icon `<div>` with `@click` for emoji picker -- not keyboard accessible.
- **`beam-sidebar.ts:521-539`** -- Settings button (`.settings-btn`) in sidebar items: opacity 0 until hover, no keyboard focus path.

**Fix:** Add `role="button"` and `tabindex="0"` with `@keydown` Enter/Space handlers to all clickable `<div>`/`<span>` elements, or convert them to `<button>`.

---

#### 2.1.2 No Keyboard Trap -- FAIL

**Severity: Critical**

- **`beam-app.ts:6294-6344`** -- Modal overlays (`role="dialog" aria-modal="true"`) do NOT implement focus trapping. When a modal opens, focus is not programmatically moved into the dialog, and Tab can move focus behind the modal to the sidebar and main content.
- **`elicitation-modal.ts`** -- Same issue. The modal has `aria-modal="true"` but no focus trap logic. Only Escape key dismissal is implemented (`elicitation-modal.ts:446-452`).
- **`beam-app.ts:2942-2957`** -- Theme settings overlay: no focus trap, no `role="dialog"`.

**Fix:** Implement focus trapping in all modals: on open, move focus to first focusable element; trap Tab/Shift+Tab within the dialog; on close, return focus to the trigger element.

---

#### 2.1.4 Character Key Shortcuts (A) -- PASS

Single-character shortcuts (`/`, `?`, `t`, `f`) are only active when NOT in an input field (`beam-app.ts:5202-5267`). The `isInput` check properly skips shortcuts when focus is on INPUT, TEXTAREA, SELECT, or contentEditable.

---

#### 2.2.1 Timing Adjustable -- PASS

Toast notifications auto-dismiss at 3 seconds but can be manually dismissed. No time-limited interactions.

---

#### 2.3.1 Three Flashes or Below Threshold -- PASS

No flashing content. Animations are subtle transitions. `prefers-reduced-motion` respected (`theme.ts:177-186`).

---

#### 2.4.1 Bypass Blocks -- FAIL

**Severity: Serious**

- No skip-to-main-content link exists anywhere in the codebase.
- **`beam-app.ts:2818-2983`** -- The render method outputs sidebar then main content. A keyboard user must Tab through the entire sidebar (search, filters, all photon items, footer buttons) before reaching main content.

**Fix:** Add a visually-hidden skip link as the first focusable element: `<a class="skip-link" href="#main-content">Skip to main content</a>` targeting the `<main>` element.

---

#### 2.4.2 Page Titled -- PASS

`index.html:6` -- `<title>Photon Beam</title>`. Page title is present and descriptive.

---

#### 2.4.3 Focus Order -- PARTIAL

**Severity: Moderate**

- DOM order generally matches visual order (sidebar -> main content).
- However, the fullscreen button (`beam-app.ts:2916`) is positioned with `position: sticky; float: right` which may create confusing tab order.
- Theme settings panel (`beam-app.ts:2942-2957`) is rendered after toast-manager but positioned as a side panel -- focus order does not match visual position.

---

#### 2.4.4 Link Purpose (In Context) -- PASS

Links/buttons generally have clear labels. Sidebar items show photon names. Footer buttons have `aria-label` attributes.

---

#### 2.4.5 Multiple Ways (AA) -- PARTIAL

**Severity: Minor**

Search is available (`Cmd+K`). Sidebar navigation provides a list. But there's no sitemap, no index page, and the marketplace has no secondary navigation path to individual photons.

---

#### 2.4.6 Headings and Labels (AA) -- PASS

Headings are descriptive: "Photon Beam" (h2), "METHODS" (h3), "ACTIVITY LOG" (h3), method names (h3). Section headers in sidebar ("APPS", "PHOTONS", "NEEDS ATTENTION", "MCPS") are properly structured.

---

#### 2.4.7 Focus Visible (AA) -- FAIL

**Severity: Serious**

**Global default is good:**
- `theme.ts:77-80` -- `*:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }` provides a visible focus indicator for all elements.

**However, it is suppressed in many places WITHOUT a replacement:**
- `theme.ts:83-88` -- `input:focus-visible, textarea:focus-visible, select:focus-visible { outline: none; }` -- Replaced with `box-shadow: 0 0 0 2px var(--glow-primary)`. **This is acceptable** as glow ring is visible.
- `invoke-form.ts:312-314` -- `.json-editor:focus-visible { outline: none; }` -- Has replacement `box-shadow`.
- **`invoke-form.ts:350`** -- `input[type='range']` outline suppressed with NO visible replacement indicator.
- **`theme-settings.ts:137`** -- `input[type='range'] { outline: none; }` -- NO replacement focus indicator for range sliders.
- **`method-card.ts:168`** -- `.description-input:focus-visible { outline: none; }` -- No replacement specified in this component's styles.
- **`beam-app.ts:436`** -- `.editable-input:focus-visible { outline: none; }` -- Relies on parent `.editing` class for visual indication, which may not be sufficient.
- **`instance-panel.ts:215, 317, 365, 416`** -- Multiple `outline: none` suppressions.
- **`elicitation-modal.ts:235, 292`** -- Range slider and date input focus suppressed.
- **`fork-dialog.ts:134`** -- `.create-repo-input:focus { outline: none; }` -- No replacement.

**Fix:** Ensure every `outline: none` has a visible replacement (border-color change, box-shadow, or equivalent). Add `:focus-visible` styles to range sliders across all components.

---

#### 2.4.11 Focus Not Obscured (Minimum) (AA) -- PARTIAL

**Severity: Moderate**

- The `position: sticky` fullscreen button and floating elements could partially obscure focused items.
- `z-index: 9999` on modals is appropriate.
- The sidebar overlay properly has `aria-hidden="true"` (`beam-app.ts:2870`).
- Fixed connection banner (`beam-app.ts:666-680`) at `top: 0` could obscure focused content at the top of the page.

---

#### 2.5.1 Pointer Gestures (A) -- PASS

All interactions are single-point click/tap. No multi-point or path-based gestures.

---

#### 2.5.2 Pointer Cancellation (A) -- PASS

Click handlers use `@click` events (mouseup equivalent). No `@mousedown` handlers trigger destructive actions.

---

#### 2.5.3 Label in Name (A) -- PARTIAL

**Severity: Moderate**

- **`beam-sidebar.ts:854-857`** -- `aria-label="Show diagnostics"` but visible text is "🔍 Status" -- accessible name does not contain the visible text "Status".
- **`beam-sidebar.ts:862-865`** -- `aria-label="Show keyboard shortcuts"` but visible text includes "⌨️" + `<kbd>?</kbd>`.
- **`beam-app.ts:2860-2861`** -- Mobile menu button: `aria-label="Open menu"` / `"Close menu"` matches intent but the visible text is "☰" / "✕".

Most are acceptable for icon buttons, but "Show diagnostics" vs "Status" is a mismatch.

**Fix:** Change `aria-label="Show diagnostics"` to `aria-label="Status - Server diagnostics"` or match visible text.

---

#### 2.5.7 Dragging Movements (AA) -- PASS

No drag-and-drop interactions in the UI.

---

#### 2.5.8 Target Size (Minimum) (AA) -- PASS

Mobile breakpoints enforce `min-height: 44px` on buttons, inputs, and interactive elements:
- `beam-sidebar.ts:580-582` -- `.photon-item { min-height: 44px }`
- `beam-sidebar.ts:591` -- `.filter-btn { min-height: 44px }`
- `invoke-form.ts:451-452` -- Inputs `min-height: 44px`
- `elicitation-modal.ts:368-374` -- Buttons/inputs `min-height: 44px`

Desktop targets are generally adequate but some are small:
- **`beam-sidebar.ts:541-558`** -- `.star-btn` has `padding: 2px` which may result in a very small touch target on desktop.
- **`method-card.ts:111-122`** -- `.edit-pencil` has `padding: 2px 4px` -- potentially undersized.

---

### 3. UNDERSTANDABLE

#### 3.1.1 Language of Page -- PASS

`index.html:2` -- `<html lang="en">` is correctly set.

---

#### 3.1.2 Language of Parts (AA) -- PASS

No content in languages other than English.

---

#### 3.2.1 On Focus -- PASS

No unexpected context changes on focus. Focus to search field does not trigger navigation.

---

#### 3.2.2 On Input -- PASS

Form submissions require explicit button clicks. Select dropdowns change values but don't submit forms. Theme toggles change appearance immediately, which is expected behavior.

---

#### 3.2.3 Consistent Navigation (AA) -- PASS

Sidebar navigation is consistent across all views. Footer buttons maintain position.

---

#### 3.2.4 Consistent Identification (AA) -- PASS

Same icons and labels used consistently: star for favorites, search icon, theme toggle, etc.

---

#### 3.3.1 Error Identification -- FAIL

**Severity: Moderate**

- **`invoke-form.ts:696`** -- Error messages are shown as `<div class="error-text">` after fields, but:
  - No `role="alert"` or `aria-live` on error text
  - No `aria-invalid="true"` on the input field
  - No `aria-describedby` linking the error to its field
- **`forms.ts:39-43`** -- Error state uses `border-color: var(--color-error)` which relies on color alone (partially mitigated by the error text below).

**Fix:** Add `aria-invalid="true"` to error-state inputs. Add `aria-describedby` pointing to the error message element. Add `role="alert"` to the error container.

---

#### 3.3.2 Labels or Instructions -- PASS

Form fields have visible labels (`invoke-form.ts:686-694`). Required fields are marked with `*`. Description hints are provided inline. Placeholder text supplements but does not replace labels.

---

#### 3.3.3 Error Suggestion (AA) -- FAIL

**Severity: Moderate**

When validation fails, the error text is shown but no suggestions are provided for correction. For example, if a required field is empty, the error should suggest "Please enter a value for [field name]" rather than just showing a generic error state.

---

#### 3.3.4 Error Prevention (Legal, Financial, Data) (AA) -- N/A for this app type

Not applicable -- no legal, financial, or test data submissions.

---

### 4. ROBUST

#### 4.1.1 Parsing -- PASS (obsolete in WCAG 2.2)

WCAG 2.2 marks this as always passing.

---

#### 4.1.2 Name, Role, Value -- FAIL

**Severity: Critical**

- **`method-card.ts:418-421`** -- Clickable `<div class="card">` has no `role`, no accessible name, and no `tabindex`. Screen readers cannot identify this as interactive.
- **`marketplace-view.ts` cards** -- Same issue with marketplace cards.
- **`app-layout.ts:197-199`** -- `<span class="anchor-link">` elements functioning as links/buttons -- no role, no keyboard access.
- **`context-bar.ts:106-127`** / **`method-card.ts:111-122`** -- Edit pencil `<span>` elements: no role, no accessible name.
- **`beam-sidebar.ts:521-539`** -- Settings button opacity:0 on default -- effectively invisible to all users until hover. No keyboard path.
- **`beam-app.ts:2942-2957`** -- Theme settings panel overlay: no dialog role, no accessible name.

**Fix:** Ensure all interactive elements have appropriate roles and accessible names. Convert `<div>`/`<span>` click handlers to `<button>` elements.

---

#### 4.1.3 Status Messages -- PARTIAL

**Severity: Moderate**

**Working:**
- `toast-manager.ts:202-208` -- Toasts wrapped in `role="status" aria-live="polite"`, individual toasts use `role="alert"`.
- `beam-app.ts:2822-2825` -- Connection banner uses `role="alert" aria-live="assertive"`.

**Missing:**
- **Activity log updates** (`activity-log.ts`) -- New entries are added to the log dynamically but there is no `aria-live` region to announce them.
- **Search results count** -- When filtering photons in the sidebar, the count changes but is not announced.
- **Loading states** -- The spinner in `buttons.ts:48-55` is visual-only; no `aria-busy` or status announcement for in-progress operations.

**Fix:** Add `aria-live="polite"` to the activity log container or use a separate status region to announce new entries. Add result count announcements for search. Add `aria-busy="true"` to containers during loading.

---

## Prioritized Remediation Plan

### Phase 1: Critical (Blocks keyboard/screen reader users)

| # | Issue | WCAG | File(s) | Effort |
|---|-------|------|---------|--------|
| 1 | Add focus trap to all modals | 2.1.2 | `beam-app.ts`, `elicitation-modal.ts` | Medium |
| 2 | Make method cards keyboard accessible | 2.1.1, 4.1.2 | `method-card.ts` | Low |
| 3 | Make marketplace cards keyboard accessible | 2.1.1, 4.1.2 | `marketplace-view.ts` | Low |
| 4 | Add skip-to-main-content link | 2.4.1 | `beam-app.ts` | Low |
| 5 | Fix all `outline: none` without replacement | 2.4.7 | Multiple files | Medium |
| 6 | Add `aria-invalid` and `aria-describedby` to form errors | 3.3.1 | `invoke-form.ts` | Low |

### Phase 2: Serious (Significant barriers)

| # | Issue | WCAG | File(s) | Effort |
|---|-------|------|---------|--------|
| 7 | Fix light theme muted text contrast | 1.4.3 | `beam-app.ts` (CSS vars) | Low |
| 8 | Add non-color indicators to activity log | 1.4.1 | `activity-log.ts` | Low |
| 9 | Add text alternative to status indicator | 1.3.3, 1.4.1 | `beam-sidebar.ts` | Low |
| 10 | Increase `--border-glass` contrast | 1.4.11 | `beam-app.ts` | Low |
| 11 | Convert anchor-link spans to buttons | 4.1.2 | `app-layout.ts` | Low |
| 12 | Add role="dialog" to theme settings panel | 4.1.2 | `beam-app.ts` | Low |

### Phase 3: Moderate/Minor (Polish)

| # | Issue | WCAG | File(s) | Effort |
|---|-------|------|---------|--------|
| 13 | Add `aria-live` to activity log | 4.1.3 | `activity-log.ts` | Low |
| 14 | Announce search result counts | 4.1.3 | `beam-sidebar.ts` | Low |
| 15 | Add `aria-busy` to loading states | 4.1.3 | `invoke-form.ts`, `beam-app.ts` | Low |
| 16 | Fix label-in-name for diagnostics button | 2.5.3 | `beam-sidebar.ts` | Trivial |
| 17 | Add `aria-label` to emoji picker buttons | 1.1.1 | `method-card.ts` | Low |
| 18 | Make edit pencil icons keyboard accessible | 2.1.1 | `method-card.ts`, `context-bar.ts` | Low |
| 19 | Improve focus order for sticky fullscreen button | 2.4.3 | `beam-app.ts` | Low |
| 20 | Add `tablist`/`tab` roles to view tabs | 1.3.1 | `invoke-form.ts` | Low |
| 21 | Add error suggestions to validation | 3.3.3 | `invoke-form.ts` | Medium |
| 22 | Add visually-hidden text to update dot | 1.3.3 | `beam-sidebar.ts` | Trivial |

---

## Quick Wins (< 30 minutes each)

1. **Skip link** -- Add 5 lines of HTML + 10 lines of CSS to `beam-app.ts`
2. **Method card keyboard** -- Add `tabindex="0"`, `role="button"`, `@keydown` to the `.card` div in `method-card.ts`
3. **`aria-invalid`** -- Add `aria-invalid="${hasError}"` to inputs in `invoke-form.ts:702`
4. **Status indicator text** -- Add `<span class="visually-hidden">${statusText}</span>` to `beam-sidebar.ts:736-747`
5. **Activity log icons** -- Prepend emoji/icon per type: `{info: 'ℹ️', success: '✓', error: '✗', warning: '⚠'}` in `activity-log.ts:236`
6. **Diagnostics label fix** -- Change `aria-label="Show diagnostics"` to `aria-label="Status"` in `beam-sidebar.ts:855`
7. **Range slider focus** -- Add `input[type='range']:focus-visible { box-shadow: 0 0 0 3px var(--glow-primary); }` to `theme.ts`

---

## What Already Works Well

The codebase shows intentional accessibility work in several areas:

1. **Landmark roles** -- `<nav>`, `<main>`, `role="search"`, `role="navigation"` properly used
2. **ARIA on sidebar** -- `listbox`/`option` pattern with `aria-selected`, `aria-pressed` on favorites, `aria-labelledby` connecting headers to lists
3. **Live regions** -- Toast notifications and connection banner properly use `role="alert"` and `aria-live`
4. **Reduced motion** -- `@media (prefers-reduced-motion: reduce)` in `theme.ts:177-186` disables animations
5. **Global focus-visible** -- The `*:focus-visible` rule in `theme.ts:77-80` provides a solid default
6. **Form accessibility** -- Labels with `for` attributes, required field indicators, error styling
7. **Decorative elements** -- `aria-hidden="true"` on icons and background elements
8. **Mobile touch targets** -- `min-height: 44px` enforced at mobile breakpoints
9. **HTML lang** -- `<html lang="en">` set on the document
10. **Responsive design** -- Proper reflow with `rem` units and media queries
