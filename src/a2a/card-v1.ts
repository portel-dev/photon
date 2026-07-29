import type { AgentCardV1, AgentSkill } from './types.js';

export function generateAgentCardV1(
  name: string,
  description: string,
  url: string,
  skills: AgentSkill[],
  options?: { version?: string; authenticated?: boolean }
): AgentCardV1 {
  const card: AgentCardV1 = {
    name,
    description,
    url,
    version: options?.version || '1.0.0',
    supportedInterfaces: [
      { url, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { url, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
    ],
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    skills,
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
  };
  if (options?.authenticated) {
    card.securitySchemes = { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } };
    card.security = [{ bearer: [] }];
  }
  return card;
}
