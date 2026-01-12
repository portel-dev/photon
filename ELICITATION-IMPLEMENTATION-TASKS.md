# MCP Elicitation Implementation Tasks

## Summary
Implement MCP-compliant elicitation support to allow Photon tools to request user input during execution via the standard `sampling/createMessage` method (MCP 2024-11-05 spec).

## Current Architecture

### Generator-Based Ask/Yield Pattern
- Tools yield `{ ask: 'text', message: '...' }` to request input
- Runtime's `createInputProvider()` handles yields
- Works perfectly for CLI (readline) and playground (SSE modals)
- Defined in `@portel/photon-core`

### Execution Flow
1. `PhotonServer.executeTool()` → calls `PhotonLoader.executeTool()`
2. `PhotonLoader.executeTool()` detects generators and calls `executeGenerator()`
3. `executeGenerator()` from photon-core handles ask/emit yields
4. `createInputProvider()` in loader.ts handles CLI prompts via `elicitPrompt()`/`elicitConfirm()`

## Implementation Tasks

### ✅ Phase 1: MCP Server Capability Declaration

**File**: `src/server.ts`  
**Lines**: ~122, ~2109

Add elicitation capability:
```typescript
capabilities: {
  tools: { listChanged: true },
  prompts: { listChanged: true },
  resources: { listChanged: true },
  sampling: {}  // ← ADD THIS
},
```

### Phase 2: Bidirectional Communication for Elicitation

**Challenge**: MCP elicitation requires client→server requests during tool execution.

#### Option A: Use MCP SDK's Request Capabilities (RECOMMENDED)
The MCP SDK Server can send requests to clients that support it:
```typescript
// During tool execution, when generator yields ask:
const response = await this.server.request({
  method: 'sampling/createMessage',
  params: {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: askYieldToPrompt(ask)
      }
    }],
    maxTokens: 1000
  }
});
```

#### Option B: SSE Polling Pattern (FALLBACK)
For SSE transport, implement:
1. Server sends `{ type: 'elicitation_request', id, schema }` via SSE
2. Client POSTs response to `/elicitation/:id/respond`
3. Server resolves pending promise with response

### Phase 3: Modify PhotonLoader Input Provider

**File**: `src/loader.ts`  
**Method**: `createInputProvider()` (line ~1539)

Current implementation:
```typescript
private createInputProvider(): InputProvider {
  return async (ask: AskYield): Promise<any> => {
    switch (ask.ask) {
      case 'text':
        return await elicitPrompt(ask.message, ask.default);
      // ... CLI-based prompts
    }
  };
}
```

**New implementation**:
```typescript
private createInputProvider(mcpServer?: Server, transport?: 'stdio' | 'sse'): InputProvider {
  return async (ask: AskYield): Promise<any> => {
    // MCP mode: use sampling/createMessage
    if (mcpServer && transport) {
      try {
        const response = await this.requestSamplingViaMCP(mcpServer, ask, transport);
        return this.extractValueFromSamplingResponse(response, ask);
      } catch (error) {
        // Fallback to CLI if MCP client doesn't support sampling
        this.logger.warn('MCP sampling failed, falling back to CLI:', error);
      }
    }
    
    // CLI fallback (current implementation)
    switch (ask.ask) {
      case 'text':
        return await elicitPrompt(ask.message, ask.default);
      // ... rest
    }
  };
}
```

### Phase 4: Ask Yield to MCP Sampling Converter

**New Method** in `src/loader.ts`:

```typescript
private async requestSamplingViaMCP(
  server: Server, 
  ask: AskYield,
  transport: 'stdio' | 'sse'
): Promise<any> {
  const prompt = this.askYieldToPrompt(ask);
  
  try {
    const response = await server.request({
      method: 'sampling/createMessage',
      params: {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: prompt
          }
        }],
        maxTokens: 1000,
        systemPrompt: 'You are helping the user provide input for a tool. ' +
                      'Return only the requested value in plain text.'
      }
    });
    
    return response.content.text;
  } catch (error) {
    // MCP client doesn't support sampling
    throw error;
  }
}

private askYieldToPrompt(ask: AskYield): string {
  switch (ask.ask) {
    case 'text':
      return `${ask.message}${ask.default ? ` (default: ${ask.default})` : ''}`;
    case 'password':
      return `${ask.message} (sensitive input)`;
    case 'confirm':
      return `${ask.message} (answer yes or no)`;
    case 'select':
      return `${ask.message}\nOptions: ${ask.options?.join(', ')}`;
    case 'number':
      return `${ask.message} (enter a number${ask.min !== undefined ? ` >= ${ask.min}` : ''}${ask.max !== undefined ? ` <= ${ask.max}` : ''})`;
    default:
      return ask.message;
  }
}
```

### Phase 5: Update PhotonServer to Pass Server Instance

**File**: `src/server.ts`  
**Method**: `setupHandlers()` → `CallToolRequestSchema` handler (line ~184)

Currently:
```typescript
const result = await this.loader.executeTool(this.mcp, toolName, args || {});
```

**Update to**:
```typescript
const result = await this.loader.executeTool(
  this.mcp, 
  toolName, 
  args || {},
  {
    mcpServer: this.server,  // ← Pass MCP server instance
    transport: this.options.transport || 'stdio'  // ← Pass transport type
  }
);
```

**Update PhotonLoader.executeTool signature**:
```typescript
async executeTool(
  mcp: PhotonMCPClass,
  toolName: string,
  parameters: any,
  options?: { 
    resumeRunId?: string; 
    outputHandler?: OutputHandler;
    mcpServer?: Server;     // ← NEW
    transport?: 'stdio' | 'sse';  // ← NEW
  }
): Promise<any>
```

Then pass to `createInputProvider()`:
```typescript
const inputProvider = this.createInputProvider(
  options?.mcpServer,
  options?.transport
);
```

### Phase 6: Playground Elicitation UI

**File**: `src/auto-ui/playground-server.ts`  
**Update**: SSE handler to support elicitation requests

Currently sends progress updates via SSE. Extend to:
1. When ask yield occurs, send `{ type: 'elicitation', data: ask }`
2. Client shows modal form
3. Client POSTs response to new endpoint `/api/invoke/:photon/:method/elicit`
4. Server resolves inputProvider promise

**New endpoint**:
```typescript
// Handle elicitation responses from playground
if (pathname.match(/^\/api\/invoke\/[^/]+\/[^/]+\/elicit$/)) {
  const body = await this.parseBody(req);
  const { elicitationId, value } = body;
  
  // Resolve pending elicitation
  this.resolvePendingElicitation(elicitationId, value);
  
  res.writeHead(200);
  res.end();
  return;
}
```

### Phase 7: Testing Plan

**Test Cases**:
1. ✅ CLI mode: Existing readline prompts continue working
2. ⬜ STDIO MCP: Test with Claude Desktop using kitchen-sink `askUserName()`
3. ⬜ SSE MCP: Test with MCP Inspector or custom client
4. ⬜ Playground: Test elicitation modal UI with kitchen-sink examples
5. ⬜ Fallback: Graceful degradation when client doesn't support sampling

**Test Photons**:
- `kitchen-sink.photon.ts` → `askUserName()` method
- Create new test: multi-step elicitation (name → email → confirm)

## Edge Cases to Handle

1. **Client doesn't support sampling**: Fallback to error or skip (current behavior)
2. **Timeout**: User doesn't respond within reasonable time
3. **Invalid response**: Validate and re-prompt or error
4. **Nested asks**: Multiple sequential yields (already handled by executeGenerator)
5. **Concurrent tools**: Multiple tools asking simultaneously (need request ID tracking)

## Benefits

✅ **MCP Compliance**: Works with any MCP client (Claude Desktop, Zed, etc.)  
✅ **Backward Compatible**: CLI and playground continue working  
✅ **Better UX**: Clients can show native UI  
✅ **Unified**: Single ask/yield pattern across all interfaces  
✅ **Type-safe**: Leverages existing PhotonYield types

## Implementation Priority

1. **High Priority**: Capability declaration + sampling request (enables basic MCP clients)
2. **Medium Priority**: Playground elicitation UI (dev experience)
3. **Low Priority**: Advanced validation, timeouts, retry logic

## Current Blockers

- Need to verify MCP SDK Server supports `server.request()` for sampling
- SSE transport needs bidirectional communication (may require WebSocket upgrade)
- Need to test with actual MCP client (Claude Desktop or MCP Inspector)

## Next Steps

1. Add `sampling: {}` to capabilities
2. Implement `requestSamplingViaMCP()` helper
3. Update `createInputProvider()` to detect MCP mode
4. Update `executeTool()` to pass server instance
5. Test with kitchen-sink in Claude Desktop
6. If successful, implement playground UI
7. Document usage in README

## Notes

- MCP spec uses `sampling/createMessage` not `elicitation/create` (spec updated)
- Sampling is optional capability - graceful degradation required
- Progress updates (`emit` yields) continue working via current SSE pattern
- Ask yields are the only ones requiring bidirectional communication
