# Auto-UI System Implementation

## Overview

We've implemented a comprehensive **Auto-UI system** that automatically generates UI components from raw data returned by `.photon.ts` methods. This eliminates the need for manual formatting boilerplate while providing consistent, beautiful output across CLI, MCP, and Web platforms.

## What Was Built

### 1. Core Auto-UI Module (`@portel/photon-core`)

#### `auto-ui.ts`
- **Intelligent format detection**: Automatically detects optimal UI component from data structure
- **JSDoc hint extraction**: Parses `@format`, `@ui-component`, `@ui-layout`, `@ui-title`, `@ui-interactive`
- **Component generation**: Converts data + hints into UI component descriptors
- **Smart suggestions**: Recommends alternative components based on data patterns
- **Helper functions**: `shouldUseCards()`, `shouldUseChart()` for advanced detection

#### `cli-ui-renderer.ts`
- **CLIUIRenderer class**: Implements `UIRenderer` interface for terminal output
- **Rich components**: Cards, charts, progress bars, tabs, accordions
- **Reuses existing formatters**: Leverages `cli-formatter.ts` for tables/trees/lists
- **Beautiful ASCII output**: Bordered cards, bar charts, colored markdown

#### Component Support

**Basic Components:**
- text, number, boolean
- list (bullet points)
- table (bordered data tables)
- tree (hierarchical indented)

**Advanced Components:**
- card (rich content boxes)
- chart (ASCII bar charts)
- progress (progress bars with %)
- code (syntax highlighted)
- markdown (formatted terminal output)
- json (pretty-printed)
- form (field display)
- tabs (tabbed content sections)
- accordion (collapsible sections)

### 2. Integration Points

#### Exported from `@portel/photon-core/index.ts`
```typescript
export {
  // Types
  type UIComponentType,
  type UILayout,
  type UIComponent,
  type AutoUIConfig,
  
  // Functions
  extractUIHints,
  generateUIComponent,
  suggestComponents,
  shouldUseCards,
  shouldUseChart,
  
  // Renderer
  type UIRenderer,
  renderUIComponent,
  CLIUIRenderer,
  cliRenderer,
} from './auto-ui.js';
```

### 3. Documentation

Read [`AUTO-UI.md`](./AUTO-UI.md) for:
- Feature overview
- Usage examples for all JSDoc hints
- Component catalog
- Architecture diagram
- Before/after comparisons
- Future enhancement ideas

## How It Works

```
┌─────────────────────────────────────────────────────┐
│ 1. Developer writes .photon.ts method               │
│    - Returns raw data (object, array, string, etc.) │
│    - Optionally adds JSDoc hints (@format, @ui-*)   │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ 2. Auto-UI System (photon-core)                     │
│    - Extracts JSDoc hints                           │
│    - Introspects data structure                     │
│    - Selects optimal component type                 │
│    - Generates UIComponent descriptor               │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ 3. Platform Renderer                                │
│    - CLI: CLIUIRenderer (terminal output)           │
│    - MCP: Structured MCP responses                  │
│    - Web: React/Vue components (future)             │
│    - API: JSON with UI hints (future)               │
└─────────────────────────────────────────────────────┘
```

## Example Usage

### Without Hints (Auto-Detection)

```typescript
// Returns array of objects → Auto-detects as table
async getUsers() {
  return [
    { name: "Alice", age: 30, role: "Admin" },
    { name: "Bob", age: 25, role: "User" },
  ];
}
```

Output:
```
┌───────┬─────┬───────┐
│ Name  │ Age │ Role  │
├───────┼─────┼───────┤
│ Alice │ 30  │ Admin │
│ Bob   │ 25  │ User  │
└───────┴─────┴───────┘
```

### With JSDoc Hints

```typescript
/**
 * Get user profile
 * @ui-component card
 * @ui-title User Profile
 */
async getProfile() {
  return {
    name: "Alice",
    email: "alice@example.com",
    role: "Admin",
    joinedAt: "2024-01-01",
  };
}
```

Output:
```
┌───────────────────────────┐
│ Name: Alice               │
│ Email: alice@example.com  │
│ Role: Admin               │
│ Joined At: 2024-01-01     │
└───────────────────────────┘
```

## Benefits

### For .photon.ts Developers
✅ **Zero boilerplate**: Just return data, UI is automatic  
✅ **Consistent output**: Same structure = same UI across platforms  
✅ **Flexible**: Override auto-detection with hints when needed  
✅ **Type-safe**: Full TypeScript support

### For Platform Integrators (Lumina, NCP, etc.)
✅ **Reusable components**: Import from `@portel/photon-core`  
✅ **Extensible**: Implement `UIRenderer` for custom platforms  
✅ **Consistent behavior**: All Photon tools render the same way  
✅ **Rich output**: Professional-looking results out of the box

### For End Users
✅ **Beautiful output**: Tables, cards, charts look professional  
✅ **Easy to read**: Proper formatting, colors, structure  
✅ **Consistent experience**: All tools feel the same  
✅ **Interactive (future)**: Web UIs can enable sorting, filtering

## Architecture Benefits

1. **Separation of Concerns**
   - Data logic in `.photon.ts` files
   - UI logic in `@portel/photon-core`
   - Platform rendering in respective runtimes

2. **DRY Principle**
   - UI components defined once
   - Reused across all platforms
   - No duplication between tools

3. **Extensibility**
   - Easy to add new component types
   - Easy to add new renderers
   - Easy to add new hint types

4. **Backward Compatible**
   - Existing `.photon.ts` files work unchanged
   - Auto-detection provides sensible defaults
   - Hints are optional enhancements

## Current Status

### Completed Integration
- [x] `photon-cli-runner.ts` integrated with Auto-UI
- [x] MCP server includes UI hints in responses
- [x] Tested with existing photon files
- [x] Custom component registry (`src/auto-ui/registry.ts`)
- [x] Theme support (light/dark) - automatic theme switching
- [x] Real-time updates via SSE and daemon pub/sub
- [x] Interactive web components in Beam UI
- [x] Web UI renderer with React-style components
- [x] MCP UI hints in responses (`@ui` directive)

### Future Enhancements
- [ ] Animation hints
- [ ] Pagination for large datasets
- [ ] Export functionality (CSV, JSON)
- [ ] REST API with UI metadata
- [ ] GraphQL with UI directives

## Testing

Build passes:
```bash
cd photon-core
npm run build  # ✓ Success
```

All functionality is in `@portel/photon-core` and ready to be consumed by:
- Photon Runtime (CLI)
- NCP (MCP orchestrator)
- Lumina (API server)
- Any custom Photon runtime

## Files Changed

### photon-core
- ✅ `src/auto-ui.ts` (413 lines) - Core Auto-UI system
- ✅ `src/cli-ui-renderer.ts` (264 lines) - CLI renderer implementation
- ✅ `src/index.ts` - Exports added
- ✅ `AUTO-UI.md` (322 lines) - Comprehensive documentation
- ✅ Committed: `feat: Add Auto-UI system for automatic component generation`

## Summary

The Auto-UI system is a **game-changer** for Photon development:

- **Developers**: Write less boilerplate, focus on business logic
- **Users**: Get beautiful, consistent output everywhere
- **Platform integrators**: Reuse battle-tested UI components
- **Project**: Professional polish with minimal effort

This feature positions Photon as a truly modern, developer-friendly framework where data and presentation are properly decoupled, yet seamlessly integrated.
