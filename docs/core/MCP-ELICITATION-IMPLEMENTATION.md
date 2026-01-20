# MCP Elicitation Implementation Plan

## Current State

We have a **custom generator-based elicitation** system:
- Tools can `yield { ask: 'text', message: '...' }` to request user input
- The runtime's `createInputProvider()` handles these yields
- Works great for CLI (`readline`) and our playground

## Problem

**MCP clients expect standard `elicitation/create` JSON-RPC method**, not custom generator yields.

According to MCP spec (2025-06-18):
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "elicitation/create",
  "params": {
    "message": "Please provide your contact information",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "email": {"type": "string", "format": "email"}
      },
      "required": ["name", "email"]
    }
  }
}
```

## Solution Architecture

### 1. Declare Elicitation Capability

During MCP server initialization, declare support:
```typescript
server.setRequestHandler(InitializeRequestSchema, async () => {
  return {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {},
      prompts: {},
      resources: {},
      elicitation: {  // ← ADD THIS
        supported: true
      }
    },
    serverInfo: {
      name: "photon",
      version: PHOTON_VERSION
    }
  };
});
```

### 2. Bridge Generator Yields to MCP Elicitation

Modify `createInputProvider()` to:
1. When tool yields `{ ask: '...', message: '...' }`, convert to MCP elicitation schema
2. Send `elicitation/create` request to MCP client (if in MCP mode)
3. Wait for client response
4. Return the validated user input to generator

```typescript
private createInputProvider(mcpServer?: Server): InputProvider {
  return async (ask: AskYield): Promise<any> => {
    // If we're in MCP mode, use elicitation/create
    if (mcpServer) {
      const schema = this.askYieldToJSONSchema(ask);
      const response = await mcpServer.request({
        method: 'elicitation/create',
        params: {
          message: ask.message,
          requestedSchema: schema
        }
      });
      
      if (response.action === 'accept') {
        return this.extractValueFromResponse(response.content, ask);
      } else if (response.action === 'decline') {
        throw new Error('User declined input request');
      } else {
        throw new Error('User cancelled operation');
      }
    }
    
    // Fallback to CLI readline (current implementation)
    switch (ask.ask) {
      case 'text':
        return await elicitPrompt(ask.message, ask.default);
      // ... rest of current implementation
    }
  };
}
```

### 3. Convert Ask Yields to JSON Schema

Helper to convert our custom ask types to MCP elicitation schema:

```typescript
private askYieldToJSONSchema(ask: AskYield): JSONSchema {
  switch (ask.ask) {
    case 'text':
      return {
        type: 'object',
        properties: {
          value: { 
            type: 'string', 
            description: ask.message 
          }
        },
        required: ['value']
      };
      
    case 'password':
      return {
        type: 'object',
        properties: {
          value: { 
            type: 'string', 
            description: ask.message,
            format: 'password'  // UI hint
          }
        },
        required: ['value']
      };
      
    case 'confirm':
      return {
        type: 'object',
        properties: {
          confirmed: { 
            type: 'boolean', 
            description: ask.message 
          }
        },
        required: ['confirmed']
      };
      
    case 'select':
      return {
        type: 'object',
        properties: {
          selected: { 
            type: 'string',
            enum: ask.options,
            description: ask.message 
          }
        },
        required: ['selected']
      };
      
    case 'number':
      return {
        type: 'object',
        properties: {
          value: { 
            type: 'number', 
            description: ask.message,
            ...(ask.min !== undefined && { minimum: ask.min }),
            ...(ask.max !== undefined && { maximum: ask.max })
          }
        },
        required: ['value']
      };
      
    // ... other types
  }
}
```

### 4. Update Playground to Support Elicitation

The playground already has SSE for progress - extend it for elicitation:

```typescript
// Frontend: Listen for elicitation requests
eventSource.addEventListener('elicitation', (e) => {
  const { message, schema } = JSON.parse(e.data);
  
  // Show modal dialog with form based on schema
  showElicitationModal(message, schema, (userInput) => {
    // Send response back
    fetch('/api/elicitation/respond', {
      method: 'POST',
      body: JSON.stringify({
        action: 'accept',
        content: userInput
      })
    });
  });
});
```

## Implementation Status

### Phase 1: Core Support (Completed)
- [x] Add elicitation capability to server initialization
- [x] Create input provider that bridges yields to MCP elicitation
- [x] Detect if running in MCP vs CLI mode
- [x] Bridge generator yields to MCP elicitation in MCP mode (`src/mcp-elicitation.ts`)

### Phase 2: Transports (Completed)
- [x] **STDIO**: Full MCP elicitation support via `server.elicitInput()`
- [x] **SSE**: Bidirectional via HTTP POST callbacks for Beam UI
- [x] **Beam UI**: Shows elicitation modals for interactive asks

### Phase 3: Testing (Completed)
- [x] Test with kitchen-sink's `askUserName()` method
- [x] Test common ask types (text, confirm, select)
- [x] Test in Claude Desktop (stdio transport)
- [x] Test in Beam UI (SSE transport)

## Edge Cases

1. **Nested elicitation**: Tool yields multiple asks in sequence → Queue them
2. **Timeout**: User doesn't respond → Configurable timeout, then cancel
3. **Invalid response**: Schema validation fails → Re-prompt or error
4. **Client doesn't support elicitation**: Fall back to error or skip

## Benefits

✅ **Standard MCP compliance** - works with all MCP clients  
✅ **Backward compatible** - CLI still uses readline  
✅ **Better UX** - Clients can show native UI (forms, modals)  
✅ **Type safety** - JSON Schema validation built-in  
✅ **Progressive enhancement** - Works without elicitation too

## References

- [MCP Elicitation Spec](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)
- [WorkOS Blog: MCP Elicitation](https://workos.com/blog/mcp-elicitation)
- [MCP Transport Mechanisms](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports/)
