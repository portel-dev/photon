/**
 * Tests for Schema Extractor - Template and Static detection
 */

import { SchemaExtractor } from '../src/schema-extractor.js';
import { strict as assert } from 'assert';

// Simple test runner
async function runTests() {
  console.log('🧪 Running Schema Extractor Tests...\n');

  const extractor = new SchemaExtractor();

  // Test 1: Template detection
  {
    const source = `
      /**
       * Generate a code review prompt
       * @Template
       * @param language Programming language
       */
      async codeReview(params: { language: string }) {
        return asTemplate("review");
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.templates.length, 1, 'Should detect 1 template');
    assert.equal(result.templates[0].name, 'codeReview', 'Template name should be codeReview');
    console.log('✅ Template detection');
  }

  // Test 2: Static detection
  {
    const source = `
      /**
       * Get API docs
       * @Static api://docs
       * @mimeType text/markdown
       */
      async apiDocs(params: {}) {
        return asStatic("docs");
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.statics.length, 1, 'Should detect 1 static');
    assert.equal(result.statics[0].uri, 'api://docs', 'URI should be api://docs');
    assert.equal(result.statics[0].mimeType, 'text/markdown', 'MIME type should be text/markdown');
    console.log('✅ Static resource detection');
  }

  // Test 3: URI parameters
  {
    const source = `
      /**
       * Get README
       * @Static readme://{projectType}
       * @param projectType Type
       */
      async readme(params: { projectType: string }) {
        return asStatic("readme");
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.statics[0].uri, 'readme://{projectType}', 'Should preserve URI parameters');
    console.log('✅ URI parameter extraction');
  }

  // Test 4: Mixed types
  {
    const source = `
      /**
       * Tool
       * @param x Number
       */
      async tool(params: { x: number }) { return x; }

      /**
       * Template
       * @Template
       * @param topic Topic
       */
      async template(params: { topic: string }) { return asTemplate(""); }

      /**
       * Static
       * @Static data://info
       */
      async static(params: {}) { return asStatic(""); }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.tools.length, 1, 'Should have 1 tool');
    assert.equal(result.templates.length, 1, 'Should have 1 template');
    assert.equal(result.statics.length, 1, 'Should have 1 static');
    console.log('✅ Mixed method categorization');
  }

  // Test 5: Default URI
  {
    const source = `
      /**
       * Config
       * @Static
       */
      async config(params: {}) { return asStatic(""); }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.statics[0].uri, 'static://config', 'Should use default URI');
    console.log('✅ Default URI generation');
  }

  // Test 6: Enum generation from string literal unions
  {
    const source = `
      /**
       * Perform action
       * @param action The action to perform
       */
      async performAction(params: { action: 'create' | 'update' | 'delete' }) {
        return action;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.tools.length, 1, 'Should have 1 tool');
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.action.type, 'string', 'Should have string type');
    assert.deepEqual(schema.properties.action.enum, ['create', 'update', 'delete'], 'Should have enum array');
    assert.equal(schema.properties.action.anyOf, undefined, 'Should not have anyOf');
    console.log('✅ String literal union to enum');
  }

  // Test 7: Enum generation from number literal unions
  {
    const source = `
      /**
       * Set level
       * @param level The level to set
       */
      async setLevel(params: { level: 1 | 2 | 3 }) {
        return level;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.level.type, 'number', 'Should have number type');
    assert.deepEqual(schema.properties.level.enum, [1, 2, 3], 'Should have numeric enum array');
    console.log('✅ Number literal union to enum');
  }

  // Test 8: Non-literal unions should still use anyOf
  {
    const source = `
      /**
       * Process value
       * @param value The value to process
       */
      async processValue(params: { value: string | number }) {
        return value;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.notEqual(schema.properties.value.anyOf, undefined, 'Should have anyOf for non-literal union');
    assert.equal(schema.properties.value.enum, undefined, 'Should not have enum for non-literal union');
    console.log('✅ Non-literal unions use anyOf');
  }

  // Test 9: Mixed unions (number + string literals) should generate optimized anyOf
  {
    const source = `
      /**
       * Set volume
       * @param level Volume level (0-100) or relative adjustment
       */
      async volume(params?: { level?: number | '+1' | '-1' | '+2' | '-2' }) {
        return level;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.notEqual(schema.properties.level.anyOf, undefined, 'Should have anyOf for mixed union');
    assert.equal(schema.properties.level.anyOf.length, 2, 'Should have 2 anyOf entries (number + string enum)');

    // Check that we have a number type
    const hasNumberType = schema.properties.level.anyOf.some((s: any) => s.type === 'number' && !s.enum);
    assert.equal(hasNumberType, true, 'Should have plain number type');

    // Check that string literals are grouped into one enum
    const stringEnums = schema.properties.level.anyOf.filter((s: any) => s.type === 'string' && s.enum);
    assert.equal(stringEnums.length, 1, 'Should have exactly one string enum entry');
    assert.deepEqual(stringEnums[0].enum, ['+1', '-1', '+2', '-2'], 'String literals should be grouped');

    console.log('✅ Mixed unions generate optimized anyOf');
  }

  // Test 10: JSDoc constraints with {@min} and {@max} tags
  {
    const source = `
      /**
       * Set volume level
       * @param level Volume percentage {@min 0} {@max 100}
       */
      async setVolume(params: { level: number }) {
        return level;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.level.type, 'number', 'Should be number type');
    assert.equal(schema.properties.level.minimum, 0, 'Should have minimum constraint');
    assert.equal(schema.properties.level.maximum, 100, 'Should have maximum constraint');
    assert.equal(schema.properties.level.description, 'Volume percentage', 'Constraint tags should be removed from description');
    console.log('✅ JSDoc constraints with {@min} {@max}');
  }

  // Test 11: Constraints applied to mixed unions
  {
    const source = `
      /**
       * Control volume
       * @param level Volume level or adjustment {@min 0} {@max 100}
       */
      async volume(params?: { level?: number | '+1' | '-1' }) {
        return level;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.notEqual(schema.properties.level.anyOf, undefined, 'Should have anyOf');

    // Find the number schema in anyOf
    const numberSchema = schema.properties.level.anyOf.find((s: any) => s.type === 'number' && !s.enum);
    assert.notEqual(numberSchema, undefined, 'Should have number type in anyOf');
    assert.equal(numberSchema.minimum, 0, 'Number type should have minimum');
    assert.equal(numberSchema.maximum, 100, 'Number type should have maximum');

    console.log('✅ Constraints on mixed unions');
  }

  // Test 12: String length constraints with {@min} {@max}
  {
    const source = `
      /**
       * Create username
       * @param username Username {@min 3} {@max 20}
       */
      async createUser(params: { username: string }) {
        return username;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.username.type, 'string', 'Should be string type');
    assert.equal(schema.properties.username.minLength, 3, 'Should have minLength');
    assert.equal(schema.properties.username.maxLength, 20, 'Should have maxLength');
    console.log('✅ String length constraints');
  }

  // Test 13: String pattern constraint
  {
    const source = `
      /**
       * Set username
       * @param username Username {@pattern ^[a-zA-Z0-9_]+$}
       */
      async setUsername(params: { username: string }) {
        return username;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.username.pattern, '^[a-zA-Z0-9_]+$', 'Should have pattern');
    console.log('✅ String pattern constraint');
  }

  // Test 14: String format constraint
  {
    const source = `
      /**
       * Send email
       * @param email Email address {@format email}
       * @param url Website {@format uri}
       */
      async sendEmail(params: { email: string; url: string }) {
        return email;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.email.format, 'email', 'Should have email format');
    assert.equal(schema.properties.url.format, 'uri', 'Should have uri format');
    console.log('✅ String format constraint');
  }

  // Test 15: Array length constraints
  {
    const source = `
      /**
       * Upload files
       * @param files File paths {@min 1} {@max 10}
       */
      async uploadFiles(params: { files: string[] }) {
        return files;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.files.type, 'array', 'Should be array type');
    assert.equal(schema.properties.files.minItems, 1, 'Should have minItems');
    assert.equal(schema.properties.files.maxItems, 10, 'Should have maxItems');
    console.log('✅ Array length constraints');
  }

  // Test 16: Default values
  {
    const source = `
      /**
       * Configure settings
       * @param timeout Timeout in seconds {@default 30}
       * @param enabled Enable feature {@default true}
       * @param name Name {@default "default"}
       */
      async configure(params?: { timeout?: number; enabled?: boolean; name?: string }) {
        return params;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.timeout.default, 30, 'Should have numeric default');
    assert.equal(schema.properties.enabled.default, true, 'Should have boolean default');
    assert.equal(schema.properties.name.default, 'default', 'Should have string default');
    console.log('✅ Default values');
  }

  // Test 17: Combined constraints
  {
    const source = `
      /**
       * Create user account
       * @param username Username {@min 3} {@max 20} {@pattern ^[a-zA-Z0-9_]+$}
       * @param email Email {@format email}
       * @param age Age {@min 13} {@max 120} {@default 18}
       */
      async createAccount(params: { username: string; email: string; age?: number }) {
        return params;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;

    // Username - multiple string constraints
    assert.equal(schema.properties.username.minLength, 3, 'Username should have minLength');
    assert.equal(schema.properties.username.maxLength, 20, 'Username should have maxLength');
    assert.equal(schema.properties.username.pattern, '^[a-zA-Z0-9_]+$', 'Username should have pattern');

    // Email - format only
    assert.equal(schema.properties.email.format, 'email', 'Email should have format');

    // Age - range with default
    assert.equal(schema.properties.age.minimum, 13, 'Age should have minimum');
    assert.equal(schema.properties.age.maximum, 120, 'Age should have maximum');
    assert.equal(schema.properties.age.default, 18, 'Age should have default');

    console.log('✅ Combined constraints');
  }

  // Test 18: Array uniqueItems constraint
  {
    const source = `
      /**
       * Set tags
       * @param tags Unique tags {@unique}
       * @param ids Unique IDs {@uniqueItems}
       */
      async setTags(params: { tags: string[]; ids: number[] }) {
        return tags;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.tags.type, 'array', 'Should be array type');
    assert.equal(schema.properties.tags.uniqueItems, true, 'Should have uniqueItems with {@unique}');
    assert.equal(schema.properties.ids.uniqueItems, true, 'Should have uniqueItems with {@uniqueItems}');
    assert.equal(schema.properties.tags.description, 'Unique tags', 'Should remove {@unique} from description');
    assert.equal(schema.properties.ids.description, 'Unique IDs', 'Should remove {@uniqueItems} from description');
    console.log('✅ Array uniqueItems constraint');
  }

  // Test 19: Array with multiple constraints
  {
    const source = `
      /**
       * Add tags
       * @param tags Tags {@min 1} {@max 5} {@unique}
       */
      async addTags(params: { tags: string[] }) {
        return tags;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.tags.type, 'array', 'Should be array type');
    assert.equal(schema.properties.tags.minItems, 1, 'Should have minItems');
    assert.equal(schema.properties.tags.maxItems, 5, 'Should have maxItems');
    assert.equal(schema.properties.tags.uniqueItems, true, 'Should have uniqueItems');
    assert.equal(schema.properties.tags.description, 'Tags', 'Should remove all constraint tags');
    console.log('✅ Array with multiple constraints');
  }

  // Test 20: Example values (single and multiple)
  {
    const source = `
      /**
       * Search users
       * @param query Search query {@example "john doe"} {@example "jane smith"}
       * @param limit Results per page {@example 20}
       * @param active Active users only {@example true}
       */
      async searchUsers(params: { query: string; limit?: number; active?: boolean }) {
        return query;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.deepEqual(schema.properties.query.examples, ['john doe', 'jane smith'], 'Should have multiple string examples');
    assert.deepEqual(schema.properties.limit.examples, [20], 'Should have numeric example');
    assert.deepEqual(schema.properties.active.examples, [true], 'Should have boolean example');
    console.log('✅ Example values');
  }

  // Test 21: multipleOf constraint
  {
    const source = `
      /**
       * Set brightness
       * @param level Brightness level {@min 0} {@max 100} {@multipleOf 5}
       */
      async setBrightness(params: { level: number }) {
        return level;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.level.type, 'number', 'Should be number type');
    assert.equal(schema.properties.level.minimum, 0, 'Should have minimum');
    assert.equal(schema.properties.level.maximum, 100, 'Should have maximum');
    assert.equal(schema.properties.level.multipleOf, 5, 'Should have multipleOf');
    console.log('✅ multipleOf constraint');
  }

  // Test 22: deprecated constraint (boolean and with message)
  {
    const source = `
      /**
       * Update user
       * @param userId User ID {@deprecated}
       * @param username Username {@deprecated Use updateUserV2 instead}
       */
      async updateUser(params: { userId: string; username: string }) {
        return userId;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.userId.deprecated, true, 'Should have deprecated=true');
    assert.equal(schema.properties.username.deprecated, 'Use updateUserV2 instead', 'Should have deprecated message');
    console.log('✅ deprecated constraint');
  }

  // Test 23: readOnly and writeOnly constraints
  {
    const source = `
      /**
       * Create user
       * @param id User ID {@readOnly}
       * @param password Password {@writeOnly} {@min 8}
       * @param name Name
       */
      async createUser(params: { id?: string; password: string; name: string }) {
        return id;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.id.readOnly, true, 'Should have readOnly');
    assert.equal(schema.properties.password.writeOnly, true, 'Should have writeOnly');
    assert.equal(schema.properties.password.minLength, 8, 'Should also have minLength');
    assert.equal(schema.properties.name.readOnly, undefined, 'Should not have readOnly');
    assert.equal(schema.properties.name.writeOnly, undefined, 'Should not have writeOnly');
    console.log('✅ readOnly and writeOnly constraints');
  }

  // Test 24: All constraints combined
  {
    const source = `
      /**
       * Comprehensive test
       * @param brightness Brightness {@min 0} {@max 100} {@multipleOf 5} {@default 50} {@example 25} {@example 75}
       */
      async comprehensive(params?: { brightness?: number }) {
        return brightness;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.brightness.type, 'number', 'Should be number type');
    assert.equal(schema.properties.brightness.minimum, 0, 'Should have minimum');
    assert.equal(schema.properties.brightness.maximum, 100, 'Should have maximum');
    assert.equal(schema.properties.brightness.multipleOf, 5, 'Should have multipleOf');
    assert.equal(schema.properties.brightness.default, 50, 'Should have default');
    assert.deepEqual(schema.properties.brightness.examples, [25, 75], 'Should have examples');
    console.log('✅ All constraints combined');
  }

  console.log('\n✅ All Schema Extractor tests passed!');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}
