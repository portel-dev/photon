# Elicitation Architecture

## Current State

Photon uses generator functions with `yield` statements for:
1. **Progress updates**: `yield { emit: 'status', message: '...' }`
2. **User input requests (asks)**: `yield { emit: 'ask', ... }`

This works perfectly for:
- ✅ CLI (via readline prompt)
- ✅ Playground UI (via SSE and modal dialogs)

## MCP Elicitation Protocol

According to the [MCP spec](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation):

### Request Format
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "elicitation/create",
  "params": {
    "message": "Please provide your GitHub username",
    "requestedSchema": {
      "type": "object",
      "properties": { "name": { "type": "string" } },
      "required": ["name"]
    }
  }
}
```

### Response Format
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "action": "accept",
    "content": { "name": "octocat" }
  }
}
```

## Challenge: MCP Transport Limitations

### STDIO Transport
- ✅ **Bidirectional**: Server can call client methods
- ✅ **Elicitation works**: Can send `elicitation/create` requests during tool execution

### SSE Transport  
- ❌ **Server → Client only**: One-way event stream
- ❌ **No client requests**: Client cannot send JSON-RPC requests back
- ❌ **Elicitation blocked**: Cannot request user input mid-execution

## Current Workaround

For SSE transport, we currently:
1. Execute the generator
2. Collect all yields (progress + asks)
3. Return everything at the end
4. ❌ **Problem**: Asks are not interactive - user cannot respond

## Solution Options

### Option 1: Dual Transport (Recommended)
Use SSE for events + HTTP POST for requests:
- SSE: Server → Client events (progress, results)
- POST `/mcp/request`: Client → Server JSON-RPC requests (elicitation responses)

**Pros**: 
- Maintains MCP compatibility
- Supports full elicitation protocol
- Clean separation of concerns

**Cons**:
- Requires two connections
- More complex client implementation

### Option 2: WebSocket Transport
Replace SSE with WebSocket for bidirectional communication.

**Pros**:
- Single connection
- Full bidirectional support
- Native MCP transport option

**Cons**:
- More complex than SSE
- Need to implement WebSocket transport

### Option 3: Polling for SSE
Client polls `/mcp/pending-requests` during tool execution.

**Pros**:
- Works with existing SSE
- Simpler than Option 1

**Cons**:
- Inefficient (polling overhead)
- Not true real-time
- Hacky solution

## Recommended Implementation

### Phase 1: STDIO (Already Works)
- Elicitation fully supported via bidirectional STDIO
- Use for Claude Desktop, Cline, etc.

### Phase 2: Add WebSocket Transport
```typescript
// New transport option
photon serve web --transport=websocket
```

### Phase 3: Playground Enhancement
Update playground to:
1. Use WebSocket for bidirectional MCP
2. Display elicitation modals in real-time
3. Send responses back via WebSocket

## Code Changes Needed

### 1. WebSocket Transport (src/server.ts)
```typescript
import { WebSocketServerTransport } from '@modelcontextprotocol/sdk/server/websocket.js';

// Add websocket option
export type TransportType = 'stdio' | 'sse' | 'websocket';
```

### 2. Generator Execution with Elicitation
```typescript
// In executeGenerator (photon-core)
async function* handleElicitation(
  generator: AsyncGenerator<PhotonYield, any, any>,
  elicitationHandler: (req: ElicitationRequest) => Promise<ElicitationResponse>
) {
  for await (const value of generator) {
    if (value.emit === 'ask') {
      const response = await elicitationHandler({
        message: value.message,
        requestedSchema: value.schema
      });
      
      if (response.action === 'accept') {
        yield* generator.next(response.content);
      } else {
        throw new Error('User declined input request');
      }
    } else {
      yield value;
    }
  }
}
```

### 3. Playground WebSocket Client
```javascript
const ws = new WebSocket('ws://localhost:3001/mcp');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.method === 'elicitation/create') {
    // Show modal
    showElicitationModal(data.params).then(response => {
      // Send response back
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: data.id,
        result: response
      }));
    });
  }
};
```

## Testing Plan

1. **Unit Tests**: Test elicitation request/response mapping
2. **Integration Tests**: Test WebSocket transport with elicitation
3. **E2E Tests**: Test playground with interactive asks
4. **MCP Compliance**: Verify against official MCP test suite

## Implementation Status

- [x] **Phase 1**: Document architecture (this file)
- [x] **Phase 2**: MCP elicitation support via SDK 1.25+ (`src/mcp-elicitation.ts`)
- [x] **Phase 3**: Wire elicitation to generators (`server.ts` - `createMCPInputProvider`)
- [x] **Phase 4**: Beam UI supports interactive asks via SSE
- [x] **Phase 5**: Testing with kitchen-sink photon

**Note**: WebSocket transport was deprioritized as SSE with HTTP POST callbacks works well for Beam UI, and STDIO handles MCP elicitation natively.

## References

- [MCP Elicitation Spec](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [WebSocket Transport](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
