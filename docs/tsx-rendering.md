# Photon TSX rendering contract

Photon ships a tiny built-in JSX runtime that maps `<jsx />` to real DOM
with focus-preserving reconciliation. You don't need React, Preact, or a
virtual DOM library — just write components and call `render(<App />, root)`
whenever your state changes. The runtime does the right thing.

This document is the source of truth for what "the right thing" is. If
the runtime ever disagrees with this page, the page is correct and the
runtime has a bug.

## TL;DR

- Calling `render(<App state={s} />, root)` on every state change is
  the supported pattern. It is **not** a full repaint — the runtime
  diffs against the previous tree and patches the existing DOM in
  place.
- Focused inputs **keep focus** across rerenders.
- Cursor and selection in `<input>` / `<textarea>` **survive** unrelated
  rerenders, and don't jump when the controlled value echoes back the
  user's own keystrokes.
- Event handlers (`onClick`, `onInput`, …) **do not stack**. Re-passing
  a different function on rerender replaces the previous handler — the
  runtime keeps exactly one delegating listener per event type per node.
- Use `key` on items in dynamic lists so reorders preserve the right
  DOM nodes (and their focus/scroll state).

## When DOM nodes are preserved

A DOM node is preserved (kept, attributes patched, children recursed)
when the next `render()` call places an element of the **same type** in
the **same position** as the previous render. For keyed children, "same
position" means "same key". For unkeyed children, "same position" means
"same index among unkeyed siblings".

It is replaced (old DOM removed, fresh DOM created) when:

- The tag name differs (`<div>` ↔ `<section>`).
- The element is keyed and its key no longer appears in the new tree.
- A unkeyed-sibling slot collapses (e.g. you removed an item from the
  middle of an unkeyed list — without keys the runtime can't tell which
  one disappeared and shifts everything).

Always-stable identity → always-stable focus / scrollTop / selection /
play state / Web Component internals.

## Controlled inputs (`value` / `checked`)

```tsx
<input value={state.name} onInput={(e) => setState({ name: e.target.value })} />
```

Each keystroke triggers `onInput`, which updates state and rerenders.
The runtime:

1. Sees `value={state.name}` on the same `<input>` node.
2. Compares the prop to the live `el.value`.
3. **If they differ** (programmatic change), writes `el.value = next`
   and — if the element is focused — restores `selectionStart` /
   `selectionEnd`.
4. **If they match** (the controlled value just echoes back the user's
   own keystroke), does nothing. The cursor never moves.

The same logic applies to `<textarea value={…}>`, `<select value={…}>`,
and `<input type="checkbox" checked={…}>`.

You do not need to skip rerenders to keep focus. You do not need to
read the DOM on submit. Just write the controlled-input pattern.

## Uncontrolled inputs (`defaultValue` / `defaultChecked`)

```tsx
<input defaultValue="hello" ref={(el) => (this.inputEl = el)} />
```

`defaultValue` and `defaultChecked` seed the DOM **only on creation**
and are never touched again by rerenders. Use them when:

- You want a starting value but don't want state on every keystroke
  (e.g. a search box you read on submit).
- You're integrating with code that mutates the input directly.

A rerender that re-passes `defaultValue="hello"` will not stomp the
user's edits.

## Keys

```tsx
<ul>
  {items.map((item) => (
    <li key={item.id}>{item.label}</li>
  ))}
</ul>
```

Provide a `key` whenever you render a list that can reorder, insert,
or remove. Without keys, the runtime matches children by position —
so removing item #2 from `[a, b, c]` patches the `b` DOM into `c`'s
content (which is usually wrong and definitely loses any focus / scroll
state in the inner subtree).

Keys must be stable across renders (use a database id, not the index)
and unique among siblings.

The runtime accepts a forgiving mix of keyed and unkeyed siblings:
unkeyed children are matched among themselves by position, keyed
children by key.

## Event handlers

```tsx
<button onClick={handleClick}>Save</button>
```

- The handler is stored on the DOM node and dispatched via a single
  delegating listener per event type. Re-rendering with a different
  function replaces the stored handler — no listeners pile up.
- Naming follows the JSX convention: `onClick`, `onInput`,
  `onPointerDown`, `onChange`, etc. The runtime lowercases the suffix
  to derive the DOM event name (`Click` → `click`).
- The handler receives the standard DOM `Event`. There is no
  SyntheticEvent layer.

## Function components

```tsx
function Card({ title, children }) {
  return (
    <article>
      <h2>{title}</h2>
      {children}
    </article>
  );
}
```

Function components are plain functions that take a `props` object
and return a JSX tree. They re-execute on every parent rerender — the
runtime does no memoisation. Keep them cheap, or hoist heavy work
outside the render path.

A component may return `null` / `false` to render nothing.

## Fragments

```tsx
return (
  <>
    <header />
    <main />
  </>
);
```

Fragments are transparent — they contribute their children to the
parent's child list, not an extra DOM node. You can return a Fragment
from a component or pass one as a child.

## Styles, classes, and `dangerouslySetInnerHTML`

- `style={{ color: 'red' }}` accepts an object; the runtime resets
  removed keys on rerender.
- `className="x y"` maps to the `class` attribute. `htmlFor` maps to
  `for`.
- `dangerouslySetInnerHTML={{ __html: '<b>raw</b>' }}` writes the HTML
  string directly. The runtime only touches `innerHTML` when the
  string actually changes.

## Refs

Refs are not part of the built-in runtime. If you need an element
reference, attach a one-shot callback in your handler:

```tsx
<input ref={(el) => el && el.focus()} />
```

The `ref` prop is reserved (the runtime won't try to set it as an HTML
attribute) but it's up to you to call it. A first-class ref API may
land later; for now this pattern is supported.

## What the runtime intentionally does **not** do

- No virtual DOM library, no SyntheticEvent, no concurrent rendering.
- No hooks (`useState`, `useEffect`). State is whatever you keep
  in a module-level variable / closure and feed back into
  `render(<App state={s} />, root)`.
- No suspense, no error boundaries.
- No SVG namespace handling. (If you need SVG, drop in
  `dangerouslySetInnerHTML` for the moment.)
- No SSR / hydration. Photon TSX is client-only.

## Want more?

You can opt out of the built-in runtime entirely by configuring `jsx`
/ `jsxFactory` / `jsxImportSource` in a `tsconfig.json` next to your
`ui/` folder. The compiler picks that up and steps out of the way, so
you can run Preact, Solid, or any other JSX runtime instead.

For the implementation, see `src/tsx-compiler.ts` (`JSX_RUNTIME` const).
