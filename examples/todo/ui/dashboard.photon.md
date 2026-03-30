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

Tasks persist across method calls within the same session.
Use `@stateful` instances for separate lists:

```
todo list --instance groceries
todo list --instance sprint-3
```

</div>

</div>

---

*Powered by `@format checklist` — auto-detected from `{text, done}[]` data shape.*
