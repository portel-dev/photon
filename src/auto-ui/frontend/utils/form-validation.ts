export interface FormValidationField {
  name: string;
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export function validateElicitationFormFields(
  fields: FormValidationField[],
  values: Record<string, any>
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = values[field.name];
    const empty = value === undefined || value === null || value === '';

    if (field.required && empty) {
      errors[field.name] = 'This field is required';
      continue;
    }
    if (empty) continue;

    if (field.enum?.length && !field.enum.includes(String(value))) {
      errors[field.name] = 'Choose one of the available options';
      continue;
    }

    if (typeof value === 'string') {
      if (field.minLength != null && value.length < field.minLength) {
        errors[field.name] = `Must be at least ${field.minLength} characters`;
        continue;
      }
      if (field.maxLength != null && value.length > field.maxLength) {
        errors[field.name] = `Must be at most ${field.maxLength} characters`;
        continue;
      }
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(value)) {
            errors[field.name] = 'Enter a value in the required format';
            continue;
          }
        } catch {
          // Invalid producer-supplied regex — do not make the form unusable.
        }
      }
    }

    if (typeof value === 'number') {
      if (field.min != null && value < field.min) {
        errors[field.name] = `Must be at least ${field.min}`;
        continue;
      }
      if (field.max != null && value > field.max) {
        errors[field.name] = `Must be at most ${field.max}`;
        continue;
      }
    }

    switch (field.format?.toLowerCase()) {
      case 'credit-card':
        if (!isValidCreditCardNumber(String(value))) {
          errors[field.name] = 'Enter a valid card number';
        }
        break;
      case 'credit-card-expiry':
        if (!isValidCreditCardExpiry(String(value))) {
          errors[field.name] = 'Enter a valid, unexpired date as MM/YY';
        }
        break;
      case 'credit-card-cvv':
        if (!/^\d{3,4}$/.test(String(value))) {
          errors[field.name] = 'Enter a 3 or 4 digit security code';
        }
        break;
    }
  }

  return errors;
}

function isValidCreditCardNumber(value: string): boolean {
  const digits = value.replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function isValidCreditCardExpiry(value: string): boolean {
  const match = /^(0[1-9]|1[0-2])\/?(\d{2})$/.exec(value.trim());
  if (!match) return false;

  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}
