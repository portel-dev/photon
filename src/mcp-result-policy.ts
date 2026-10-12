import type { MCPImageContent, MCPTextContent } from './types/server-types.js';
import { buildMCPToolError } from './mcp/protocol/tool-errors.js';
import { sanitizePublicErrorMessage } from './shared/error-handler.js';

export function formatMcpResult(result: any): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    if ('success' in result && 'content' in result) return result.content || String(result);
    if ('success' in result && 'error' in result) {
      if (!result.success) throw new Error(result.error);
      return result.error || 'Success';
    }
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

export function imageContentFromMcpResult(
  value: unknown,
  declaredMimeType?: string
): MCPImageContent | null {
  if (typeof value === 'string') {
    const match = value.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (match) return { type: 'image', mimeType: match[1], data: match[2].replace(/\s/g, '') };
    if (value.trimStart().startsWith('{')) {
      try {
        return imageContentFromMcpResult(JSON.parse(value), declaredMimeType);
      } catch {
        return null;
      }
    }
    return null;
  }
  let bytes: Uint8Array | null = null;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (
      entries.length > 0 &&
      entries.every(([key, item]) => /^\d+$/.test(key) && Number.isInteger(item))
    ) {
      const ordered = entries.sort(([a], [b]) => Number(a) - Number(b));
      bytes = Uint8Array.from(ordered.map(([, item]) => Number(item)));
    }
  }
  if (!bytes) return null;
  const detectedMimeType =
    declaredMimeType ||
    (bytes[0] === 0x42 && bytes[1] === 0x4d
      ? 'image/bmp'
      : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        ? 'image/png'
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          ? 'image/jpeg'
          : undefined);
  if (!detectedMimeType?.startsWith('image/')) return null;
  return { type: 'image', mimeType: detectedMimeType, data: Buffer.from(bytes).toString('base64') };
}

export function formatMcpTemplateResult(result: any): any {
  if (result && typeof result === 'object' && 'messages' in result) {
    return { messages: result.messages };
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

export function formatMcpError(error: unknown, toolName: string): any {
  return buildMCPToolError(toolName, error);
}

export function sanitizeMcpError(error: unknown): string {
  return sanitizePublicErrorMessage(error);
}

export type McpTextOrImageContent = MCPTextContent | MCPImageContent;
