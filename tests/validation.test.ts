/**
 * Validation Utilities Tests
 */

import {
  isString,
  isNumber,
  isBoolean,
  isObject,
  isArray,
  notEmpty,
  hasLength,
  matchesPattern,
  isEmail,
  isUrl,
  inRange,
  isPositive,
  isInteger,
  hasArrayLength,
  arrayOf,
  hasFields,
  validate,
  validateOrThrow,
  oneOf,
  combineResults,
} from '../dist/shared/validation.js';
import { ValidationError } from '../dist/shared/error-handler.js';

console.log('🧪 Running Validation Utilities Tests...\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

// Type validators
assert(isString('hello'), 'isString identifies strings');
assert(!isString(123), 'isString rejects non-strings');
assert(isNumber(42), 'isNumber identifies numbers');
assert(!isNumber('42'), 'isNumber rejects non-numbers');
assert(isBoolean(true), 'isBoolean identifies booleans');
assert(!isBoolean('true'), 'isBoolean rejects non-booleans');
assert(isObject({}), 'isObject identifies objects');
assert(!isObject([]), 'isObject rejects arrays');
assert(isArray([]), 'isArray identifies arrays');
assert(!isArray({}), 'isArray rejects objects');

// String validators
const emptyResult = notEmpty('name')('');
assert(!emptyResult.valid, 'notEmpty rejects empty strings');

const nonEmptyResult = notEmpty('name')('John');
assert(nonEmptyResult.valid, 'notEmpty accepts non-empty strings');

const lengthResult = hasLength('password', 8, 20)('short');
assert(!lengthResult.valid, 'hasLength enforces min length');

const validLengthResult = hasLength('password', 8, 20)('validpassword');
assert(validLengthResult.valid, 'hasLength accepts valid length');

const patternResult = matchesPattern('code', /^\d{4}$/)('1234');
assert(patternResult.valid, 'matchesPattern validates patterns');

const emailResult = isEmail('email')('user@example.com');
assert(emailResult.valid, 'isEmail accepts valid email');

const invalidEmailResult = isEmail('email')('not-an-email');
assert(!invalidEmailResult.valid, 'isEmail rejects invalid email');

const urlResult = isUrl('website')('https://example.com');
assert(urlResult.valid, 'isUrl accepts valid URL');

const invalidUrlResult = isUrl('website')('not a url');
assert(!invalidUrlResult.valid, 'isUrl rejects invalid URL');

// Number validators
const rangeResult = inRange('age', 0, 120)(25);
assert(rangeResult.valid, 'inRange accepts values in range');

const outOfRangeResult = inRange('age', 0, 120)(150);
assert(!outOfRangeResult.valid, 'inRange rejects out of range values');

const positiveResult = isPositive('amount')(10);
assert(positiveResult.valid, 'isPositive accepts positive numbers');

const negativeResult = isPositive('amount')(-5);
assert(!negativeResult.valid, 'isPositive rejects negative numbers');

const integerResult = isInteger('count')(42);
assert(integerResult.valid, 'isInteger accepts integers');

const floatResult = isInteger('count')(42.5);
assert(!floatResult.valid, 'isInteger rejects floats');

// Array validators
const arrayLengthResult = hasArrayLength('items', 1, 5)([1, 2, 3]);
assert(arrayLengthResult.valid, 'hasArrayLength accepts valid length');

const emptyArrayResult = hasArrayLength('items', 1, 5)([]);
assert(!emptyArrayResult.valid, 'hasArrayLength rejects empty arrays');

const arrayOfResult = arrayOf('numbers', isPositive('number'))([1, 2, 3]);
assert(arrayOfResult.valid, 'arrayOf validates all items');

const invalidArrayOfResult = arrayOf('numbers', isPositive('number'))([1, -2, 3]);
assert(!invalidArrayOfResult.valid, 'arrayOf rejects invalid items');

// Object validators
const fieldsResult = hasFields('user', ['name', 'email'])({ name: 'John', email: 'john@example.com' });
assert(fieldsResult.valid, 'hasFields accepts objects with all fields');

const missingFieldsResult = hasFields('user', ['name', 'email'])({ name: 'John' });
assert(!missingFieldsResult.valid, 'hasFields rejects objects missing fields');

// oneOf validator
const oneOfResult = oneOf('status', ['active', 'inactive', 'pending'])('active');
assert(oneOfResult.valid, 'oneOf accepts allowed values');

const invalidOneOfResult = oneOf('status', ['active', 'inactive', 'pending'])('unknown');
assert(!invalidOneOfResult.valid, 'oneOf rejects disallowed values');

// Combining validators
const combinedResult = validate('test@example.com', [
  notEmpty('email'),
  isEmail('email'),
]);
assert(combinedResult.valid, 'validate combines multiple validators');

const failedCombinedResult = validate('', [
  notEmpty('email'),
  isEmail('email'),
]);
assert(!failedCombinedResult.valid, 'validate fails if any validator fails');

// validateOrThrow
try {
  validateOrThrow('hello', [notEmpty('text')]);
  assert(true, 'validateOrThrow succeeds for valid input');
} catch {
  assert(false, 'validateOrThrow should not throw for valid input');
}

try {
  validateOrThrow('', [notEmpty('text')]);
  assert(false, 'validateOrThrow should throw for invalid input');
} catch (error) {
  assert(error instanceof ValidationError, 'validateOrThrow throws ValidationError');
}

// combineResults
const result1 = { valid: true, errors: [] };
const result2 = { valid: false, errors: ['Error 1'] };
const result3 = { valid: false, errors: ['Error 2'] };
const combined = combineResults(result1, result2, result3);
assert(!combined.valid && combined.errors.length === 2, 'combineResults merges errors');

console.log(`\n✅ Validation Utilities tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
