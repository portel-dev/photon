# Photon Yield Protocol - Implementation Tasks

## Overview
Photon uses generator functions with a unified yield protocol across all adapters (CLI, MCP, WebUI). The engine drives the generator and reacts to yielded messages.

---

## 1. Core Protocol Types (photon-core)

### 1.1 Define Discriminated Union Types
- [ ] Define `IoMsg` type for always-available messages:
  ```ts
  type IoMsg =
    | { kind: "emit"; op: "status"; text: string }
    | { kind: "emit"; op: "progress"; done?: number; total?: number; text?: string }
    | { kind: "emit"; op: "stream"; text: string }
    | { kind: "ask"; op: "text"; message: string; default?: string }
    | { kind: "ask"; op: "confirm"; message: string; default?: boolean }
    | { kind: "ask"; op: "select"; message: string; options: string[]; default?: string }
  ```

- [ ] Define `WfMsg` type for durable workflow messages (@stateful only):
  ```ts
  type WfMsg =
    | { kind: "do"; op: string; input: unknown; key?: string }
    | { kind: "wait"; op: string; input: unknown; key?: string }
  ```

- [ ] Export unified `PhotonYield = IoMsg | WfMsg`

### 1.2 Engine Behavior per Kind
- [ ] `emit` → forward to adapters, immediately continue (no resume value)
- [ ] `ask` → suspend until adapter returns response, resume with `next(answer)`
- [ ] `do`/`wait` → persist to history, replay returns stored results (workflow only)

---

## 2. Developer API (photon-core)

### 2.1 Create `io` Helper (always available)
- [ ] `io.emit.status(text)` → yields `{ kind: "emit", op: "status", text }`
- [ ] `io.emit.progress({ done, total, text })` → yields progress
- [ ] `io.emit.stream(text)` → yields stream chunk
- [ ] `io.ask.text(message, default?)` → yields and returns string
- [ ] `io.ask.confirm(message, default?)` → yields and returns boolean
- [ ] `io.ask.select(message, options, default?)` → yields and returns string

### 2.2 Create `wf` Helper (workflow only)
- [ ] `wf.do(op, input, key?)` → durable effect execution
- [ ] `wf.wait(op, input, key?)` → wait for external event

### 2.3 Backward Compatibility
- [ ] Support existing `{ emit: 'progress', value, message }` format during transition
- [ ] Support existing `{ ask: 'text', message }` format during transition

---

## 3. Engine Updates (photon-core)

### 3.1 Update `executeGenerator`
- [ ] Route by `kind` field (discriminated union)
- [ ] `emit` messages: call outputHandler, continue immediately
- [ ] `ask` messages: call inputProvider, resume with response
- [ ] Handle backward-compatible formats

### 3.2 Update PhotonMCP Base Class
- [ ] `this.emit()` should use new protocol internally
- [ ] Execution context properly passes outputHandler
- [ ] Support both generator yields AND `this.emit()` calls

---

## 4. Adapter Wiring

### 4.1 CLI Adapter (photon)
- [ ] `emit.status` → print status line / spinner
- [ ] `emit.progress` → render progress bar
- [ ] `emit.stream` → print streamed text
- [ ] `ask.*` → prompt user for input (inquirer/readline)

### 4.2 MCP Adapter (photon)
- [ ] `emit.*` → MCP progress notifications / streaming
- [ ] `ask.*` → MCP elicitation protocol

### 4.3 WebUI/Playground Adapter (photon)
- [ ] `emit.*` → WebSocket message `{ type: 'yield', data }`
- [ ] `ask.*` → WebSocket message `{ type: 'elicitation', data }`, wait for response
- [ ] Use `loader.executeTool()` to properly wire outputHandler context

---

## 5. Playground Specific

### 5.1 Fix Current Issues
- [ ] Kitchen-sink fails to load (TypeScript parameter properties)
- [ ] `this.emit()` not working → use `loader.executeTool()` with outputHandler
- [ ] Progress dialog: single message, clears on result ✅ DONE

### 5.2 Auto UI Improvements
- [ ] YAML front matter rendering ✅ DONE
- [ ] Link styling (no underline, theme colors) ✅ DONE
- [ ] Blockquote rendering ✅ DONE

### 5.3 Custom UI Support
- [ ] Create `PhotonClient` class for client-side SDK:
  ```ts
  const client = new PhotonClient('ws://localhost:3000');
  const result = await client.invoke('photon', 'method', args, {
    onProgress: (data) => { /* update custom UI */ },
    onElicitation: async (ask) => { /* show custom dialog, return response */ }
  });
  ```
- [ ] Expose PhotonClient in playground for custom UIs to import
- [ ] Document custom UI integration pattern

---

## 6. Photon Internal Events

### 6.1 Surface Runtime Events via `emit`
- [ ] Dependency resolution progress
- [ ] Dependency installation progress
- [ ] TypeScript compilation status
- [ ] MCP client connection status

This ensures all frontends (CLI/MCP/WebUI) get consistent updates for internal operations.

---

## 7. Testing

- [ ] Unit tests for new protocol types
- [ ] Integration tests: CLI adapter
- [ ] Integration tests: MCP adapter
- [ ] Integration tests: WebUI/Playground adapter
- [ ] Test backward compatibility with old yield format
- [ ] Test kitchen-sink.progressDemo() in playground

---

## Current Status

### Completed
- [x] Demo photon updated to new yield format
- [x] WebSocket playground progress display (centered overlay, single message)
- [x] WebSocket playground clears progress on result
- [x] Markdown rendering: blockquotes, code, links
- [x] YAML front matter rendering
- [x] Link styling for dark theme
- [x] PhotonLoader used in both playgrounds

### In Progress
- [ ] `this.emit()` wiring in playground (needs loader.executeTool integration)

### Blocked
- [ ] Kitchen-sink photon (TypeScript parameter properties not supported in strip mode)

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────┐
│                     Photon Method                           │
│  yield io.emit.progress(...)  or  yield io.ask.confirm(...) │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Photon Engine                             │
│  Routes by `kind`: emit → forward, ask → suspend+resume     │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌─────────┐     ┌─────────┐     ┌─────────┐
        │   CLI   │     │   MCP   │     │  WebUI  │
        │ Adapter │     │ Adapter │     │ Adapter │
        └─────────┘     └─────────┘     └─────────┘
              │               │               │
              ▼               ▼               ▼
        Terminal        Claude/LLM        Browser
        Progress        Elicitation       Custom UI
```
