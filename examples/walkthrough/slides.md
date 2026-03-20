---
marp: true
theme: default
paginate: true
header: "📖 Photon Walkthrough"
footer: "portel.dev/photon"
---

# Build Your First Photon

### From zero to a working MCP server in 5 minutes

Every method you write becomes an AI tool.
No boilerplate. No configuration. Just TypeScript.

---

# What is a Photon?

A **single `.photon.ts` file** that becomes a full MCP server.

```typescript
// hello.photon.ts
export default class Hello {
  greet({ name }: { name: string }) {
    return `Hello, ${name}!`;
  }
}
```

That's it. This is a complete, working photon.

**Every public method → an MCP tool.**

---

# Run It

### Three ways to use your photon:

| Command | What it does |
|---------|-------------|
| `photon beam` | Opens the web UI (Beam) |
| `photon cli hello greet --name World` | Runs from terminal |
| `photon mcp hello` | Starts as MCP server for Claude/Cursor |

All three produce the same result: `"Hello, World!"`

---

# Step 1: Parameters

Methods receive typed parameters. The runtime auto-generates forms.

```typescript
export default class Calculator {
  /**
   * Add two numbers
   * @param a First number
   * @param b Second number
   */
  add({ a, b }: { a: number; b: number }) {
    return { result: a + b };
  }
}
```

- TypeScript types → JSON Schema → auto UI form
- `@param` descriptions become field labels
- Required vs optional detected from `?` modifier

---

# Step 2: Output Formats

Tell the UI how to render results with `@format`.

```typescript
export default class Dashboard {
  /** @format table */
  users() {
    return [
      { name: "Alice", role: "Admin", status: "Active" },
      { name: "Bob", role: "Editor", status: "Offline" },
    ];
  }

  /** @format gauge */
  cpu() {
    return { value: 73, max: 100, label: "CPU", unit: "%" };
  }

  /** @format chart:bar */
  revenue() {
    return [
      { month: "Jan", amount: 12400 },
      { month: "Feb", amount: 15800 },
    ];
  }
}
```

---

# 48 Output Formats

| Category | Formats |
|----------|---------|
| **Data** | table, list, card, kv, tree, grid |
| **Charts** | chart:bar, chart:line, chart:pie, chart:area, chart:donut |
| **Metrics** | metric, gauge, progress, badge, stat-group |
| **Content** | markdown, code, json, mermaid, diff, log |
| **Visuals** | timeline, calendar, map, heatmap, network, qr |
| **Design** | hero, banner, carousel, gallery, masonry, profile |
| **Layout** | steps, kanban, comparison, invoice, feature-grid |
| **Media** | image, embed, slides |

If you don't specify `@format`, it auto-detects from data shape.

---

# Step 3: Input Formats

Control how form fields render with `{@format}` on params.

```typescript
export default class UserForm {
  /**
   * Register a user
   * @param email Email {@format email}
   * @param password Secret {@format password}
   * @param birthday Date of birth {@format date}
   * @param role User role {@format segmented}
   * @param tags Interests {@format tags}
   * @param bio About you {@format markdown}
   */
  register({
    email, password, birthday, role, tags, bio
  }: {
    email: string;
    password: string;
    birthday: string;
    role: "admin" | "editor" | "viewer";
    tags: string[];
    bio: string;
  }) {
    return { email, role, tags: tags.length };
  }
}
```

---

# Input Widgets

| Format | Widget |
|--------|--------|
| `email` | Email input with validation |
| `password` | Masked with show/hide toggle |
| `url` | URL input with open-link button |
| `color` | Color swatch + hex input |
| `date` | Calendar with year/month drill-down |
| `tags` | Chip/pill input (Enter to add) |
| `rating` | Star rating (1-5) |
| `segmented` | Horizontal pill bar for enums |
| `radio` | Vertical radio buttons |
| `code` | Editor with line numbers |
| `markdown` | Split editor with live preview |

**Smart defaults**: `birthday` opens 25 years ago, `expiry` starts in future.

---

# Step 4: Stateful Photons

Add `@stateful` to persist data between calls.

```typescript
/**
 * @stateful
 */
export default class TodoList {
  private items: string[] = [];

  add({ text }: { text: string }) {
    this.items.push(text);
    return { added: text, total: this.items.length };
  }

  /** @format list */
  list() {
    return this.items.map((text, i) => ({
      name: text,
      status: "pending"
    }));
  }
}
```

- State persists to `~/.photon/state/`
- Auto-emits events on every method call
- Supports named instances (multiple boards, profiles, etc.)

---

# Step 5: Real-time Updates

Use `this.emit()` for live events and `this.render()` for streaming.

```typescript
export default class Monitor {
  /** @format gauge */
  async *cpu() {
    for (let i = 0; i < 10; i++) {
      const value = Math.round(30 + Math.random() * 50);
      yield { emit: "render", format: "gauge",
              value: { value, max: 100, label: "CPU" } };
      await new Promise(r => setTimeout(r, 1000));
    }
    return { value: 42, max: 100, label: "CPU", unit: "%" };
  }
}
```

Generator methods (`async *`) stream results in real-time.
`yield { emit: "render" }` updates the UI live.

---

# Step 6: Custom UI

For full control, create a `.photon.html` template.

```html
<!-- ui/dashboard.photon.html -->
<h1>My Dashboard</h1>
<div data-method="cpu"></div>
<div data-method="memory"></div>
<div data-method="requests"></div>
<button data-method="restart"
        data-target="#status">Restart</button>
<span id="status"></span>
```

**Just `data-method`** — format, live updates, theme all auto-inferred.

Or use `.html` for full JavaScript control with the `window.photon` API.

---

# Step 7: Deploy Everywhere

Your photon works on every MCP client — zero changes needed.

| Client | Command |
|--------|---------|
| **Beam** (web UI) | `photon beam` |
| **Claude Desktop** | `photon mcp my-app --config` |
| **Cursor** | Same MCP config |
| **CLI** | `photon cli my-app method --param value` |
| **Standalone binary** | `photon build my-app` |

### One file. Every platform.

---

# What's Next?

### Explore the examples:
- `examples/render-showcase.photon.ts` — all 48 output formats
- `examples/input-showcase.photon.ts` — all input widgets
- `examples/pizzaz-shop.photon.ts` — real-world e-commerce

### Resources:
- **Docs**: `docs/reference/DOCBLOCK-TAGS.md`
- **Marketplace**: `photon search <keyword>`
- **Create**: `photon maker new`

### The philosophy:
> Every method is a tool. Every file is a server.
> No boilerplate. No configuration. Just build.
