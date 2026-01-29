/**
 * Tests for Schema Extractor - Template and Static detection
 */

import { SchemaExtractor } from '@portel/photon-core';
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
       * Update settings
       * @param timeout Timeout in seconds {@default 30}
       * @param enabled Enable feature {@default true}
       * @param name Name {@default "default"}
       */
      async updateSettings(params?: { timeout?: number; enabled?: boolean; name?: string }) {
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

  // Test 25: Extract readonly from TypeScript
  {
    const source = `
      /**
       * Update resource
       * @param id Resource ID
       * @param name Resource name
       */
      async updateResource(params: { readonly id: string; name: string }) {
        return id;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.id.readOnly, true, 'Should extract readOnly from TS readonly modifier');
    assert.equal(schema.properties.name.readOnly, undefined, 'Should not have readOnly on non-readonly property');
    console.log('✅ Extract readonly from TypeScript');
  }

  // Test 26: JSDoc overrides TypeScript readonly
  {
    const source = `
      /**
       * Update with override
       * @param id Resource ID {@writeOnly}
       * @param name Resource name {@readOnly}
       */
      async updateOverride(params: { readonly id: string; name: string }) {
        return id;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    // JSDoc writeOnly should override TS readonly
    assert.equal(schema.properties.id.writeOnly, true, 'JSDoc writeOnly should be set');
    assert.equal(schema.properties.id.readOnly, undefined, 'TS readonly should be overridden by JSDoc writeOnly');
    // JSDoc readOnly should be set even without TS readonly
    assert.equal(schema.properties.name.readOnly, true, 'JSDoc readOnly should be set');
    console.log('✅ JSDoc overrides TypeScript readonly');
  }

  // Test 27: TypeScript readonly without JSDoc override
  {
    const source = `
      /**
       * Simple readonly test
       * @param id Resource ID
       */
      async simpleReadonly(params: { readonly id: string }) {
        return id;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.id.readOnly, true, 'Should preserve TS readonly when no JSDoc override');
    console.log('✅ TypeScript readonly without JSDoc override');
  }

  // Test 28: Nested objects
  {
    const source = `
      /**
       * Create user with address
       * @param name User name
       * @param address User address
       */
      async createUser(params: {
        name: string;
        address: { street: string; city: string; zip: number }
      }) {
        return name;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.name.type, 'string', 'Should have name as string');
    assert.equal(schema.properties.address.type, 'object', 'Should have address as object');
    assert.notEqual(schema.properties.address.properties, undefined, 'Nested object should have properties');
    assert.equal(schema.properties.address.properties.street.type, 'string', 'Nested street should be string');
    assert.equal(schema.properties.address.properties.city.type, 'string', 'Nested city should be string');
    assert.equal(schema.properties.address.properties.zip.type, 'number', 'Nested zip should be number');
    console.log('✅ Nested objects');
  }

  // Test 29: Nullable types (string | null)
  {
    const source = `
      /**
       * Update bio
       * @param bio Biography (can be null to clear)
       */
      async updateBio(params: { bio: string | null }) {
        return bio;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.notEqual(schema.properties.bio.anyOf, undefined, 'Nullable should have anyOf');
    const types = schema.properties.bio.anyOf.map((s: any) => s.type);
    assert.ok(types.includes('string'), 'Should include string type');
    console.log('✅ Nullable types (string | null)');
  }

  // Test 30: Conflicting constraints (readOnly + writeOnly)
  {
    const source = `
      /**
       * Conflicting test
       * @param field1 Field with readOnly first {@readOnly} {@writeOnly}
       * @param field2 Field with writeOnly first {@writeOnly} {@readOnly}
       */
      async conflictTest(params: { field1: string; field2: string }) {
        return field1;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    // Last one wins: writeOnly should win for field1
    assert.equal(schema.properties.field1.writeOnly, true, 'Last constraint should win (writeOnly)');
    assert.equal(schema.properties.field1.readOnly, undefined, 'Should not have readOnly when writeOnly is set');
    // Last one wins: readOnly should win for field2
    assert.equal(schema.properties.field2.readOnly, true, 'Last constraint should win (readOnly)');
    assert.equal(schema.properties.field2.writeOnly, undefined, 'Should not have writeOnly when readOnly is set');
    console.log('✅ Conflicting constraints (last wins)');
  }

  // Test 31: Array of complex types
  {
    const source = `
      /**
       * Set users
       * @param users List of users
       */
      async setUsers(params: { users: Array<{ name: string; age: number }> }) {
        return users;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.users.type, 'array', 'Should be array type');
    assert.notEqual(schema.properties.users.items, undefined, 'Array should have items schema');
    // Items should be an object type (may not have full nested schema extraction)
    console.log('✅ Array of complex types');
  }

  // Test 32: Multiple examples (more than 2)
  {
    const source = `
      /**
       * Search with many examples
       * @param query Query {@example "john"} {@example "jane"} {@example "bob"} {@example "alice"}
       */
      async search(params: { query: string }) {
        return query;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.deepEqual(schema.properties.query.examples, ['john', 'jane', 'bob', 'alice'], 'Should support multiple examples');
    console.log('✅ Multiple examples (4)');
  }

  // Test 33: Escaped characters in pattern
  {
    const source = `
      /**
       * Phone number validation
       * @param phone Phone number {@pattern ^\\d{3}-\\d{4}$}
       */
      async validatePhone(params: { phone: string }) {
        return phone;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.phone.pattern, '^\\d{3}-\\d{4}$', 'Should preserve escaped characters');
    console.log('✅ Escaped characters in pattern');
  }

  // Test 34: Edge case - negative constraints
  {
    const source = `
      /**
       * Temperature
       * @param celsius Temperature {@min -273.15} {@max 1000}
       */
      async setTemp(params: { celsius: number }) {
        return celsius;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.celsius.minimum, -273.15, 'Should support negative min');
    assert.equal(schema.properties.celsius.maximum, 1000, 'Should support large max');
    console.log('✅ Negative and large constraint values');
  }

  // Test 35: Empty object parameter
  {
    const source = `
      /**
       * No params method
       */
      async noParams(params: {}) {
        return true;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.type, 'object', 'Should have object type');
    assert.deepEqual(schema.properties, {}, 'Should have empty properties');
    assert.equal(schema.required, undefined, 'Should not have required array');
    console.log('✅ Empty object parameter');
  }

  // Test 36: Very long enum list
  {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `'${l}'`).join(' | ');
    const source = `
      async selectLetter(params: { letter: ${letters} }) {
        return letter;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.letter.type, 'string', 'Should be string type');
    assert.equal(schema.properties.letter.enum.length, 26, 'Should have all 26 letters');
    console.log('✅ Very long enum list (26 values)');
  }

  // Test 37: Invalid JSON in default (should use as string)
  {
    const source = `
      /**
       * Test invalid JSON
       * @param value Value {@default not-json-123}
       */
      async test(params?: { value?: string }) {
        return value;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.value.default, 'not-json-123', 'Should use invalid JSON as string');
    console.log('✅ Invalid JSON in default (fallback to string)');
  }

  // Test 38: Decimal multipleOf
  {
    const source = `
      /**
       * Precise value
       * @param amount Amount {@min 0} {@max 100} {@multipleOf 0.01}
       */
      async setAmount(params: { amount: number }) {
        return amount;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.amount.multipleOf, 0.01, 'Should support decimal multipleOf');
    console.log('✅ Decimal multipleOf');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ASSET EXTRACTION TESTS
  // ═══════════════════════════════════════════════════════════════════

  // Test 39: UI asset extraction
  {
    const source = `
      /**
       * Preferences Photon
       * @ui settings ./ui/settings.html
       * @ui theme-preview ./ui/theme-preview.html
       */
      export default class Prefs extends PhotonMCP {}
    `;
    const assets = extractor.extractAssets(source);
    assert.equal(assets.ui.length, 2, 'Should detect 2 UI assets');
    assert.equal(assets.ui[0].id, 'settings', 'First UI id should be settings');
    assert.equal(assets.ui[0].path, './ui/settings.html', 'First UI path should be ./ui/settings.html');
    assert.equal(assets.ui[1].id, 'theme-preview', 'Second UI id should be theme-preview');
    console.log('✅ UI asset extraction');
  }

  // Test 40: Prompt asset extraction
  {
    const source = `
      /**
       * Test Photon
       * @prompt welcome ./prompts/welcome.md
       * @prompt error-msg ./prompts/error.md
       */
      export default class Test extends PhotonMCP {}
    `;
    const assets = extractor.extractAssets(source);
    assert.equal(assets.prompts.length, 2, 'Should detect 2 prompt assets');
    assert.equal(assets.prompts[0].id, 'welcome', 'First prompt id should be welcome');
    assert.equal(assets.prompts[1].id, 'error-msg', 'Second prompt id should be error-msg');
    console.log('✅ Prompt asset extraction');
  }

  // Test 41: Resource asset extraction
  {
    const source = `
      /**
       * Test Photon
       * @resource defaults ./resources/defaults.json
       * @resource schema /absolute/path/schema.json
       */
      export default class Test extends PhotonMCP {}
    `;
    const assets = extractor.extractAssets(source);
    assert.equal(assets.resources.length, 2, 'Should detect 2 resource assets');
    assert.equal(assets.resources[0].id, 'defaults', 'First resource id should be defaults');
    assert.equal(assets.resources[0].path, './resources/defaults.json', 'Should have relative path');
    assert.equal(assets.resources[1].path, '/absolute/path/schema.json', 'Should have absolute path');
    console.log('✅ Resource asset extraction');
  }

  // Test 42: Mixed asset types
  {
    const source = `
      /**
       * Full Photon
       * @ui form ./ui/form.html
       * @prompt greeting ./prompts/greeting.md
       * @resource config ./resources/config.json
       */
      export default class Full extends PhotonMCP {}
    `;
    const assets = extractor.extractAssets(source);
    assert.equal(assets.ui.length, 1, 'Should have 1 UI asset');
    assert.equal(assets.prompts.length, 1, 'Should have 1 prompt asset');
    assert.equal(assets.resources.length, 1, 'Should have 1 resource asset');
    console.log('✅ Mixed asset types extraction');
  }

  // Test 43: Invalid paths should not match (no ./ or / prefix)
  {
    const source = `
      /**
       * Test Photon
       * @ui settings ui/settings.html
       * This is a @ui reference that should not match
       */
      export default class Test extends PhotonMCP {}
    `;
    const assets = extractor.extractAssets(source);
    assert.equal(assets.ui.length, 0, 'Should not match paths without ./ or / prefix');
    console.log('✅ Invalid paths rejected');
  }

  // Test 44: JSDoc closing should not match as path
  {
    const source = `
      /**
       * Test method
       * @ui settings
       */
      async editSettings() {}
    `;
    const assets = extractor.extractAssets(source);
    assert.equal(assets.ui.length, 0, 'Method-level @ui without path should not be a declaration');
    console.log('✅ Method-level @ui (no path) not treated as declaration');
  }

  // Test 45: No assets when none declared
  {
    const source = `
      /**
       * Simple Photon with no assets
       */
      export default class Simple extends PhotonMCP {
        async doSomething() { return true; }
      }
    `;
    const assets = extractor.extractAssets(source);
    assert.equal(assets.ui.length, 0, 'Should have no UI assets');
    assert.equal(assets.prompts.length, 0, 'Should have no prompt assets');
    assert.equal(assets.resources.length, 0, 'Should have no resource assets');
    console.log('✅ No assets when none declared');
  }

  // ═══════════════════════════════════════════════════════════════════
  // LABEL TAG TESTS
  // ═══════════════════════════════════════════════════════════════════

  // Test 46: Custom parameter labels with {@label}
  {
    const source = `
      /**
       * Add two numbers
       * @param a {@label First Number} First value to add
       * @param b {@label Second Number} Second value to add
       */
      async add(params: { a: number; b: number }) {
        return params.a + params.b;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.a.title, 'First Number', 'First param should have custom label');
    assert.equal(schema.properties.b.title, 'Second Number', 'Second param should have custom label');
    assert.equal(schema.properties.a.description, 'First value to add', 'Label tag should be removed from description');
    console.log('✅ Custom parameter labels with {@label}');
  }

  // Test 47: Button label from @returns {@label}
  {
    const source = `
      /**
       * Calculate sum
       * @param x First number
       * @param y Second number
       * @returns {@label Calculate Sum} The sum result
       */
      async calculateSum(params: { x: number; y: number }) {
        return params.x + params.y;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).buttonLabel, 'Calculate Sum', 'Should have custom button label');
    console.log('✅ Button label from @returns {@label}');
  }

  // Test 48: Label combined with other constraints
  {
    const source = `
      /**
       * Set volume
       * @param level {@label Volume Level} {@min 0} {@max 100} Volume percentage
       */
      async setVolume(params: { level: number }) {
        return level;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.level.title, 'Volume Level', 'Should have custom label');
    assert.equal(schema.properties.level.minimum, 0, 'Should have minimum constraint');
    assert.equal(schema.properties.level.maximum, 100, 'Should have maximum constraint');
    assert.equal(schema.properties.level.description, 'Volume percentage', 'Should have clean description');
    console.log('✅ Label combined with other constraints');
  }

  // Test 49: Method without labels uses no title property
  {
    const source = `
      /**
       * Simple method
       * @param value The value
       */
      async simple(params: { value: string }) {
        return value;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.value.title, undefined, 'Should not have title without {@label}');
    assert.equal((result.tools[0] as any).buttonLabel, undefined, 'Should not have buttonLabel without {@label}');
    console.log('✅ No title without {@label} tag');
  }

  // Test 50: Label with @return (singular) variation
  {
    const source = `
      /**
       * Process value
       * @param input The input
       * @return {@label Process Now} The result
       */
      async process(params: { input: string }) {
        return input;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).buttonLabel, 'Process Now', 'Should work with @return (singular)');
    console.log('✅ Label with @return (singular) variation');
  }

  // Test 51: Placeholder tag extraction
  {
    const source = `
      /**
       * Search items
       * @param query {@placeholder Type to search...} Search query
       */
      async search(params: { query: string }) {
        return query;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.query.placeholder, 'Type to search...', 'Should have custom placeholder');
    assert.equal(schema.properties.query.description, 'Search query', 'Placeholder tag should be removed from description');
    console.log('✅ Placeholder tag extraction');
  }

  // Test 52: Hint tag extraction
  {
    const source = `
      /**
       * Set name
       * @param name {@hint This will be displayed publicly} User name
       */
      async setName(params: { name: string }) {
        return name;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.name.hint, 'This will be displayed publicly', 'Should have custom hint');
    assert.equal(schema.properties.name.description, 'User name', 'Hint tag should be removed from description');
    console.log('✅ Hint tag extraction');
  }

  // Test 53: Icon tag extraction
  {
    const source = `
      /**
       * Search for items
       * @icon 🔍
       * @param query The query
       */
      async search(params: { query: string }) {
        return query;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).icon, '🔍', 'Should have emoji icon');
    console.log('✅ Icon tag extraction (emoji)');
  }

  // Test 54: Combined placeholder, hint, and label
  {
    const source = `
      /**
       * Send message
       * @param recipient {@label To} {@placeholder name@example.com} {@hint The email address of the recipient} Email address
       */
      async send(params: { recipient: string }) {
        return recipient;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.recipient.title, 'To', 'Should have custom label');
    assert.equal(schema.properties.recipient.placeholder, 'name@example.com', 'Should have placeholder');
    assert.equal(schema.properties.recipient.hint, 'The email address of the recipient', 'Should have hint');
    assert.equal(schema.properties.recipient.description, 'Email address', 'Tags should be removed from description');
    console.log('✅ Combined placeholder, hint, and label');
  }

  // ═══════════════════════════════════════════════════════════════════
  // DAEMON FEATURE TAGS TESTS
  // ═══════════════════════════════════════════════════════════════════

  // Test 55: @webhook tag extraction (boolean)
  {
    const source = `
      /**
       * Handle incoming webhook
       * @webhook
       */
      async receiveWebhook(params: { payload: any }) {
        return payload;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).webhook, true, 'Should have webhook=true with bare @webhook tag');
    console.log('✅ @webhook tag extraction (boolean)');
  }

  // Test 56: @webhook tag with custom path
  {
    const source = `
      /**
       * Handle Stripe webhook
       * @webhook stripe/payments
       */
      async handleStripePayment(params: { event: any }) {
        return event;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).webhook, 'stripe/payments', 'Should have custom webhook path');
    console.log('✅ @webhook tag with custom path');
  }

  // Test 57: handle* prefix auto-detection as webhook
  {
    const source = `
      /**
       * Handle GitHub issue event
       */
      async handleGithubIssue(params: { action: string; issue: any }) {
        return issue;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).webhook, true, 'Should auto-detect handle* prefix as webhook');
    console.log('✅ handle* prefix auto-detection as webhook');
  }

  // Test 58: Method without handle* or @webhook has no webhook property
  {
    const source = `
      /**
       * Regular method
       */
      async processData(params: { data: any }) {
        return data;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).webhook, undefined, 'Regular method should not have webhook property');
    console.log('✅ Regular method has no webhook property');
  }

  // Test 59: @scheduled tag with inline cron expression
  {
    const source = `
      /**
       * Run daily cleanup
       * @scheduled 0 0 * * *
       */
      async dailyCleanup(params: {}) {
        return 'cleaned';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, '0 0 * * *', 'Should have cron expression from @scheduled');
    console.log('✅ @scheduled tag with inline cron expression');
  }

  // Test 60: @cron tag extraction
  {
    const source = `
      /**
       * Run at the top of every hour
       * @cron 0 * * * *
       */
      async frequentTask(params: {}) {
        return 'done';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, '0 * * * *', 'Should have cron expression from @cron');
    console.log('✅ @cron tag extraction');
  }

  // Test 61: Complex cron expression (specific day/time)
  {
    const source = `
      /**
       * Run at 2:30 AM on weekdays
       * @scheduled 30 2 * * 1-5
       */
      async weekdayTask(params: {}) {
        return 'done';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, '30 2 * * 1-5', 'Should parse complex cron expression');
    console.log('✅ Complex cron expression (weekdays)');
  }

  // Test 62: Cron with ranges and lists
  {
    const source = `
      /**
       * Run every 15 minutes during business hours
       * @cron 0,15,30,45 9-17 * * 1-5
       */
      async businessHoursTask(params: {}) {
        return 'done';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, '0,15,30,45 9-17 * * 1-5', 'Should parse cron with ranges and lists');
    console.log('✅ Cron with ranges and lists');
  }

  // Test 63: scheduled* prefix without @cron has no scheduled property
  {
    const source = `
      /**
       * Method named with scheduled prefix but no cron
       */
      async scheduledMissingCron(params: {}) {
        return 'done';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, undefined, 'scheduled* prefix without @cron should have no scheduled property');
    console.log('✅ scheduled* prefix without @cron has no scheduled property');
  }

  // Test 64: Method without scheduled tag has no scheduled property
  {
    const source = `
      /**
       * Regular method
       */
      async regularMethod(params: {}) {
        return 'done';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, undefined, 'Regular method should not have scheduled property');
    console.log('✅ Regular method has no scheduled property');
  }

  // Test 65: @locked tag extraction (boolean)
  {
    const source = `
      /**
       * Update board with lock
       * @locked
       */
      async updateBoard(params: { board: string }) {
        return board;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).locked, true, 'Should have locked=true with bare @locked tag');
    console.log('✅ @locked tag extraction (boolean)');
  }

  // Test 66: @locked tag with custom lock name
  {
    const source = `
      /**
       * Batch update tasks
       * @locked board:write
       */
      async batchUpdate(params: { taskIds: string[] }) {
        return taskIds;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).locked, 'board:write', 'Should have custom lock name');
    console.log('✅ @locked tag with custom lock name');
  }

  // Test 67: Method without @locked has no locked property
  {
    const source = `
      /**
       * Regular method without lock
       */
      async noLock(params: { data: any }) {
        return data;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).locked, undefined, 'Regular method should not have locked property');
    console.log('✅ Regular method has no locked property');
  }

  // Test 68: Combined daemon features (webhook + locked)
  {
    const source = `
      /**
       * Handle webhook with lock protection
       * @webhook github/push
       * @locked github:push
       */
      async handleGithubPush(params: { commits: any[] }) {
        return commits;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).webhook, 'github/push', 'Should have custom webhook path');
    assert.equal((tool as any).locked, 'github:push', 'Should have custom lock name');
    console.log('✅ Combined daemon features (webhook + locked)');
  }

  // Test 69: Combined daemon features (scheduled + locked)
  {
    const source = `
      /**
       * Run scheduled task with lock
       * @scheduled 0 0,12 * * *
       * @locked cleanup:daily
       */
      async scheduledCleanup(params: {}) {
        return 'done';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, '0 0,12 * * *', 'Should have cron expression');
    assert.equal((tool as any).locked, 'cleanup:daily', 'Should have custom lock name');
    console.log('✅ Combined daemon features (scheduled + locked)');
  }

  // Test 70: All daemon features with other metadata
  {
    const source = `
      /**
       * Process webhook data
       * @webhook stripe
       * @locked stripe:process
       * @icon 💳
       * @format json
       * @param event The Stripe event
       */
      async handleStripeEvent(params: { event: any }) {
        return event;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).webhook, 'stripe', 'Should have webhook path');
    assert.equal((tool as any).locked, 'stripe:process', 'Should have lock name');
    assert.equal((tool as any).icon, '💳', 'Should have icon');
    assert.equal((tool as any).outputFormat, 'json', 'Should have format');
    console.log('✅ All daemon features with other metadata');
  }

  // Test 71: @webhook takes precedence over handle* prefix
  {
    const source = `
      /**
       * Handle with custom webhook path
       * @webhook custom/path
       */
      async handleCustomEvent(params: { data: any }) {
        return data;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).webhook, 'custom/path', '@webhook should provide path even with handle* prefix');
    console.log('✅ @webhook takes precedence over handle* prefix');
  }

  // Test 72: @internal combined with daemon features
  {
    const source = `
      /**
       * Internal scheduled cleanup
       * @scheduled 0 0 * * 0
       * @internal
       */
      async scheduledWeeklyCleanup(params: {}) {
        return 'cleaned';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, '0 0 * * 0', 'Should have cron expression for @internal method');
    console.log('✅ @internal combined with daemon features');
  }

  // Test 73: Cron with step and range values
  {
    const source = `
      /**
       * Run every 10 minutes during business hours
       * @cron 0,10,20,30,40,50 9-17 * * *
       */
      async everyTenMinutes(params: {}) {
        return 'done';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).scheduled, '0,10,20,30,40,50 9-17 * * *', 'Should parse step value cron');
    console.log('✅ Cron with step and range values');
  }

  // Test 74: Case insensitivity of daemon tags
  {
    const source = `
      /**
       * Test case insensitivity
       * @WEBHOOK github
       * @LOCKED test
       */
      async testCaseInsensitive(params: {}) {
        return 'done';
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).webhook, 'github', '@WEBHOOK should be recognized');
    assert.equal((tool as any).locked, 'test', '@LOCKED should be recognized');
    console.log('✅ Case insensitivity of daemon tags');
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHOICE AND FIELD TAG TESTS
  // ═══════════════════════════════════════════════════════════════════

  // Test 75: {@choice} tag generates enum
  {
    const source = `
      /**
       * Set user status
       * @param status User status {@choice active,inactive,pending}
       */
      async setStatus(params: { status: string }) {
        return status;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.deepEqual(schema.properties.status.enum, ['active', 'inactive', 'pending'], 'Should generate enum from {@choice}');
    assert.equal(schema.properties.status.type, 'string', 'Should be string type');
    console.log('✅ {@choice} tag generates enum');
  }

  // Test 76: {@choice} with spaces around values
  {
    const source = `
      /**
       * Select priority
       * @param priority Priority level {@choice low, medium, high}
       */
      async setPriority(params: { priority: string }) {
        return priority;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.deepEqual(schema.properties.priority.enum, ['low', 'medium', 'high'], 'Should trim spaces from choices');
    console.log('✅ {@choice} with spaces around values');
  }

  // Test 77: {@field} tag sets field type
  {
    const source = `
      /**
       * Update profile
       * @param bio Biography {@field textarea}
       */
      async updateProfile(params: { bio: string }) {
        return bio;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.bio.field, 'textarea', 'Should set field type from {@field}');
    console.log('✅ {@field} tag sets field type');
  }

  // Test 78: {@field} combined with other tags
  {
    const source = `
      /**
       * Set password
       * @param password New password {@field password} {@min 8}
       */
      async setPassword(params: { password: string }) {
        return password;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.password.field, 'password', 'Should have field type');
    assert.equal(schema.properties.password.minLength, 8, 'Should also have minLength');
    console.log('✅ {@field} combined with other tags');
  }

  // Test 79: {@choice} combined with {@label}
  {
    const source = `
      /**
       * Set theme
       * @param theme {@label Theme Mode} {@choice light,dark,auto} Select theme
       */
      async setTheme(params: { theme: string }) {
        return theme;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const schema = result.tools[0].inputSchema;
    assert.equal(schema.properties.theme.title, 'Theme Mode', 'Should have custom label');
    assert.deepEqual(schema.properties.theme.enum, ['light', 'dark', 'auto'], 'Should have enum');
    assert.equal(schema.properties.theme.description, 'Select theme', 'Tags should be removed from description');
    console.log('✅ {@choice} combined with {@label}');
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTORUN TAG TESTS
  // ═══════════════════════════════════════════════════════════════════

  // Test 80: @autorun tag extraction
  {
    const source = `
      /**
       * Get current status
       * @autorun
       */
      async getStatus(params: {}) {
        return { status: 'online' };
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).autorun, true, 'Should have autorun=true');
    console.log('✅ @autorun tag extraction');
  }

  // Test 81: Method without @autorun has no autorun property
  {
    const source = `
      /**
       * Regular method
       */
      async regularMethod(params: {}) {
        return true;
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).autorun, undefined, 'Should not have autorun property');
    console.log('✅ Method without @autorun has no autorun property');
  }

  // Test 82: @autorun combined with @icon
  {
    const source = `
      /**
       * Get system info
       * @autorun
       * @icon 📊
       */
      async systemInfo(params: {}) {
        return { uptime: 100 };
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal((tool as any).autorun, true, 'Should have autorun');
    assert.equal((tool as any).icon, '📊', 'Should have icon');
    console.log('✅ @autorun combined with @icon');
  }

  console.log('\n✅ All Schema Extractor tests passed! (82 tests)');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}
