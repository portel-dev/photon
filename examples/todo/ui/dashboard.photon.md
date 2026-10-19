# Task Dashboard

<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0;">

<div style="background: var(--color-surface-container); border-radius: 8px; padding: 16px;">

## Current Tasks

<div data-method="list" data-format="checklist"></div>

</div>

<div style="background: var(--color-surface-container); border-radius: 8px; padding: 16px;">

## Quick Add

<div data-method="add" data-trigger="click" style="display: none;"></div>

Use the **add** method from the sidebar to create new tasks.
Each task is a simple `{text, done}` object stored in memory.

### How it works

- **add** — creates a task with `done: false`
- **check** — toggles completion by text match
- **reorder** — sets new order from text array
- **list** — returns all tasks as `@format checklist`

Tasks are persisted by the stateful runtime. A human and MCP client addressing
the same instance operate on the same list. The generated `list` checklist is
marked `@readOnly`, so Beam can safely revalidate it after external changes or
reconnection. This custom dashboard manages its own data-method bindings.
Use `@stateful` instances for separate lists:

```
photon use todo groceries
photon cli todo list
photon use todo sprint-3
photon cli todo list
```

</div>

</div>

---

*Powered by `@format checklist` — auto-detected from `{text, done}[]` data shape.*
