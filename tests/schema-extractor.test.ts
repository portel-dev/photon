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

  console.log('\n✅ All Schema Extractor tests passed!');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}
