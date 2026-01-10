# Progress and UX Improvements

## Overview
Improved progress indication and user experience for Photon CLI to provide clean, professional output with ephemeral progress messages.

## Changes Made

### 1. Progress Rendering (photon runtime)
**File**: `src/shared/progress-renderer.ts`

**Improvements**:
- Replaced manual ANSI escape codes with Node's `readline` module for proper TTY handling
- Added TTY detection (`process.stderr.isTTY`) to avoid sending escape codes to pipes/redirects
- Simplified `showSpinner()` to always clear before updating, ensuring only one progress message visible at a time
- Progress messages now properly disappear when tool execution completes

**Behavior**:
- In a real terminal: Progress indicators update in-place and clear when done
- When piped/redirected: Progress messages are suppressed (no ANSI codes sent)
- Final results always remain visible on stdout

### 2. Web Photon Documentation  
**File**: `photons/web.photon.ts` (in sibling repo)

**Improvements**:
- Removed redundant `@param` and `@returns` JSDoc tags (AI understands parameters from signature)
- Kept descriptions concise and focused on tool purpose
- Reduced documentation noise while maintaining clarity

### 3. Progress Support in Photon Core
**File**: `photon-core/src/progress.ts` (created)

**Purpose**: Provide reusable progress rendering utilities for all Photon-based runtimes

**Features**:
- `ProgressRenderer` class with spinner and progress bar support
- Ephemeral progress that auto-clears when complete
- Global renderer instance for consistent UX
- Exported from `@portel/photon-core` for use in NCP, Lumina, and other runtimes

**API**:
```typescript
import { startSpinner, showProgress, stopProgress } from '@portel/photon-core';

// Indeterminate progress
startSpinner('Processing...');

// Determinate progress  
showProgress(0.5, 'Halfway there...');

// Clear when done
stopProgress();
```

## User Experience Goals

### Before
```
Dependencies already installed for web-a0937798
Web Agent (Search + Read) initialized.
ℹ 🔍 Searching DuckDuckGo...
ℹ 📄 Parsing results...
Entry 1
...results...
```

### After
```
Entry 1
...results...
```

Progress messages (searching, parsing) are shown while running but disappear when complete, leaving only the final results visible.

## Technical Details

### Why readline instead of ANSI codes?
- `readline.clearLine()` handles TTY detection automatically
- Works correctly with different terminal types
- Properly handles piped/redirected output
- More robust than manual escape sequences

### TTY vs Non-TTY Output
- **TTY (terminal)**: Progress indicators animate and clear in-place
- **Non-TTY (pipes, redirects)**: Progress suppressed, only results shown
- This prevents ANSI codes from polluting logs, test output, or piped data

### Generator-based Progress
Web photon and other tools use async generators with `yield { emit: 'status', message: '...' }` for progress updates. These are handled by the output handler in the loader, which routes them to the ProgressRenderer.

## Next Steps

1. ✅ Fix progress clearing in terminals
2. ⏭️ Update other runtimes (NCP, Lumina) to use photon-core progress utilities
3. ⏭️ Add progress support for dependency installation
4. ⏭️ Consider animated spinners for long-running operations

## Testing

To test progress clearing in a real terminal:
```bash
# Run without piping to see live progress
photon cli web search "test query"

# Progress messages appear and disappear
# Only final results remain
```

To test non-TTY behavior:
```bash
# Pipe output - should see no ANSI codes
photon cli web search "test query" 2>&1 | cat

# Redirect - same clean output
photon cli web search "test query" > results.txt 2>&1
```

## Related Files

- `src/loader.ts` - Output handler that routes emits to ProgressRenderer
- `src/photon-cli-runner.ts` - CLI command executor that shows results after progress clears
- `photon-core/src/generator.ts` - Emit types (status, progress, etc.)
- `photon-core/src/progress.ts` - New progress utilities for all runtimes
