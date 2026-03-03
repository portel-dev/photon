# Don Norman's 7 Principles UX Audit: Photon Beam

**Auditor**: Claude (Opus 4.6)
**Date**: 2026-03-01
**Application**: Photon Beam v1.x (localhost:3000)
**Methodology**: Source code analysis against Don Norman's *The Design of Everyday Things*
**Cross-reference**: Nielsen Heuristics audit (3.7/5), WCAG 2.1 audit (prior)

---

## Executive Summary

Photon Beam scores **3.5/5** across Norman's seven principles. The application excels at **feedback** (toast notifications, loading spinners, connection banners) and **conceptual models** (the photon-method-result hierarchy is clear and consistent). However, it suffers from significant **affordance ambiguity** (method cards are clickable divs with no button semantics), **hidden signifiers** (edit pencils only appear on hover, invisible to touch users), and **weak constraints** (forms allow submission of invalid data beyond required-field checks). The most critical "Norman Door" is the method card itself: its action icon shows either a clipboard or play button, but the *entire card* is the click target, creating confusion about what will happen on click.

**Overall Score: 3.5 / 5.0**

| Principle | Score | Summary |
|-----------|-------|---------|
| 1. Discoverability | 3.0 / 5 | Key features hidden behind keyboard shortcuts and hover states |
| 2. Affordance | 3.0 / 5 | Cards look clickable but lack button semantics; edit zones invisible |
| 3. Signifiers | 3.5 / 5 | Good use of icons and badges, but hover-dependent signifiers fail on touch |
| 4. Feedback | 4.5 / 5 | Excellent toast system, loading spinners, connection banners |
| 5. Mapping | 4.0 / 5 | Spatial layout matches hierarchy well; sidebar-to-content flow is natural |
| 6. Constraints | 3.0 / 5 | Required-field validation only; no type/range constraints enforced |
| 7. Conceptual Model | 3.5 / 5 | Photon-method-result model is clear but "instance" and "stateful" concepts are opaque |

---

## Detailed Evaluation by Principle

### 1. Discoverability

**Compliance Level: Fair (3.0/5)**

Discoverability asks: can users determine what actions are possible just by looking?

#### Strengths

**S1.1: Welcome wizard provides clear entry points**
The welcome screen (`beam-app.ts:3099-3186`) presents two clear paths -- "Browse & Install" and "Create Your Own" -- with explanatory text. The three-step visual (`.ts file -> Methods = Tools -> Use anywhere`) establishes what Photon does immediately.

**S1.2: Sidebar categories organize photons by status**
The sidebar (`beam-sidebar.ts:783-846`) groups items into APPS, PHOTONS, NEEDS ATTENTION, and MCPS sections with clear uppercase headers. The "NEEDS ATTENTION" section uses a warning color accent (`section-header.attention`, line 247), making unconfigured photons visible.

**S1.3: Search is prominently placed**
The search input is always visible at the top of the sidebar (`beam-sidebar.ts:750-758`) with a placeholder hint showing the keyboard shortcut (`Search photons... (Cmd+K)`).

**S1.4: Dashboard overview on no selection**
When no photon is selected but photons exist (`beam-app.ts:3189-3267`), the app shows a dashboard with "Your Photons" count, "Browse Marketplace", and "Keyboard Shortcuts" cards. This provides orientation rather than a blank screen.

#### Violations

**V1.1: Keyboard shortcuts are the primary discovery mechanism for power features (Medium)**
Focus mode (`beam-app.ts:5276`), theme settings (`t`), marketplace (`p`), favorites filter (`f`), photon navigation (`[`/`]`), and method navigation (`j`/`k`) are all keyboard-only unless the user knows to press `?`. The footer does show `? ` as a hint (`beam-sidebar.ts:863-865`), but the keyboard icon alone is not a strong enough signifier.

- **File**: `beam-app.ts:5269-5350` (keyboard handler)
- **Impact**: Power users benefit; casual users never discover these features.

**V1.2: Edit affordances are completely hidden until hover (High)**
The edit pencil for method names and descriptions only appears on hover (`method-card.ts:111-126`, `.edit-pencil { opacity: 0 }`, `.editable:hover .edit-pencil { opacity: 0.5 }`). On touch devices, there is no hover, so users cannot discover that descriptions and names are editable.

Similarly, the photon header edit pencil (`beam-app.ts:414-423`) uses CSS `::after` content that only appears on hover. The sidebar settings gear icon is also hover-only (`beam-sidebar.ts:527-538`, `opacity: 0`, revealed on `.photon-item:hover`).

- **File**: `method-card.ts:111-126`, `beam-app.ts:414-423`, `beam-sidebar.ts:527-538`
- **Impact**: Editing capability is invisible to all non-mouse users.

**V1.3: No indication of what "clicking a method card" will do (Medium)**
The action icon in the bottom-right of method cards (`method-card.ts:535-545`) shows either a clipboard icon (has params) or play icon (no params), but this icon is at 50% opacity by default and only reveals at full opacity on hover. Users cannot determine the consequence of clicking without hovering first.

**V1.4: Settings gear appears only on sidebar hover (Medium)**
The per-photon settings button (`beam-sidebar.ts:521-538`) has `opacity: 0` by default and only appears when the parent `.photon-item` is hovered. This means photon settings are undiscoverable without random hovering.

#### Recommendations

1. **Add visible edit indicators**: Show a subtle "Edit" text or persistent (dimmed) pencil icon rather than hiding it entirely. On mobile, make descriptions tappable with a visual cue.
2. **Add a "Getting Started" tooltip or first-run tour**: On first visit, highlight key areas (search, keyboard shortcuts, method cards).
3. **Make keyboard shortcut hints persistent**: Add a small `?` button in the main toolbar area, not just the sidebar footer.
4. **Show action intent on cards**: Replace the opacity-hidden action icon with a persistent visual like "Click to configure" or "Click to run" text.

---

### 2. Affordance

**Compliance Level: Fair (3.0/5)**

Affordance asks: do elements naturally suggest their possible use?

#### Strengths

**S2.1: Glass-panel cards afford interaction**
Method cards (`method-card.ts:36-56`) use `cursor: pointer`, hover lift (`transform: translateY(-2px)`), and border-left accent on hover. These physical metaphors communicate clickability.

**S2.2: Buttons use gradient fills to signal primary actions**
The `.btn-primary` style (`buttons.ts:14-23`) uses a gradient background and hover shadow, clearly distinguishing it from secondary buttons which are transparent with borders.

**S2.3: Sliders look and feel like sliders**
The invoke form's range inputs (`invoke-form.ts:341-378`) have styled thumb handles with accent color and shadow, making them look draggable.

**S2.4: The sidebar search input affords typing**
Standard input styling with placeholder text and search icon position creates a clear text-entry affordance.

#### Violations

**V2.1: Method cards are `<div>` elements with cursor:pointer -- a "Norman Door" (High)**
The entire method card is a `<div class="card glass-panel">` with a click handler (`method-card.ts:417-421`). It is not a `<button>` or `<a>`, so it has no semantic affordance for keyboard or screen reader users. The card "looks" interactive due to hover effects, but the underlying element does not communicate its purpose.

This is the classic Norman Door: the visual affordance says "I'm clickable" but the semantic affordance says "I'm a container."

- **File**: `method-card.ts:418` (`<div class="card glass-panel" @click=${this._handleCardClick}>`)
- **Impact**: Keyboard users cannot tab to or activate cards without mouse.

**V2.2: Editable text looks like static text (High)**
Photon names and descriptions appear as regular text (`beam-app.ts:267-283`). The only affordance for editability is a hidden pencil icon that appears on hover. Users have no visual cue that text is editable -- it looks like a read-only label.

The `.editable` class (`beam-app.ts:400-423`) adds a hover background, but this is reactive, not proactive. A user who doesn't hover never knows they can edit.

- **File**: `beam-app.ts:400-423`, `method-card.ts:105-132`
- **Impact**: Users who want to customize their photon/method descriptions may never discover the capability.

**V2.3: Star (favorite) button looks decorative, not interactive (Medium)**
The star button (`beam-sidebar.ts:541-571`) starts at `opacity: 0.2` (almost invisible) and only reaches full opacity when `.favorited`. An unfilled, barely-visible star does not afford "click me to favorite."

- **File**: `beam-sidebar.ts:541-571`
- **Impact**: Favoriting feature goes unused by users who never discover it.

**V2.4: Footer icons lack text labels -- ambiguous affordance (Low)**
The sidebar footer (`beam-sidebar.ts:849-878`) has three buttons with only emoji icons and a `kbd` tag. The theme button (`beam-sidebar.ts:867-877`) shows only a paint palette emoji with no text. While there are `title` attributes, these are not visible affordances.

**V2.5: The "fullscreen" button uses obscure Unicode glyphs (Low)**
The focus mode toggle (`beam-app.ts:2916-2930`) uses `⊡` and `⛶` characters, which are not universally recognized as expand/collapse symbols. Standard fullscreen icons would afford the action more clearly.

#### Recommendations

1. **Convert method cards to `<button>` elements** or at minimum add `role="button"` and `tabindex="0"` with keyboard event handlers.
2. **Add visual edit affordance**: Use a subtle dotted underline or a persistent "click to edit" placeholder styling for editable text fields.
3. **Make stars always visible at low opacity**: Change from `opacity: 0.2` to `opacity: 0.4` with an outlined star shape, so the affordance is visible even unfavorited.
4. **Add text labels to footer icons**: At minimum "Status", "Keys", "Theme" next to the emojis.
5. **Use standard expand/fullscreen icons**: Replace Unicode glyphs with SVG icons that follow platform conventions.

---

### 3. Signifiers

**Compliance Level: Good (3.5/5)**

Signifiers are the perceivable cues that indicate where and how to act.

#### Strengths

**S3.1: Required fields are clearly marked**
The invoke form (`invoke-form.ts:688`) marks required fields with an asterisk (`*`) in the accent color, following universal convention.

**S3.2: Parameter tags on method cards signal complexity**
Method cards show parameter name pills (`method-card.ts:488-501`), giving users immediate insight into what a method requires before clicking. The `+N` count pill for methods with many params is a clear signifier.

**S3.3: Type badges communicate method behavior**
Badges like "Scheduled", "Deprecated", "Cached", "Throttled", and "Queued" (`method-card.ts:444-480`) use distinct colors and text labels to communicate method characteristics at a glance.

**S3.4: Connection status uses traffic light metaphor**
The status indicator dot (`beam-sidebar.ts:153-176`) uses green (connected), amber/pulsing (reconnecting), and red (disconnected) with glow effects, following the universal traffic light signifier.

**S3.5: Error states use red consistently**
Form errors (`forms.ts:39-48`), the connection banner (`beam-app.ts:666-698`), and activity log error items (`activity-log.ts:146-147`) all use the `--color-error` red consistently.

**S3.6: CLI preview shows the equivalent command**
The invoke form renders a CLI preview (`invoke-form.ts:93-145`) with a `$ ` prefix and green text, clearly signifying "this is the terminal command equivalent." The copy button is positioned next to it.

#### Violations

**V3.1: Status dot relies on color alone (Medium)**
The sidebar connection indicator (`beam-sidebar.ts:153-176`) is only an 8px colored circle. The `title` attribute provides text, but this requires hover. Users with color vision deficiency cannot distinguish connected from reconnecting from disconnected.

- **File**: `beam-sidebar.ts:153-176`
- **Impact**: Already flagged in WCAG audit; color-only signifier fails accessibility.

**V3.2: Activity log types use only border-left color (Medium)**
Activity log items (`activity-log.ts:139-150`) differentiate info/success/error/warning solely through `border-left-color`. No icon or text label indicates the type.

- **File**: `activity-log.ts:139-150`
- **Impact**: Same color-only signifier issue as V3.1.

**V3.3: The "Add description..." placeholder is ambiguous (Low)**
Method cards show "Add description..." (`method-card.ts:522-523`) in italic/muted style when no description exists. This text could be read as either a static label ("no description") or an invitation to act. Without an edit affordance visible, it leans toward the former.

**V3.4: No signifier distinguishes "photon" from "external MCP" in the sidebar (Low)**
While external MCPs get a different icon background (`beam-sidebar.ts:443-448`, gradient blue), the visual distinction is subtle. The section headers (PHOTONS vs MCPS) help, but within the APPS category, photon apps and external MCP apps are mixed without clear signifiers.

#### Recommendations

1. **Add icons or labels to status indicators**: Show a checkmark, spinner, or X icon alongside the color dot.
2. **Add type icons to activity log entries**: Prefix each entry with a status icon (checkmark, X, warning triangle, info circle).
3. **Make "Add description..." an explicit CTA**: Change to "Click to add description" or show a small edit icon persistently.
4. **Add a subtle badge or icon to distinguish external MCPs**: A small "MCP" label pill or plug icon next to the name.

---

### 4. Feedback

**Compliance Level: Excellent (4.5/5)**

Feedback asks: does the system respond immediately to every action?

#### Strengths

**S4.1: Toast notification system is comprehensive**
The toast manager (`toast-manager.ts:1-100`) provides animated slide-in notifications for success, error, info, and warning states. Toasts auto-dismiss with configurable duration, use color-coded left borders, and support action buttons (e.g., undo).

- Used for: form clears (`invoke-form.ts:600`), clipboard copies, installations, validation warnings (`invoke-form.ts:1744`), shared link fills (`invoke-form.ts:554`).

**S4.2: Loading states are well-implemented**
The Execute button (`invoke-form.ts:617-620`) shows a spinner animation and "Executing..." text when loading, and is disabled to prevent double-submission.

**S4.3: Connection loss is prominently communicated**
The connection banner (`beam-app.ts:2820-2853`) is a fixed-position full-width bar with clear messaging ("Disconnected from server" / "Reconnecting...") and a "Retry Now" button. After 2 failed attempts, it shows recovery instructions (`photon beam`).

**S4.4: Progress bars for long operations**
The progress container (`beam-app.ts:1329-1379`) shows a determinate or indeterminate progress bar with percentage text, providing continuous feedback for installations and long-running operations.

**S4.5: Hover feedback is pervasive and consistent**
Nearly every interactive element has `transition: all 0.2s ease` and hover state changes. Cards lift (`translateY(-2px)`), buttons change color, and icons scale up. This creates a responsive, alive feeling.

**S4.6: Form validation provides inline feedback**
Required field errors show inline error text (`invoke-form.ts:696`) with red error styling (`forms.ts:33-48`), and the input border changes to red.

#### Violations

**V4.1: No feedback when keyboard shortcuts are pressed (Medium)**
When pressing `[` or `]` to navigate photons (`beam-app.ts:5306-5326`), `j`/`k` to navigate methods (`beam-app.ts:5328-5350`), or `f` to toggle favorites, there is no visible focus indicator or highlight on the newly selected item. The sidebar selection changes, but without a scroll-into-view or flash animation, the user may not notice the change.

Exception: The `f` shortcut does show a toast (`beam-app.ts:5291`), which is good.

**V4.2: No feedback when editing description is saved (Low)**
When a description edit is saved via blur (`method-card.ts:513`), there is no toast or visual confirmation that the change was persisted. The user has to trust that blur = save.

#### Recommendations

1. **Add scroll-into-view and flash animation for keyboard navigation**: When `[`/`]` or `j`/`k` select a new item, scroll it into view and briefly highlight it.
2. **Show save confirmation for inline edits**: A brief toast or a checkmark animation when description/name edits are saved.

---

### 5. Mapping

**Compliance Level: Good (4.0/5)**

Mapping asks: do controls logically correspond with their effects?

#### Strengths

**S5.1: Spatial hierarchy matches conceptual hierarchy**
The layout follows a natural left-to-right, general-to-specific mapping:
- Sidebar (left) = navigation/selection = "where am I?"
- Main area (right) = content/actions = "what can I do?"
- Activity log (bottom) = history = "what happened?"

This maps perfectly to the user's mental model of browse-select-act-review.

**S5.2: The photon-method-form flow is spatially linear**
Selecting a photon in the sidebar shows methods in the main area. Clicking a method transitions to the invoke form. Results appear below. This top-to-bottom, left-to-right flow matches reading order and the temporal sequence of actions.

**S5.3: Keyboard shortcuts follow vim conventions**
`j`/`k` for down/up, `h` for back, `[`/`]` for previous/next container, and `/` for search follow established vim mappings (`beam-app.ts:5228-5350`). Power users find these mappings natural.

**S5.4: Breadcrumb/context bar provides spatial context**
The context bar (`context-bar.ts`) shows the current photon with icon, name, and metadata, reinforcing "where am I" at the top of the content area.

**S5.5: Theme settings panel slides in from the right**
The theme panel (`beam-app.ts:1293-1314`) uses `slideInRight` animation, spatially mapping to the sidebar (left = navigation) vs. settings (right = configuration). This left-navigation / right-settings convention matches many applications.

#### Violations

**V5.1: "Back" button position is inconsistent (Medium)**
The "Back to Dashboard" and "Back to Welcome" buttons (`beam-app.ts:3009-3014, 3079-3085`) are unstyled text buttons positioned at the top left of the content area. But the context bar (which contains navigation context) is separate. Users must decide whether to use the back button, the sidebar, or press `h`/`Escape` -- three different mechanisms with inconsistent placement.

- **File**: `beam-app.ts:3009-3014`
- **Impact**: Users may not find the back path they expect.

**V5.2: Emoji picker position does not map to the icon being edited (Low)**
On method cards, the emoji picker (`method-card.ts:258-272`) appears at `top: 50px; left: var(--space-md)` -- an absolute position that may not visually connect to the icon being customized. On mobile, it becomes a centered fixed overlay (`method-card.ts:323-330`), completely breaking the spatial relationship.

**V5.3: Form/JSON toggle position does not suggest its scope (Low)**
The Form/JSON view tabs (`invoke-form.ts:634-648`) appear at the top of the form container. While positioned correctly, the tab labels ("Form" / "JSON") do not make clear that they are alternate *input modes* for the same data. A user might think they are switching between two different datasets.

#### Recommendations

1. **Consolidate back navigation**: Use the context bar as the single back navigation mechanism with a visible back arrow, rather than ad-hoc text buttons.
2. **Position emoji picker adjacent to trigger**: Use a popover anchored to the icon element rather than absolute positioning.
3. **Clarify form/JSON toggle labels**: Change to "Visual Editor" / "JSON Editor" to make the mode-switching nature explicit.

---

### 6. Constraints

**Compliance Level: Fair (3.0/5)**

Constraints limit possible actions to prevent errors.

#### Strengths

**S6.1: Required field validation prevents empty submissions**
The invoke form (`invoke-form.ts:1721-1750`) validates that all required fields have values before dispatching the submit event. Errors are shown inline with red text.

**S6.2: Execute button is disabled during loading**
Both the Execute and Cancel buttons have `?disabled=${this.loading}` (`invoke-form.ts:614-617, 653-656`), preventing double submissions.

**S6.3: JSON editor validates syntax**
The JSON editor view has an `.error` class for invalid JSON (`invoke-form.ts:318-319`), and the `_handleJsonSubmit` method (implied by the JSON view) would validate parsing before submission.

**S6.4: Marketplace install button shows state**
Installed photons show a non-interactive "Installed" button (`marketplace-view.ts:286-295`) with `cursor: default`, constraining the user from re-installing.

**S6.5: Connection state prevents meaningless actions**
When disconnected, the full-width banner (`beam-app.ts:2820-2853`) overlays the interface, effectively constraining the user to the reconnection action.

#### Violations

**V6.1: No type validation beyond "required" (High)**
The form only validates that required fields are non-empty (`invoke-form.ts:1733-1738`). There is no validation for:
- **Number ranges**: Even though sliders have min/max (`invoke-form.ts:341`), direct number input is unconstrained.
- **String patterns**: No regex validation for email, URL, or other formatted strings.
- **Enum values**: While selects constrain to valid options, there is no server-side echo validation.

A user can type "abc" in a number field or enter a 10,000-character string in a short text field.

- **File**: `invoke-form.ts:1721-1750`
- **Impact**: Invalid data reaches the server, causing cryptic MCP errors instead of clear UI feedback.

**V6.2: No confirmation for destructive marketplace actions (High)**
The "Remove" button on installed marketplace items has no confirmation dialog. Clicking it immediately triggers removal. This was also noted in the Nielsen audit (H3/H5).

- **File**: `marketplace-view.ts:297-300` (btn-remove styling implies direct action)
- **Impact**: Accidental photon removal with no undo path.

**V6.3: Form data is lost on navigation without warning (Medium)**
If a user fills in form fields and then navigates away (clicking sidebar, pressing `h`, or pressing `Escape`), form data is silently discarded. There is no "unsaved changes" warning.

- **File**: `beam-app.ts:5256-5258` (`_handleBackFromMethod` called on Escape)
- **Impact**: Users lose work. Also noted in Nielsen audit (H5).

**V6.4: No character count or length constraints on editable descriptions (Low)**
The inline description editor (`method-card.ts:503-517`) is a textarea with no `maxlength` attribute. Users can enter arbitrarily long descriptions that may break layout or exceed storage limits.

**V6.5: Favorites can be toggled without undo (Low)**
Clicking the star button immediately toggles favorite status with no undo option. If a user accidentally unfavorites and has the favorites filter active, the item disappears from view.

- **File**: `beam-sidebar.ts:541-571`
- **Impact**: Also noted in Nielsen audit (H3).

#### Recommendations

1. **Add type validation to the invoke form**: Validate number ranges, string patterns, and lengths based on JSON Schema constraints. Show inline errors for type mismatches.
2. **Add confirmation dialog for marketplace remove**: Show a modal asking "Remove {photon-name}? This will delete local configuration."
3. **Implement dirty-form detection**: Track whether form values have changed; prompt before navigation with "Discard changes?"
4. **Add maxlength to description editors**: Enforce a reasonable character limit (e.g., 500 chars) with a counter.
5. **Add undo action to favorite toggle toast**: Show a toast with "Removed from favorites" and an "Undo" action button.

---

### 7. Conceptual Model

**Compliance Level: Good (3.5/5)**

A conceptual model is the user's understanding of how the system works.

#### Strengths

**S7.1: The photon-method metaphor is strong and consistent**
A "photon" is like an app or module. Each photon has "methods" that are like functions or tools. You select a photon, pick a method, fill in parameters, and get a result. This maps naturally to both developer mental models (class -> method -> params -> return) and general-purpose mental models (app -> action -> input -> output).

**S7.2: The card grid layout reinforces "collection of capabilities"**
Methods displayed as cards in a grid (`beam-app.ts:169-174`, `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`) communicate "these are independent, parallel options" -- matching the reality that methods are independent entry points.

**S7.3: Result viewer adapts to data shape**
The result viewer (`result-viewer.ts:8-32`) supports 20+ layout types (table, list, card, chart, mermaid, markdown, etc.) and auto-detects the appropriate one. This means users see results in a form that matches their mental model of the data, rather than always seeing raw JSON.

**S7.4: The CLI preview bridges mental models**
Showing the equivalent CLI command (`invoke-form.ts:93-145`) helps users who think in terms of command-line tools understand what the UI is doing. This dual-representation reinforces the conceptual model.

**S7.5: Sidebar categories create a clear taxonomy**
APPS, PHOTONS, NEEDS ATTENTION, MCPS -- these four categories (`beam-sidebar.ts:783-846`) create a mental model of "things I use, things that work, things that need fixing, external connections."

#### Violations

**V7.1: "Instance" concept is poorly explained (High)**
The instance panel (`instance-panel.ts`) shows a pill with "default" and a chevron dropdown. But there is no explanation of what instances *are*, when to create them, or how they relate to photon state. The concept of named instances (representing separate state contexts) is powerful but opaque.

A new user seeing "default" with a dropdown arrow has no mental model for what switching instances means. Is it like git branches? Profiles? Workspaces?

- **File**: `instance-panel.ts:113-125`
- **Impact**: The stateful instance system, a key differentiator, goes unused because users don't understand it.

**V7.2: "Needs Attention" category mixes two distinct concepts (Medium)**
The NEEDS ATTENTION section groups photons that need configuration with photons that have load errors (`beam-sidebar.ts:18-19`, `errorReason?: 'missing-config' | 'load-error'`). These are conceptually different: one requires user action, the other indicates a system problem. Combining them under one heading conflates the mental model.

- **File**: `beam-sidebar.ts:18-19, 803-808`
- **Impact**: Users may not understand why a photon "needs attention" or what action is required.

**V7.3: The relationship between Marketplace and installed photons is unclear (Medium)**
The marketplace shows cards with "Install" / "Installed" / "Update" / "Remove" buttons (`marketplace-view.ts:265-300`). But after installing, there is no clear visual transition from "marketplace item" to "sidebar photon." Users may not realize that an installed marketplace photon is the same thing that appears in the sidebar under PHOTONS.

- **Impact**: Users may install photons and then not find them, or not understand the marketplace-to-sidebar pipeline.

**V7.4: "Autorun" methods challenge the tool-invocation mental model (Low)**
Methods marked as `autorun` (`method-card.ts:391`) automatically execute on load -- but the card still displays with a play button. The "Autorun" badge helps, but the conceptual model of "I click to run" is violated when something runs on its own. Users may wonder "did it already run? do I need to click?"

**V7.5: The distinction between "photon" and "external MCP" is conceptually muddled (Low)**
Both appear in the sidebar, both have methods/tools, and both can be invoked. But they have different capabilities (external MCPs cannot be edited, may disconnect). The UI treats them nearly identically, which helps simplicity but hurts when the user tries to edit or configure an external MCP and cannot.

#### Recommendations

1. **Add instance explainer**: When the instance pill is first shown, display a tooltip or info icon explaining: "Instances are separate data containers. Like having multiple accounts in the same app."
2. **Split "Needs Attention" into sub-categories**: Show "Needs Configuration" and "Load Errors" separately, with distinct icons and colors.
3. **Show post-install animation**: After marketplace install, animate the new photon appearing in the sidebar (scroll to it, flash highlight).
4. **Add "Auto-executing..." indicator for autorun methods**: Instead of showing the standard card, show an execution state with a progress indicator.
5. **Visually distinguish external MCPs more clearly**: Add a "connected service" badge or icon that communicates "this is remote, not local."

---

## Prioritized Issues

### Critical (Must Fix)

| ID | Principle | Issue | File | Line |
|----|-----------|-------|------|------|
| N1 | Affordance | Method cards are `<div>` not `<button>` -- "Norman Door" | `method-card.ts` | 418 |
| N2 | Constraints | No type validation beyond required fields | `invoke-form.ts` | 1721-1750 |
| N3 | Discoverability | Edit affordances invisible until hover (0 opacity) | `method-card.ts` | 111-126 |
| N4 | Constraints | No confirmation for destructive marketplace actions | `marketplace-view.ts` | 297+ |

### High (Should Fix)

| ID | Principle | Issue | File | Line |
|----|-----------|-------|------|------|
| N5 | Affordance | Editable text indistinguishable from static text | `beam-app.ts` | 400-423 |
| N6 | Conceptual Model | Instance concept unexplained and opaque | `instance-panel.ts` | 113-125 |
| N7 | Constraints | Form data lost on navigation without warning | `beam-app.ts` | 5256-5258 |
| N8 | Feedback | No visual feedback for keyboard navigation selections | `beam-app.ts` | 5306-5350 |

### Medium (Nice to Have)

| ID | Principle | Issue | File | Line |
|----|-----------|-------|------|------|
| N9 | Signifiers | Status dot and activity log use color-only indicators | `beam-sidebar.ts` | 153-176 |
| N10 | Mapping | Inconsistent back navigation (buttons vs sidebar vs keyboard) | `beam-app.ts` | 3009-3014 |
| N11 | Discoverability | Power features only accessible via keyboard shortcuts | `beam-app.ts` | 5269-5293 |
| N12 | Conceptual Model | "Needs Attention" conflates config-needed and load-error | `beam-sidebar.ts` | 803-808 |
| N13 | Affordance | Star/favorite button nearly invisible at 0.2 opacity | `beam-sidebar.ts` | 541-571 |
| N14 | Conceptual Model | Marketplace-to-sidebar install transition is unclear | `marketplace-view.ts` | 265+ |

### Low (Polish)

| ID | Principle | Issue | File | Line |
|----|-----------|-------|------|------|
| N15 | Affordance | Fullscreen button uses obscure Unicode glyphs | `beam-app.ts` | 2929 |
| N16 | Mapping | Emoji picker position disconnected from trigger | `method-card.ts` | 258-272 |
| N17 | Constraints | No character limit on inline description editing | `method-card.ts` | 503-517 |
| N18 | Feedback | No save confirmation for inline description edits | `method-card.ts` | 513 |
| N19 | Signifiers | "Add description..." placeholder is ambiguous | `method-card.ts` | 522-523 |

---

## "Norman Doors" Identified

A "Norman Door" is an element where the design suggests one action but requires another.

### 1. Method Card: Looks Like a Display, Acts Like a Button
The method card (`method-card.ts:418`) is a `<div>` with visual hover effects that make it *look* clickable, but semantically it is not a button. Screen readers announce it as a generic element. Keyboard users cannot tab to it. The card has an action icon (play or clipboard) in the corner, but clicking *anywhere* on the card triggers the action -- not just the icon. Users who click the icon expecting a specific action get the same result as clicking the title or description.

### 2. Editable Text: Looks Static, Is Editable
Photon names, descriptions, and method descriptions (`beam-app.ts:267-283`, `method-card.ts:437-533`) look like ordinary text labels. Nothing about their appearance (no underline, no border, no icon) suggests they can be edited. The edit pencil only appears on hover. This is the equivalent of a door handle that is flush with the surface -- users push against it not realizing they need to pull.

### 3. Star Button: Looks Decorative, Is Functional
The favorite star (`beam-sidebar.ts:541-571`) at 0.2 opacity looks like a decorative element or inactive indicator, not a clickable toggle. Users may see it as a "this is not yet a favorite" indicator rather than a "click me to make it a favorite" button.

### 4. Sidebar Footer Icons: Look Like Status, Are Navigation
The footer icons (status, keyboard shortcuts, theme) (`beam-sidebar.ts:849-878`) look like small status indicators due to their muted color and small size. They are actually navigation buttons that open panels and modals.

---

## Redesign Suggestions

### Quick Wins (< 1 day each)

1. **Add `role="button"` and `tabindex="0"` to method cards** with Enter/Space keyboard handlers.
2. **Increase star button base opacity to 0.4** and use an outlined star shape for unfavorited state.
3. **Add text labels to sidebar footer buttons**: "Status", "Shortcuts", "Theme".
4. **Add save confirmation toast** when inline descriptions are saved.
5. **Change fullscreen button icons** to standard expand/compress SVGs.

### Medium Effort (1-3 days each)

6. **Add type validation to invoke form**: Parse JSON Schema `minimum`/`maximum`/`pattern`/`minLength`/`maxLength` and validate before submit.
7. **Implement dirty-form guard**: Track form changes; show confirmation dialog on navigation away.
8. **Add confirmation dialog for marketplace remove**: Reuse the elicitation modal with `ask: 'confirm'`.
9. **Make edit affordances visible**: Add persistent (dimmed) pencil icon or dotted underline to editable fields.
10. **Add instance explainer**: Tooltip or info modal on first encounter with the instance pill.

### Larger Initiatives (3+ days)

11. **First-run guided tour**: Use a step-by-step overlay highlighting sidebar, search, method cards, and keyboard shortcuts.
12. **Unified navigation model**: Replace ad-hoc back buttons with a consistent breadcrumb/back pattern in the context bar.
13. **Post-install flow**: Animate new photon appearing in sidebar, auto-select it, show a "Getting Started" card.

---

## Cross-Reference with Previous Audits

| Norman Issue | Nielsen Issue | WCAG Issue | Status |
|---|---|---|---|
| N1 (Cards not buttons) | -- | Method cards not keyboard accessible | Overlapping; fix once |
| N3 (Hover-only edit) | -- | -- | Norman-unique; not caught by prior audits |
| N4 (No remove confirm) | H3, H5 (No confirmation) | -- | Same root cause |
| N7 (Form data loss) | H5 (Error prevention) | -- | Same root cause |
| N9 (Color-only status) | H4 (Consistency) | Color-only indicators | Overlapping; fix once |
| N11 (Hidden features) | H10 (No onboarding) | -- | Related |
| N6 (Instance concept) | -- | -- | Norman-unique; conceptual model gap |
| N5 (Editable text) | -- | -- | Norman-unique; affordance gap |

**Norman-unique findings** (not covered by prior audits): N3, N5, N6, N8, N12, N13, N14, N15, N16, N17, N18, N19 -- 12 issues that only surface through Norman's lens, primarily around affordance, conceptual models, and mapping.

---

## Next Steps

1. **Immediate**: Fix N1 (method card semantics) -- this overlaps with WCAG and is the most impactful single change.
2. **Sprint 1**: Address N2 (type validation), N3 (visible edit affordances), N4 (remove confirmation) -- all constraint/affordance fundamentals.
3. **Sprint 2**: Tackle N6 (instance explainer), N7 (dirty-form guard), N8 (keyboard nav feedback) -- conceptual clarity and feedback polish.
4. **Sprint 3**: Polish items N9-N14 -- signifier refinements and mapping consistency.
5. **Backlog**: Low-priority items N15-N19 and the larger redesign initiatives (tour, unified navigation, post-install flow).
