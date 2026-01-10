/**
 * Tests for error handling utilities
 */

import {
  PhotonError,
  ValidationError,
  FileSystemError,
  NetworkError,
  ConfigurationError,
  getErrorMessage,
  getErrorStack,
  isErrorCode,
  isNodeError,
  formatErrorMessage,
  wrapError,
  tryAsync,
  trySync,
} from '../src/shared/error-handler.js';

function test(name: string, fn: () => void | Promise<void>) {
  return async () => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      return true;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.error(`   ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('🧪 Running Error Handler Tests...\n');

  const tests = [
    test('PhotonError creates with all properties', () => {
      const err = new PhotonError('test message', 'TEST_CODE', { key: 'value' }, 'try this');
      assert(err.message === 'test message', 'message mismatch');
      assert(err.code === 'TEST_CODE', 'code mismatch');
      assert(err.details?.key === 'value', 'details mismatch');
      assert(err.suggestion === 'try this', 'suggestion mismatch');
      assert(err.name === 'PhotonError', 'name mismatch');
    }),

    test('ValidationError is a PhotonError', () => {
      const err = new ValidationError('invalid input');
      assert(err instanceof PhotonError, 'not a PhotonError');
      assert(err.code === 'VALIDATION_ERROR', 'wrong code');
      assert(err.name === 'ValidationError', 'wrong name');
    }),

    test('FileSystemError is a PhotonError', () => {
      const err = new FileSystemError('file not found');
      assert(err instanceof PhotonError, 'not a PhotonError');
      assert(err.code === 'FILE_SYSTEM_ERROR', 'wrong code');
    }),

    test('getErrorMessage extracts from Error', () => {
      const msg = getErrorMessage(new Error('test error'));
      assert(msg === 'test error', 'message extraction failed');
    }),

    test('getErrorMessage handles string', () => {
      const msg = getErrorMessage('string error');
      assert(msg === 'string error', 'string handling failed');
    }),

    test('getErrorMessage handles object with message', () => {
      const msg = getErrorMessage({ message: 'object error' });
      assert(msg === 'object error', 'object handling failed');
    }),

    test('getErrorMessage handles unknown types', () => {
      const msg = getErrorMessage(null);
      assert(msg === 'Unknown error', 'null handling failed');
    }),

    test('getErrorStack extracts stack from Error', () => {
      const err = new Error('test');
      const stack = getErrorStack(err);
      assert(stack !== undefined, 'stack not extracted');
      assert(stack!.includes('Error: test'), 'stack content wrong');
    }),

    test('getErrorStack returns undefined for non-Error', () => {
      const stack = getErrorStack('not an error');
      assert(stack === undefined, 'should be undefined');
    }),

    test('isErrorCode identifies PhotonError by code', () => {
      const err = new PhotonError('test', 'MY_CODE');
      assert(isErrorCode(err, 'MY_CODE'), 'code not identified');
      assert(!isErrorCode(err, 'OTHER_CODE'), 'false positive');
    }),

    test('isNodeError identifies Node.js errors', () => {
      const err: NodeJS.ErrnoException = new Error('test');
      err.code = 'ENOENT';
      assert(isNodeError(err, 'ENOENT'), 'Node error not identified');
      assert(isNodeError(err), 'generic Node error check failed');
    }),

    test('formatErrorMessage formats basic error', () => {
      const formatted = formatErrorMessage(new Error('test'));
      assert(formatted.includes('test'), 'message not included');
    }),

    test('formatErrorMessage includes context', () => {
      const formatted = formatErrorMessage(new Error('test'), { context: 'loading file' });
      assert(formatted.includes('loading file'), 'context not included');
      assert(formatted.includes('test'), 'message not included');
    }),

    test('formatErrorMessage includes suggestion from PhotonError', () => {
      const err = new PhotonError('test', 'CODE', undefined, 'try this');
      const formatted = formatErrorMessage(err);
      assert(formatted.includes('try this'), 'suggestion not included');
    }),

    test('formatErrorMessage includes stack when requested', () => {
      const err = new Error('test');
      const formatted = formatErrorMessage(err, { includeStack: true });
      assert(formatted.includes('Stack trace'), 'stack header not included');
    }),

    test('wrapError converts Error to PhotonError', () => {
      const original = new Error('original');
      const wrapped = wrapError(original, 'context');
      assert(wrapped instanceof PhotonError, 'not wrapped');
      assert(wrapped.message.includes('context'), 'context not added');
      assert(wrapped.message.includes('original'), 'original message lost');
    }),

    test('wrapError preserves PhotonError', () => {
      const original = new PhotonError('test', 'CODE');
      const wrapped = wrapError(original);
      assert(wrapped === original, 'should be same instance');
    }),

    test('wrapError handles Node.js ENOENT', () => {
      const err: NodeJS.ErrnoException = new Error('ENOENT');
      err.code = 'ENOENT';
      err.path = '/test/file';
      const wrapped = wrapError(err);
      assert(wrapped instanceof FileSystemError, 'not FileSystemError');
      assert(wrapped.message.includes('/test/file'), 'path not included');
    }),

    test('trySync wraps sync function errors', () => {
      try {
        trySync(() => {
          throw new Error('sync error');
        }, 'doing sync work');
        assert(false, 'should have thrown');
      } catch (err) {
        assert(err instanceof PhotonError, 'not wrapped');
        assert((err as PhotonError).message.includes('doing sync work'), 'context not added');
      }
    }),

    test('trySync returns value on success', () => {
      const result = trySync(() => 42);
      assert(result === 42, 'wrong return value');
    }),

    test('tryAsync wraps async function errors', async () => {
      try {
        await tryAsync(async () => {
          throw new Error('async error');
        }, 'doing async work');
        assert(false, 'should have thrown');
      } catch (err) {
        assert(err instanceof PhotonError, 'not wrapped');
        assert((err as PhotonError).message.includes('doing async work'), 'context not added');
      }
    }),

    test('tryAsync returns value on success', async () => {
      const result = await tryAsync(async () => 42);
      assert(result === 42, 'wrong return value');
    }),
  ];

  let passed = 0;
  let failed = 0;

  for (const testFn of tests) {
    const result = await testFn();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n✅ Error Handler tests: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
