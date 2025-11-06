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

  console.log('\n✅ All Schema Extractor tests passed!');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}
