import { describe, expect, it } from 'vitest';
import { normalizeCloudflareMcpToolDefinition } from '../dist/deploy/cloudflare.js';

describe('MCP named object parameter normalization', () => {
  it('flattens a simpleParams wrapper before Cloudflare code generation', () => {
    const tool = normalizeCloudflareMcpToolDefinition({
      name: 'updateBookingSetup',
      simpleParams: true,
      inputSchema: {
        type: 'object',
        properties: {
          params: {
            type: 'object',
            properties: {
              promotions: { type: 'array' },
            },
            required: ['promotions'],
          },
        },
        required: ['params'],
      },
    });

    expect(tool.simpleParams).toBeUndefined();
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: { promotions: { type: 'array' } },
      required: ['promotions'],
    });
  });

  it('leaves ordinary flat tools unchanged', () => {
    const tool = {
      name: 'bookConsultation',
      simpleParams: true,
      inputSchema: { type: 'object', properties: { email: { type: 'string' } } },
    };
    expect(normalizeCloudflareMcpToolDefinition(tool)).toEqual(tool);
  });

  it('leaves a non-object params field unchanged', () => {
    const tool = {
      name: 'echo',
      simpleParams: true,
      inputSchema: { type: 'object', properties: { params: { type: 'string' } } },
    };
    expect(normalizeCloudflareMcpToolDefinition(tool)).toEqual(tool);
  });
});
