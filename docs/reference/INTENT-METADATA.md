# Intent Metadata

Photon derives surface-neutral intent from the MCP-visible method contract. There
is no required `@intent` tag. Authors express intent through names, descriptions,
types, MCP annotations, and format hints; Photon publishes the derived contract
under `_meta["photon/render"].intent`.

The server stays lean: it runs business logic and returns MCP data. Each surface
decides how to render or launch the method.

## Contract Shape

```json
{
  "_meta": {
    "photon/render": {
      "version": 1,
      "mode": "auto",
      "intent": {
        "action": "list",
        "subject": "tasks",
        "confidence": 0.85,
        "sources": ["description", "format", "schema"],
        "safety": { "readOnly": true },
        "input": { "requiresInput": false },
        "output": { "structured": true, "format": "table" }
      },
      "format": "table"
    }
  }
}
```

`action` is one of:

| Action | Typical source |
|--------|----------------|
| `view` | `get`, `show`, `read`, `open` |
| `list` | `list`, `browse`, `@format table/list` |
| `search` | `search`, `find`, `query` |
| `create` | `create`, `add`, `import`, `upload` |
| `update` | `update`, `edit`, `set`, `configure` |
| `delete` | `delete`, `remove`, `clear`, `@destructive` |
| `monitor` | `status`, `metrics`, `watch`, dashboards/charts |
| `run` | `run`, `start`, `execute`, fallback |

## Authoring Rules

Prefer literal method names and first-sentence descriptions:

```ts
/**
 * List tasks.
 * @readOnly
 * @format table {@title title}
 */
async tasks() {
  return [{ title: 'Ship Photon' }];
}

/**
 * Create task.
 */
async createTask(params: { title: string; notes?: string }) {
  return { id: crypto.randomUUID(), ...params };
}

/**
 * Delete task.
 * @destructive
 */
async deleteTask(params: { id: string }) {
  return await this.db.delete(params.id);
}
```

These produce enough intent for every surface:

- Beam renders `tasks` as a direct load/refresh action with a table.
- CLI runs `tasks` directly, prompts for `createTask.title`, and confirms
  `deleteTask`.
- Desktop can map `tasks` to a menu item, `createTask` to a dialog, and
  `deleteTask` to a destructive confirmation.
- MCP clients still receive normal `tools/list`, `tools/call`, `content`, and
  `structuredContent`.

## Surface Mapping

| Intent field | Beam | CLI | Desktop |
|--------------|------|-----|---------|
| `input.requiresInput=false` | direct run / refresh | direct command | menu item |
| `input.requiresInput=true` | form/dialog | prompt or help | modal dialog |
| `safety.destructive=true` or `action=delete` | confirmation | confirmation unless `-y` | destructive alert |
| `output.format` | renderer fallback | formatter fallback | native view selection |
| `action=configure` / settings-like update | settings panel | settings command | preferences pane |

## MCP Boundary

Intent metadata is Photon-specific, but it remains MCP-compliant because it lives
inside `_meta`. Discovery still uses `tools/list`, execution still uses
`tools/call`, custom UI still loads through `resources/read`, and generated HTML
still runs as a sandboxed MCP Apps resource.

Legacy `x-output-format` and `x-layout-hints` remain compatibility aliases while
clients migrate, but `_meta["photon/render"]` is authoritative.

