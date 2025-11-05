# Photon MCP Tests

Automated testing framework for Photon MCPs using the MCP protocol.

## Overview

The test client spawns MCP servers, sends JSON-RPC messages over stdio, and validates responses using pattern matching and custom validators.

## Running Tests

### SQLite MCP (no credentials needed)
```bash
npm test:sqlite
# or
npx tsx tests/sqlite.test.ts
```

### GitHub Issues MCP (requires token)
```bash
export GITHUB_TOKEN="ghp_your_token_here"
npm test:github
# or
npx tsx tests/github-issues.test.ts
```

### All Tests
```bash
npm test
```

## Writing Tests

### Basic Structure

```typescript
import { MCPTestClient, validators } from '../src/test-client.js';

const client = new MCPTestClient();

// Start MCP server
await client.start('node', ['dist/cli.js', 'examples/your-mcp.photon.ts'], {
  ENV_VAR: 'value',
});

// Initialize
await client.initialize();

// Run test cases
const results = await client.runTests([
  {
    name: 'Test description',
    method: 'tools/call',
    params: {
      name: 'toolName',
      arguments: { param: 'value' },
    },
    validate: validators.hasResult,
  },
]);
```

### Available Validators

**`validators.hasResult`** - Check response has result field
```typescript
validate: validators.hasResult
```

**`validators.hasError`** - Check response has error field
```typescript
validate: validators.hasError
```

**`validators.hasField(path)`** - Check nested field exists
```typescript
validate: validators.hasField('content.0.text')
```

**`validators.equals(expected, field?)`** - Check exact match
```typescript
validate: validators.equals(true, 'success')
```

**`validators.matchesPattern(regex, field?)`** - Regex matching
```typescript
validate: validators.matchesPattern(/^https:\/\/github.com/, 'html_url')
```

**`validators.custom(fn)`** - Custom validation function
```typescript
validate: validators.custom((result) => {
  const data = JSON.parse(result.content[0].text);
  if (!data.success) return `Error: ${data.error}`;
  if (data.count < 1) return 'Expected at least one result';
  return true; // Pass
})
```

**`validators.and(...validators)`** - Combine multiple validators
```typescript
validate: validators.and(
  validators.hasResult,
  validators.hasField('tools'),
  validators.custom((result) => result.tools.length > 0)
)
```

## Test Case Structure

```typescript
interface TestCase {
  name: string;           // Test description
  method: string;         // MCP method (e.g., 'tools/list', 'tools/call')
  params?: any;           // Method parameters
  validate: (response: MCPResponse) => boolean | string;
}
```

**Validation return values:**
- `true` - Test passed
- `string` - Test failed with error message

## Example Test

```typescript
{
  name: 'List issues should return valid data',
  method: 'tools/call',
  params: {
    name: 'listIssues',
    arguments: {
      owner: 'anthropics',
      repo: 'anthropic-sdk-typescript',
      state: 'open',
      per_page: 5,
    },
  },
  validate: validators.and(
    validators.hasResult,
    validators.hasField('content.0.text'),
    validators.custom((result) => {
      const text = result?.content?.[0]?.text;
      const data = JSON.parse(text);

      if (!data.success) return `API failed: ${data.error}`;
      if (!Array.isArray(data.issues)) return 'Issues should be array';
      if (data.issues.length === 0) return 'Should return issues';

      // Validate structure
      const issue = data.issues[0];
      if (!issue.number) return 'Issue missing number';
      if (!issue.title) return 'Issue missing title';

      return true;
    })
  ),
}
```

## MCP Protocol Methods

### `initialize`
```typescript
await client.initialize();
```

### `tools/list`
```typescript
await client.listTools();
// or
await client.send('tools/list');
```

### `tools/call`
```typescript
await client.callTool('toolName', { arg1: 'value' });
// or
await client.send('tools/call', {
  name: 'toolName',
  arguments: { arg1: 'value' },
});
```

## Environment Variables

Tests can pass environment variables to MCP servers:

```typescript
await client.start('node', ['dist/cli.js', 'example.photon.ts'], {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  SLACK_TOKEN: process.env.SLACK_TOKEN,
  DB_PASSWORD: 'secret',
});
```

## Test Output

```
🧪 Testing SQLite MCP

✅ MCP server started
✅ Initialized: SQLite

🧪 Running: List tools should return all SQLite tools
✅ PASS: List tools should return all SQLite tools

🧪 Running: Create users table
✅ PASS: Create users table

==================================================

📊 Test Results:
   ✅ Passed: 8
   ❌ Failed: 0

==================================================
```

## CI/CD Integration

Tests exit with code 0 on success, 1 on failure:

```bash
npm test || exit 1
```

## Tips

1. **Use temp files for databases** - Clean up in finally block
2. **Test error cases** - Validate error responses work correctly
3. **Check field structure** - Don't just check success, validate data shape
4. **Use realistic data** - Test with actual API endpoints when possible
5. **Isolate tests** - Each test should be independent
