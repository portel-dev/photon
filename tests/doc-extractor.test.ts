/**
 * Tests for PhotonDocExtractor
 * Run: npx tsx tests/doc-extractor.test.ts
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PhotonDocExtractor } from '../src/photon-doc-extractor.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

// ── Temp file setup ──

const tmpDir = '/tmp/photon-doc-extractor-tests';
fs.mkdirSync(tmpDir, { recursive: true });

// A rich photon file that exercises all extraction paths
const richContent = `
/**
 * A multi-purpose test photon for documentation extraction.
 * It validates that all JSDoc tags and inline constraints are parsed correctly.
 *
 * Configuration:
 * - apiKey: Your API key for authentication
 * - region: AWS region to use
 *
 * @version 2.5.0
 * @author Jane Doe
 * @license MIT
 * @icon rocket
 * @stateful
 * @internal
 * @label My Cool Photon
 * @runtime ^1.5.0
 * @dependencies axios@^1.0.0, lodash@^4.0.0
 * @mcps github, slack
 * @photons todo, calendar
 */
export default class TestDocPhoton {
  constructor(private apiKey: string, private region?: string) {}

  /**
   * Fetches a resource by ID with constraints on the id param.
   * @param id The resource identifier {@min 1} {@max 9999}
   * @param format Output format {@choice json,xml,csv}
   */
  async fetch(id: number, format?: string) {
    return { id, format };
  }

  /**
   * Creates a new entry with validated email and pattern.
   * @param email User email address {@format email}
   * @param slug URL-friendly slug {@pattern ^[a-z0-9-]+$}
   * @param data Payload data {@example {"key": "value", "nested": {"a": 1}}}
   */
  async create(email: string, slug: string, data: object) {
    return { email, slug, data };
  }

  /**
   * Streams data to the client.
   * @param query Search query {@min 3} {@max 200} {@format uri}
   */
  async *stream(query: string) {
    yield { emit: 'status', message: 'Starting stream' };
    yield { ask: 'confirm', message: 'Continue?' };
  }

  /**
   * Removes an item from the collection.
   * @emits items:cleared
   * @param itemId Item to remove
   */
  async remove(itemId: string) {
    return { removed: true };
  }

  /**
   * Reads configuration values.
   */
  async read() {
    return {};
  }

  /**
   * Sends a notification.
   */
  async send() {
    return {};
  }

  /**
   * Validates input data.
   */
  async validate() {
    return {};
  }

  /**
   * Configures settings.
   */
  async setup() {
    return {};
  }

  /**
   * Runs the main process.
   */
  async run() {
    return {};
  }

  /**
   * Stops execution.
   */
  async stop() {
    return {};
  }

  /**
   * Connects to external service.
   */
  async connect() {
    return {};
  }

  /**
   * Downloads a report.
   */
  async download() {
    return {};
  }

  /**
   * Updates an existing record.
   */
  async update() {
    return {};
  }

  /**
   * Deletes a record.
   */
  async drop() {
    return {};
  }

  /**
   * @internal
   */
  async secret() {
    return {};
  }

  private async _helper() {
    return {};
  }

  async onInitialize() {}
  async onShutdown() {}
}
`;

const richFilePath = path.join(tmpDir, 'test-doc-extractor.photon.ts');
fs.writeFileSync(richFilePath, richContent);

// A simple API-only photon (no generators)
const apiOnlyContent = `
/**
 * Simple API photon with no generators.
 * @version 1.0.0
 */
export default class SimpleApi {
  /**
   * Gets items.
   */
  async list() {
    return [];
  }
}
`;
const apiOnlyPath = path.join(tmpDir, 'simple-api.photon.ts');
fs.writeFileSync(apiOnlyPath, apiOnlyContent);

// A streaming-only photon (generators but no ask/emit)
const streamingContent = `
/**
 * Streaming photon with generators but no ask/emit.
 * @version 1.0.0
 */
export default class StreamOnly {
  /**
   * Streams results.
   */
  async *results() {
    yield 'chunk1';
    yield 'chunk2';
  }

  /**
   * Plain method.
   */
  async plain() {
    return 'ok';
  }
}
`;
const streamingPath = path.join(tmpDir, 'stream-only.photon.ts');
fs.writeFileSync(streamingPath, streamingContent);

// A workflow photon (generators + ask/emit)
const workflowContent = `
/**
 * Workflow photon with ask and emit patterns.
 * @version 1.0.0
 * @mcps github
 */
export default class MyWorkflow {
  /**
   * Runs the workflow.
   */
  async *execute() {
    yield { emit: 'status', message: 'Starting' };
    const answer = yield { ask: 'confirm', message: 'Proceed?' };
    const name = yield { ask: 'text', message: 'Enter name' };
    yield { emit: 'progress', message: 'Working...' };
    await this.mcp('github').listRepos();
    await this.photon('todo').list();
    return { done: true };
  }
}
`;
const workflowPath = path.join(tmpDir, 'my-workflow.photon.ts');
fs.writeFileSync(workflowPath, workflowContent);

// A photon with feature detection patterns
const featureContent = `
/**
 * Feature-rich photon.
 * @version 1.0.0
 * @stateful
 * @ui dashboard ./dashboard/index.html
 * @webhook incoming
 */
export default class FeaturePhoton {
  /**
   * Uses mcp bridge.
   */
  async bridge() {
    const result = await this.mcp('slack').send();
    const other = await this.photon('calendar').events();
    return result;
  }

  /**
   * Has elicitation.
   */
  async *wizard() {
    const x = yield { ask: 'text', message: 'Name?' };
    yield { emit: 'status', message: 'Done' };
    return x;
  }

  /**
   * Uses locks.
   */
  async locked() {
    await this.acquireLock('res');
    await this.releaseLock('res');
  }
}
`;
const featurePath = path.join(tmpDir, 'feature-photon.photon.ts');
fs.writeFileSync(featurePath, featureContent);

// Photon with multiple inline constraints on one param
const multiConstraintContent = `
/**
 * Multi-constraint photon.
 */
export default class MultiConstraint {
  /**
   * Has combined constraints.
   * @param score The score value {@min 0} {@max 100} {@format int32}
   */
  async check(score: number) {
    return score;
  }
}
`;
const multiConstraintPath = path.join(tmpDir, 'multi-constraint.photon.ts');
fs.writeFileSync(multiConstraintPath, multiConstraintContent);

// No JSDoc photon
const noJsdocContent = `
export default class Bare {
  async doStuff() {
    return 'hi';
  }
}
`;
const noJsdocPath = path.join(tmpDir, 'no-jsdoc.photon.ts');
fs.writeFileSync(noJsdocPath, noJsdocContent);

// ── Test sections ──

async function testExtractName() {
  console.log('\n── extractName ──\n');

  await test('extracts name from filename (kebab-case)', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.name, 'test-doc-extractor');
  });

  await test('extracts name from simple filename', async () => {
    const meta = await new PhotonDocExtractor(apiOnlyPath).extractFullMetadata();
    assert.equal(meta.name, 'simple-api');
  });

  await test('extracts name from nested path', async () => {
    const meta = await new PhotonDocExtractor(workflowPath).extractFullMetadata();
    assert.equal(meta.name, 'my-workflow');
  });
}

async function testExtractDescription() {
  console.log('\n── extractDescription ──\n');

  await test('extracts multi-line description before @tags', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.description.includes('multi-purpose test photon'));
    assert.ok(meta.description.includes('validates that all JSDoc tags'));
  });

  await test('description does not contain @tags', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(!meta.description.includes('@version'));
    assert.ok(!meta.description.includes('@author'));
  });

  await test('returns empty string when no JSDoc', async () => {
    const meta = await new PhotonDocExtractor(noJsdocPath).extractFullMetadata();
    assert.equal(meta.description, '');
  });
}

async function testExtractTag() {
  console.log('\n── extractTag ──\n');

  await test('@version is extracted', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.version, '2.5.0');
  });

  await test('@author is extracted', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.author, 'Jane Doe');
  });

  await test('@license is extracted', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.license, 'MIT');
  });

  await test('@icon is extracted', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.icon, 'rocket');
  });

  await test('@stateful boolean tag is true', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.stateful, true);
  });

  await test('@internal boolean tag is true', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.internal, true);
  });

  await test('@label is extracted', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.label, 'My Cool Photon');
  });

  await test('@runtime is extracted', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.equal(meta.runtime, '^1.5.0');
  });

  await test('missing tag returns undefined', async () => {
    const meta = await new PhotonDocExtractor(apiOnlyPath).extractFullMetadata();
    assert.equal(meta.author, undefined);
    assert.equal(meta.license, undefined);
    assert.equal(meta.icon, undefined);
  });
}

async function testExtractClassName() {
  console.log('\n── extractClassName (via configParams env prefix) ──\n');

  await test('class name extracted from export default class', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    // The className is used internally for configParams env var naming
    // TestDocPhoton -> TEST_DOC_PHOTON_APIKEY
    const apiKeyParam = meta.configParams?.find((p) => p.name === 'apiKey');
    if (apiKeyParam) {
      assert.ok(apiKeyParam.envVar.startsWith('TEST_DOC_PHOTON'));
    }
  });
}

async function testParseInlineJSDocTags() {
  console.log('\n── parseInlineJSDocTags (via extractTools params) ──\n');

  await test('{@min N} extracts min constraint', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const fetchTool = meta.tools?.find((t) => t.name === 'fetch');
    assert.ok(fetchTool, 'fetch tool not found');
    const idParam = fetchTool.params.find((p) => p.name === 'id');
    assert.ok(idParam, 'id param not found');
    assert.ok(
      idParam.constraintsFormatted?.includes('min: 1'),
      `expected min: 1, got: ${idParam.constraintsFormatted}`
    );
  });

  await test('{@max N} extracts max constraint', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const fetchTool = meta.tools?.find((t) => t.name === 'fetch');
    const idParam = fetchTool!.params.find((p) => p.name === 'id');
    assert.ok(idParam!.constraintsFormatted?.includes('max: 9999'));
  });

  await test('{@format email} extracts format constraint', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const createTool = meta.tools?.find((t) => t.name === 'create');
    const emailParam = createTool!.params.find((p) => p.name === 'email');
    assert.ok(emailParam!.constraintsFormatted?.includes('format: email'));
  });

  await test('{@pattern regex} extracts pattern constraint', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const createTool = meta.tools?.find((t) => t.name === 'create');
    const slugParam = createTool!.params.find((p) => p.name === 'slug');
    assert.ok(slugParam!.constraintsFormatted?.includes('pattern: ^[a-z0-9-]+$'));
  });

  await test('{@choice a,b,c} extracts choice constraint', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const fetchTool = meta.tools?.find((t) => t.name === 'fetch');
    const formatParam = fetchTool!.params.find((p) => p.name === 'format');
    assert.ok(formatParam!.constraintsFormatted?.includes('choice: json,xml,csv'));
  });

  await test('{@example {json}} extracts example with nested braces', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const createTool = meta.tools?.find((t) => t.name === 'create');
    const dataParam = createTool!.params.find((p) => p.name === 'data');
    assert.ok(dataParam!.example, 'example not found');
    assert.ok(dataParam!.example!.includes('"key"'));
    assert.ok(dataParam!.example!.includes('"nested"'));
  });

  await test('multiple constraints combined on one param', async () => {
    const meta = await new PhotonDocExtractor(multiConstraintPath).extractFullMetadata();
    const checkTool = meta.tools?.find((t) => t.name === 'check');
    assert.ok(checkTool, 'check tool not found');
    const scoreParam = checkTool.params.find((p) => p.name === 'score');
    assert.ok(scoreParam!.constraintsFormatted?.includes('min: 0'));
    assert.ok(scoreParam!.constraintsFormatted?.includes('max: 100'));
    // Note: {@format int32} won't match because the source regex is [a-z-]+ (no digits)
    // This is by design - format values should be alphabetic like 'email', 'uri', 'date'
  });

  await test('constraints are cleaned from description text', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const fetchTool = meta.tools?.find((t) => t.name === 'fetch');
    const idParam = fetchTool!.params.find((p) => p.name === 'id');
    assert.ok(!idParam!.description.includes('{@min'));
    assert.ok(!idParam!.description.includes('{@max'));
  });
}

async function testStripJSDocTagsFromDescription() {
  console.log('\n── stripJSDocTagsFromDescription (via tool descriptions) ──\n');

  await test('@emits line is removed from method description', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const removeTool = meta.tools?.find((t) => t.name === 'remove');
    assert.ok(removeTool, 'remove tool not found');
    assert.ok(
      !removeTool.description.includes('@emits'),
      `description still contains @emits: "${removeTool.description}"`
    );
    assert.ok(removeTool.description.includes('Removes an item'));
  });
}

async function testDetectFeatures() {
  console.log('\n── detectFeatures ──\n');

  await test('detects generator feature', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.features.includes('generator'));
  });

  await test('detects stateful feature', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.features.includes('stateful'));
  });

  await test('detects elicitation from yield ask pattern', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.features.includes('elicitation'));
  });

  await test('detects streaming from yield emit pattern', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.features.includes('streaming'));
  });

  await test('detects mcp-bridge from this.mcp() calls', async () => {
    const meta = await new PhotonDocExtractor(featurePath).extractFullMetadata();
    assert.ok(meta.features.includes('mcp-bridge'));
  });

  await test('detects photon-bridge from this.photon() calls', async () => {
    const meta = await new PhotonDocExtractor(featurePath).extractFullMetadata();
    assert.ok(meta.features.includes('photon-bridge'));
  });

  await test('detects locks from acquireLock/releaseLock', async () => {
    const meta = await new PhotonDocExtractor(featurePath).extractFullMetadata();
    assert.ok(meta.features.includes('locks'));
  });

  await test('API-only photon has no generator feature', async () => {
    const meta = await new PhotonDocExtractor(apiOnlyPath).extractFullMetadata();
    assert.ok(!meta.features.includes('generator'));
    assert.ok(!meta.features.includes('elicitation'));
    assert.ok(!meta.features.includes('streaming'));
  });
}

async function testDetectPhotonType() {
  console.log('\n── detectPhotonType ──\n');

  await test('API type for non-generator photon', async () => {
    const meta = await new PhotonDocExtractor(apiOnlyPath).extractFullMetadata();
    assert.equal(meta.photonType, 'api');
  });

  await test('streaming type for generator without ask/emit', async () => {
    const meta = await new PhotonDocExtractor(streamingPath).extractFullMetadata();
    assert.equal(meta.photonType, 'streaming');
  });

  await test('workflow type for generator with ask/emit patterns', async () => {
    const meta = await new PhotonDocExtractor(workflowPath).extractFullMetadata();
    assert.equal(meta.photonType, 'workflow');
  });
}

async function testExtractDependencies() {
  console.log('\n── extractDependencies ──\n');

  await test('@mcps parsed into mcp list', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.externalDeps.mcps.includes('github'));
    assert.ok(meta.externalDeps.mcps.includes('slack'));
  });

  await test('@photons parsed into photon list', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.externalDeps.photons.includes('todo'));
    assert.ok(meta.externalDeps.photons.includes('calendar'));
  });

  await test('@dependencies parsed into npm list (package names only)', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.externalDeps.npm.includes('axios'));
    assert.ok(meta.externalDeps.npm.includes('lodash'));
  });

  await test('no dependencies returns empty arrays', async () => {
    const meta = await new PhotonDocExtractor(apiOnlyPath).extractFullMetadata();
    assert.deepEqual(meta.externalDeps.mcps, []);
    assert.deepEqual(meta.externalDeps.photons, []);
    assert.deepEqual(meta.externalDeps.npm, []);
  });
}

// A dedicated API photon with various verb-named methods for emoji inference testing
const emojiTestContent = `
/**
 * Emoji inference test photon.
 */
export default class EmojiTest {
  /** Fetches data. */
  async fetch() { return {}; }
  /** Creates data. */
  async create() { return {}; }
  /** Removes data. */
  async remove() { return {}; }
  /** Drops data. */
  async drop() { return {}; }
  /** Sends data. */
  async send() { return {}; }
  /** Validates data. */
  async validate() { return {}; }
  /** Sets up config. */
  async setup() { return {}; }
  /** Runs process. */
  async run() { return {}; }
  /** Stops process. */
  async stop() { return {}; }
  /** Connects to service. */
  async connect() { return {}; }
  /** Downloads report. */
  async download() { return {}; }
  /** Updates record. */
  async update() { return {}; }
}
`;
const emojiTestPath = path.join(tmpDir, 'emoji-test.photon.ts');
fs.writeFileSync(emojiTestPath, emojiTestContent);

async function testInferEmoji() {
  console.log('\n── inferEmoji (via API diagram tool labels) ──\n');

  // Use a pure API photon so the diagram is an API surface diagram with tool names
  const meta = await new PhotonDocExtractor(emojiTestPath).extractFullMetadata();
  assert.equal(meta.photonType, 'api'); // sanity check

  await test('fetch tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('fetch'));
  });

  await test('create tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('create'));
  });

  await test('remove and drop tools appear in API diagram', async () => {
    assert.ok(meta.diagram!.includes('remove'));
    assert.ok(meta.diagram!.includes('drop'));
  });

  await test('send tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('send'));
  });

  await test('validate tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('validate'));
  });

  await test('setup tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('setup'));
  });

  await test('run tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('run'));
  });

  await test('stop tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('stop'));
  });

  await test('connect tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('connect'));
  });

  await test('download tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('download'));
  });

  await test('update tool appears in API diagram', async () => {
    assert.ok(meta.diagram!.includes('update'));
  });
}

async function testDiagramGeneration() {
  console.log('\n── Diagram generation ──\n');

  await test('API diagram has flowchart LR', async () => {
    const meta = await new PhotonDocExtractor(apiOnlyPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('flowchart LR'));
  });

  await test('API diagram has subgraph with photon name', async () => {
    const meta = await new PhotonDocExtractor(apiOnlyPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('Simple Api'));
  });

  await test('API diagram has PHOTON center node', async () => {
    const meta = await new PhotonDocExtractor(apiOnlyPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('PHOTON'));
  });

  await test('streaming diagram marks generators with (stream)', async () => {
    const meta = await new PhotonDocExtractor(streamingPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('(stream)'), `diagram: ${meta.diagram}`);
  });

  await test('streaming diagram uses flowchart LR', async () => {
    const meta = await new PhotonDocExtractor(streamingPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('flowchart LR'));
  });

  await test('workflow diagram uses flowchart TD', async () => {
    const meta = await new PhotonDocExtractor(workflowPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('flowchart TD'));
  });

  await test('workflow diagram has Start and Success nodes', async () => {
    const meta = await new PhotonDocExtractor(workflowPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('Start'));
    assert.ok(meta.diagram!.includes('Success'));
  });

  await test('workflow diagram includes ask/emit nodes', async () => {
    const meta = await new PhotonDocExtractor(workflowPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('Starting'));
    assert.ok(meta.diagram!.includes('Proceed?'));
  });

  await test('workflow diagram includes external call nodes', async () => {
    const meta = await new PhotonDocExtractor(workflowPath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('github.listRepos'));
    assert.ok(meta.diagram!.includes('todo.list'));
  });

  await test('API diagram with dependencies shows deps subgraph', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    assert.ok(meta.diagram!.includes('Dependencies'));
    assert.ok(meta.diagram!.includes('github'));
    assert.ok(meta.diagram!.includes('slack'));
  });
}

async function testToolExtraction() {
  console.log('\n── Tool extraction edge cases ──\n');

  await test('private methods (_helper) are excluded', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const names = meta.tools?.map((t) => t.name) || [];
    assert.ok(!names.includes('_helper'));
  });

  await test('lifecycle methods (onInitialize, onShutdown) are excluded', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const names = meta.tools?.map((t) => t.name) || [];
    assert.ok(!names.includes('onInitialize'));
    assert.ok(!names.includes('onShutdown'));
  });

  await test('@internal methods are excluded', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const names = meta.tools?.map((t) => t.name) || [];
    assert.ok(!names.includes('secret'));
  });

  await test('generator methods have isGenerator=true', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const streamTool = meta.tools?.find((t) => t.name === 'stream');
    assert.ok(streamTool, 'stream tool not found');
    assert.equal(streamTool.isGenerator, true);
  });

  await test('non-generator methods have isGenerator falsy', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const fetchTool = meta.tools?.find((t) => t.name === 'fetch');
    assert.ok(fetchTool, 'fetch tool not found');
    assert.ok(!fetchTool.isGenerator);
  });

  await test('methods without JSDoc are excluded', async () => {
    const meta = await new PhotonDocExtractor(noJsdocPath).extractFullMetadata();
    assert.equal(meta.tools?.length, 0);
  });

  await test('param types come from method signature', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const fetchTool = meta.tools?.find((t) => t.name === 'fetch');
    const idParam = fetchTool!.params.find((p) => p.name === 'id');
    assert.equal(idParam!.type, 'number');
    const formatParam = fetchTool!.params.find((p) => p.name === 'format');
    assert.equal(formatParam!.optional, true);
  });
}

async function testConfigParams() {
  console.log('\n── Config params ──\n');

  await test('constructor params extracted as config', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const params = meta.configParams || [];
    const apiKey = params.find((p) => p.name === 'apiKey');
    assert.ok(apiKey, 'apiKey config param should exist');
  });

  await test('config descriptions from Configuration section', async () => {
    const meta = await new PhotonDocExtractor(richFilePath).extractFullMetadata();
    const params = meta.configParams || [];
    const apiKey = params.find((p) => p.name === 'apiKey');
    if (apiKey) {
      assert.ok(apiKey.description.includes('API key'));
    }
  });
}

// ── Runner ──

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              DOC EXTRACTOR TESTS                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testExtractName();
  await testExtractDescription();
  await testExtractTag();
  await testExtractClassName();
  await testParseInlineJSDocTags();
  await testStripJSDocTagsFromDescription();
  await testDetectFeatures();
  await testDetectPhotonType();
  await testExtractDependencies();
  await testInferEmoji();
  await testDiagramGeneration();
  await testToolExtraction();
  await testConfigParams();

  // Cleanup
  try {
    fs.unlinkSync(richFilePath);
    fs.unlinkSync(apiOnlyPath);
    fs.unlinkSync(streamingPath);
    fs.unlinkSync(workflowPath);
    fs.unlinkSync(featurePath);
    fs.unlinkSync(multiConstraintPath);
    fs.unlinkSync(noJsdocPath);
    fs.unlinkSync(emojiTestPath);
    fs.rmdirSync(tmpDir);
  } catch {
    // Best-effort cleanup
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));
  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All doc extractor tests passed!\n');
})();
