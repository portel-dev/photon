# Convert an Existing Frontend App into a Photon

Use this guide when adapting an existing Vite, React, Vue, Svelte, Angular, or plain HTML app into a Photon custom UI. A photon can validate and still have a broken UI bundle, so treat the UI checks below as part of the definition of done.

## Where the UI Belongs

Prefer the pathless convention when the UI lives beside the photon:

```text
stereogram.photon.ts
stereogram/
  ui/
    main.html
    assets/
      main.js
      main.css
```

Declare the UI at class level and link it from the method:

```typescript
/**
 * Stereogram
 *
 * @ui main
 */
export default class Stereogram {
  /**
   * Open the app.
   * @ui main
   * @readOnly
   */
  open(params: { text?: string } = {}) {
    return { status: 'active', params };
  }
}
```

Pathless `@ui main` resolves by convention from the companion UI folder:

1. `ui/main.photon.tsx`
2. `ui/main.tsx`
3. `ui/main.photon.html`
4. `ui/main.html`

Use explicit paths only when the UI is genuinely outside the conventional companion folder, for example `@ui dashboard ./dashboard/dist/index.html`.

## Vite and Bundled Assets

Vite defaults to absolute asset URLs such as `/assets/index.js`. That often works in a standalone web app but is wrong for a Photon UI served under `/api/ui/<id>/`.

Set a relative base:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'stereogram/ui',
  },
});
```

The built HTML should reference sibling assets relatively:

```html
<script type="module" src="./assets/main.js"></script>
<link rel="stylesheet" href="./assets/main.css" />
```

If the generated HTML still contains `/assets/...`, fix the frontend build before debugging Photon.

## Tool Parameters

For optional object parameters, prefer a required object parameter with a default empty object:

```typescript
open(params: {
  text?: string;
  preset?: string;
  pattern?: string;
} = {}) {
  return { status: 'active', params };
}
```

Avoid `params?: { ... }` for Photon tool surfaces when possible. It can execute, but it gives extractors less stable information for generated documentation and forms.

Use docblock inline tags such as `{@choice ...}` for enum choices:

```typescript
/**
 * @param preset Initial preset {@choice sphere,torus,solid} {@example torus}
 */
```

Do not rely on TypeScript union literal types alone for marketplace docs; unescaped `|` characters can break Markdown tables.

## Build and Sync

Run these from the photon workspace root:

```bash
bun run build
photon maker validate stereogram
photon maker sync
photon cli stereogram open --text 3D --preset torus
```

`photon maker validate` proves the photon source is loadable. It does not prove the custom UI HTML or its JS/CSS chunks load in a browser.

`photon maker sync` refreshes `.marketplace/photons.json` and generated docs. Run it after rebuilding the UI so the manifest includes the current assets.

If sync reports that content changed without a version bump, either bump the photon's `@version` or intentionally leave the warning for local-only work.

## Verify the UI Asset Server

Start a local SSE server:

```bash
photon mcp --transport sse --port 35678 stereogram
```

Look for log lines like:

```text
UI main resolved by convention -> ./ui/main.html
UI main -> open
URI: ui://stereogram/main
```

Then verify with GET requests:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:35678/api/ui/main/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:35678/api/ui/main/assets/main.js
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:35678/api/ui/main/assets/main.css
```

Use `GET`, not `HEAD`. Browser asset loads use GET, and some Photon UI routes may not answer HEAD the same way.

All three checks should return `200`.

## Calling Tools from a Standalone Frontend

Beam exposes tools through `POST /api/v1/photon/<name>/tools/<method>`. Local browser and CLI clients must include `X-Photon-Request`; remote clients must use a configured Bearer token. Tool invocation is POST-only so cross-origin navigation cannot trigger mutations.

```bash
curl -X POST http://127.0.0.1:3000/api/v1/photon/stereogram/tools/open \
  -H 'Content-Type: application/json' \
  -H 'X-Photon-Request: 1' \
  --data '{"text":"3D","preset":"torus"}'
```

Generate the matching OpenAPI 3.1 document with `photon openapi stereogram`, or open `/api/docs` while Beam is running.

## Common Failure Modes

| Symptom                                         | Likely cause                                                   | Fix                                                            |
| ----------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| HTML loads but JS/CSS 404                       | Built HTML uses `/assets/...`                                  | Set Vite `base: './'` and rebuild                              |
| `@ui` asset is registered but route 404s        | UI declaration does not match companion layout                 | Prefer pathless `@ui main` with `photon-name/ui/main.html`     |
| `photon maker validate` passes but app is blank | Validation does not load browser chunks                        | Run the SSE `GET /api/ui/...` checks                           |
| Generated docs show malformed parameter types   | Optional object or complex union type confused extraction/docs | Use `params: { ... } = {}` and docblock `{@choice ...}`        |
| `photon add` cannot install from repo           | Marketplace manifest missing or stale                          | Run `photon maker sync` and commit `.marketplace/photons.json` |

## Done Checklist

- Class-level `@ui <id>` resolves by convention unless an explicit path is truly needed.
- Method-level `@ui <id>` links the UI to the tool that opens it.
- Frontend build uses relative asset URLs.
- Tool params use `params: { ... } = {}` for optional object input.
- `bun run build` succeeds.
- `photon maker validate <name>` succeeds.
- `photon maker sync` succeeds and generated docs look sane.
- `photon cli <name> <method> ...` passes parameters through.
- `GET /api/ui/<id>/` returns `200`.
- `GET /api/ui/<id>/<asset-path>` returns `200` for JS and CSS chunks.
