/**
 * MCP Spec Tags — End-to-End Test
 *
 * Verifies that all MCP standard annotations flow correctly from
 * JSDoc tags → schema extraction → MCP tools/list → MCP tools/call.
 *
 * Uses tags.photon.ts from the official photons repo as the test fixture.
 * Connects via STDIO transport (real MCP client → real photon server).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SchemaExtractor } from '@portel/photon-core';
import { readFileSync } from 'fs';
import { strict as assert } from 'assert';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
const photonsDir = path.join(__dirname, '..', '..', 'photons');
const tagsPhotonPath = path.join(photonsDir, 'tags.photon.ts');

let passed = 0;
let failed = 0;

function ok(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

// ═════════════════════════════════════════════════════════════════
// Layer 1: Schema Extraction (photon-core)
// Verifies that JSDoc tags are correctly parsed into ExtractedSchema
// ═════════════════════════════════════════════════════════════════

console.log('\n🧪 Layer 1: Schema Extraction\n');

const extractor = new SchemaExtractor();
const source = readFileSync(tagsPhotonPath, 'utf-8');
const metadata = extractor.extractAllFromSource(source);
const schemas = metadata.tools;

function findSchema(name: string) {
  return schemas.find((s) => s.name === name);
}

// --- Tool Annotations ---

{
  const s = findSchema('listItems');
  ok(!!s, 'listItems schema extracted');
  ok((s as any)?.readOnlyHint === true, 'listItems: readOnlyHint = true');
  ok((s as any)?.title === 'List All Items', 'listItems: title extracted');
}

{
  const s = findSchema('nuke');
  ok(!!s, 'nuke schema extracted');
  ok((s as any)?.destructiveHint === true, 'nuke: destructiveHint = true');
  ok((s as any)?.title === 'Delete Everything', 'nuke: title extracted');
}

{
  const s = findSchema('upsert');
  ok(!!s, 'upsert schema extracted');
  ok((s as any)?.idempotentHint === true, 'upsert: idempotentHint = true');
  ok((s as any)?.title === 'Upsert Record', 'upsert: title extracted');
}

{
  const s = findSchema('weather');
  ok(!!s, 'weather schema extracted');
  ok((s as any)?.openWorldHint === true, 'weather: openWorldHint = true');
}

{
  const s = findSchema('localOnly');
  ok(!!s, 'localOnly schema extracted');
  ok((s as any)?.openWorldHint === false, 'localOnly: openWorldHint = false (closedWorld)');
}

{
  const s = findSchema('safeQuery');
  ok(!!s, 'safeQuery schema extracted');
  ok((s as any)?.readOnlyHint === true, 'safeQuery: readOnlyHint = true');
  ok((s as any)?.idempotentHint === true, 'safeQuery: idempotentHint = true');
  ok((s as any)?.openWorldHint === false, 'safeQuery: openWorldHint = false');
  ok((s as any)?.title === 'Safe Local Query', 'safeQuery: title extracted');
}

// --- Content Annotations ---

{
  const s = findSchema('userOnly');
  ok(!!s, 'userOnly schema extracted');
  ok(
    JSON.stringify((s as any)?.audience) === JSON.stringify(['user']),
    'userOnly: audience = ["user"]'
  );
  ok((s as any)?.contentPriority === 0.9, 'userOnly: contentPriority = 0.9');
}

{
  const s = findSchema('assistantOnly');
  ok(!!s, 'assistantOnly schema extracted');
  ok(
    JSON.stringify((s as any)?.audience) === JSON.stringify(['assistant']),
    'assistantOnly: audience = ["assistant"]'
  );
  ok((s as any)?.contentPriority === 0.3, 'assistantOnly: contentPriority = 0.3');
}

{
  const s = findSchema('bothAudience');
  ok(!!s, 'bothAudience schema extracted');
  ok(
    JSON.stringify((s as any)?.audience) === JSON.stringify(['user', 'assistant']),
    'bothAudience: audience = ["user", "assistant"]'
  );
}

// --- Structured Output ---

// Inline return type — auto-inferred, no tags needed
{
  const s = findSchema('createTask');
  ok(!!s, 'createTask schema extracted');
  const out = (s as any)?.outputSchema;
  ok(!!out, 'createTask: outputSchema auto-inferred from return type');
  ok(out?.type === 'object', 'createTask: outputSchema.type = object');
  ok(out?.properties?.id?.type === 'string', 'createTask: id type = string');
  ok(out?.properties?.title?.type === 'string', 'createTask: title type = string');
  ok(out?.properties?.done?.type === 'boolean', 'createTask: done type = boolean');
  ok(out?.properties?.priority?.type === 'number', 'createTask: priority type = number');
  ok(
    JSON.stringify(out?.required?.sort()) === JSON.stringify(['done', 'id', 'priority', 'title']),
    'createTask: all fields required'
  );
}

// Interface return type — descriptions from JSDoc on interface properties
{
  const s = findSchema('describedTask');
  ok(!!s, 'describedTask schema extracted');
  const out = (s as any)?.outputSchema;
  ok(!!out, 'describedTask: outputSchema from interface');
  ok(out?.properties?.id?.type === 'string', 'describedTask: id type = string');
  ok(
    out?.properties?.id?.description === 'Unique task identifier',
    'describedTask: id has description from interface'
  );
  ok(out?.properties?.title?.description === 'Task title', 'describedTask: title has description');
  ok(out?.properties?.done?.type === 'boolean', 'describedTask: done type = boolean');
  ok(
    out?.properties?.done?.description === 'Whether the task is complete',
    'describedTask: done has description'
  );
  ok(out?.properties?.priority?.type === 'number', 'describedTask: priority type = number');
  ok(
    out?.properties?.priority?.description === 'Priority level 1-5',
    'describedTask: priority has description'
  );
}

// --- Disambiguation ---

{
  const s = findSchema('lookup');
  ok(!!s, 'lookup schema extracted');
  ok((s as any)?.readOnlyHint === true, 'lookup: method-level @readOnly detected');
  // Param-level {@readOnly} should mark the param, not conflict with method-level
  const idProp = s?.inputSchema?.properties?.id;
  ok(idProp?.readOnly === true, 'lookup: param-level {@readOnly} on id field');
}

// ═════════════════════════════════════════════════════════════════
// Layer 2: MCP Transport (STDIO)
// Verifies tools/list includes standard annotations, icons, outputSchema
// and tools/call returns content annotations + structuredContent
// ═════════════════════════════════════════════════════════════════

console.log('\n🧪 Layer 2: MCP Transport (STDIO)\n');

async function createClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, 'mcp', 'tags'],
    env: { ...process.env, PHOTON_DIR: photonsDir },
  });

  const client = new Client({ name: 'mcp-spec-tags-test', version: '1.0.0' }, { capabilities: {} });

  await client.connect(transport);
  return client;
}

let client: Client | null = null;

try {
  client = await createClient();
  const { tools } = await client.listTools();

  function findTool(name: string) {
    return tools.find((t) => t.name === name);
  }

  // --- tools/list: annotations ---

  {
    const t = findTool('listItems');
    ok(!!t, 'MCP: listItems tool listed');
    const ann = (t as any)?.annotations;
    ok(!!ann, 'MCP: listItems has annotations');
    ok(ann?.readOnlyHint === true, 'MCP: listItems annotations.readOnlyHint = true');
    ok(ann?.title === 'List All Items', 'MCP: listItems annotations.title');
  }

  {
    const t = findTool('nuke');
    ok(!!t, 'MCP: nuke tool listed');
    const ann = (t as any)?.annotations;
    ok(!!ann, 'MCP: nuke has annotations');
    ok(ann?.destructiveHint === true, 'MCP: nuke annotations.destructiveHint = true');
    ok(ann?.title === 'Delete Everything', 'MCP: nuke annotations.title');
  }

  {
    const t = findTool('upsert');
    ok(!!t, 'MCP: upsert tool listed');
    const ann = (t as any)?.annotations;
    ok(ann?.idempotentHint === true, 'MCP: upsert annotations.idempotentHint = true');
  }

  {
    const t = findTool('weather');
    ok(!!t, 'MCP: weather tool listed');
    const ann = (t as any)?.annotations;
    ok(ann?.openWorldHint === true, 'MCP: weather annotations.openWorldHint = true');
  }

  {
    const t = findTool('localOnly');
    ok(!!t, 'MCP: localOnly tool listed');
    const ann = (t as any)?.annotations;
    ok(ann?.openWorldHint === false, 'MCP: localOnly annotations.openWorldHint = false');
  }

  {
    const t = findTool('safeQuery');
    ok(!!t, 'MCP: safeQuery tool listed');
    const ann = (t as any)?.annotations;
    ok(ann?.readOnlyHint === true, 'MCP: safeQuery combined readOnlyHint');
    ok(ann?.idempotentHint === true, 'MCP: safeQuery combined idempotentHint');
    ok(ann?.openWorldHint === false, 'MCP: safeQuery combined openWorldHint');
    ok(ann?.title === 'Safe Local Query', 'MCP: safeQuery combined title');
  }

  // --- tools/list: outputSchema ---

  {
    const t = findTool('createTask');
    ok(!!t, 'MCP: createTask tool listed');
    const out = (t as any)?.outputSchema;
    ok(!!out, 'MCP: createTask has outputSchema');
    ok(out?.type === 'object', 'MCP: createTask outputSchema.type = object');
    ok(!!out?.properties?.id, 'MCP: createTask outputSchema.properties.id');
    ok(!!out?.properties?.done, 'MCP: createTask outputSchema.properties.done');
    ok(out?.properties?.done?.type === 'boolean', 'MCP: createTask outputSchema done type');
  }

  // Interface return type with descriptions
  {
    const t = findTool('describedTask');
    ok(!!t, 'MCP: describedTask tool listed');
    const out = (t as any)?.outputSchema;
    ok(!!out, 'MCP: describedTask has outputSchema from interface');
    ok(
      out?.properties?.id?.description === 'Unique task identifier',
      'MCP: describedTask id description'
    );
    ok(out?.properties?.priority?.type === 'number', 'MCP: describedTask priority type = number');
  }

  // --- tools/call: content annotations ---

  {
    console.log('\n  📡 Calling tools to verify content annotations...\n');

    const userResult = await client.callTool({ name: 'userOnly', arguments: {} });
    ok(Array.isArray(userResult.content), 'MCP call userOnly: has content');
    const block = (userResult.content as any[])?.[0];
    ok(!!block?.annotations, 'MCP call userOnly: content block has annotations');
    ok(
      JSON.stringify(block?.annotations?.audience) === JSON.stringify(['user']),
      'MCP call userOnly: annotations.audience = ["user"]'
    );
    ok(block?.annotations?.priority === 0.9, 'MCP call userOnly: annotations.priority = 0.9');
  }

  {
    const assistResult = await client.callTool({ name: 'assistantOnly', arguments: {} });
    const block = (assistResult.content as any[])?.[0];
    ok(!!block?.annotations, 'MCP call assistantOnly: content block has annotations');
    ok(
      JSON.stringify(block?.annotations?.audience) === JSON.stringify(['assistant']),
      'MCP call assistantOnly: annotations.audience = ["assistant"]'
    );
    ok(block?.annotations?.priority === 0.3, 'MCP call assistantOnly: annotations.priority = 0.3');
  }

  {
    const bothResult = await client.callTool({ name: 'bothAudience', arguments: {} });
    const block = (bothResult.content as any[])?.[0];
    ok(!!block?.annotations, 'MCP call bothAudience: content block has annotations');
    ok(
      JSON.stringify(block?.annotations?.audience) === JSON.stringify(['user', 'assistant']),
      'MCP call bothAudience: annotations.audience = ["user", "assistant"]'
    );
  }

  // --- tools/call: structuredContent ---

  {
    const taskResult = await client.callTool({
      name: 'createTask',
      arguments: { title: 'Write tests' },
    });
    ok(Array.isArray(taskResult.content), 'MCP call createTask: has content');

    const sc = (taskResult as any).structuredContent;
    ok(!!sc, 'MCP call createTask: has structuredContent');
    ok(sc?.id === 'task-001', 'MCP call createTask: structuredContent.id');
    ok(sc?.title === 'Write tests', 'MCP call createTask: structuredContent.title');
    ok(sc?.done === false, 'MCP call createTask: structuredContent.done');
    ok(sc?.priority === 3, 'MCP call createTask: structuredContent.priority');
  }

  // describedTask: interface return type with structuredContent
  {
    const descResult = await client.callTool({
      name: 'describedTask',
      arguments: { title: 'Described test' },
    });
    const sc = (descResult as any).structuredContent;
    ok(!!sc, 'MCP call describedTask: has structuredContent');
    ok(sc?.id === 'task-002', 'MCP call describedTask: structuredContent.id');
    ok(sc?.title === 'Described test', 'MCP call describedTask: structuredContent.title');
    ok(sc?.priority === 2, 'MCP call describedTask: structuredContent.priority');
  }

  // --- tools/call: methods without annotations should NOT have annotations ---

  {
    const noAnnoResult = await client.callTool({ name: 'localOnly', arguments: {} });
    const block = (noAnnoResult.content as any[])?.[0];
    ok(
      !block?.annotations,
      'MCP call localOnly: no content annotations (only tool-level openWorldHint)'
    );
  }

  // --- Backward compat: tools without new tags produce clean output ---

  {
    const plain = findTool('upsert');
    ok(!(plain as any)?.annotations?.readOnlyHint, 'upsert: no readOnlyHint (not set)');
    ok(!(plain as any)?.annotations?.destructiveHint, 'upsert: no destructiveHint (not set)');
    ok(
      (plain as any)?.annotations?.openWorldHint === undefined,
      'upsert: no openWorldHint (not set)'
    );
  }
} catch (error) {
  console.error('\n❌ MCP Transport test failed:', error instanceof Error ? error.message : error);
  failed++;
} finally {
  if (client) {
    try {
      await client.close();
    } catch {}
  }
}

// ═════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
