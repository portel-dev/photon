/**
 * String Photon MCP - Text and string manipulation utilities
 *
 * Provides comprehensive string operations including case conversion,
 * formatting, parsing, and analysis.
 *
 * Run with: npx photon string.photon.ts --dev
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

export default class StringMCP {
  /**
   * Convert string to uppercase
   * @param text Text to convert
   */
  async uppercase(params: { text: string }) {
    return {
      result: params.text.toUpperCase(),
    };
  }

  /**
   * Convert string to lowercase
   * @param text Text to convert
   */
  async lowercase(params: { text: string }) {
    return {
      result: params.text.toLowerCase(),
    };
  }

  /**
   * Trim whitespace from string
   * @param text Text to trim
   */
  async trim(params: { text: string }) {
    return {
      result: params.text.trim(),
    };
  }

  /**
   * Convert string to slug (URL-friendly)
   * @param text Text to slugify
   */
  async slugify(params: { text: string }) {
    const slug = params.text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return {
      result: slug,
    };
  }

  /**
   * Reverse a string
   * @param text Text to reverse
   */
  async reverse(params: { text: string }) {
    return {
      result: params.text.split('').reverse().join(''),
    };
  }

  /**
   * Count words in a string
   * @param text Text to count words in
   */
  async wordCount(params: { text: string }) {
    const words = params.text.trim().split(/\s+/).filter(w => w.length > 0);
    return {
      count: words.length,
      words,
    };
  }

  /**
   * Split string by delimiter
   * @param text Text to split
   * @param delimiter Delimiter to split by
   */
  async split(params: { text: string; delimiter: string }) {
    return {
      result: params.text.split(params.delimiter),
    };
  }

  /**
   * Replace all occurrences in string
   * @param text Text to search in
   * @param search Text to search for
   * @param replace Text to replace with
   */
  async replace(params: { text: string; search: string; replace: string }) {
    return {
      result: params.text.replace(new RegExp(params.search, 'g'), params.replace),
    };
  }

  /**
   * Capitalize first letter of each word
   * @param text Text to capitalize
   */
  async titleCase(params: { text: string }) {
    const result = params.text
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    return {
      result,
    };
  }

  /**
   * Extract substring
   * @param text Text to extract from
   * @param start Start index
   * @param length Length of substring (optional)
   */
  async substring(params: { text: string; start: number; length?: number }) {
    const result = params.length
      ? params.text.substring(params.start, params.start + params.length)
      : params.text.substring(params.start);

    return {
      result,
    };
  }
}
