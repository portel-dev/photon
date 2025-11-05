/**
 * SocialFormat Photon MCP - Markdown to Social Media Formatter
 *
 * A robust parser-based Markdown converter that handles:
 * - Nested formatting (bold within italic, etc)
 * - Platform-specific syntax (WhatsApp vs Telegram)
 * - Character limits (Twitter 280, LinkedIn 3000)
 * - Links and mentions
 * - Code blocks and inline code
 *
 * Example: 
 * ```typescript
 * const result = await socialFormat.convert({
 *   markdown: "**Bold _and italic_** with `code` and [link](https://example.com)",
 *   platform: "whatsapp"
 * });
 * // Returns: "*Bold _and italic_* with ```code``` and link (https://example.com)"
 * ```
 *
 * Supported platforms and their features:
 * - WhatsApp: *bold*, _italic_, ~strike~, ```code```
 * - Telegram: __bold__, _italic_, ~~strike~~, `code`
 * - Facebook: Basic text, links, mentions
 * - LinkedIn: Basic text, links, mentions (3000 char limit)
 * - Twitter: Basic text, links, mentions (280 char limit)
 *
 * Converts Markdown-formatted text to the closest supported format for various social media platforms (WhatsApp, Facebook, LinkedIn, etc).
 * Handles bold, italic, strikethrough, code, and other common styles, mapping them to each platform's supported syntax.
 *
 * Example: socialFormat.convert({
 *   markdown: "**Bold** _Italic_ ~Strikethrough~ `Code`",
 *   platform: "whatsapp"
 * })
 *
 * Supported platforms: whatsapp, facebook, linkedin, telegram, twitter
 *
 * Dependencies: none
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

type FormattingRules = {
  // Text styling
  headingUnderline: string;        // Character for underlining H1, e.g., '=' or '─'
  bulletPoint: string;             // Character for bullet points, e.g., '•' or '○' or '*'
  horizontalRule: string;          // Character for horizontal rules, e.g., '─' or '—'
  quotePrefix: string;            // Character for quotes, e.g., '>' or '❝'
  codeBlockStyle: 'indent' | 'box' | 'plain'; // How to format code blocks
  emphasisStyle: 'uppercase' | 'spacing' | 'quotes'; // How to emphasize text
  
  // Spacing
  paragraphSpacing: number;       // Number of newlines between paragraphs
  listSpacing: number;           // Number of newlines between list items
  headingSpacing: number;        // Number of newlines around headings
  
  // Link formatting
  linkStyle: 'parentheses' | 'brackets' | 'plain'; // How to format links
  
  // Special characters
  preserveEmoji: boolean;        // Whether to preserve emoji or convert to text
  useUnicodeSymbols: boolean;    // Whether to use unicode symbols for formatting
};

const defaultRules: FormattingRules = {
  headingUnderline: '═',
  bulletPoint: '•',
  horizontalRule: '─',
  quotePrefix: '❝',
  codeBlockStyle: 'indent',
  emphasisStyle: 'spacing',
  paragraphSpacing: 2,
  listSpacing: 1,
  headingSpacing: 2,
  linkStyle: 'parentheses',
  preserveEmoji: true,
  useUnicodeSymbols: true
};

type Token = {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'mention' | 'hashtag' | 'list' | 'codeblock' | 'strikethrough' | 'heading' | 'quote';
  content: string;
  children?: Token[];
  level?: number; // For headings (h1, h2, etc.)
};

type ConvertResult = {
  result: string;
  operation: 'convert';
  platform: string;
};

export default class SocialFormat {
  private rules: FormattingRules;

  constructor(rules: Partial<FormattingRules> = {}) {
    this.rules = { ...defaultRules, ...rules };
  }
  private parseMarkdown(markdown: string): Token[] {
    const tokens: Token[] = [];
    let current = 0;
    const len = markdown.length;

    while (current < len) {
      // Check for headings
      if (markdown[current] === '#') {
        let level = 1;
        while (markdown[current + level] === '#') level++;
        const end = markdown.indexOf('\n', current);
        if (end !== -1) {
          tokens.push({
            type: 'heading',
            level,
            content: markdown.slice(current + level, end).trim(),
            children: this.parseMarkdown(markdown.slice(current + level, end).trim())
          });
          current = end + 1;
          continue;
        }
      }

      // Check for block quotes
      if (markdown[current] === '>' && (current === 0 || markdown[current - 1] === '\n')) {
        const end = markdown.indexOf('\n', current);
        if (end !== -1) {
          tokens.push({
            type: 'quote',
            content: markdown.slice(current + 1, end).trim(),
            children: this.parseMarkdown(markdown.slice(current + 1, end).trim())
          });
          current = end + 1;
          continue;
        }
      }

      // Check for code blocks first to avoid parsing markdown inside them
      if (markdown.startsWith('```', current)) {
        const end = markdown.indexOf('```', current + 3);
        if (end !== -1) {
          tokens.push({
            type: 'codeblock',
            content: markdown.slice(current + 3, end)
          });
          current = end + 3;
          continue;
        }
      }

      // Check for inline code
      if (markdown[current] === '`') {
        const end = markdown.indexOf('`', current + 1);
        if (end !== -1) {
          tokens.push({
            type: 'code',
            content: markdown.slice(current + 1, end)
          });
          current = end + 1;
          continue;
        }
      }

      // Check for bold
      if (markdown.startsWith('**', current)) {
        const end = markdown.indexOf('**', current + 2);
        if (end !== -1) {
          tokens.push({
            type: 'bold',
            content: markdown.slice(current + 2, end),
            children: this.parseMarkdown(markdown.slice(current + 2, end))
          });
          current = end + 2;
          continue;
        }
      }

      // Check for italic
      if (markdown[current] === '_' || markdown[current] === '*') {
        const end = markdown.indexOf(markdown[current], current + 1);
        if (end !== -1) {
          tokens.push({
            type: 'italic',
            content: markdown.slice(current + 1, end),
            children: this.parseMarkdown(markdown.slice(current + 1, end))
          });
          current = end + 1;
          continue;
        }
      }

      // Check for strikethrough
      if (markdown.startsWith('~~', current)) {
        const end = markdown.indexOf('~~', current + 2);
        if (end !== -1) {
          tokens.push({
            type: 'strikethrough',
            content: markdown.slice(current + 2, end),
            children: this.parseMarkdown(markdown.slice(current + 2, end))
          });
          current = end + 2;
          continue;
        }
      }

      // Check for links
      if (markdown[current] === '[') {
        const titleEnd = markdown.indexOf(']', current);
        if (titleEnd !== -1 && markdown[titleEnd + 1] === '(') {
          const linkEnd = markdown.indexOf(')', titleEnd);
          if (linkEnd !== -1) {
            tokens.push({
              type: 'link',
              content: markdown.slice(current + 1, titleEnd),
              children: [{ 
                type: 'text', 
                content: markdown.slice(titleEnd + 2, linkEnd) 
              }]
            });
            current = linkEnd + 1;
            continue;
          }
        }
      }

      // Check for mentions and hashtags
      if (markdown[current] === '@' || markdown[current] === '#') {
        const end = markdown.indexOf(' ', current);
        const actualEnd = end !== -1 ? end : len;
        tokens.push({
          type: markdown[current] === '@' ? 'mention' : 'hashtag',
          content: markdown.slice(current, actualEnd)
        });
        current = actualEnd;
        continue;
      }

      // Plain text
      let textEnd = markdown.indexOf('**', current);
      ['_', '*', '`', '[', '@', '#', '~~'].forEach(char => {
        const idx = markdown.indexOf(char, current);
        if (idx !== -1 && (textEnd === -1 || idx < textEnd)) {
          textEnd = idx;
        }
      });

      if (textEnd === -1) textEnd = len;
      if (textEnd > current) {
        tokens.push({
          type: 'text',
          content: markdown.slice(current, textEnd)
        });
        current = textEnd;
      } else {
        current++;
      }
    }

    return tokens;
  }

  private formatTokens(tokens: Token[], platform: string): string {
    return tokens.map(token => {
      switch (platform) {
        case 'whatsapp':
          return this.formatWhatsApp(token);
        case 'telegram':
          return this.formatTelegram(token);
        case 'facebook':
          return this.formatFacebook(token);
        case 'linkedin':
          return this.formatLinkedIn(token);
        case 'twitter':
          return this.formatTwitter(token);
        default:
          return token.content;
      }
    }).join('');
  }

  private formatWhatsApp(token: Token): string {
    switch (token.type) {
      case 'bold':
        return `*${token.children ? this.formatTokens(token.children, 'whatsapp') : token.content}*`;
      case 'italic':
        return `_${token.children ? this.formatTokens(token.children, 'whatsapp') : token.content}_`;
      case 'strikethrough':
        return `~${token.children ? this.formatTokens(token.children, 'whatsapp') : token.content}~`;
      case 'code':
      case 'codeblock':
        return `\`\`\`${token.content}\`\`\``;
      case 'link':
        return `${token.content} (${token.children?.[0].content})`;
      case 'mention':
        return token.content;
      default:
        return token.content;
    }
  }

  private formatPlainText(token: Token, addSpacing: boolean = false): string {
    const { rules } = this;
    
    switch (token.type) {
      case 'heading':
        const level = token.level || 1;
        const content = token.children ? 
          this.formatTokens(token.children, 'plain') : 
          token.content;
        
        if (level === 1 && rules.headingUnderline) {
          const underline = rules.headingUnderline.repeat(content.length);
          return `\n${content}\n${underline}${'\n'.repeat(rules.headingSpacing)}`;
        }
        return `\n${content}${'\n'.repeat(rules.headingSpacing)}`;

      case 'bold':
        const boldContent = token.children ? 
          this.formatTokens(token.children, 'plain') : 
          token.content;
        
        switch (rules.emphasisStyle) {
          case 'uppercase':
            return addSpacing ? ` ${boldContent.toUpperCase()} ` : boldContent.toUpperCase();
          case 'spacing':
            return ` ${boldContent} `;
          case 'quotes':
            return `"${boldContent}"`;
          default:
            return boldContent;
        }

      case 'italic':
        const italicContent = token.children ?
          this.formatTokens(token.children, 'plain') :
          token.content;
        return rules.emphasisStyle === 'spacing' ? ` ${italicContent} ` : italicContent;

      case 'code':
      case 'codeblock':
        const code = token.content;
        switch (rules.codeBlockStyle) {
          case 'box':
            const lines = code.split('\n');
            const width = Math.max(...lines.map(l => l.length));
            const top = rules.useUnicodeSymbols ? '┌' + '─'.repeat(width + 2) + '┐' : '+' + '-'.repeat(width + 2) + '+';
            const bottom = rules.useUnicodeSymbols ? '└' + '─'.repeat(width + 2) + '┘' : '+' + '-'.repeat(width + 2) + '+';
            const formattedLines = lines.map(l => 
              (rules.useUnicodeSymbols ? '│ ' : '| ') + 
              l.padEnd(width) + 
              (rules.useUnicodeSymbols ? ' │' : ' |')
            );
            return `\n${top}\n${formattedLines.join('\n')}\n${bottom}\n`;
          case 'indent':
            return '\n    ' + code.split('\n').join('\n    ') + '\n';
          default:
            return `\n${code}\n`;
        }

      case 'quote':
        const quoteContent = token.children ?
          this.formatTokens(token.children, 'plain') :
          token.content;
        return `\n${rules.quotePrefix} ${quoteContent}\n`;

      case 'link':
        const linkText = token.content;
        const url = token.children?.[0].content;
        switch (rules.linkStyle) {
          case 'parentheses':
            return `${linkText} (${url})`;
          case 'brackets':
            return `${linkText} [${url}]`;
          default:
            return `${linkText} ${url}`;
        }

      case 'list':
        return `\n${rules.bulletPoint} ${token.content}${'\n'.repeat(rules.listSpacing)}`;

      case 'mention':
      case 'hashtag':
        return token.content; // Always preserve @mentions and #hashtags

      default:
        const text = token.content;
        return rules.preserveEmoji ? text : text.replace(/[\u{1F300}-\u{1F6FF}]/gu, ''); // Strip emoji if configured
    }
  }

  private formatTelegram(token: Token): string {
    // Telegram: Only plain text with @mentions and #hashtags
    return this.formatPlainText(token, true);
  }

  private formatFacebook(token: Token): string {
    // Facebook: Only plain text with @mentions and #hashtags
    return this.formatPlainText(token, true);
  }

  private formatLinkedIn(token: Token): string {
    // LinkedIn: Only plain text with @mentions and #hashtags
    return this.formatPlainText(token, true);
  }

  private formatTwitter(token: Token): string {
    // Twitter: Only plain text with @mentions and #hashtags
    return this.formatPlainText(token, true);
  }

  private truncateForTwitter(text: string): string {
    return text.length <= 280 ? text : text.slice(0, 277) + '...';
  }

  private optimizeForLinkedIn(text: string): string {
    // LinkedIn has a 3000 character limit for posts
    return text.length <= 3000 ? text : text.slice(0, 2997) + '...';
  }

  /**
   * Convert Markdown to the closest supported format for a given social media platform.
   * @param markdown The Markdown string to convert
   * @param platform The target platform (e.g., 'whatsapp', 'facebook', 'linkedin', 'telegram', 'twitter')
   */
  /**
   * Convert Markdown to the closest supported format for a given social media platform.
   * @param markdown The Markdown string to convert
   * @param platform The target platform (e.g., 'whatsapp', 'facebook', 'linkedin', 'telegram', 'twitter')
   * @param rules Optional formatting rules to override the defaults
   * @returns A promise that resolves to the converted text and operation details
   */
  async convert(params: { 
    markdown: string; 
    platform: string;
    rules?: Partial<FormattingRules>;
  }): Promise<ConvertResult> {
    if (params.rules) {
      this.rules = { ...defaultRules, ...params.rules };
    }
    const { markdown, platform } = params;
    const tokens = this.parseMarkdown(markdown);
    const formatted = this.formatTokens(tokens, platform.toLowerCase());
    
    // Apply platform-specific post-processing
    const lowercasePlatform = platform.toLowerCase();
    if (lowercasePlatform === 'twitter') {
      return { result: this.truncateForTwitter(formatted), operation: 'convert', platform };
    } else if (lowercasePlatform === 'linkedin') {
      return { result: this.optimizeForLinkedIn(formatted), operation: 'convert', platform };
    }
    return { result: formatted, operation: 'convert', platform };
  }
}
