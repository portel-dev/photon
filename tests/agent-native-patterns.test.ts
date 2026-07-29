import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toCapabilityContract } from '../src/capability-contract.js';
import { validateAppContext } from '../src/app-context.js';
import { extractSkillDeclarations } from '../src/skills.js';
import { extractA2AHandler, extractA2ASkills } from '../src/a2a/handler.js';
import { extractApplicationManifest } from '../src/auto-ui/app-manifest.js';

test('canonical capability contract preserves metadata and defaults to MCP surfaces', () => {
  const contract = toCapabilityContract({
    name: 'save',
    description: 'Save a record',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    isStateful: true,
  });
  assert.deepEqual([...contract.exposure], ['mcp', 'cli']);
  assert.equal(contract.annotations.idempotentHint, true);
  assert.equal(contract.execution.stateful, true);
});

test('internal and explicit surface exposure are represented without coercion', () => {
  const internal = toCapabilityContract({
    name: 'helper',
    description: '',
    inputSchema: { type: 'object', properties: {} },
    internal: true,
  });
  assert.deepEqual([...internal.exposure], ['runtime']);
  const a2a = toCapabilityContract({
    name: 'delegate',
    description: '',
    inputSchema: { type: 'object', properties: {} },
    surfaces: ['a2a'],
  });
  assert.deepEqual([...a2a.exposure], ['a2a']);
});

test('app context is bounded and normalized', () => {
  const context = validateAppContext({
    navigation: { photon: 'todos', view: 'detail' },
    source: 'beam',
  });
  assert.equal(context.navigation?.photon, 'todos');
  assert.equal(context.source, 'beam');
  assert.throws(() => validateAppContext({ selection: 'x'.repeat(20_000) }), /exceeds/);
});

test('skill declarations expose descriptors without reading bodies', () => {
  const skills = extractSkillDeclarations(
    '/**\n * @skill deploy skills/deploy/SKILL.md\n */\nclass App {}'
  );
  assert.deepEqual(skills, [{ name: 'deploy', description: '', path: 'skills/deploy/SKILL.md' }]);
});

test('A2A declarations require an explicit handler and expose opted-in skills', () => {
  const source = `/** @a2aHandler */\nasync handleAgent(message, context) {}\n/** @surface a2a */\nasync summarize(params) {}`;
  assert.deepEqual(extractA2AHandler(source), { method: 'handleAgent' });
  assert.deepEqual(extractA2ASkills(source), ['summarize']);
  assert.equal(extractA2AHandler('class App { async run() {} }'), undefined);
  assert.equal(
    extractA2AHandler('/** @a2aHandler */ async one() {}\n/** @a2aHandler */ async two() {}'),
    undefined
  );
});

test('application manifest composes screens and settings from existing methods', () => {
  const manifest = extractApplicationManifest(
    [
      { name: 'listTasks', linkedUi: 'tasks', label: 'Tasks' },
      { name: 'getTask', linkedUi: 'task-detail', label: 'Detail' },
      { name: 'settings' },
    ],
    { entry: 'listTasks', settings: true, name: 'Task board' }
  );
  assert.equal(manifest?.name, 'Task board');
  assert.deepEqual(
    manifest?.screens.map((screen) => screen.id),
    ['tasks', 'task-detail']
  );
  assert.equal(manifest?.screens[0].route, 'tasks');
  assert.equal(manifest?.settings, 'settings');
});
