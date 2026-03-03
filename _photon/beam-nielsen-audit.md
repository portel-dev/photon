# Photon Beam UX Audit: Nielsen's 10 Usability Heuristics

**Date:** 2026-03-01
**Auditor:** Claude (Opus 4.6)
**Application:** Photon Beam (localhost:3000) -- MCP Tool Browser & Invoker
**Target Users:** Developers, AI Agents

---

## Scoring Guide

| Stars | Meaning |
|-------|---------|
| 1/5 | Severe compliance failures; users will be blocked |
| 2/5 | Multiple significant violations; usability degraded |
| 3/5 | Adequate with notable gaps |
| 4/5 | Good compliance with minor issues |
| 5/5 | Excellent; best-practice implementation |

**Severity Scale (Nielsen 0-4):**
- **0** = Not a usability problem
- **1** = Cosmetic only; fix if time permits
- **2** = Minor; low priority
- **3** = Major; important to fix; high priority
- **4** = Catastrophe; must fix before release

---

## H1: Visibility of System Status

**Rating: 4/5**

The system generally keeps users informed about what is happening through appropriate feedback.

### Positive Examples
- **Connection status indicator:** The green/yellow/red dot next to "Photon Beam" in the sidebar header clearly communicates server connection state. The pulsing animation on reconnecting state is effective.
- **Reconnection banner:** A prominent colored banner appears at the top during disconnection with attempt count and "Retry Now" button. Color-coded: red for disconnected, yellow/warning for reconnecting.
- **Loading spinners on forms:** The invoke-form shows a spinner with "Executing..." text during tool execution, and buttons are properly disabled.
- **Activity Log:** Timestamped, color-coded log entries (info/success/error/warning) with duration badges provide excellent post-hoc visibility.
- **Toast notifications:** Non-blocking slide-in toasts for copy confirmations, errors, etc.
- **Update dots:** Red dots on sidebar items when updates are available.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | No progress indicator for long-running tool executions | 3 | The form shows "Executing..." but there is no progress bar, elapsed timer, or streaming output preview. For tools that take 10+ seconds, users have no idea if the operation is hanging or progressing. |
| 2 | Marketplace loading state is minimal | 2 | `_loading` boolean exists but the marketplace grid simply disappears during fetch with no skeleton/placeholder UI. |
| 3 | No indication of which photons are currently loading on startup | 2 | When Beam starts, all photons appear at once. There is no staggered loading or skeleton sidebar to show the app is still discovering photons. |
| 4 | MCP App iframe loading shows only "Loading MCP App..." text | 1 | A spinner would be more informative; no progress indication for iframe load time. |

### Recommendations
1. **Must:** Add an elapsed-time counter or pulsing animation to the "Executing..." state for long-running tool calls.
2. **Should:** Add skeleton cards in the marketplace grid while loading.
3. **Nice:** Show a brief "Discovering photons..." state in the sidebar on initial load.

---

## H2: Match Between System and the Real World

**Rating: 4/5**

The interface uses developer-friendly language and concepts that match its technical audience.

### Positive Examples
- **formatLabel utility:** Converts camelCase/snake_case parameter names into human-readable labels. Handles common acronyms (AI, URL, ID) correctly.
- **CLI preview in invoke-form:** Shows the equivalent CLI command with `$ ` prefix -- developers can copy-paste to terminal.
- **Section naming:** "APPS", "PHOTONS", "NEEDS ATTENTION", "MCPS" are clear categories for the target audience.
- **Breadcrumb navigation:** Context bar uses breadcrumbs that mirror the conceptual hierarchy (Photon > Method).
- **Method badges:** Tags like "webhook", "cron", "cached", "retryable" use industry-standard terminology.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | "Photon" as a term is domain-specific jargon | 2 | New users unfamiliar with the Photon ecosystem must learn that "Photon" = "an MCP server/plugin/tool package." No onboarding tooltip or glossary exists. |
| 2 | "Beam" itself is unexplained | 1 | The app is called "Photon Beam" but nowhere in the UI is there a tagline or subtitle explaining what it does. |
| 3 | "Elicitation" is technical MCP jargon | 2 | The elicitation modal uses this term internally; if it surfaces in any user-facing text, it would confuse non-MCP-experts. |
| 4 | Emoji as icons may not render consistently | 1 | Photon icons and sidebar items rely on emoji (e.g., app icons). Rendering varies across OS/browser. |

### Recommendations
1. **Should:** Add a one-line tagline under "Photon Beam" on first visit or in an empty state: "Browse, test, and invoke your MCP tools."
2. **Nice:** Add a tooltip glossary or link to docs from the `?` footer icon.

---

## H3: User Control and Freedom

**Rating: 3/5**

Users have some escape paths but several important exit routes are missing.

### Positive Examples
- **Escape key handling:** Closes modals, cancels editing, exits popout mode. Documented in shortcuts.
- **Cancel button on invoke forms:** Users can cancel an in-progress execution.
- **Back navigation:** `h` key goes back; breadcrumbs allow clicking to parent; browser history/popstate is supported.
- **Focus mode toggle:** Users can expand/collapse the sidebar for more workspace.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | No undo for removing favorites | 3 | Clicking the star again silently removes a favorite with no undo toast. One misclick and the user must re-find and re-star the item. |
| 2 | No confirmation for destructive marketplace actions | 3 | "Remove" button on installed photons has no confirmation dialog. Removing a photon could break dependent workflows. |
| 3 | No undo for "Clear" on Activity Log | 2 | The clear button instantly wipes the log with no confirmation and no undo. |
| 4 | Theme settings changes are applied instantly with no "preview before apply" | 1 | Custom HCL sliders change the theme in real-time. While this is arguably good (instant feedback), there is no "Cancel" that reverts to previous state -- only "Reset to Default." If a user was exploring and wants to go back to their previous custom, they cannot. |
| 5 | No way to cancel a marketplace install mid-operation | 2 | Once install is triggered, there is no cancel mechanism. |

### Recommendations
1. **Must:** Add undo toast for favorite removal ("Removed from favorites. [Undo]").
2. **Must:** Add confirmation dialog for photon removal from marketplace.
3. **Should:** Add undo toast for Activity Log clear.
4. **Nice:** Store "previous theme" state so the theme panel close reverts if user cancels.

---

## H4: Consistency and Standards

**Rating: 4/5**

The interface is largely consistent in its visual language and interaction patterns.

### Positive Examples
- **Design token system:** Comprehensive CSS custom properties (`--space-*`, `--text-*`, `--radius-*`, `--bg-*`, `--t-*`, `--border-*`) ensure visual consistency.
- **Glass morphism pattern:** Consistent `glass-panel` class with backdrop-filter, border-glass, bg-glass used everywhere.
- **Button hierarchy:** `btn-primary` (gradient accent), `btn-secondary` (glass), `btn-ghost` (no background) are used consistently.
- **Card pattern:** Method cards, marketplace cards, and activity log items all follow the same glass-panel + border + rounded corners pattern.
- **Responsive breakpoints:** Consistent 768px (tablet) and 480px (mobile) breakpoints across all components.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | Sidebar footer icons lack text labels | 3 | The footer has four tiny icons (status/diagnostics, keyboard, ?, palette) with no visible labels. Only hover `title` attributes provide context. This violates icon-only button best practices for infrequent actions. |
| 2 | Inconsistent favorites behavior: photons have stars, external MCPs do not | 2 | Users can favorite local photons but not external MCP servers, creating an inconsistent mental model. |
| 3 | Mixed icon paradigms | 2 | Some icons are emoji (photon icons, app icons), some are text symbols (the `+` in marketplace), and the footer uses a mix. No unified icon system (no SVG icon set or icon font). |
| 4 | Light mode header gradient feels disconnected | 1 | The pink/magenta gradient header persists in light mode unchanged, while the rest of the palette shifts to warm earth tones. The gradient should adapt to the light theme's accent colors. |
| 5 | `!important` overrides in CSS | 1 | Several `!important` declarations (e.g., `.edit-pencil:hover`, `.settings-btn:hover`) suggest specificity battles. Not user-facing but indicates maintainability risk. |

### Recommendations
1. **Must:** Add text labels or at minimum larger, more recognizable icons to sidebar footer actions.
2. **Should:** Allow favoriting external MCPs for consistency.
3. **Should:** Adopt a single icon system (e.g., Lucide, Phosphor) instead of emoji + text symbols.
4. **Nice:** Make the header gradient respond to theme settings (use `--accent-primary` and `--accent-secondary`).

---

## H5: Error Prevention

**Rating: 3/5**

Some error prevention exists but several dangerous operations lack guardrails.

### Positive Examples
- **Required field validation:** The invoke-form checks required parameters before submission.
- **Enum fields as selects/radio buttons:** Prevents invalid input by constraining choices.
- **iOS zoom prevention:** `font-size: 16px` on mobile inputs prevents Safari zoom-on-focus.
- **Disabled buttons during loading:** Prevents double-submission.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | No confirmation for "Remove" in marketplace | 3 | See H3 above. This is also an error-prevention issue. |
| 2 | No draft/autosave for form inputs | 3 | If a user fills a complex form and accidentally navigates away (keyboard shortcut, misclick on sidebar), all input is lost. The `localStorage` persistence mechanism exists (`_storageKey`) but only for specific scenarios. |
| 3 | No validation feedback on form submit failure | 2 | When a required field is missing, the form does not scroll to or highlight the offending field. |
| 4 | Keyboard shortcuts fire from unexpected contexts | 2 | Single-key shortcuts like `t` (theme), `p` (marketplace), `f` (favorites) could fire when a user is typing in the search box if the guard check is insufficient. Code shows `_skipShortcutsInInput` but the check pattern needs verification. |
| 5 | No guard against invoking deprecated methods | 1 | Deprecated methods show a visual badge but can still be executed without any warning. |

### Recommendations
1. **Must:** Add confirmation dialog for photon removal.
2. **Must:** Autosave form state to localStorage on every input change; restore on navigation back.
3. **Should:** Scroll to and highlight the first invalid field on form submission failure.
4. **Should:** Show a deprecation warning toast when executing a deprecated method.

---

## H6: Recognition Rather Than Recall

**Rating: 4/5**

The interface generally makes information visible and reduces memory load.

### Positive Examples
- **Method cards show all metadata at a glance:** Parameter tags, badges (webhook, cron, cached, etc.), descriptions, and method counts are visible without clicking.
- **CLI preview:** Shows the full command so users do not need to remember CLI syntax.
- **Search with `Cmd+K`:** Follows the universal command-palette convention.
- **Keyboard shortcut modal:** All shortcuts are discoverable via `?`.
- **Breadcrumbs:** Always show current location in the hierarchy.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | Parameter descriptions not visible on method cards | 2 | Method cards show parameter names as tags but not their descriptions. Users must click into the form to understand what each parameter expects. |
| 2 | No recent/history list | 2 | There is no "Recently Used" or "History" section. Users must remember which photon/method they used last session. |
| 3 | Marketplace search has no filter presets or tag browsing | 2 | Users must recall exact search terms. No tag cloud or category filter to browse available photons. |
| 4 | Sidebar items truncate descriptions | 1 | `.photon-desc` uses `text-overflow: ellipsis` with no mechanism to see the full text (no expand, no tooltip for the description -- only the name has a title tooltip). |

### Recommendations
1. **Should:** Add a "Recently Used" section at the top of the sidebar (persisted to localStorage).
2. **Should:** Show parameter descriptions in a tooltip or subtitle on method cards.
3. **Nice:** Add tag-based filtering in the marketplace.

---

## H7: Flexibility and Efficiency of Use

**Rating: 4.5/5**

This is a strong area. The interface provides excellent power-user features.

### Positive Examples
- **Comprehensive keyboard shortcuts:** Navigation (`[`, `]`, `j`, `k`), actions (`Cmd+Enter`, `Esc`, `t`, `p`, `f`), search (`Cmd+K`, `/`). Vim-inspired j/k is excellent for developer tools.
- **Favorites system:** Quick filter to show only favorited photons.
- **Focus mode:** Hide sidebar for distraction-free method invocation.
- **CLI preview with copy:** One-click copy of CLI equivalent command.
- **Popout mode for apps:** Fullscreen experience for app-type photons.
- **Hash-based deep linking:** URL hash updates allow bookmarking specific photon/method views.
- **Form persistence:** Some form values persist across sessions.
- **Copy MCP config:** Quick action for integrating with other MCP clients.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | No bulk operations | 1 | Cannot bulk-install/remove photons from marketplace. |
| 2 | No custom keyboard shortcut binding | 1 | Shortcuts are hardcoded; no way to remap. |
| 3 | No "Run Last" shortcut | 2 | No way to quickly re-execute the last tool call with the same parameters. |

### Recommendations
1. **Should:** Add "Re-execute" or "Run Last" shortcut (e.g., `Cmd+Shift+Enter`).
2. **Nice:** Allow custom shortcut mapping in settings.

---

## H8: Aesthetic and Minimalist Design

**Rating: 4/5**

The dark-mode-first glass morphism design is visually polished and appropriate for developer tooling.

### Positive Examples
- **Glass morphism:** Translucent panels with backdrop-filter create depth without clutter.
- **Design tokens with HCL color space:** The theme system uses perceptually uniform HCL color space, which is a sophisticated approach.
- **6 presets + custom:** Theme flexibility without overwhelming choices.
- **Clean card layout:** Method cards use whitespace well; 3-line description clamp prevents visual overload.
- **Gradient accents:** `text-gradient` on headings adds visual interest without distraction.
- **Monospace font for code:** CLI previews, activity logs, and error messages use monospace fonts appropriately.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | Light mode feels like an afterthought | 3 | The warm earth-tone palette (#eae4dd bg, #2c2420 text) is distinct from the dark mode's cool blue-violet. The header gradient does not adapt. The overall impression is that light mode was added secondarily and does not receive equal design attention. |
| 2 | Sidebar density may overwhelm new users | 2 | With multiple categories (APPS, PHOTONS, NEEDS ATTENTION, MCPS), favorites, marketplace button, filter row, search, and status indicator all in the sidebar, information density is high. |
| 3 | Activity Log takes up permanent vertical space | 1 | The log sits below the method grid and is always visible. It could be collapsible or moved to a slide-out panel. |
| 4 | Error state page has inline styles | 1 | The "Failed to load" error view uses extensive inline `style=` attributes instead of CSS classes, suggesting it was added hastily. While not user-facing in terms of behavior, it indicates design inconsistency. |

### Recommendations
1. **Should:** Give light mode a dedicated design pass -- adapt the gradient, ensure all semantic colors work well on warm backgrounds.
2. **Should:** Make the Activity Log collapsible (collapsed by default) or move it to a drawer.
3. **Nice:** Consider a collapsible sidebar mode for dense category lists.

---

## H9: Help Users Recognize, Diagnose, and Recover from Errors

**Rating: 3.5/5**

Error handling is present but recovery guidance is often missing.

### Positive Examples
- **Error load page:** Shows the photon name, file path, and actual error message in a styled pre block. The message "Fix the issue and Beam will reload it automatically" provides clear recovery guidance.
- **NEEDS ATTENTION section:** Sidebar explicitly groups problematic photons with warning-colored badges.
- **Toast notifications for errors:** Red error toasts for clipboard failures, network issues, etc.
- **Reconnection banner:** Shows attempt count and provides manual "Retry Now" button.
- **Activity log error entries:** Red left-border for error log items with full error messages.

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | Tool execution errors show raw error text | 3 | When a tool call fails, the error content from MCP is displayed as-is. No wrapping in a friendly error UI with suggested next steps. |
| 2 | "NEEDS ATTENTION" items lack actionable guidance | 2 | The sidebar shows "Error loading" or "missing-config" badge but clicking provides either a raw error dump or a configuration form. No guided wizard or checklist for common issues. |
| 3 | Connection failure after max retries has no recovery path | 2 | After `MCP_MAX_CONNECT_RETRIES` (5), the system "gives up." The UI should offer a manual reconnect button or suggest checking the server. |
| 4 | Marketplace install failures may not provide clear error messages | 2 | Error handling in marketplace operations relies on toast notifications that auto-dismiss. |
| 5 | No error boundary for result rendering crashes | 2 | If a result-viewer encounters malformed data (bad HTML, invalid chart data, etc.), there is no try/catch rendering fallback visible in the component. |

### Recommendations
1. **Must:** Wrap tool execution errors in a structured error card with: error message, possible cause, suggested action.
2. **Should:** After max reconnection attempts, show a persistent banner with "Server may be down. [Start Server] [Retry Connection]" guidance.
3. **Should:** Add error boundaries in result-viewer that gracefully degrade to showing raw JSON when rich rendering fails.

---

## H10: Help and Documentation

**Rating: 3/5**

Minimal but functional help system exists.

### Positive Examples
- **Keyboard shortcuts modal:** Comprehensive, well-organized modal accessible via `?` key.
- **Diagnostics page:** Shows system info (Node version, Photon version, uptime, loaded photons) for debugging.
- **Search placeholder text:** "Search photons... (Cmd+K)" teaches the shortcut.
- **Title tooltips:** Most interactive elements have `title` attributes for hover help.
- **Photon help modal:** Dedicated help content for individual photons (auto-generated markdown).

### Violations

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | No onboarding or first-run experience | 3 | A new user opening Beam for the first time sees the full interface with no guidance on what to do first. No welcome screen, no guided tour, no "getting started" overlay. |
| 2 | No contextual help on forms | 2 | Complex parameters (objects, arrays, nested schemas) have no inline help text or examples. Users must guess the expected format. |
| 3 | Footer `?` icon is too small and ambiguous | 2 | The help icon in the sidebar footer is a tiny button among other tiny buttons. It does not clearly indicate "Help." |
| 4 | No documentation link | 2 | There is no "Docs" or "Learn More" link anywhere in the UI that would take users to external documentation. |
| 5 | Marketplace has no photon README viewer | 2 | Before installing a photon, users cannot read its documentation. Only a short description is visible. |

### Recommendations
1. **Must:** Add a first-run onboarding flow: brief overlay highlighting sidebar, method cards, and invoke forms.
2. **Should:** Add inline help text for complex form parameters (show description from JSON schema).
3. **Should:** Add a "Docs" link in the sidebar footer pointing to external documentation.
4. **Should:** Show photon README in the marketplace before install.

---

## Executive Summary

### Overall Score: 3.7 / 5.0

| Heuristic | Score | Weight | Notes |
|-----------|-------|--------|-------|
| H1: Visibility of System Status | 4.0 | High | Strong connection feedback; needs progress for long operations |
| H2: Match System & Real World | 4.0 | Medium | Good developer-focused language; jargon barrier for newcomers |
| H3: User Control & Freedom | 3.0 | High | Missing undo patterns and destructive action confirmations |
| H4: Consistency & Standards | 4.0 | High | Strong design system; mixed icon paradigms |
| H5: Error Prevention | 3.0 | High | Form data loss risk; missing confirmations |
| H6: Recognition vs. Recall | 4.0 | Medium | Good information visibility; no recent history |
| H7: Flexibility & Efficiency | 4.5 | Medium | Excellent power-user features |
| H8: Aesthetic & Minimalist | 4.0 | Medium | Polished dark mode; light mode needs work |
| H9: Error Recovery | 3.5 | High | Error display present; recovery guidance missing |
| H10: Help & Documentation | 3.0 | High | No onboarding; limited contextual help |

**Strengths:**
- Excellent keyboard-driven workflow for power users
- Comprehensive design token system ensuring visual consistency
- Good connection state management with multiple feedback mechanisms
- Thoughtful responsive design with mobile breakpoints
- Rich result rendering system (tables, charts, cards, markdown, mermaid, etc.)
- Good ARIA attributes in sidebar navigation

**Weaknesses:**
- No onboarding experience for new users
- Missing undo/confirmation patterns for destructive actions
- Form data loss risk on accidental navigation
- Light mode is visually inconsistent with dark mode quality
- Error recovery guidance is too technical/raw
- No recent history or usage tracking

---

## Prioritized Action Items

### Must Fix (Severity 3-4, High Impact)

1. **Add confirmation dialog for photon removal** (H3, H5)
   - Impact: Prevents accidental data loss
   - Effort: Small (single modal component)

2. **Add undo toast for favorite removal** (H3)
   - Impact: Prevents user frustration
   - Effort: Small (reuse toast-manager with action callback)

3. **Autosave form inputs to localStorage** (H5)
   - Impact: Prevents loss of complex form data on accidental navigation
   - Effort: Medium (extend existing `_storageKey` pattern to all forms)

4. **Add elapsed timer to tool execution state** (H1)
   - Impact: Reduces uncertainty during long-running operations
   - Effort: Small (timer in invoke-form during loading state)

5. **Wrap tool execution errors in structured error cards** (H9)
   - Impact: Makes errors actionable instead of raw dumps
   - Effort: Medium (error card component with message/cause/action fields)

6. **Add first-run onboarding overlay** (H10)
   - Impact: Reduces new-user abandonment
   - Effort: Medium (one-time overlay with 3-4 highlight steps)

### Should Fix (Severity 2, Medium Impact)

7. **Add text labels to sidebar footer icons** (H4)
   - Impact: Makes help, diagnostics, theme, and shortcuts discoverable
   - Effort: Small (expand footer layout)

8. **Make Activity Log collapsible** (H8)
   - Impact: Reduces visual clutter; gives more space to method cards
   - Effort: Small (toggle state + CSS transition)

9. **Give light mode a design pass** (H8)
   - Impact: Makes light mode feel intentional, not afterthought
   - Effort: Medium (gradient adaptation, color audit)

10. **Add "Recently Used" sidebar section** (H6)
    - Impact: Reduces navigation time for repeat tasks
    - Effort: Medium (localStorage history + sidebar section)

11. **Show parameter descriptions on method cards** (H6)
    - Impact: Reduces click-through needed to understand a method
    - Effort: Small (tooltip on parameter tags)

12. **Add recovery guidance after max reconnection attempts** (H9)
    - Impact: Prevents users from being stuck on dead screen
    - Effort: Small (conditional banner content)

13. **Add inline help text for complex form parameters** (H10)
    - Impact: Reduces form errors; surfaces JSON schema descriptions
    - Effort: Medium (render `description` from schema below fields)

14. **Add Docs link in sidebar footer** (H10)
    - Impact: Connects in-app experience to full documentation
    - Effort: Trivial

15. **Allow favoriting external MCPs** (H4)
    - Impact: Consistent mental model across all sidebar items
    - Effort: Small (extend favorites Set to include MCP names)

### Nice to Have (Severity 1, Low Impact)

16. **Adopt unified icon system** (H4) -- Replace emoji + text with Lucide or Phosphor icons
17. **Add "Run Last" keyboard shortcut** (H7) -- Re-execute previous tool call
18. **Show photon README in marketplace** (H10) -- Render README before install
19. **Add tag-based browsing in marketplace** (H6) -- Filter by category tags
20. **Add skeleton loading states** (H1) -- Marketplace grid, sidebar on startup
21. **Add deprecation warning toast on execution** (H5) -- Warn before running deprecated methods
22. **Store previous theme for "cancel" on theme panel** (H3) -- Revert if user dismisses

---

## Quick Wins (< 1 hour each)

| # | Fix | Heuristic | Time Est. |
|---|-----|-----------|-----------|
| 1 | Add `title` tooltips to sidebar footer icons with visible text | H4 | 15 min |
| 2 | Add "Docs" link to sidebar footer | H10 | 10 min |
| 3 | Add confirmation `window.confirm()` before photon remove | H3, H5 | 15 min |
| 4 | Add elapsed timer next to "Executing..." spinner | H1 | 20 min |
| 5 | Make Activity Log header clickable to collapse/expand | H8 | 30 min |
| 6 | Add `title` attribute to `.photon-desc` elements for full description on hover | H6 | 10 min |
| 7 | Add undo action to favorite-removal toast | H3 | 30 min |
| 8 | Show post-max-retry recovery banner with manual retry button | H9 | 20 min |
| 9 | Adapt header gradient to use `--accent-primary`/`--accent-secondary` in light mode | H8 | 20 min |
| 10 | Add one-line subtitle under "Photon Beam" for first-time context | H2 | 5 min |

---

## Accessibility Notes (Bonus)

While not a Nielsen heuristic per se, accessibility was observed during the audit:

**Good:**
- ARIA roles on sidebar navigation (`role="navigation"`, `role="listbox"`, `role="search"`)
- `aria-label` on search input, filter buttons, modal dialogs
- `aria-modal="true"` on help modal
- `aria-pressed` on favorites toggle
- `aria-hidden="true"` on decorative elements (glow, overlay)

**Gaps:**
- Only 61 total ARIA attributes across 6 files -- additional components (method-card, result-viewer, marketplace-view, activity-log) have no ARIA attributes
- No `aria-live` region for toast notifications or Activity Log updates
- No skip-to-main-content link
- Keyboard focus indicators may be relying on browser defaults (no custom `:focus-visible` styles observed)
- Color contrast in muted text (`--t-muted: hsl(220, 10%, 65%)` on `--bg-app: hsl(220, 15%, 10%)`) should be verified against WCAG AA (estimated ratio ~5.8:1, likely passes but borderline)

---

*End of audit. File: `/Users/arul/Projects/photon/_photon/beam-nielsen-audit.md`*
