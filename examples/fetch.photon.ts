/**
 * Fetch Photon MCP - HTTP request utilities
 *
 * Provides HTTP client operations: GET, POST, PUT, DELETE, and file downloads.
 * Supports JSON, form data, and custom headers. Built on Node.js fetch API.
 *
 * Example: get({ url: "https://api.github.com/users/octocat" })
 *
 * Run with: npx photon fetch.photon.ts --dev
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import { writeFile } from 'fs/promises';
import { basename } from 'path';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export default class Fetch {
  /**
   * HTTP GET request
   * @param url URL to fetch
   * @param headers Optional HTTP headers as JSON object
   */
  async get(params: { url: string; headers?: Record<string, string> }) {
    return this._request('GET', params.url, { headers: params.headers });
  }

  /**
   * HTTP POST request
   * @param url URL to post to
   * @param body Request body (JSON object or string)
   * @param headers Optional HTTP headers as JSON object
   */
  async post(params: { url: string; body?: any; headers?: Record<string, string> }) {
    return this._request('POST', params.url, {
      body: params.body,
      headers: params.headers,
    });
  }

  /**
   * HTTP PUT request
   * @param url URL to put to
   * @param body Request body (JSON object or string)
   * @param headers Optional HTTP headers as JSON object
   */
  async put(params: { url: string; body?: any; headers?: Record<string, string> }) {
    return this._request('PUT', params.url, {
      body: params.body,
      headers: params.headers,
    });
  }

  /**
   * HTTP DELETE request
   * @param url URL to delete
   * @param headers Optional HTTP headers as JSON object
   */
  async delete(params: { url: string; headers?: Record<string, string> }) {
    return this._request('DELETE', params.url, { headers: params.headers });
  }

  /**
   * HTTP PATCH request
   * @param url URL to patch
   * @param body Request body (JSON object or string)
   * @param headers Optional HTTP headers as JSON object
   */
  async patch(params: { url: string; body?: any; headers?: Record<string, string> }) {
    return this._request('PATCH', params.url, {
      body: params.body,
      headers: params.headers,
    });
  }

  /**
   * Download file from URL to local filesystem
   * @param url URL to download from
   * @param outputPath Output file path (relative to CWD)
   * @param headers Optional HTTP headers as JSON object
   */
  async download(params: { url: string; outputPath: string; headers?: Record<string, string> }) {
    try {
      const response = await fetch(params.url, {
        method: 'GET',
        headers: params.headers || {},
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const buffer = await response.arrayBuffer();
      await writeFile(params.outputPath, Buffer.from(buffer));

      return {
        success: true,
        message: `File downloaded to ${params.outputPath}`,
        size: buffer.byteLength,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * GraphQL query
   * @param url GraphQL endpoint URL
   * @param query GraphQL query string
   * @param variables Optional GraphQL variables as JSON object
   * @param headers Optional HTTP headers as JSON object
   */
  async graphql(params: {
    url: string;
    query: string;
    variables?: Record<string, any>;
    headers?: Record<string, string>;
  }) {
    try {
      const response = await fetch(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(params.headers || {}),
        },
        body: JSON.stringify({
          query: params.query,
          variables: params.variables || {},
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          data,
        };
      }

      if (data.errors) {
        return {
          success: false,
          error: 'GraphQL errors',
          errors: data.errors,
          data: data.data,
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // Private helper methods

  private async _request(
    method: HttpMethod,
    url: string,
    options: {
      body?: any;
      headers?: Record<string, string>;
    } = {}
  ) {
    try {
      const headers: Record<string, string> = {
        ...(options.headers || {}),
      };

      // Auto-set Content-Type for JSON bodies
      if (options.body && typeof options.body === 'object' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: options.body
          ? typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body)
          : undefined,
      });

      const contentType = response.headers.get('content-type') || '';
      let data: any;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          statusText: response.statusText,
          error: `HTTP ${response.status}: ${response.statusText}`,
          data,
        };
      }

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        data,
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
