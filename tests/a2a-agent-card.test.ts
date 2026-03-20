/**
 * A2A Agent Card Tests
 *
 * Tests Agent Card generation from photon metadata,
 * capability detection, and skill mapping.
 */

import { describe, it, expect } from 'vitest';
import { generateAgentCard } from '../src/a2a/card-generator.js';
import type { AgentCard } from '../src/a2a/types.js';

describe('A2A Agent Card Generator', () => {
  const singlePhoton = [
    {
      name: 'todo',
      description: 'A todo list manager',
      stateful: true,
      methods: [
        {
          name: 'add',
          description: 'Add a new todo item',
          params: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
        {
          name: 'list',
          description: 'List all todo items',
          params: {},
        },
      ],
    },
  ];

  const multiPhoton = [
    {
      name: 'todo',
      description: 'Todo manager',
      stateful: true,
      methods: [{ name: 'add', description: 'Add item', params: { type: 'object' } }],
    },
    {
      name: 'weather',
      description: 'Weather service',
      stateful: false,
      methods: [{ name: 'forecast', description: 'Get forecast', params: {} }],
    },
  ];

  it('generates a valid Agent Card from photon info', () => {
    const card = generateAgentCard(singlePhoton);

    expect(card.name).toBe('todo');
    expect(card.description).toBe('A todo list manager');
    expect(card.url).toBe('http://localhost:3000');
    expect(card.version).toBe('1.0.0');
    expect(card.defaultInputModes).toEqual(['text/plain', 'application/json']);
    expect(card.defaultOutputModes).toEqual(['text/plain', 'application/json']);
  });

  it('maps each photon method to a skill with correct id/name/description', () => {
    const card = generateAgentCard(singlePhoton);

    expect(card.skills).toHaveLength(2);
    expect(card.skills[0]).toEqual({
      id: 'todo/add',
      name: 'todo add',
      description: 'Add a new todo item',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      tags: undefined,
    });
    expect(card.skills[1]).toEqual({
      id: 'todo/list',
      name: 'todo list',
      description: 'List all todo items',
      inputSchema: undefined,
      tags: undefined,
    });
  });

  it('includes input schemas from tool definitions', () => {
    const photonWithTools = [
      {
        name: 'calc',
        tools: [
          {
            name: 'compute',
            description: 'Run a computation',
            inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
          },
        ],
      },
    ];

    const card = generateAgentCard(photonWithTools);

    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].inputSchema).toEqual({
      type: 'object',
      properties: { expr: { type: 'string' } },
    });
  });

  it('detects "stateful" capability from @stateful photons', () => {
    const card = generateAgentCard(singlePhoton);

    const statefulCap = card.capabilities.find((c) => c.name === 'stateful');
    expect(statefulCap).toBeDefined();
    expect(statefulCap!.description).toContain('state');
  });

  it('omits "stateful" when no photons are stateful', () => {
    const card = generateAgentCard([
      {
        name: 'basic',
        stateful: false,
        methods: [{ name: 'run', description: 'Run', params: {} }],
      },
    ]);

    const statefulCap = card.capabilities.find((c) => c.name === 'stateful');
    expect(statefulCap).toBeUndefined();
  });

  it('always includes streaming and ag-ui capabilities', () => {
    const card = generateAgentCard(singlePhoton);

    expect(card.capabilities.find((c) => c.name === 'streaming')).toBeDefined();
    expect(card.capabilities.find((c) => c.name === 'ag-ui')).toBeDefined();
  });

  it('includes tool_execution capability when methods exist', () => {
    const card = generateAgentCard(singlePhoton);

    expect(card.capabilities.find((c) => c.name === 'tool_execution')).toBeDefined();
  });

  it('includes provider info when configured', () => {
    const card = generateAgentCard(singlePhoton, {
      organization: 'Portel',
      organizationUrl: 'https://portel.dev',
    });

    expect(card.provider).toEqual({
      organization: 'Portel',
      url: 'https://portel.dev',
    });
  });

  it('omits provider when not configured', () => {
    const card = generateAgentCard(singlePhoton);
    expect(card.provider).toBeUndefined();
  });

  it('sets default input/output modes', () => {
    const card = generateAgentCard(singlePhoton);

    expect(card.defaultInputModes).toContain('text/plain');
    expect(card.defaultInputModes).toContain('application/json');
    expect(card.defaultOutputModes).toContain('text/plain');
    expect(card.defaultOutputModes).toContain('application/json');
  });

  it('uses custom baseUrl and version from options', () => {
    const card = generateAgentCard(singlePhoton, {
      baseUrl: 'https://agent.example.com',
      version: '2.0.0',
    });

    expect(card.url).toBe('https://agent.example.com');
    expect(card.version).toBe('2.0.0');
  });

  it('handles multiple photons — aggregates skills from all', () => {
    const card = generateAgentCard(multiPhoton);

    expect(card.name).toBe('photon-agent');
    expect(card.description).toContain('todo');
    expect(card.description).toContain('weather');
    expect(card.skills).toHaveLength(2);
    expect(card.skills[0].id).toBe('todo/add');
    expect(card.skills[1].id).toBe('weather/forecast');
  });

  it('handles photons with no methods gracefully', () => {
    const card = generateAgentCard([{ name: 'empty' }]);

    expect(card.skills).toHaveLength(0);
    // No tool_execution capability when no tools
    expect(card.capabilities.find((c) => c.name === 'tool_execution')).toBeUndefined();
  });

  it('prefers methods over tools when both are present', () => {
    const card = generateAgentCard([
      {
        name: 'dual',
        methods: [{ name: 'alpha', description: 'Alpha method', params: {} }],
        tools: [{ name: 'beta', description: 'Beta tool' }],
      },
    ]);

    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('dual/alpha');
  });
});
