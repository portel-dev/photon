# Error Handling Improvements for Photon

## Current State

The project has a centralized error handler (`src/shared/error-handler.ts`) with:
- Custom error types (PhotonError, ValidationError, FileSystemError, etc.)
- Error utility functions (getErrorMessage, wrapError, formatErrorMessage)
- Helper functions (tryAsync, trySync)

However, error handling is inconsistent across the codebase - some places use these utilities, others use plain catch blocks.

## Improvements to Apply

### 1. **Consistent Error Utility Usage**

**Problem**: Many catch blocks use `error.message` or `String(error)` instead of `getErrorMessage(error)`

**Solution**: Replace all instances with `getErrorMessage(error)` for type-safe error message extraction

**Files to update**:
- `src/cli.ts` - Multiple catch blocks
- `src/server.ts` - Error formatting
- `src/loader.ts` - Already good, just verify
- `src/photon-cli-runner.ts` - Error handling in CLI runner
- `src/daemon/` - Daemon error handling
- `src/deploy/` - Deployment error handling

### 2. **Add Error Context**

**Problem**: Many errors lack context about what operation was being performed

**Solution**: Use `wrapError(error, context, suggestion)` to add contextual information

**Example**:
```typescript
// Before
catch (error) {
  console.error(`Error: ${error.message}`);
}

// After
catch (error) {
  const wrappedError = wrapError(error, 'Loading configuration', 'Check that the config file exists and is valid JSON');
  logger.error(formatErrorMessage(wrappedError));
}
```

### 3. **Structured Error Logging**

**Problem**: Error logging is inconsistent - sometimes console.error, sometimes logger

**Solution**: Always use logger with proper context and metadata

**Example**:
```typescript
// Before
catch (error) {
  console.error(`Failed: ${error}`);
}

// After
catch (error) {
  logger.error('Operation failed', {
    operation: 'loadConfig',
    error: getErrorMessage(error),
    stack: getErrorStack(error),
  });
}
```

### 4. **Error Recovery Strategies**

**Problem**: Many operations fail immediately without retry or fallback

**Solution**: Implement retry logic for transient failures

**Files needing retry logic**:
- Network operations in `marketplace-manager.ts`
- File system operations in `loader.ts`
- MCP client connections in `mcp-client.ts`

### 5. **User-Friendly Error Messages**

**Problem**: Technical stack traces shown to users instead of actionable messages

**Solution**: Format errors appropriately for CLI vs API contexts

**Example**:
```typescript
// CLI context - hide technical details
if (error instanceof PhotonError) {
  console.error(`❌ ${error.message}`);
  if (error.suggestion) {
    console.error(`💡 ${error.suggestion}`);
  }
} else {
  console.error(`❌ An unexpected error occurred. Run with DEBUG=true for details.`);
}
```

### 6. **Validation Error Improvements**

**Problem**: Validation errors don't provide enough detail about what's wrong

**Solution**: Use ValidationError with structured details

**Example**:
```typescript
if (!config.apiKey) {
  throw new ValidationError(
    'API key is required',
    { field: 'apiKey', value: undefined },
    'Set the API_KEY environment variable'
  );
}
```

### 7. **Error Boundaries for Long-Running Operations**

**Problem**: Server/daemon errors can crash the entire process

**Solution**: Add error boundaries that log and continue

**Example**:
```typescript
// In server request handlers
try {
  await handleRequest(request);
} catch (error) {
  logger.error('Request handler failed', {
    request: request.method,
    error: getErrorMessage(error),
  });
  return { error: formatErrorMessage(error) };
}
```

## Implementation Priority

1. **High Priority** (Security/Stability):
   - Server error handlers (`src/server.ts`)
   - Loader error handling (`src/loader.ts`) 
   - Daemon error handling (`src/daemon/`)

2. **Medium Priority** (UX):
   - CLI error messages (`src/cli.ts`)
   - CLI runner error handling (`src/photon-cli-runner.ts`)
   - Deployment error handling (`src/deploy/`)

3. **Low Priority** (Nice-to-have):
   - Test client error handling (`src/test-client.ts`)
   - Template manager error handling

## Testing Strategy

For each improvement:
1. Add unit test covering the error case
2. Verify existing tests still pass
3. Manually test error scenarios
4. Check logs are structured correctly

## Success Criteria

- ✅ All catch blocks use `getErrorMessage()`
- ✅ No bare `error.message` or `String(error)` calls
- ✅ All user-facing errors have actionable suggestions
- ✅ Server errors don't crash the process
- ✅ Error logs include context and metadata
- ✅ All tests pass with improved error handling
