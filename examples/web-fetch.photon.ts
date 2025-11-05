/**
 * Web Fetch - Web content fetching and markdown conversion
 *
 * Replicates the official MCP Fetch server for retrieving web pages and converting to markdown.
 * Supports pagination for large pages and raw content retrieval.
 *
 * Common use cases:
 * - Documentation retrieval: "Fetch the Python requests documentation"
 * - Content analysis: "Get the content from this blog post"
 * - Web scraping: "Fetch and summarize this article"
 *
 * Example: fetch({ url: "https://example.com", max_length: 5000 })
 *
 * Configuration:
 * - user_agent: Custom User-Agent header (optional, default: "Photon-MCP-Fetch/1.0")
 *
 * Dependencies are auto-installed on first run.
 *
 * @dependencies turndown@^7.2.0
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import TurndownService from 'turndown';

export default class WebFetch {
  private turndown: TurndownService;
  private userAgent: string;

  constructor(user_agent?: string) {
    this.userAgent = user_agent || 'Photon-MCP-Fetch/1.0';
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
  }

  async onInitialize() {
    console.error('[web-fetch] ✅ Initialized');
    console.error(`[web-fetch] User-Agent: ${this.userAgent}`);
  }

  /**
   * Fetch a URL and convert to markdown
   * @param url The URL to fetch
   * @param max_length Maximum length of returned content (default: 5000)
   * @param start_index Start index for pagination (default: 0)
   * @param raw Return raw HTML instead of markdown (default: false)
   */
  async fetch(params: {
    url: string;
    max_length?: number;
    start_index?: number;
    raw?: boolean;
  }) {
    try {
      // Validate URL
      const url = new URL(params.url);

      // Fetch content
      const response = await fetch(url.href, {
        headers: {
          'User-Agent': this.userAgent,
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          status: response.status,
        };
      }

      const contentType = response.headers.get('content-type') || '';

      // Get content
      let content = await response.text();

      // Convert HTML to markdown unless raw is requested
      if (!params.raw && contentType.includes('text/html')) {
        content = this.turndown.turndown(content);
      }

      // Apply pagination
      const startIndex = params.start_index || 0;
      const maxLength = params.max_length || 5000;

      const totalLength = content.length;
      const endIndex = Math.min(startIndex + maxLength, totalLength);
      const paginatedContent = content.slice(startIndex, endIndex);

      return {
        success: true,
        url: url.href,
        content: paginatedContent,
        metadata: {
          status: response.status,
          contentType,
          totalLength,
          startIndex,
          endIndex,
          hasMore: endIndex < totalLength,
        },
      };
    } catch (error: any) {
      if (error.code === 'ENOTFOUND') {
        return {
          success: false,
          error: 'Domain not found. Check the URL.',
        };
      }

      if (error.name === 'TypeError' && error.message.includes('Invalid URL')) {
        return {
          success: false,
          error: 'Invalid URL format',
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Fetch multiple URLs in parallel
   * @param urls Array of URLs to fetch
   * @param max_length Maximum length per URL (default: 5000)
   */
  async fetchBatch(params: { urls: string[]; max_length?: number }) {
    try {
      const results = await Promise.all(
        params.urls.map((url) =>
          this.fetch({ url, max_length: params.max_length })
        )
      );

      return {
        success: true,
        count: results.length,
        results,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
