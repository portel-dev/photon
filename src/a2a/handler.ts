import type {
  A2AHandler,
  A2AInvocationContext,
  A2AMessage,
  A2AEvent,
  A2AHandlerResult,
} from './types.js';

export interface A2AHandlerDeclaration {
  method: string;
  photon?: string;
}

/** Locate the single user-owned handler declared with @a2aHandler. */
export function extractA2AHandler(source: string): A2AHandlerDeclaration | undefined {
  const matches = extractA2AHandlers(source);
  if (matches.length === 0) return undefined;
  if (matches.length > 1) return undefined;
  const explicit = matches[0].explicit;
  const method = matches[0].method;
  return { method: explicit || method };
}

export function extractA2AHandlers(source: string): Array<{ explicit?: string; method: string }> {
  return [
    ...source.matchAll(
      /\/\*\*[\s\S]*?@a2aHandler(?:\s+([\w$.-]+))?[\s\S]*?\*\/\s*(?:async\s+)?(?:function\s+)?([\w$]+)\s*\(/g
    ),
  ].map((match) => ({ explicit: match[1], method: match[2] }));
}

export function extractA2ASkills(source: string): string[] {
  const methods: string[] = [];
  const re =
    /\/\*\*[\s\S]*?@surface\s+[^\n*]*\ba2a\b[^\n*]*[\s\S]*?\*\/\s*(?:async\s+)?([\w$]+)\s*\(/g;
  for (const match of source.matchAll(re)) methods.push(match[1]);
  return methods;
}

export async function invokeA2AHandler(
  handler: A2AHandler,
  message: A2AMessage,
  context: A2AInvocationContext
): Promise<A2AHandlerResult | AsyncIterable<A2AEvent>> {
  return await handler(message, context);
}
