# Auto-UI Architecture

## Overview

Photon's Auto-UI system automatically generates appropriate UI components based on the data returned from `.photon.ts` methods. This allows developers to focus on business logic while the runtime handles presentation across different interfaces (CLI, MCP, Web).

## Architecture

### Core Components (in @portel/photon-core)

1. **Auto-UI System** (`auto-ui.ts`)
   - Component type detection
   - JSDoc hint extraction  
   - UI component generation
   - Layout inference

2. **Progress Renderer** (`progress.ts`)
   - Ephemeral progress indicators
   - Spinner for indeterminate progress
   - Progress bar for determinate progress
   - Auto-clears when complete

3. **CLI UI Renderer** (`cli-ui-renderer.ts`)
   - Terminal-based component rendering
   - Implements UIRenderer interface
   - Formats data for CLI display

### Runtime Integration (in @portel/photon)

The runtime consumes photon-core components and provides:

1. **MCP Server** (`server.ts`)
   - Serves Photon methods via MCP protocol
   - Includes `/playground` for interactive testing
   - Auto-generates UI hints in tool responses

2. **CLI Interface** (`cli.ts`)
   - Uses `ProgressRenderer` from core
   - Formats output using core renderers
   - Ephemeral progress messages

3. **Auto-UI Components** (`src/auto-ui/`)
   - Extended components for runtime-specific features
   - Table, Tree, List, Card, Form, Progress
   - ComponentRegistry for routing

## How It Works

### 1. Method Introspection

When a Photon method is called, the runtime:

```typescript
// Extract JSDoc hints
const hints = extractUIHints(methodJSDoc);

// Generate UI component
const component = generateUIComponent(result, hints);

// Render based on target (CLI/MCP/Web)
renderUIComponent(component, renderer);
```

### 2. JSDoc Annotations

Developers can provide hints in JSDoc:

```typescript
/**
 * Search GitHub repositories
 * @format table
 * @ui-component table
 * @ui-title Search Results
 * @ui-sortable
 * @ui-filterable
 */
async searchRepos(query: string) {
  return [...]; // Runtime auto-formats as table
}
```

### 3. Automatic Detection

Without hints, the system infers the best UI:

```typescript
// Returns array of objects → table
async listUsers() {
  return [{ name: 'Alice', age: 30 }, ...];
}

// Returns tree structure → tree view
async getFileSystem() {
  return { name: 'root', children: [...] };
}

// Returns single value → text
async getCount() {
  return 42;
}
```

### 4. Progress Indication

Generators can emit progress updates:

```typescript
async *searchWithProgress(query: string) {
  // Indeterminate progress (spinner)
  yield { emit: 'status', message: 'Searching...' };
  
  // Determinate progress (bar)
  yield { emit: 'progress', value: 0.5, message: 'Processing...' };
  
  // Progress clears automatically when done
  return results;
}
```

## Supported UI Components

### Data Display
- **text**: Single values, strings
- **number**: Numeric values
- **boolean**: True/false
- **list**: Simple arrays
- **table**: Array of objects
- **tree**: Hierarchical data
- **card**: Rich object display
- **json**: Raw JSON view

### Input
- **form**: Interactive forms (via generators)

### Feedback
- **progress**: Loading states
- **toast**: Notifications
- **thinking**: AI status

### Code & Content
- **code**: Syntax-highlighted code
- **markdown**: Formatted text

## MCP Integration

### Tool Output Templates

Tools can specify UI templates using `_meta`:

```typescript
{
  name: "search",
  description: "Search repositories",
  inputSchema: {...},
  _meta: {
    outputTemplate: "photon://github/ui/search-results"
  }
}
```

### Beam UI

The Beam UI (`photon beam`) provides:

1. **Interactive Testing**: Select tools and run them
2. **Auto-Generated Forms**: Input parameters based on JSON Schema
3. **UI Preview**: See linked templates and custom UIs
4. **Progress Indication**: Real-time status updates via SSE
5. **Status Panel**: Runtime health monitoring
6. **Theme Support**: Automatic light/dark theme switching

Access via: `photon beam` command, which opens the interactive web UI for all installed Photons.

## Web UI Integration

For web-based UIs (like Lumina or NCP Dashboard):

1. **Component Props**: Runtime returns structured UI descriptors
2. **React/Vue Rendering**: Frontend maps to components
3. **Custom Styling**: CSS injection support
4. **Real-time Updates**: SSE for progress

Example component descriptor:

```json
{
  "component": "Table",
  "props": {
    "data": [...],
    "columns": ["name", "stars", "forks"],
    "sortable": true,
    "filterable": true
  }
}
```

## Best Practices

### For Photon Developers

1. **Return Clean Data**: Let Auto-UI handle formatting
   ```typescript
   // Good
   return { name: 'Alice', score: 95 };
   
   // Avoid
   return `Name: Alice\nScore: 95`;
   ```

2. **Use JSDoc Hints** for complex UIs:
   ```typescript
   /** @ui-component tree @ui-expandable */
   ```

3. **Emit Progress** for long operations:
   ```typescript
   yield { emit: 'progress', value: 0.5 };
   ```

4. **Group Related Data** for card layout:
   ```typescript
   return {
     user: { name, email },
     stats: { followers, repos },
     metadata: { created, updated }
   };
   ```

### For Runtime Developers

1. **Use Core Components**: Import from `@portel/photon-core`
2. **Implement UIRenderer**: For custom output targets
3. **Handle Progress**: Subscribe to emit events
4. **Clear Ephemeral Output**: Use ProgressRenderer API

## API Reference

### Auto-UI Core

```typescript
// Extract hints from JSDoc
extractUIHints(jsdoc: string): AutoUIConfig

// Generate component from data
generateUIComponent(data: any, config?: AutoUIConfig): UIComponent

// Suggest alternative components
suggestComponents(data: any): UIComponentType[]

// Render component
renderUIComponent(component: UIComponent, renderer: UIRenderer): void
```

### Progress Renderer

```typescript
// Start spinner (indeterminate)
startSpinner(message: string): void

// Show progress bar (determinate)
showProgress(value: number, message?: string): void

// Update message
updateProgressMessage(message: string): void

// Stop and clear
stopProgress(): void

// Check if active
isProgressActive(): boolean
```

### CLI UI Renderer

```typescript
// Get singleton instance
const renderer = cliRenderer();

// Render components
renderer.renderTable(data);
renderer.renderTree(data);
renderer.renderList(data);
renderer.renderCard(data);
renderer.renderProgress(value, total);
```

## Implementation Status

### Completed
- [x] **Custom Components**: Photons can bundle custom UI via `@ui` directive
- [x] **Themes**: Light/dark theme support with automatic switching
- [x] **Interactive Components**: Click handlers, forms in Beam UI
- [x] **Streaming UI**: Progressive rendering via SSE events

### Future Enhancements
- [ ] Responsive Layouts: Adapt to terminal size / viewport
- [ ] Chart Components: Graphs and visualizations in CLI
- [ ] Advanced filtering and sorting in CLI output

## Related Standards

- **MCP (Model Context Protocol)**: Anthropic's tool protocol
- **ChatGPT Actions UI**: OpenAI's UI guidelines
- **Anthropic UI Paper**: Combined MCP + UI specification

## Examples

See:
- `examples/` folder for example Photon implementations
- `photon beam` command for interactive demos
- Tests in `tests/` for component usage

