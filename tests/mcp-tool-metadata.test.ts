import { strict as assert } from 'node:assert';
import { cleanMcpToolDescription } from '../src/shared/mcp-tool-metadata.js';

assert.equal(
  cleanMcpToolDescription('List bookable slots. @readOnly @idempotent @closedWorld'),
  'List bookable slots.'
);
assert.equal(
  cleanMcpToolDescription('Book a consultation.\n@class Appointments {@role user}\n@openWorld'),
  'Book a consultation.'
);
assert.equal(
  cleanMcpToolDescription('Contact support at user@example.com'),
  'Contact support at user@example.com'
);

console.log('✅ MCP tool descriptions omit control tags while preserving prose');
