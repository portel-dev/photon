/**
 * Lightweight MCP client shim for pure-view context.
 * Uses window.postMessage to communicate with the pure-view MCP adapter
 * (which proxies to the Beam server via HTTP fetch).
 *
 * This replaces the full mcpClient singleton when building the form bundle,
 * so invoke-form can resolve x-choiceFrom fields without the heavy Beam SSE client.
 */

function callToolViaPostMessage(toolName: string, args: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = 'form_' + Date.now() + '_' + Math.random().toString(36).slice(2);

    function handler(event: MessageEvent) {
      const msg = event.data;
      if (!msg || msg.jsonrpc !== '2.0' || msg.id !== id) return;
      window.removeEventListener('message', handler);
      if (msg.error) {
        reject(new Error(msg.error.message || 'MCP call failed'));
      } else {
        resolve(msg.result);
      }
    }

    window.addEventListener('message', handler);
    // Timeout after 10 seconds
    setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('MCP call timeout'));
    }, 10000);

    window.postMessage(
      {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      },
      '*'
    );
  });
}

export const mcpClient = {
  callTool: callToolViaPostMessage,
  // Stub other methods that invoke-form might reference (none currently used)
  parseToolResult(result: any): any {
    if (!result?.content) return result;
    for (const item of result.content) {
      if (item.type === 'text') {
        try {
          return JSON.parse(item.text);
        } catch {
          return item.text;
        }
      }
    }
    return result;
  },
};
