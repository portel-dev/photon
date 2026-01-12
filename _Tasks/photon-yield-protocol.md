# Photon Yield Protocol - Implementation Tasks

## Overview
Photon uses generator functions with a unified yield protocol across all adapters (CLI, MCP, WebUI). The engine drives the generator and reacts to yielded messages.

---

## 1. Core Protocol Types (photon-core) ✅ DONE

### 1.1 Define Discriminated Union Types
Types already defined in `generator.ts` with `emit`/`ask` discriminators:
```ts
// Emit yields (output)
type EmitYield = EmitStatus | EmitProgress | EmitStream | EmitLog | EmitToast | ...
// e.g., { emit: 'status', message: string }

// Ask yields (input)
type AskYield = AskText | AskPassword | AskConfirm | AskSelect | AskNumber | ...
// e.g., { ask: 'text', message: string, default?: string }

// Combined
type PhotonYield = AskYield | EmitYield
```

- [x] EmitYield types: status, progress, stream, log, toast, thinking, artifact, ui
- [x] AskYield types: text, password, confirm, select, number, file, date, form, url
- [x] Type guards: `isAskYield()`, `isEmitYield()`
- [x] Checkpoint yields for stateful workflows

### 1.2 Engine Behavior per Kind
- [x] `emit` → forward to adapters, immediately continue (no resume value)
- [x] `ask` → suspend until adapter returns response, resume with `next(answer)`
- [x] `checkpoint` → persist to history for stateful workflows

---

## 2. Developer API (photon-core) ✅ DONE

### 2.1 Create `io` Helper (always available)
Implemented in `io.ts` - provides ergonomic API for yields:
```ts
import { io } from '@portel/photon-core';

yield io.emit.status('Loading...');
yield io.emit.progress(0.5, 'Halfway');
const name = yield io.ask.text('Name?', { default: 'Guest' });
const ok = yield io.ask.confirm('Continue?');
```

- [x] `io.emit.status(message, type?)` → status message
- [x] `io.emit.progress(value, message?, meta?)` → progress bar
- [x] `io.emit.stream(data, final?, contentType?)` → stream chunk
- [x] `io.emit.log(message, level?, data?)` → debug log
- [x] `io.emit.toast(message, type?, duration?)` → toast notification
- [x] `io.emit.thinking(active)` → thinking indicator
- [x] `io.emit.artifact(type, options)` → rich artifact
- [x] `io.emit.ui(id, options?)` → UI component
- [x] `io.ask.text(message, options?)` → text input
- [x] `io.ask.password(message, options?)` → password input
- [x] `io.ask.confirm(message, options?)` → yes/no
- [x] `io.ask.select(message, options, config?)` → selection
- [x] `io.ask.number(message, options?)` → number input
- [x] `io.ask.file(message, options?)` → file picker
- [x] `io.ask.date(message, options?)` → date picker
- [x] `io.ask.form(message, schema, options?)` → structured form
- [x] `io.ask.url(message, url, options?)` → OAuth/URL auth

### 2.2 Create `wf` Helper (workflow only)
- [ ] `wf.do(op, input, key?)` → durable effect execution
- [ ] `wf.wait(op, input, key?)` → wait for external event

### 2.3 Backward Compatibility
- [x] Existing `{ emit: 'progress', value, message }` format works
- [x] Existing `{ ask: 'text', message }` format works
- [x] Type guards handle both formats

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

**Current Convention:**
- `<photon-name>/` folder next to `<photon-name>.photon.ts` contains assets
- `<photon-name>/ui/` - custom UI templates (HTML files)
- Custom UIs receive final result via `window.__PHOTON_DATA__`
- Method links to UI via `@ui <view-name>` docblock tag

**Gap:** Custom UIs only receive final result, not progress/elicitation events.

**Solution:** Expose `window.__PHOTON__` API for custom UIs:
```ts
// Custom UI can subscribe to events
window.__PHOTON__.on('progress', (data) => {
  // { kind: 'emit', op: 'progress', done, total, text }
  updateProgressBar(data);
});

window.__PHOTON__.on('elicitation', async (ask) => {
  // { kind: 'ask', op: 'confirm', message }
  const result = await showMyDialog(ask);
  window.__PHOTON__.respond(result);
});

// Final data still available as before
const data = window.__PHOTON_DATA__;
```

**Tasks:**
- [ ] Create `window.__PHOTON__` API with `on()`, `respond()` methods
- [ ] Playground injects this API before loading custom UI
- [ ] Forward `emit` yields to subscribed listeners
- [ ] Forward `ask` yields, wait for `respond()` call
- [ ] Maintain backward compat: `window.__PHOTON_DATA__` still works for result-only UIs

---

## 6. Auto UI Format Rendering

The `@format` docblock tag customizes how results are rendered in auto-generated UIs.

### 6.1 Structural Formats
| Format | Rendering |
|--------|-----------|
| `primitive` | Simple text/number display |
| `table` | Data grid with columns from object keys |
| `tree` | Collapsible hierarchical view |
| `list` | Bulleted/numbered list |
| `none` | No output displayed |

### 6.2 Content Type Formats
| Format | Rendering |
|--------|-----------|
| `json` | Syntax-highlighted JSON |
| `markdown` | Rendered markdown |
| `yaml` | Syntax-highlighted YAML |
| `xml` | Syntax-highlighted XML |
| `html` | Rendered HTML (sandboxed) |

### 6.3 Code Formats
| Format | Rendering |
|--------|-----------|
| `code` | Generic code block |
| `code:typescript` | TypeScript syntax highlighting |
| `code:python` | Python syntax highlighting |
| `code:<lang>` | Language-specific highlighting |

### 6.4 Tasks
- [ ] Auto UI respects `@format` from method docblock
- [ ] Table renderer for array-of-objects
- [ ] Tree renderer for nested objects
- [ ] Code block renderer with syntax highlighting
- [ ] Markdown renderer (already partially done)

---

## 7. Photon Internal Events

### 7.1 Surface Runtime Events via `emit`
- [ ] Dependency resolution progress
- [ ] Dependency installation progress
- [ ] TypeScript compilation status
- [ ] MCP client connection status

This ensures all frontends (CLI/MCP/WebUI) get consistent updates for internal operations.

---

## 8. Testing

- [ ] Unit tests for new protocol types
- [ ] Integration tests: CLI adapter
- [ ] Integration tests: MCP adapter
- [ ] Integration tests: WebUI/Playground adapter
- [ ] Test backward compatibility with old yield format
- [ ] Test kitchen-sink.progressDemo() in playground

---

## Current Status

### Completed
- [x] Core protocol types in photon-core (EmitYield, AskYield, PhotonYield)
- [x] `io` helper API in photon-core v1.5.0 (io.emit.*, io.ask.*)
- [x] Demo photon updated to use `io` helper
- [x] WebSocket playground progress display (centered overlay, single message)
- [x] WebSocket playground clears progress on result
- [x] Markdown rendering: blockquotes, code, links
- [x] YAML front matter rendering
- [x] Link styling for dark theme
- [x] PhotonLoader used in both playgrounds
- [x] Dependency installation from @dependencies docblock

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
│  or: yield { emit: 'status', message: '...' }               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            executeGenerator (photon-core)                   │
│  isEmitYield() → outputHandler, continue                    │
│  isAskYield()  → inputProvider, resume with response        │
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

---

## Future Improvements (Backlog)

### Error Yields
```ts
| { kind: "error"; code: string; message: string; recoverable?: boolean }
```
Allows UI to show errors inline vs crashing the flow.

### Cancellation Support
- Adapter sends cancel signal
- Engine calls `generator.return()`
- Photon handles cleanup via `try/finally`

### Timeout on `ask`
```ts
io.ask.text('Name?', { timeout: 30000, default: 'Anonymous' })
```
If user doesn't respond in time, use default or throw.

### Binary/File Streaming
```ts
| { kind: "emit"; op: "chunk"; mime: string; data: string /* base64 */ }
```

### Protocol Version Header
First yield declares version for graceful upgrades:
```ts
{ kind: "meta"; protocol: "photon/1.0" }
```

### Type-Safe Returns with `yield*`
```ts
const name: string = yield* io.ask.text('What is your name?');
const confirmed: boolean = yield* io.ask.confirm('Continue?');
```
Requires helpers to be generator functions for TypeScript inference.
