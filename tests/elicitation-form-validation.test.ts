import assert from 'node:assert/strict';
import test from 'node:test';
import { validateElicitationFormFields } from '../src/auto-ui/frontend/utils/form-validation.js';

test('elicitation forms enforce required fields and schema patterns', () => {
  const errors = validateElicitationFormFields(
    [
      { name: 'address', required: true, minLength: 5 },
      { name: 'zip', required: true, pattern: '^\\d{5}$' },
    ],
    { address: '123', zip: '12' }
  );

  assert.deepEqual(errors, {
    address: 'Must be at least 5 characters',
    zip: 'Enter a value in the required format',
  });
});

test('credit-card formats enforce Luhn, expiry, and security-code rules', () => {
  const nextYear = String((new Date().getFullYear() + 1) % 100).padStart(2, '0');
  const valid = validateElicitationFormFields(
    [
      { name: 'cardNumber', required: true, format: 'credit-card' },
      { name: 'expiry', required: true, format: 'credit-card-expiry' },
      { name: 'cvv', required: true, format: 'credit-card-cvv' },
    ],
    { cardNumber: '4111 1111 1111 1111', expiry: `12/${nextYear}`, cvv: '123' }
  );
  assert.deepEqual(valid, {});

  const invalid = validateElicitationFormFields(
    [
      { name: 'cardNumber', format: 'credit-card' },
      { name: 'expiry', format: 'credit-card-expiry' },
      { name: 'cvv', format: 'credit-card-cvv' },
    ],
    { cardNumber: '4111 1111 1111 1112', expiry: '01/20', cvv: '12' }
  );
  assert.deepEqual(invalid, {
    cardNumber: 'Enter a valid card number',
    expiry: 'Enter a valid, unexpired date as MM/YY',
    cvv: 'Enter a 3 or 4 digit security code',
  });
});
