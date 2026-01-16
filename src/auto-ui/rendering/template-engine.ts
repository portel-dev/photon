/**
 * Template Engine - Custom HTML Template Support
 *
 * Enables custom UI templates that map elements to class methods.
 * Perfect for specialized interfaces like:
 * - TV remote control
 * - Numeric keypad
 * - Dashboard with gauges
 * - Media player controls
 *
 * Template Binding Attributes:
 * - data-method: Method to call on click
 * - data-args: JSON arguments to pass
 * - data-result: Container for method output
 * - data-bind: Live data binding
 * - data-if: Conditional visibility
 */

export interface TemplateBinding {
  element: string; // CSS selector
  method: string; // Method name
  args?: any; // Arguments to pass
  event?: string; // Event to listen for (default: 'click')
}

export interface TemplateConfig {
  id: string; // Template identifier
  path: string; // Path to template file
  bindings?: TemplateBinding[]; // Pre-defined bindings (optional)
}

/**
 * Parse template HTML and extract data-method bindings
 */
export function parseTemplateBindings(html: string): TemplateBinding[] {
  const bindings: TemplateBinding[] = [];

  // Match elements with data-method attribute
  const methodRegex = /data-method=["']([^"']+)["']/g;
  const argsRegex = /data-args=["']([^"']+)["']/g;

  // Note: This is a simplified parser - actual implementation
  // would use DOM parsing in the browser

  return bindings;
}

/**
 * Generate JavaScript for template engine (to embed in HTML)
 */
export function generateTemplateEngineJS(): string {
  return `
// ==========================================================================
// Template Engine - Custom UI Template Support
// ==========================================================================

/**
 * Initialize template bindings for custom UI
 * Finds all elements with data-method and binds click handlers
 */
function initTemplateBindings(container, invokeMethod) {
  // Find all elements with data-method attribute
  const methodElements = container.querySelectorAll('[data-method]');

  methodElements.forEach(el => {
    const methodName = el.getAttribute('data-method');
    const argsStr = el.getAttribute('data-args');
    const eventType = el.getAttribute('data-event') || 'click';

    // Parse args if present
    let args = {};
    if (argsStr) {
      try {
        args = JSON.parse(argsStr);
      } catch (e) {
        console.warn('Invalid data-args JSON:', argsStr);
      }
    }

    // Add event listener
    el.addEventListener(eventType, async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Add loading state
      el.classList.add('template-loading');

      try {
        // Invoke the method
        const result = await invokeMethod(methodName, args);

        // Find result container and update
        const resultContainer = container.querySelector('[data-result]');
        if (resultContainer && result !== undefined) {
          // Use smart rendering for the result
          const rendered = renderSmartResult(result, null, null);
          if (rendered) {
            resultContainer.innerHTML = rendered;
          } else {
            resultContainer.textContent = JSON.stringify(result, null, 2);
          }
        }
      } catch (error) {
        console.error('Template method error:', error);
        const resultContainer = container.querySelector('[data-result]');
        if (resultContainer) {
          resultContainer.innerHTML = '<div class="template-error">' + escapeHtml(error.message) + '</div>';
        }
      } finally {
        el.classList.remove('template-loading');
      }
    });
  });

  // Handle data-bind for live updates
  const bindElements = container.querySelectorAll('[data-bind]');
  bindElements.forEach(el => {
    const bindKey = el.getAttribute('data-bind');
    // Store reference for later updates
    el._bindKey = bindKey;
  });

  // Handle data-if for conditional visibility
  const ifElements = container.querySelectorAll('[data-if]');
  ifElements.forEach(el => {
    const condition = el.getAttribute('data-if');
    el._ifCondition = condition;
    // Initially hidden until condition is evaluated
    el.style.display = 'none';
  });
}

/**
 * Update bound elements with new data
 */
function updateTemplateBindings(container, data) {
  // Update data-bind elements
  const bindElements = container.querySelectorAll('[data-bind]');
  bindElements.forEach(el => {
    const bindKey = el._bindKey || el.getAttribute('data-bind');
    if (bindKey && data[bindKey] !== undefined) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = data[bindKey];
      } else {
        el.textContent = data[bindKey];
      }
    }
  });

  // Update data-if elements
  const ifElements = container.querySelectorAll('[data-if]');
  ifElements.forEach(el => {
    const condition = el._ifCondition || el.getAttribute('data-if');
    if (condition) {
      // Evaluate condition against data
      const value = data[condition];
      el.style.display = value ? '' : 'none';
    }
  });
}

/**
 * Load and render a custom template
 */
async function loadTemplate(templatePath, container, invokeMethod) {
  try {
    // Fetch template content
    const response = await fetch('/api/template?path=' + encodeURIComponent(templatePath));
    if (!response.ok) {
      throw new Error('Failed to load template: ' + response.statusText);
    }

    const html = await response.text();
    container.innerHTML = html;

    // Initialize bindings
    initTemplateBindings(container, invokeMethod);

    return true;
  } catch (error) {
    console.error('Template load error:', error);
    container.innerHTML = '<div class="template-error">Failed to load template: ' + escapeHtml(error.message) + '</div>';
    return false;
  }
}
`;
}

/**
 * Generate CSS for template engine
 */
export function generateTemplateEngineCSS(): string {
  return `
/* Template Engine Styles */
.template-loading {
  opacity: 0.6;
  pointer-events: none;
  position: relative;
}

.template-loading::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: template-spin 0.8s linear infinite;
}

@keyframes template-spin {
  to { transform: rotate(360deg); }
}

.template-error {
  color: var(--error);
  padding: 12px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 8px;
  font-size: 0.875rem;
}

/* Template button styles */
[data-method] {
  cursor: pointer;
  transition: all 0.15s ease;
}

[data-method]:hover {
  filter: brightness(1.1);
}

[data-method]:active {
  transform: scale(0.98);
}

/* Result container */
[data-result] {
  min-height: 40px;
  padding: 8px;
  border-radius: 8px;
  background: var(--bg-tertiary);
}

[data-result]:empty::before {
  content: '—';
  color: var(--text-muted);
}
`;
}
