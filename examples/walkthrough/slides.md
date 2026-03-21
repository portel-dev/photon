---
marp: true
theme: default
transition: fade
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

# This Walkthrough Is a Photon Too

<div style="display:grid;grid-template-columns:0.92fr 1.08fr;gap:28px;align-items:center;">
  <div>
    <p style="font-size:1.1em;opacity:0.86;margin:0 0 0.9em;">
      The walkthrough itself is just a photon with a <code>main()</code> method.
      Beam launches it as an app automatically.
    </p>
    <pre style="margin:0;background:rgba(0,0,0,0.28);padding:18px;border-radius:14px;overflow:auto;"><code class="language-typescript">/**
 * @format slides
 */
main() {
  return this.assets('slides.md', true)
}</code></pre>
    <p style="font-size:0.95em;opacity:0.72;margin:1em 0 0;">
      Markdown + assets folder = a full in-product walkthrough.
    </p>
  </div>
  <div>
    <img
      src="walkthrough-app-panel.png"
      alt="Walkthrough running as a Beam app"
      style="width:100%;display:block;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,0.28);"
    />
  </div>
</div>

---

<!-- transition: slide -->

# Step 1: Parameters

Methods receive typed parameters. The runtime auto-generates forms.

<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
  <div>

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

  </div>
  <div>
    <p style="font-size:0.9em;opacity:0.7;margin:0 0 8px;">Live — Beam auto-generates this form:</p>
    <div data-embed="calculator/add" data-embed-height="280"></div>
  </div>
</div>

---

# Step 2: Output Formats

Tell the UI how to render results with `@format`.

<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
  <div>

```typescript
export default class Dashboard {
  /** @format table */
  users() {
    return [
      { name: "Alice", role: "Admin" },
      { name: "Bob", role: "Editor" },
    ];
  }

  /** @format gauge */
  cpu() {
    return { value: 73, max: 100,
             label: "CPU", unit: "%" };
  }
}
```

  </div>
  <div>
    <p style="font-size:0.9em;opacity:0.7;margin:0 0 8px;">Live — table and gauge rendering:</p>
    <div data-embed="render-showcase/table" data-embed-height="200"></div>
    <div data-embed="render-showcase/gauge" data-embed-height="160" style="margin-top:12px;"></div>
  </div>
</div>

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

<!-- transition: cover -->

# Step 3: Input Formats

Control how form fields render with `{@format}` on params.

<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
  <div>

```typescript
export default class UserForm {
  /**
   * Register a user
   * @param email Email {@format email}
   * @param password Secret {@format password}
   * @param birthday Date {@format date}
   * @param role Role {@format segmented}
   * @param tags Interests {@format tags}
   */
  register({ email, password, birthday,
             role, tags }: { ... }) {
    return { email, role };
  }
}
```

  </div>
  <div>
    <p style="font-size:0.9em;opacity:0.7;margin:0 0 8px;">Live — specialized input widgets:</p>
    <div data-embed="input-showcase/register" data-embed-height="340"></div>
  </div>
</div>

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

<!-- transition: slide -->

# Step 4: Stateful Photons

<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
  <div>

Add `@stateful` to persist data between calls.

```typescript
/**
 * @stateful
 */
export default class TodoList {
  private items: string[] = [];

  add({ text }: { text: string }) {
    this.items.push(text);
    return { added: text,
             total: this.items.length };
  }

  /** @format list */
  list() {
    return this.items.map(text => ({
      name: text, status: "pending"
    }));
  }
}
```

  </div>
  <div>
    <p style="font-size:0.9em;opacity:0.7;margin:0 0 8px;">Live — state persists across calls:</p>
    <div data-embed="todo/add" data-embed-height="200"></div>
    <div data-embed="todo/list" data-embed-height="200" style="margin-top:12px;"></div>
  </div>
</div>

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

<!-- transition: reveal -->

# Step 6: Custom UI

For full control, create a `.photon.html` template.

<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
  <div>

```html
<!-- dashboard.photon.html -->
<h1>My Dashboard</h1>
<div data-method="cpu"></div>
<div data-method="memory"></div>
<div data-method="requests"></div>
<button data-method="restart"
        data-target="#status">
  Restart
</button>
<span id="status"></span>
```

**Just `data-method`** — format, live updates, theme all auto-inferred.

  </div>
  <div>
    <p style="font-size:0.9em;opacity:0.7;margin:0 0 8px;">The same bindings now work in slides too:</p>
    <div class="demo-box">
      <div data-method="walkthrough/greet"
           data-args='{"name":"Photon User"}'
           data-format="text">
      </div>
    </div>
  </div>
</div>

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

<!-- transition: zoom -->

# Interactive Slides

These slides use two new features you can use in any presentation photon:

| Feature | How |
|---------|-----|
| **Live embeds** | `data-embed="photon/method"` renders Beam UI in an iframe |
| **MCP calls** | `data-method="photon/method"` makes live tool calls |
| **Transitions** | `transition: fade` in frontmatter or `<!-- transition: slide -->` per-slide |

Every code example you saw had a **live Beam panel** next to it — not a screenshot.

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
