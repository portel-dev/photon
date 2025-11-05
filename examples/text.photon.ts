/**
 * Text Photon MCP - Advanced text and NLP utilities for AI/agent use
 *
 * Provides normalization, tokenization, similarity, pattern extraction, language detection, sentiment, fuzzy matching, and more.
 *
 * Example: tokenize({ text: "Hello, world!" }) → ["Hello", ",", "world", "!"]
 *
 * Run with: npx photon text.photon.ts --dev
 *
 * @version 2.0.0
 * @author Portel
 * @license MIT
 */

export default class Text {
  /**
   * Normalize text (NFKC, remove diacritics, lower case)
   * @param text Text to normalize
   */
  async normalize(params: { text: string }) {
    const nfkc = params.text.normalize('NFKC');
    const noDiacritics = nfkc.replace(/\p{Diacritic}/gu, '');
    return { result: noDiacritics.toLowerCase() };
  }

  /**
   * Tokenize text into words, punctuation, and numbers
   * @param text Text to tokenize
   */
  async tokenize(params: { text: string }) {
    const tokens = params.text.match(/\w+|[^\w\s]+|\s+/g) || [];
    return { tokens: tokens.filter(t => t.trim().length > 0) };
  }

  /**
   * Compute Levenshtein distance between two strings
   * @param a First string
   * @param b Second string
   */
  async similarity(params: { a: string; b: string }) {
    function levenshtein(a: string, b: string): number {
      const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
      for (let i = 0; i <= a.length; i++) dp[i][0] = i;
      for (let j = 0; j <= b.length; j++) dp[0][j] = j;
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          dp[i][j] = a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
      return dp[a.length][b.length];
    }
    return { distance: levenshtein(params.a, params.b) };
  }

  /**
   * Extract emails, URLs, hashtags, and mentions from text
   * @param text Text to extract patterns from
   */
  async extractPatterns(params: { text: string }) {
    const emails = Array.from(params.text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g), m => m[0]);
    const urls = Array.from(params.text.matchAll(/https?:\/\/[\w.-]+(?:\.[\w\.-]+)+(?:[\w\-\._~:/?#[\]@!$&'()*+,;=]*)?/g), m => m[0]);
    const hashtags = Array.from(params.text.matchAll(/#\w+/g), m => m[0]);
    const mentions = Array.from(params.text.matchAll(/@\w+/g), m => m[0]);
    return { emails, urls, hashtags, mentions };
  }

  /**
   * Detect language (very basic, stub)
   * @param text Text to detect language for
   */
  async detectLanguage(params: { text: string }) {
    // Simple heuristic: check for common English words
    const isEnglish = /\b(the|and|is|of|to|in|that|it|for|on|with)\b/i.test(params.text);
    return { language: isEnglish ? 'en' : 'unknown' };
  }

  /**
   * Sentiment analysis (very basic, stub)
   * @param text Text to analyze
   */
  async sentiment(params: { text: string }) {
    const positive = /\b(good|great|happy|love|excellent|awesome|best|fantastic)\b/i.test(params.text);
    const negative = /\b(bad|sad|hate|terrible|awful|worst|horrible)\b/i.test(params.text);
    let score = 0;
    if (positive) score++;
    if (negative) score--;
    return { score, sentiment: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral' };
  }

  /**
   * Fuzzy match: does pattern approximately match text?
   * @param text Text to search in
   * @param pattern Pattern to match
   * @param maxDistance Maximum Levenshtein distance (default 2)
   */
  async fuzzyMatch(params: { text: string; pattern: string; maxDistance?: number }) {
    function levenshtein(a: string, b: string): number {
      const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
      for (let i = 0; i <= a.length; i++) dp[i][0] = i;
      for (let j = 0; j <= b.length; j++) dp[0][j] = j;
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          dp[i][j] = a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
      return dp[a.length][b.length];
    }
    const maxDist = params.maxDistance ?? 2;
    const found = params.text.split(/\s+/).some(word => levenshtein(word, params.pattern) <= maxDist);
    return { match: found };
  }
}
