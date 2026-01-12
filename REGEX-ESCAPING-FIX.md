# Regex Escaping Fix for Playground

## Problem
Browser was throwing: `Uncaught SyntaxError: Invalid regular expression: /[([^]]+)](([^)]+))/g: Unmatched ')'`

## Root Cause
In `src/auto-ui/playground-server.ts`, regex patterns were embedded in a TypeScript template string that generates HTML with embedded JavaScript. The escaping was insufficient.

When you have:
- TypeScript template string → HTML → JavaScript regex
- You need **quadruple backslashes** (`\\\\`) to get a single backslash in the final JavaScript

## The Fix
Changed line 469-470 in `src/auto-ui/playground-server.ts`:

**Before:**
```javascript
const markdownLinkRegex = /\\[([^\\]]+)\\]\\(([^)]+)\\)/g;
const markdownBoldRegex = /\\*\\*([^*]+)\\*\\*/g;
```

**After:**
```javascript
const markdownLinkRegex = /\\\\[([^\\\\]]+)\\\\]\\\\(([^)]+)\\\\)/g;
const markdownBoldRegex = /\\\\*\\\\*([^*]+)\\\\*\\\\*/g;
```

## Why This Works
1. TypeScript processes `\\\\` → `\\` (in the template string)
2. HTML contains `\\` literally 
3. Browser JavaScript interprets `\\` → `\` (escaped backslash)
4. Final regex has proper escaping: `/\[([^\]]+)\]\(([^)]+)\)/g`

## Testing
Run `photon playground` and verify:
1. No regex syntax errors in browser console
2. Markdown links render correctly
3. Bold text renders correctly
