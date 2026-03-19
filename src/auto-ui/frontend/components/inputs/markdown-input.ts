import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { theme, forms } from '../../styles/index.js';

@customElement('markdown-input')
export class MarkdownInput extends LitElement {
  static styles = [
    theme,
    forms,
    css`
      :host {
        display: block;
      }

      .container {
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: var(--bg-glass);
      }

      .container:focus-within {
        border-color: var(--accent-primary);
      }

      .toolbar {
        display: flex;
        gap: 2px;
        padding: 4px 6px;
        background: rgba(0, 0, 0, 0.1);
        border-bottom: 1px solid var(--border-glass);
        flex-wrap: wrap;
      }

      .tool-btn {
        padding: 4px 8px;
        background: none;
        border: none;
        border-radius: 4px;
        color: var(--t-muted);
        cursor: pointer;
        font-size: 13px;
        transition: all 0.1s;
      }

      .tool-btn:hover {
        background: var(--bg-glass-strong, rgba(255, 255, 255, 0.1));
        color: var(--t-primary);
      }

      .mode-tabs {
        display: flex;
        margin-left: auto;
        gap: 2px;
      }

      .mode-tab {
        padding: 4px 10px;
        background: none;
        border: none;
        border-radius: 4px;
        color: var(--t-muted);
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.1s;
      }

      .mode-tab.active {
        background: var(--accent-primary);
        color: #fff;
      }

      .body {
        display: flex;
        min-height: 200px;
      }

      .body.split {
        gap: 1px;
      }

      textarea {
        flex: 1;
        border: none;
        background: none;
        color: var(--t-primary);
        font-family: var(--font-mono, monospace);
        font-size: 13px;
        line-height: 1.6;
        padding: 12px;
        resize: vertical;
        min-height: 200px;
        outline: none;
        width: 100%;
      }

      textarea::placeholder {
        color: var(--t-muted);
        opacity: 0.5;
      }

      .preview {
        flex: 1;
        padding: 12px;
        font-size: 14px;
        line-height: 1.6;
        color: var(--t-primary);
        overflow: auto;
        border-left: 1px solid var(--border-glass);
        min-height: 200px;
      }

      .preview h1 {
        font-size: 20px;
        font-weight: 700;
        margin: 0 0 8px;
      }
      .preview h2 {
        font-size: 17px;
        font-weight: 600;
        margin: 12px 0 6px;
      }
      .preview h3 {
        font-size: 15px;
        font-weight: 600;
        margin: 10px 0 4px;
      }
      .preview p {
        margin: 0 0 8px;
      }
      .preview code {
        background: rgba(0, 0, 0, 0.2);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: var(--font-mono, monospace);
        font-size: 12px;
      }
      .preview pre {
        background: rgba(0, 0, 0, 0.2);
        padding: 10px;
        border-radius: 6px;
        overflow: auto;
        margin: 8px 0;
      }
      .preview pre code {
        background: none;
        padding: 0;
      }
      .preview ul,
      .preview ol {
        margin: 0 0 8px;
        padding-left: 24px;
      }
      .preview li {
        margin: 2px 0;
      }
      .preview a {
        color: var(--accent-primary);
      }
      .preview strong {
        font-weight: 600;
      }
      .preview em {
        font-style: italic;
      }
      .preview blockquote {
        border-left: 3px solid var(--accent-primary);
        padding: 4px 12px;
        margin: 8px 0;
        color: var(--t-muted);
      }
      .preview hr {
        border: none;
        border-top: 1px solid var(--border-glass);
        margin: 12px 0;
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.1);
        font-size: 11px;
        color: var(--t-muted);
        border-top: 1px solid var(--border-glass);
      }

      @media (max-width: 768px) {
        textarea {
          font-size: 14px;
        }
        .body.split {
          flex-direction: column;
        }
        .preview {
          border-left: none;
          border-top: 1px solid var(--border-glass);
        }
      }
    `,
  ];

  @property() value = '';
  @property() placeholder = '';
  @property({ type: Boolean }) hasError = false;

  @state() private _mode: 'write' | 'preview' | 'split' = 'split';

  private _emit(val: string) {
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: val }, bubbles: true, composed: true })
    );
  }

  private _handleInput = (e: Event) => {
    this._emit((e.target as HTMLTextAreaElement).value);
  };

  private _insertMarkdown = (prefix: string, suffix: string = '') => {
    const ta = this.shadowRoot?.querySelector('textarea');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = ta.value;
    const selected = text.substring(start, end);
    const newText = text.substring(0, start) + prefix + selected + suffix + text.substring(end);
    this._emit(newText);
    // Restore cursor position after update
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + prefix.length;
      ta.selectionEnd = start + prefix.length + selected.length;
    });
  };

  /** Simple markdown → HTML (no external deps) */
  private _renderMarkdown(md: string): string {
    let h = md
      // Code blocks (must be before inline code)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      // Headings
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Blockquote
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      // HR
      .replace(/^---$/gm, '<hr>')
      // Bold & italic
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Unordered lists
      .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
      // Paragraphs (lines that aren't already HTML)
      .replace(/^(?!<[hpuolbcda]|<li|<hr|<pre)(.+)$/gm, '<p>$1</p>');

    // Wrap consecutive <li> in <ul>
    h = h.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    return h;
  }

  render() {
    const charCount = (this.value || '').length;
    const wordCount = (this.value || '').trim().split(/\s+/).filter(Boolean).length;

    return html`
      <div class="container">
        <div class="toolbar">
          <button class="tool-btn" @click=${() => this._insertMarkdown('**', '**')} title="Bold">
            B
          </button>
          <button class="tool-btn" @click=${() => this._insertMarkdown('*', '*')} title="Italic">
            <em>I</em>
          </button>
          <button class="tool-btn" @click=${() => this._insertMarkdown('`', '`')} title="Code">
            &lt;/&gt;
          </button>
          <button class="tool-btn" @click=${() => this._insertMarkdown('[', '](url)')} title="Link">
            🔗
          </button>
          <button class="tool-btn" @click=${() => this._insertMarkdown('## ')} title="Heading">
            H
          </button>
          <button class="tool-btn" @click=${() => this._insertMarkdown('- ')} title="List">
            •
          </button>
          <button class="tool-btn" @click=${() => this._insertMarkdown('> ')} title="Quote">
            ❝
          </button>
          <div class="mode-tabs">
            <button
              class="mode-tab ${this._mode === 'write' ? 'active' : ''}"
              @click=${() => {
                this._mode = 'write';
              }}
            >
              Write
            </button>
            <button
              class="mode-tab ${this._mode === 'split' ? 'active' : ''}"
              @click=${() => {
                this._mode = 'split';
              }}
            >
              Split
            </button>
            <button
              class="mode-tab ${this._mode === 'preview' ? 'active' : ''}"
              @click=${() => {
                this._mode = 'preview';
              }}
            >
              Preview
            </button>
          </div>
        </div>

        <div class="body ${this._mode === 'split' ? 'split' : ''}">
          ${this._mode !== 'preview'
            ? html`
                <textarea
                  .value=${this.value || ''}
                  placeholder=${this.placeholder || 'Write markdown...'}
                  @input=${this._handleInput}
                ></textarea>
              `
            : ''}
          ${this._mode !== 'write'
            ? html`
                <div
                  class="preview"
                  .innerHTML=${this._renderMarkdown(this.value || '*No content yet*')}
                ></div>
              `
            : ''}
        </div>

        <div class="footer">
          <span>${wordCount} words, ${charCount} chars</span>
        </div>
      </div>
    `;
  }
}
