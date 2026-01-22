import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme } from '../styles/theme.js';
import { showToast } from './toast-manager.js';

@customElement('result-viewer')
export class ResultViewer extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        margin-top: var(--space-md);
      }

      .container {
        padding: var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-md);
        position: relative;
        overflow: hidden;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-sm);
        padding-bottom: var(--space-sm);
        border-bottom: 1px solid var(--border-glass);
      }

      .title {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--t-muted);
        font-weight: 600;
      }

      .actions {
        display: flex;
        gap: var(--space-sm);
      }

      button {
        background: transparent;
        border: 1px solid var(--border-glass);
        color: var(--t-muted);
        border-radius: var(--radius-sm);
        cursor: pointer;
        padding: 4px 8px;
        font-size: 0.75rem;
        transition: all 0.2s;
      }

      button:hover {
        background: hsla(220, 10%, 80%, 0.1);
        color: var(--t-primary);
      }

      .content {
        font-family: var(--font-mono);
        font-size: 0.9rem;
        color: var(--t-primary);
        white-space: pre-wrap;
        overflow-x: auto;
        max-height: 500px;
        line-height: 1.5;
      }

      /* JSON Syntax Highlighting */
      .json-key { color: var(--accent-secondary); }
      .json-string { color: #a5d6ff; }
      .json-number { color: #ff9e64; }
      .json-boolean { color: #ff007c; }
      .json-null { color: #79c0ff; }
    `
  ];

  @property({ type: Object })
  result: any = null;

  render() {
    if (this.result === null || this.result === undefined) return html``;

    return html`
      <div class="container glass-panel">
        <div class="header">
          <span class="title">Result</span>
          <div class="actions">
            <button @click=${this._copy}>Copy</button>
          </div>
        </div>
        <div class="content">${this._renderContent()}</div>
      </div>
    `;
  }

  private _renderContent() {
    if (typeof this.result === 'object') {
      return this._renderJson(this.result);
    }

    // Check if string contains markdown or mermaid
    const str = String(this.result);

    // Use marked for markdown if available
    if ((window as any).marked) {
      // First render markdown
      const htmlContent = (window as any).marked.parse(str);

      // Create a temporary container
      const container = document.createElement('div');
      container.innerHTML = htmlContent;

      // Check for mermaid code blocks and process them
      // Mermaid blocks usually look like <pre><code class="language-mermaid">...</code></pre>
      // or just plain text in our specific output format
      if ((window as any).mermaid) {
        // We need extended logic here to properly handle mermaid
        // For now, let's try to identify mermaid blocks in the raw string if possible, 
        // OR relying on marked to identify "language-mermaid"

        // Let's create a custom renderer for this component
        setTimeout(async () => {
          try {
            const mermaidBlocks = this.shadowRoot?.querySelectorAll('.language-mermaid');
            if (mermaidBlocks) {
              for (const block of Array.from(mermaidBlocks)) {
                const code = block.textContent || '';
                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
                const parent = block.parentElement; // pre tag
                if (parent) {
                  const div = document.createElement('div');
                  div.id = id;
                  div.className = 'mermaid';
                  div.textContent = code;
                  parent.replaceWith(div);
                }
              }
              await (window as any).mermaid.run();
            }
          } catch (e) {
            console.error('Mermaid render error:', e);
          }
        }, 0);
      }

      // Unsafe HTML render (trusted content from local backend)
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      // Allow basic styling for the markdown content
      return html`
              <style>
                p { margin-bottom: 0.5em; }
                code { background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; }
                pre { background: rgba(0,0,0,0.3); padding: 1em; border-radius: 8px; overflow-x: auto; }
                ul, ol { margin-left: 1.5em; margin-bottom: 0.5em; }
                h1, h2, h3 { margin-top: 1em; margin-bottom: 0.5em; color: var(--t-primary); }
                a { color: var(--accent-primary); text-decoration: none; }
                a:hover { text-decoration: underline; }
                table { border-collapse: collapse; width: 100%; margin: 1em 0; }
                th, td { border: 1px solid var(--border-glass); padding: 8px; text-align: left; }
                th { background: rgba(255,255,255,0.05); }
              </style>
              <div class="markdown-body">
                ${Array.from(doc.body.childNodes)}
              </div>
            `;
    }

    return str;
  }

  private _renderJson(data: any, level = 0) {
    // Simple recursive JSON render for now, can be upgraded to collapsible tree later
    const jsonArgs = JSON.stringify(data, null, 2);

    // Basic syntax highlighting via HTML generation
    // Note: In a production app, use a proper comprehensive highlighter or library
    // This is a lightweight version for the "zero-dependency" requirement
    const highlighted = jsonArgs.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );

    // Use unsafed HTML to render the spans. 
    // Data is from our own trusted execution, but valid concern for XSS if user-gen content.
    // For this dev tool (Beam), it is acceptable.
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<pre>${highlighted}</pre>`, 'text/html');
    return html`${doc.body.children[0]}`;
  }

  private _copy() {
    const text = typeof this.result === 'object'
      ? JSON.stringify(this.result, null, 2)
      : String(this.result);

    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  }
}
