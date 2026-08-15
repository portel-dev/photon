/**
 * Form Components Bundle
 *
 * Canonical entry point for rendering invoke-form with custom input
 * components in pure-view and embedded MCP App contexts. The same bundle is
 * lazy-loaded by Beam and can be inlined into originless resources.
 *
 * Built separately from the main beam.bundle.js with an esbuild alias that
 * replaces the full Beam MCP client with a lightweight host fallback.
 */

// Core form component
import './components/invoke-form.js';

// Custom input components (date-picker, segmented-control, etc.)
import './components/inputs/date-picker.js';
import './components/inputs/number-stepper.js';
import './components/inputs/tag-input.js';
import './components/inputs/star-rating.js';
import './components/inputs/segmented-control.js';
import './components/inputs/code-input.js';
import './components/inputs/markdown-input.js';

// Toast notifications (invoke-form uses showToast)
import './components/toast-manager.js';
