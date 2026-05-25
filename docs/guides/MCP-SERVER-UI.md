# Add a UI to an MCP Server

Photon can add a UI to an MCP server without splitting your project into a
backend, API schema, frontend app, and separate MCP adapter. A `.photon.ts`
method can expose the same capability as an MCP tool, CLI command, Beam form,
and embedded app UI.

This guide shows the two UI paths:

- Use Beam's generated forms and renderers.
- Add a custom HTML UI with `@ui`.

## Start with a Method

```typescript
export default class Weather {
  /**
   * Show current weather for a city
   * @param city City name {@example Singapore} {@choice Singapore,London,San Francisco}
   * @format card
   * @readOnly
   */
  current(params: { city: string }) {
    return {
      title: `Weather in ${params.city}`,
      subtitle: "Clear skies",
      value: "29 C",
      description: "Light wind, comfortable visibility",
    };
  }
}
```

Run Beam:

```bash
photon
```

Photon generates a form from the method signature and comments. The `@format
card` tag tells Beam how to render the result.

## Add a Custom MCP App UI

Create a UI file next to the photon:

```text
weather.photon.ts
ui/weather-card.html
```

Point Photon at the UI:

```typescript
/**
 * @ui weather-card
 */
export default class Weather {
  /**
   * Show current weather for a city
   * @ui weather-card
   * @param city City name {@example Singapore} {@choice Singapore,London,San Francisco}
   * @readOnly
   */
  current(params: { city: string }) {
    return {
      city: params.city,
      temperature: 29,
      condition: "Clear skies",
    };
  }
}
```

The UI receives method results through the Photon bridge. The same UI can render
inside Beam and MCP app-capable clients.

## Minimal UI Example

```html
<main>
  <h1>Weather</h1>
  <button data-method="current" data-args='{"city":"Singapore"}'>
    Load Singapore
  </button>
  <pre data-result></pre>
</main>
```

For richer interfaces, use the injected Photon bridge to call methods,
subscribe to events, and update the UI.

## Generated UI vs Custom UI

| Use generated Beam UI when | Use custom `@ui` when |
|---|---|
| You want forms for tools quickly | The result needs a purpose-built interface |
| Inputs and outputs are simple | Users need a dashboard, card, map, editor, or workflow |
| You are testing an MCP tool | The UI is part of the product experience |
| You want zero frontend code | You need custom layout and interaction |

## Does This Work in ChatGPT and Claude?

Photon's custom UI path follows the MCP app/resource model used by modern MCP
clients. Local clients can connect through stdio. Remote clients such as ChatGPT
developer mode need a public HTTPS MCP endpoint, usually through a deployed
server or temporary tunnel.

GitHub Pages can host static documentation and browser-side WebMCP helpers. It
cannot host a live server-side `/mcp` endpoint by itself because MCP tool
execution needs a runtime.

## Related Docs

| Goal | Read |
|---|---|
| Build the MCP server first | [Build an MCP Server in TypeScript](BUILD-MCP-SERVER-TYPESCRIPT.md) |
| Full UI bridge reference | [Custom UI Development Guide](CUSTOM-UI.md) |
| Weather chat app tutorial | [From Method to Chat App](../tutorials/from-method-to-chat-app.md) |
| Output rendering formats | [Output Formats](../formats.md) |
| Deployment options | [Deployment](DEPLOYMENT.md) |
