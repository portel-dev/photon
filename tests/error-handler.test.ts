/**
 * Tests for error handling utilities
 */

import {
  PhotonError,
  ValidationError,
  getErrorMessage,
  isNodeError,
  wrapError,
  ExitCode,
  handleError,
  exitWithError,
} from '../dist/shared/error-handler.js';

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

    test('isNodeError identifies Node.js errors', () => {
      const err: NodeJS.ErrnoException = new Error('test');
      err.code = 'ENOENT';
      assert(isNodeError(err, 'ENOENT'), 'Node error not identified');
      assert(isNodeError(err), 'generic Node error check failed');
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
      assert(wrapped instanceof PhotonError, 'not PhotonError');
      assert(wrapped.message.includes('/test/file'), 'path not included');
    }),

    test('ExitCode constants exist', () => {
      assert(ExitCode.SUCCESS === 0, 'SUCCESS wrong');
      assert(ExitCode.ERROR === 1, 'ERROR wrong');
      assert(ExitCode.NOT_FOUND === 4, 'NOT_FOUND wrong');
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
