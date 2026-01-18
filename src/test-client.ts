#!/usr/bin/env node
/**
 * MCP Test Client - Automated testing for Photon MCPs
 *
 * Spawns MCP servers, sends protocol messages, validates responses
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { PHOTON_VERSION } from './version.js';
import { logger } from './shared/logger.js';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface TestCase {
  name: string;
  method: string;
  params?: any;
  validate: (response: MCPResponse) => boolean | string;
}

export class MCPTestClient {
  private process?: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<
    number | string,
    {
      resolve: (response: MCPResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  async start(command: string, args: string[], env?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });

      if (!this.process.stdout || !this.process.stdin) {
        reject(new Error('Failed to create stdio pipes'));
        return;
      }

      // Read responses line by line
      const rl = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        try {
          const response = JSON.parse(line) as MCPResponse;
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            pending.resolve(response);
          }
        } catch {
          logger.error('[test-client] Failed to parse response:', { line });
        }
      });

      // Log stderr for debugging (MCP servers log to stderr)
      if (this.process.stderr) {
        const stderrRl = readline.createInterface({
          input: this.process.stderr,
          crlfDelay: Infinity,
        });

        stderrRl.on('line', (line) => {
          logger.debug('[mcp-stderr]', { line });
        });
      }

      this.process.on('error', (error) => {
        reject(error);
      });

      // Wait a bit for process to start
      setTimeout(() => resolve(), 100);
    });
  }

  async send(method: string, params?: any): Promise<MCPResponse> {
    if (!this.process?.stdin) {
      throw new Error('MCP process not started');
    }

    const id = ++this.requestId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Set timeout for request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 10000);

      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  async initialize(serverInfo?: { name: string; version: string }): Promise<MCPResponse> {
    return this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: serverInfo || { name: 'test-client', version: PHOTON_VERSION },
    });
  }

  async listTools(): Promise<MCPResponse> {
    return this.send('tools/list');
  }

  async callTool(name: string, args?: any): Promise<MCPResponse> {
    return this.send('tools/call', { name, arguments: args || {} });
  }

  async runTests(tests: TestCase[]): Promise<{ passed: number; failed: number; errors: string[] }> {
    const errors: string[] = [];
    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      try {
        logger.info(`Running: ${test.name}`);
        const response = await this.send(test.method, test.params);

        const result = test.validate(response);
        if (result === true) {
          logger.info(`PASS: ${test.name}`);
          passed++;
        } else {
          const errorMsg = typeof result === 'string' ? result : 'Validation failed';
          logger.error(`FAIL: ${test.name}\n   ${errorMsg}`);
          errors.push(`${test.name}: ${errorMsg}`);
          failed++;
        }
      } catch (error: any) {
        logger.error(`ERROR: ${test.name}\n   ${error.message}`);
        errors.push(`${test.name}: ${error.message}`);
        failed++;
      }
    }

    return { passed, failed, errors };
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = undefined;
    }
  }
}

// Validation helpers
export const validators = {
  hasResult: (response: MCPResponse) =>
    response.result !== undefined || 'Response missing result field',

  hasError: (response: MCPResponse) =>
    response.error !== undefined || 'Response missing error field',

  matchesPattern: (pattern: RegExp, field?: string) => (response: MCPResponse) => {
    const value = field
      ? JSON.stringify(response.result?.[field])
      : JSON.stringify(response.result);
    return pattern.test(value) || `Pattern ${pattern} did not match: ${value}`;
  },

  hasField: (field: string) => (response: MCPResponse) => {
    const parts = field.split('.');
    let current: any = response.result;
    for (const part of parts) {
      if (current?.[part] === undefined) {
        return `Missing field: ${field}`;
      }
      current = current[part];
    }
    return true;
  },

  equals: (expected: any, field?: string) => (response: MCPResponse) => {
    const actual = field ? response.result?.[field] : response.result;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    return match || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  },

  custom: (fn: (result: any) => boolean | string) => (response: MCPResponse) => {
    return fn(response.result);
  },

  and:
    (...validators: Array<(response: MCPResponse) => boolean | string>) =>
    (response: MCPResponse) => {
      for (const validator of validators) {
        const result = validator(response);
        if (result !== true) return result;
      }
      return true;
    },
};
