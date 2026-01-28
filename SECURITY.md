# Photon Security Guide

Security best practices and audit checklist for photon development.

---

## Table of Contents

- [Overview](#overview)
- [Security Checklist](#security-checklist)
- [Input Validation](#input-validation)
- [Secrets Management](#secrets-management)
- [File System Security](#file-system-security)
- [Command Injection](#command-injection)
- [SQL Injection](#sql-injection)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Audit Logging](#audit-logging)
- [Common Vulnerabilities](#common-vulnerabilities)

---

## Overview

Photons run with the same privileges as the user invoking them. This makes security critical:

- **AI assistants** invoke tools automatically based on user prompts
- **Bad input** can lead to file deletion, data leaks, or system compromise
- **External integrations** must be authenticated securely

---

## Security Checklist

### Before Publishing

- [ ] **Input validation** - All parameters validated before use
- [ ] **Path traversal** - File paths normalized and sandboxed
- [ ] **Command injection** - No user input in shell commands
- [ ] **SQL injection** - Parameterized queries only
- [ ] **Secrets** - No hardcoded credentials, use environment variables
- [ ] **Error messages** - No sensitive info in errors
- [ ] **Rate limiting** - Prevent abuse of expensive operations
- [ ] **Audit logging** - Log security-relevant operations

### Runtime Security

- [ ] **Minimal permissions** - Request only needed access
- [ ] **Least privilege** - Run as unprivileged user
- [ ] **Network isolation** - Limit outbound connections
- [ ] **Resource limits** - Set memory and CPU limits

---

## Input Validation

### Basic Validation

```typescript
import { validateOrThrow, isPositive, isString, inRange } from '@portel/photon-core';

async search(params: { query: string; limit?: number }) {
  // Validate required fields
  if (!params.query || typeof params.query !== 'string') {
    throw new Error('Query is required and must be a string');
  }

  // Validate optional fields with defaults
  const limit = params.limit ?? 10;
  if (typeof limit !== 'number' || limit < 1 || limit > 100) {
    throw new Error('Limit must be between 1 and 100');
  }

  // Sanitize input
  const query = params.query.trim().slice(0, 1000);

  // Safe to use
  return this.performSearch(query, limit);
}
```

### Schema Validation

Use TypeScript types and JSDoc for automatic validation:

```typescript
/**
 * Search for items
 * @param query Search query {@min 1} {@max 1000}
 * @param limit Result limit {@min 1} {@max 100} {@default 10}
 */
async search(params: {
  query: string;
  limit?: number;
}): Promise<SearchResult[]> {
  // TypeScript + JSDoc constraints are validated by runtime
}
```

### Dangerous Patterns to Avoid

```typescript
// BAD: No validation
async deleteFile(params: { path: string }) {
  await fs.unlink(params.path);  // Deletes any file!
}

// GOOD: Validate and sandbox
async deleteFile(params: { path: string }) {
  const resolved = path.resolve(this.workDir, params.path);

  // Ensure path is within sandbox
  if (!resolved.startsWith(this.workDir)) {
    throw new Error('Access denied: path outside working directory');
  }

  // Ensure file exists and is a file (not directory)
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error('Can only delete files');
  }

  await fs.unlink(resolved);
}
```

---

## Secrets Management

### Environment Variables

```typescript
/**
 * My API Client
 * @mcp github
 */
export default class MyApiClient {
  constructor(
    /** @env MY_API_KEY - API key for authentication */
    private apiKey: string,
    /** @env MY_API_SECRET - API secret */
    private apiSecret: string
  ) {
    if (!apiKey || !apiSecret) {
      throw new Error('API credentials required');
    }
  }
}
```

### Never Hardcode Secrets

```typescript
// BAD: Hardcoded secret
const API_KEY = 'sk-abc123...';

// GOOD: Environment variable
const API_KEY = process.env.MY_API_KEY;
if (!API_KEY) {
  throw new Error('MY_API_KEY environment variable required');
}
```

### Config File Security

```typescript
// Secrets in config should be encrypted or reference env vars
{
  "apiKey": "${MY_API_KEY}",
  "database": "${DATABASE_URL}"
}
```

---

## File System Security

### Path Traversal Prevention

```typescript
import * as path from 'path';
import * as fs from 'fs/promises';

class FileManager {
  private workDir: string;

  private resolveSafe(userPath: string): string {
    // Normalize and resolve
    const resolved = path.resolve(this.workDir, userPath);

    // Check for traversal
    if (!resolved.startsWith(this.workDir + path.sep) &&
        resolved !== this.workDir) {
      throw new Error('Access denied: path outside working directory');
    }

    return resolved;
  }

  async readFile(params: { path: string }) {
    const safePath = this.resolveSafe(params.path);
    return fs.readFile(safePath, 'utf-8');
  }
}
```

### Symlink Attacks

```typescript
async readFile(params: { path: string }) {
  const safePath = this.resolveSafe(params.path);

  // Resolve symlinks and check again
  const realPath = await fs.realpath(safePath);
  if (!realPath.startsWith(this.workDir)) {
    throw new Error('Access denied: symlink points outside working directory');
  }

  return fs.readFile(realPath, 'utf-8');
}
```

---

## Command Injection

### Never Build Shell Commands from User Input

```typescript
// BAD: Command injection vulnerability
async search(params: { query: string }) {
  const { stdout } = await exec(`grep "${params.query}" /var/log/*.log`);
  return stdout;
}

// If query = '" && rm -rf / && "', this deletes everything!
```

### Safe Alternatives

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// GOOD: Use execFile with arguments array
async search(params: { query: string }) {
  const { stdout } = await execFileAsync('grep', [
    '-r',
    params.query,  // Safe: passed as argument, not in shell
    '/var/log/'
  ]);
  return stdout;
}
```

### Use Libraries Instead of Shell

```typescript
// BETTER: Use Node.js APIs instead of shell
import * as fs from 'fs/promises';

async search(params: { query: string }) {
  const files = await fs.readdir('/var/log/');
  const results = [];

  for (const file of files) {
    const content = await fs.readFile(`/var/log/${file}`, 'utf-8');
    if (content.includes(params.query)) {
      results.push(file);
    }
  }

  return results;
}
```

---

## SQL Injection

### Always Use Parameterized Queries

```typescript
// BAD: SQL injection vulnerability
async getUser(params: { id: string }) {
  const result = await this.db.query(
    `SELECT * FROM users WHERE id = '${params.id}'`
  );
  return result;
}

// If id = "' OR '1'='1", returns all users!
```

### Safe Queries

```typescript
// GOOD: Parameterized query
async getUser(params: { id: string }) {
  const result = await this.db.query(
    'SELECT * FROM users WHERE id = $1',
    [params.id]
  );
  return result;
}

// GOOD: Use query builder
async getUser(params: { id: string }) {
  return this.db.select().from('users').where('id', params.id);
}
```

---

## Authentication

### OAuth Flows

```typescript
/**
 * GitHub Integration
 * @mcp github
 */
export default class GitHubPhoton {
  constructor(
    /** @env GITHUB_TOKEN */
    private token: string
  ) {}

  async *connect() {
    if (!this.token) {
      // Trigger OAuth flow
      const url = yield { ask: 'oauth', provider: 'github' };
      // Token is stored securely by runtime
    }
  }
}
```

### API Key Validation

```typescript
async callExternalApi(endpoint: string, data: any) {
  if (!this.apiKey || this.apiKey.length < 32) {
    throw new Error('Invalid API key');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (response.status === 401) {
    throw new Error('API key rejected - check credentials');
  }

  return response.json();
}
```

---

## Rate Limiting

### Basic Rate Limiter

```typescript
class RateLimiter {
  private requests = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = 60, windowMs = 60000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string): boolean {
    const now = Date.now();
    const requests = this.requests.get(key) || [];

    // Remove old requests
    const recent = requests.filter(t => now - t < this.windowMs);

    if (recent.length >= this.limit) {
      return false;
    }

    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }
}

// Usage
const limiter = new RateLimiter(10, 60000); // 10 requests per minute

async search(params: { query: string }) {
  if (!limiter.check('search')) {
    throw new Error('Rate limit exceeded. Please wait.');
  }
  // ... perform search
}
```

---

## Audit Logging

### Log Security Events

```typescript
import { logger } from '@portel/photon-core';

async deleteFile(params: { path: string }) {
  const safePath = this.resolveSafe(params.path);

  // Log before action
  logger.info('File deletion requested', {
    path: safePath,
    user: this.currentUser,
    timestamp: new Date().toISOString()
  });

  try {
    await fs.unlink(safePath);
    logger.info('File deleted successfully', { path: safePath });
  } catch (error) {
    logger.error('File deletion failed', {
      path: safePath,
      error: error.message
    });
    throw error;
  }
}
```

### What to Log

- Authentication attempts (success/failure)
- Authorization decisions
- Data access (especially sensitive data)
- Data modifications
- Administrative actions
- Errors and exceptions

---

## Common Vulnerabilities

### OWASP Top 10 for Photons

| Risk | Mitigation |
|------|------------|
| Injection | Parameterized queries, no shell commands |
| Broken Auth | OAuth, secure token storage |
| Sensitive Data | Encrypt at rest, TLS in transit |
| XXE | Disable external entities in XML parsing |
| Broken Access | Validate permissions per request |
| Security Misconfig | Secure defaults, no debug in prod |
| XSS | Sanitize output in custom UIs |
| Insecure Deserialization | Validate/sanitize deserialized data |
| Components | Keep dependencies updated |
| Logging | Log security events, protect logs |

### Reporting Vulnerabilities

If you discover a security vulnerability in Photon:

1. **Do not** open a public issue
2. Email security@portel.dev with details
3. Allow 90 days for remediation before disclosure

---

## Next Steps

- [DEPLOYMENT.md](DEPLOYMENT.md) - Secure deployment practices
- [GUIDE.md](GUIDE.md) - Development guide
- [ADVANCED.md](ADVANCED.md) - Advanced patterns
