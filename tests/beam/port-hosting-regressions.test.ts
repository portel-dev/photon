/**
 * Port/TEL hosting regressions that Photon must own.
 *
 * These are intentionally boundary-level contracts for bugs seen while running
 * TSX apps through Beam. They are written before the implementation fixes so a
 * Photon-side agent can make them pass without guessing the desired behavior.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  shouldBypassBeamServiceWorkerNavigation,
  shouldHandleBeamServiceWorkerNavigation,
} from '../../src/auto-ui/beam.js';

const repoRoot = process.cwd();

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function source(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf-8');
}

async function run(): Promise<void> {
  console.log('\nPort/TEL Beam hosting regression contracts:');

  await test('Beam service worker never owns linked app navigation routes', () => {
    const appPaths = [
      '/web/port',
      '/web/port/threads',
      '/web/port/threads/session-123',
      '/web/port/api/state',
      '/web/calendar/events/today',
    ];

    for (const pathname of appPaths) {
      assert.equal(
        shouldBypassBeamServiceWorkerNavigation(pathname),
        true,
        `${pathname} must bypass Beam's service worker`
      );
      assert.equal(
        shouldHandleBeamServiceWorkerNavigation(pathname),
        false,
        `${pathname} must not be handled by Beam's offline boot page`
      );
    }
  });

  await test('Beam service worker cache is scoped to a concrete Beam owner', () => {
    const beamSource = source('src/auto-ui/beam.ts');

    assert.equal(
      beamSource.includes("const CACHE_NAME = 'photon-pwa-v1';"),
      false,
      'a fixed global service-worker cache lets one Beam instance mask another app on the same port'
    );
    assert.match(
      beamSource,
      /CACHE_NAME[\s\S]*(EXPECTED_WORKING_DIR|workingDir|owner|diagnostics)/,
      'service-worker cache naming should include the Beam owner/workdir or diagnostics fingerprint'
    );
  });

  await test('Beam acknowledges the bridge handshake for blob-based custom UIs', () => {
    const beamSource = source('src/auto-ui/beam.ts');

    assert.match(
      beamSource,
      /if \(msg\.type === 'photon:hello'\)[\s\S]*?postMessage\(\{ type: 'photon:ack', id: msg\.id \}/,
      'Beam must acknowledge photon:hello so custom UIs use postMessage instead of blob: fetch fallback'
    );
  });

  await test('destructive MCP confirmations include actionable tool context without extending elicitation params', () => {
    const transportSource = source('src/auto-ui/streamable-http-transport.ts');
    const destructiveBlockMatch = transportSource.match(
      /if \(methodInfo\?\.destructiveHint\) \{[\s\S]*?requestBeamElicitation\([\s\S]*?\}\s*,\s*\{ photonName: serverName, methodName \}/
    );

    assert.ok(destructiveBlockMatch, 'destructive tool calls must route through Beam elicitation');

    const block = destructiveBlockMatch[0];
    assert.match(block, /photonName/, 'confirmation must identify the photon/server');
    assert.match(block, /methodName/, 'confirmation must identify the method');
    assert.match(block, /methodTitle/, 'confirmation must include the human-readable method title');
    assert.match(block, /description/, 'confirmation must include the method description');
    assert.match(
      block,
      /(_meta|uiMetadata|preview|argumentPreview|inputPreview|JSON\.stringify\(.*arguments|JSON\.stringify\(.*params)/,
      'confirmation must surface a tool-argument preview through Beam UI metadata or MCP _meta, not blind yes/no text'
    );
  });

  await test('elicitation modal has room for MCP-safe structured approval display context', () => {
    const modalSource = source('src/auto-ui/frontend/components/elicitation-modal.ts');

    assert.match(modalSource, /methodTitle\?: string/, 'modal accepts a method title');
    assert.match(modalSource, /photonName\?: string/, 'modal accepts a photon name');
    assert.match(modalSource, /methodName\?: string/, 'modal accepts a method name');
    assert.match(
      modalSource,
      /(_meta|uiMetadata|preview|argumentPreview|inputPreview)\?:/,
      'modal must accept MCP-safe display metadata for a tool-argument preview'
    );
  });

  await test('date form fields use Photon calendar controls instead of native browser popups', () => {
    const bridgeSource = source('src/auto-ui/bridge/index.ts');
    const modalSource = source('src/auto-ui/frontend/components/elicitation-modal.ts');

    assert.match(
      bridgeSource,
      /function _needsRichForm\(schema\)/,
      'metadata-driven forms must detect date fields and select the shared rich form renderer'
    );
    assert.match(
      bridgeSource,
      /viewOverride === 'form' \|\| _needsRichForm\(meta\.inputSchema\)/,
      'date fields must not fall back to a native input[type=date] popup'
    );
    assert.match(
      bridgeSource,
      /properties\[keys\[i\]\]\.type === 'number' \|\| properties\[keys\[i\]\]\.type === 'integer'/,
      'numeric fields must select the shared rich form renderer'
    );
    assert.match(
      modalSource,
      /import '\.\/inputs\/date-picker\.js';/,
      'elicitation forms must register the shared date picker'
    );
    assert.match(
      modalSource,
      /<date-picker[\s\S]*mode=\$\{mode\}[\s\S]*@change=/,
      'elicitation date fields must render the shared date picker'
    );
    assert.match(
      modalSource,
      /import '\.\/inputs\/number-stepper\.js';/,
      'elicitation forms must register the shared number stepper'
    );
    assert.match(
      modalSource,
      /<number-stepper[\s\S]*\.step=\$\{step\}[\s\S]*@change=/,
      'elicitation numeric fields must render the shared number stepper'
    );
  });

  await test('Beam method cards use the canonical method-selection lifecycle', () => {
    const cardSource = source('src/auto-ui/frontend/components/method-card.ts');
    const beamSource = source('src/auto-ui/frontend/components/beam-app.ts');

    assert.match(cardSource, /@pointerup=\$\{\(e: PointerEvent\) =>/);
    assert.match(
      cardSource,
      /new CustomEvent\('select',[\s\S]*bubbles: true,[\s\S]*composed: true/
    );
    assert.match(
      beamSource,
      /<method-card[\s\S]*@select=\$\{this\._handleMethodSelect\}/,
      'method cards must use the shared method-selection handler'
    );
  });

  await test('standard elicitation/create payload stays spec-shaped', () => {
    const transportSource = source('src/auto-ui/streamable-http-transport.ts');
    const confirmSchemaMatch = transportSource.match(
      /case 'confirm':[\s\S]*?requestedSchema:\s*\{[\s\S]*?required:\s*\['confirmed'\][\s\S]*?\}/
    );
    const destructiveBlockMatch = transportSource.match(
      /if \(methodInfo\?\.destructiveHint\) \{[\s\S]*?requestBeamElicitation\([\s\S]*?\}\s*,\s*\{ photonName: serverName, methodName \}/
    );

    assert.ok(confirmSchemaMatch, 'confirm elicitation schema must be present');
    assert.ok(destructiveBlockMatch, 'destructive tool calls must route through Beam elicitation');
    assert.match(
      confirmSchemaMatch[0],
      /requestedSchema[\s\S]*properties[\s\S]*confirmed[\s\S]*type:\s*'boolean'/,
      'confirm elicitation should use a flat boolean requestedSchema'
    );
    assert.match(
      destructiveBlockMatch[0],
      /_meta[\s\S]*argumentPreview/,
      'argument previews must be carried as display metadata, not as MCP requestedSchema fields'
    );
  });

  await test('Beam resumes MCP 2026 durable input rounds instead of treating them as errors', () => {
    const beamSource = source('src/auto-ui/frontend/components/beam-app.ts');
    const clientSource = source('src/auto-ui/frontend/services/mcp-client.ts');
    const sdkSource = source('src/auto-ui/frontend/services/mcp-client-sdk.ts');

    assert.match(
      beamSource,
      /isMCPInputRequired\(result\)[\s\S]*?_presentMCPInputRound/,
      'Beam must detect input_required before normal error/result handling'
    );
    assert.match(
      beamSource,
      /buildMCPInputContinuation\(pending, value\)/,
      'Beam must use the canonical continuation builder instead of assembling a wire response inline'
    );
    assert.doesNotMatch(
      beamSource,
      /inputResponses:\s*\{\s*\[pending\.inputKey\]/,
      'Beam must not have a second ad hoc input response encoder'
    );
    assert.match(
      clientSource,
      /requestState: string;[\s\S]*?inputResponses: Record<string, unknown>/,
      'the MCP client must preserve the 2026 continuation shape'
    );
    assert.match(
      sdkSource,
      /requestState: options\.requestState[\s\S]*?inputResponses: options\.inputResponses/,
      'the SDK must send continuation state outside tool arguments'
    );
  });

  await test('MCP select schemas retain Photon rich option metadata for Beam', () => {
    const transportSource = source('src/auto-ui/streamable-http-transport.ts');
    const serverSource = source('src/server.ts');

    assert.match(
      transportSource,
      /'x-photon-option':\s*\{[\s\S]*?option\.image[\s\S]*?option\.price/,
      'modern MCP select options must retain image and pricing metadata'
    );
    assert.match(
      serverSource,
      /'x-photon-options':\s*photonOptions/,
      'legacy MCP select options must retain Photon rich option metadata'
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
