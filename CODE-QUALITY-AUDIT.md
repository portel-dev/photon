# Code Quality Audit - Photon Runtime

This document outlines code quality issues found in the Photon project and their solutions.

## Priority 1: Console Statement Cleanup

### Issue
Direct console.log/error/warn usage throughout codebase instead of centralized logger.

### Impact
- Inconsistent logging format
- No log level control
- Cannot disable/redirect output programmatically
- Makes testing difficult

### Files Affected (107 instances across 13 files)
- `src/photon-cli-runner.ts` (59 instances) - **CLI output, intentional for user display**
- `src/cli.ts` (42 instances) - **CLI output, intentional for user display**  
- `src/deploy/cloudflare.ts` (17 instances) - **CLI output, intentional**
- `src/cli-alias.ts` (16 instances) - **CLI output, intentional**
- `src/server.ts` (1 instance) - Error logging, should use logger
- `src/loader.ts` (1 instance) - Debug output, should use logger
- `src/test-client.ts` (6 instances) - Test diagnostics, acceptable
- `src/template-manager.ts` (2 instances) - CLI output, acceptable
- `src/shared/error-handler.ts` (2 instances) - Fallback error logging
- `src/shared/cli-sections.ts` (1 instance) - CLI output, intentional
- `src/claude-code-plugin.ts` (7 instances) - CLI output, intentional

### Solution
**Note**: Most console.log usage is in CLI commands and is INTENTIONAL for user output. These should remain as-is since they're the primary way users interact with the tool.

Only fix:
1. `src/server.ts` - Use logger for error logging
2. `src/loader.ts` - Use logger for debug output
3. `src/shared/error-handler.ts` - Already has fallback logic, OK as-is

## Priority 2: Type Safety Improvements

### Issue
Some areas lack proper TypeScript type annotations, using `any` or missing types.

### Files to Review
- Constructor injection types in `loader.ts`
- MCP client proxy types
- Asset resolution types
- Generator types (partially addressed in core)

### Solution
- Add explicit type annotations
- Replace `any` with proper types or `unknown` where appropriate
- Add JSDoc comments for complex types

## Priority 3: Error Handling Consistency

### Issue
Mix of error throwing styles and user-facing error messages.

### Current State
- ✅ Centralized error types in `shared/error-handler.ts`
- ✅ `PhotonError`, `ValidationError`, `FileSystemError`, etc.
- ✅ `getErrorMessage()` utility for safe extraction
- ⚠️ Not consistently used everywhere

### Solution
- Use `PhotonError` subclasses instead of plain `Error`
- Use `wrapError()` utility for catching external errors
- Add helpful suggestions to all user-facing errors

## Priority 4: Input Validation

### Issue
Some user inputs are not validated before processing.

### Areas Needing Validation
- File paths
- Environment variable values
- Network URLs
- MCP configurations

### Solution
- Add validation functions in `shared/validation.ts`
- Validate early (at entry points)
- Provide clear error messages with examples

## Priority 5: Code Documentation

### Issue
Some complex functions lack JSDoc comments explaining their purpose.

### Areas Needing Documentation
- `PhotonLoader` injection resolution
- MCP proxy creation
- Asset discovery algorithm
- Stateful execution with checkpoints

### Solution
- Add JSDoc to public APIs
- Document complex algorithms
- Add usage examples for key patterns

## Priority 6: Test Coverage

### Current Coverage
- ✅ Schema extraction tests
- ✅ Marketplace tests  
- ✅ Loader tests
- ✅ Server tests
- ✅ Integration tests
- ✅ CLI tests
- ✅ Logger tests
- ✅ Error handler tests
- ⚠️ Missing: Progress renderer tests
- ⚠️ Missing: Asset discovery tests

### Solution
- Add unit tests for progress renderer
- Add tests for asset auto-discovery
- Add tests for error recovery scenarios

## Non-Issues (Intentional Design)

### Console.log in CLI Commands
**This is NOT a bug.** CLI commands (`src/cli.ts`, `src/photon-cli-runner.ts`, `src/cli-alias.ts`, etc.) use console.log for direct user output. This is the correct approach for CLI tools.

- User-facing messages should go to stdout/stderr
- Structured logging is for internal diagnostics
- Claude Code plugin generation outputs to stderr intentionally (progress messages while stdout is reserved for data)

### Direct stdout/stderr in Specific Cases
- `process.stdout.write()` for streaming output - Correct for real-time data
- `console.error()` for CLI progress messages - Correct (stderr doesn't interfere with stdout data)

## Implementation Plan

### Phase 1: Critical Fixes (Immediate)
1. Fix server.ts error logging → Use logger
2. Fix loader.ts debug output → Use logger
3. Validate all file path inputs
4. Add proper error types to public APIs

### Phase 2: Type Safety (Next)
1. Audit and replace `any` types
2. Add missing type annotations
3. Strengthen interface contracts

### Phase 3: Documentation (Ongoing)
1. Document complex algorithms
2. Add usage examples
3. Update architecture docs

### Phase 4: Test Expansion (As Needed)
1. Add missing unit tests
2. Expand integration test scenarios
3. Add performance regression tests

## Status

- **Created**: 2026-01-11
- **Last Updated**: 2026-01-11
- **Priority**: Medium (no critical bugs, mostly improvements)
- **Timeline**: Implement incrementally, Phase 1 complete within current session

## Notes

The Photon codebase is generally well-structured with good separation of concerns:
- ✅ Centralized error handling
- ✅ Structured logging system
- ✅ Comprehensive test suite
- ✅ Clear module boundaries
- ✅ Good use of TypeScript features

The issues identified are mostly opportunities for polish, not fundamental problems.
