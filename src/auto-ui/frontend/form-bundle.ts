/**
 * Form Components Bundle
 *
 * Minimal entry point for rendering invoke-form with custom input components
 * in pure-view context (no beam-app chrome). Lazy-loaded by the bridge when
 * data-view="form" is set on an element.
 *
 * Built separately from the main beam.bundle.js with an esbuild alias
 * that replaces mcpClient with a postMessage-based shim.
 */

// Core form component
import './components/invoke-form.js';

// Custom input components (date-picker, segmented-control, etc.)
import './components/inputs/date-picker.js';
import './components/inputs/tag-input.js';
import './components/inputs/star-rating.js';
import './components/inputs/segmented-control.js';
import './components/inputs/code-input.js';
import './components/inputs/markdown-input.js';

// Toast notifications (invoke-form uses showToast)
import './components/toast-manager.js';
