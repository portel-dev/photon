# Troubleshooting Guide

Comprehensive guide to diagnosing and fixing common Photon MCP issues.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Configuration Problems](#configuration-problems)
- [Hot Reload Failures](#hot-reload-failures)
- [Dependency Issues](#dependency-issues)
- [Schema Extraction Errors](#schema-extraction-errors)
- [Marketplace Problems](#marketplace-problems)
- [Performance Issues](#performance-issues)
- [MCP Protocol Errors](#mcp-protocol-errors)
- [Stale Cache After Upgrade](#stale-cache-after-upgrade)
- [npx Quick Reset Guide](#npx-quick-reset-guide)

---

## npx Quick Reset Guide

If you're using `npx @portel/photon` and things aren't working, here's a quick reference for resetting to a clean state.

### Full Reset (Nuclear Option)

```bash
# 1. Remove all installed photons and caches
rm -rf ~/.photon

# 2. Clear npx cache to get the latest version
npx clear-npx-cache 2>/dev/null; npm cache clean --force

# 3. Start fresh
npx @portel/photon@latest
```

### Repair a Single Photon

If a specific photon isn't working (e.g., showing under PHOTONS instead of APPS, missing UI):

```bash
# Remove and reinstall it
npx @portel/photon remove <name>
npx @portel/photon add <name>
```

This re-downloads both the photon file and its UI assets.

### Photon Shows in Wrong Sidebar Category

**Symptom**: A photon like `kanban` or `git-box` appears under PHOTONS instead of APPS.

**Cause**: The photon's UI assets (HTML files) weren't downloaded during the original install. Without the UI asset, Beam can't detect that the photon has an app interface.

**Fix**:
```bash
# Option 1: Upgrade Photon (v1.8.4+ auto-repairs on startup)
npx @portel/photon@latest beam

# Option 2: Reinstall the affected photon
npx @portel/photon remove git-box
npx @portel/photon add git-box
```

### Verify Your Installation

```bash
# Check version
npx @portel/photon --version

# Check what's installed
ls ~/.photon/*.photon.ts

# Check if UI assets exist for a photon
ls ~/.photon/<name>/ui/

# Check marketplace cache
ls ~/.photon/.cache/

# Run Beam diagnostics (in browser)
# Start Beam, then click the 🔍 Status button in the bottom-left
npx @portel/photon beam
```

### Common npx Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Old version running | npx caches packages | `npm cache clean --force` then retry |
| `~/.photon` doesn't exist | First run, no photons installed | Normal — `photon beam` creates it automatically |
| Assets missing after install | Installed with older version that had a bug | Upgrade to latest and restart Beam (auto-repairs) |
| "No photons found" in Beam | Empty `~/.photon` directory | Use marketplace in Beam sidebar or `npx @portel/photon add <name>` |

---

## Installation Issues

### Global Install Not Found

**Symptom**: `command not found: photon` after installation

**Solutions**:

```bash
# Verify installation
npm list -g @portel/photon

# If not installed
npm install -g @portel/photon

# Check npm global bin path
npm config get prefix

# Add to PATH if needed (macOS/Linux)
export PATH="$(npm config get prefix)/bin:$PATH"

# Add to PATH (Windows PowerShell)
$env:PATH += ";$(npm config get prefix)"
```

### npx Version Conflicts

**Symptom**: Different behavior between `photon` and `npx @portel/photon`

**Solution**:
```bash
# Always use specific version with npx
npx @portel/photon@latest mcp <name>

# Or install globally for consistency
npm install -g @portel/photon
```

---

## Configuration Problems

### Missing Environment Variables

**Symptom**:
```
❌ Configuration Error: github-issues MCP failed to initialize
Original error: GITHUB_ISSUES_TOKEN is required
```

**Diagnosis**:
```bash
# Validate configuration
photon mcp github-issues --validate

# Show configuration template
photon mcp github-issues --config
```

**Solution**:

1. **For Claude Desktop**: Edit `claude_desktop_config.json`
   ```json
   {
     "mcpServers": {
       "github-issues": {
         "command": "npx",
         "args": ["@portel/photon", "mcp", "github-issues"],
         "env": {
           "GITHUB_ISSUES_TOKEN": "your-token-here"
         }
       }
     }
   }
   ```

2. **For Development**:
   ```bash
   export GITHUB_ISSUES_TOKEN="your-token"
   photon mcp github-issues --dev
   ```

### Environment Variable Naming

**Problem**: Environment variables not recognized

**Rule**: `{MCP_NAME}_{PARAM_NAME}` in UPPER_SNAKE_CASE

**Examples**:
- MCP: `github-issues`, Param: `token` → `GITHUB_ISSUES_TOKEN`
- MCP: `my-api`, Param: `apiKey` → `MY_API_API_KEY`
- MCP: `postgres`, Param: `connectionString` → `POSTGRES_CONNECTION_STRING`

### Default Values Not Working

**Symptom**: Optional parameters causing errors despite having defaults

**Check**:
```typescript
// ✅ Correct - default in constructor
constructor(private timeout: number = 30000) {}

// ❌ Wrong - default in interface won't work
constructor(private timeout: number) {}
// with separate: timeout?: number = 30000
```

---

## Hot Reload Failures

### Reload Failed - Server Still Running

**Symptom**:
```
❌ Reload failed (attempt 1/3)
Error: Initialization failed for postgres

✓ Server still running with previous version
```

**This is NORMAL behavior**. Photon keeps your last working version active.

**Solutions**:

1. **Fix the error and save again** - Photon will auto-retry
2. **Check the error message** for specific issues
3. **Restart if needed**:
   ```bash
   # Ctrl+C to stop, then:
   photon mcp <name> --dev
   ```

### onInitialize() Failures

**Common causes**:
- Database connection failures
- API authentication errors
- Missing environment variables
- Network timeouts

**Debug**:
```typescript
export default class MyMCP {
  constructor(private dbUrl: string) {}

  async onInitialize() {
    try {
      // Add logging
      console.error('Connecting to:', this.dbUrl);
      await this.connectToDatabase();
      console.error('Connected successfully');
    } catch (error) {
      console.error('Connection failed:', error);
      throw error; // Photon will show helpful error
    }
  }
}
```

### Max Reload Failures Reached

**Symptom**:
```
⚠️  Maximum reload failures reached (3)
   Keeping previous working version active.
```

**Solution**:
- Fix the underlying issue (check error messages above)
- Save the file again to reset counter and retry
- Or restart: `photon mcp <name> --dev`

---

## Dependency Issues

### Dependency Installation Fails

**Symptom**:
```
📦 Installing dependencies for github-issues...
❌ npm install failed with code 1
```

**Solutions**:

```bash
# Clear dependency cache
photon clear-cache

# Or clear specific MCP
rm -rf ~/.cache/photon-mcp/dependencies/<mcp-name>

# Check npm configuration
npm config list

# Try manual install to see error
cd ~/.cache/photon-mcp/dependencies/<mcp-name>
npm install
```

### Module Not Found After Install

**Symptom**:
```typescript
// In MCP file
/**
 * @dependencies axios@^1.6.0
 */
import axios from 'axios'; // ❌ Module not found
```

**Solutions**:

1. **Check dependency syntax**:
   ```typescript
   // ✅ Correct
   /**
    * @dependencies axios@^1.6.0, date-fns@^2.0.0
    */

   // ❌ Wrong - missing comma
   /**
    * @dependencies axios@^1.6.0 date-fns@^2.0.0
    */
   ```

2. **Clear cache and restart**:
   ```bash
   photon clear-cache
   photon mcp <name> --dev
   ```

### Security Vulnerabilities

**Symptom**:
```bash
$ photon audit
⚠️  github-issues: 3 vulnerabilities found
   🟠 High: 2
```

**Solution**:
```typescript
// Update version in @dependencies tag
/**
 * @dependencies axios@^1.6.5  // Updated from 0.21.0
 */

// Then clear cache and reinstall
```

```bash
photon clear-cache
photon mcp github-issues
```

---

## Schema Extraction Errors

### Type Not Recognized

**Symptom**: Schema shows `type: 'object'` for primitive types

**Unsupported patterns**:
```typescript
// ❌ Type aliases
type MyString = string;
async myTool(params: { value: MyString }) {} // Shows as object

// ❌ Imported types
import { CustomType } from './types';
async myTool(params: { data: CustomType }) {} // Shows as object
```

**Solutions**:
```typescript
// ✅ Use inline primitive types
async myTool(params: { value: string }) {}

// ✅ Use inline object types
async myTool(params: {
  data: {
    name: string;
    age: number;
  }
}) {}

// ✅ For complex types, document in JSDoc
/**
 * @param data User data object with name (string) and age (number)
 */
async myTool(params: { data: any }) {}
```

### Optional Parameters Not Working

**Symptom**: Optional parameters marked as required

**Check syntax**:
```typescript
// ✅ Correct
async myTool(params: {
  required: string;
  optional?: number;  // ? makes it optional
}) {}

// ❌ Wrong
async myTool(params: {
  required: string;
  optional: number | undefined;  // Treated as required
}) {}
```

---

## Marketplace Problems

### MCP Not Found in Marketplace

**Symptom**:
```
❌ MCP 'my-tool' not found in any enabled marketplace
```

**Diagnosis**:
```bash
# List all marketplaces
photon marketplace list

# Search for MCP
photon search my-tool

# Check specific marketplace
photon marketplace list
```

**Solutions**:

1. **Update marketplace cache**:
   ```bash
   photon marketplace update
   ```

2. **Check marketplace is enabled**:
   ```bash
   photon marketplace enable <name>
   ```

3. **Add marketplace if missing**:
   ```bash
   photon marketplace add username/repo
   ```

### Conflicting MCPs

**Symptom**:
```
⚠️  MCP 'analytics' found in multiple marketplaces:
  → [1] company-internal (v2.1.0)
    [2] community-mcps (v1.9.0)
```

**Solutions**:

```bash
# Use specific marketplace
photon add analytics --marketplace company-internal

# Or disable unwanted marketplace
photon marketplace disable community-mcps

# View all conflicts
photon conflicts
```

---

## Performance Issues

### Slow Startup

**Symptoms**:
- MCP takes >5 seconds to start
- First request times out

**Diagnosis**:
```bash
# Check dependency size
du -sh ~/.cache/photon-mcp/dependencies/<mcp-name>/node_modules

# Profile startup
time photon mcp <name>
```

**Solutions**:

1. **Reduce dependencies**:
   ```typescript
   // ❌ Heavy - imports entire library
   import lodash from 'lodash';

   // ✅ Light - imports only what's needed
   import { map } from 'lodash/map';
   ```

2. **Lazy initialization**:
   ```typescript
   export default class MyMCP {
     private connection?: Database;

     // ❌ Slow - connects on startup
     async onInitialize() {
       this.connection = await connectDatabase();
     }

     // ✅ Fast - connects on first use
     private async getConnection() {
       if (!this.connection) {
         this.connection = await connectDatabase();
       }
       return this.connection;
     }
   }
   ```

### Memory Leaks

**Symptoms**:
- Memory usage grows over time
- Server becomes unresponsive

**Diagnosis**:
```bash
# Run load tests
npm run test:load

# Monitor memory in production
node --expose-gc --max-old-space-size=4096 \
  node_modules/.bin/photon mcp <name>
```

**Solutions**:

1. **Clean up in onShutdown**:
   ```typescript
   export default class MyMCP {
     private connections: Connection[] = [];

     async onShutdown() {
       // Close all connections
       await Promise.all(
         this.connections.map(c => c.close())
       );
       this.connections = [];
     }
   }
   ```

2. **Avoid global state**:
   ```typescript
   // ❌ Memory leak - cache grows forever
   const cache = new Map();

   export default class MyMCP {
     async getData(id: string) {
       if (cache.has(id)) return cache.get(id);
       const data = await fetchData(id);
       cache.set(id, data); // Never cleared!
       return data;
     }
   }

   // ✅ Fixed - use LRU cache or clear old entries
   export default class MyMCP {
     private cache = new Map();

     async getData(id: string) {
       if (this.cache.size > 1000) {
         // Clear oldest entries
         const first = this.cache.keys().next().value;
         this.cache.delete(first);
       }
       // ... rest of code
     }
   }
   ```

---

## MCP Protocol Errors

### Tools Not Showing in Claude

**Symptom**: MCP connects but tools don't appear

**Diagnosis**:
```bash
# Check server is running
photon mcp <name> --dev

# Verify tools are extracted
# Look for: "Extracted X tools, Y templates, Z statics"
```

**Solutions**:

1. **Check method signature**:
   ```typescript
   // ✅ Correct - async method with params object
   async myTool(params: { input: string }) {
     return { result: 'ok' };
   }

   // ❌ Wrong - missing async
   myTool(params: { input: string }) {}

   // ❌ Wrong - no params object
   async myTool(input: string) {}
   ```

2. **Check JSDoc**:
   ```typescript
   /**
    * Tool description here
    * @param input Description of input parameter
    */
   async myTool(params: { input: string }) {}
   ```

3. **Restart Claude Desktop** after config changes

### Connection Refused

**Symptom**:
```
Error: Connection refused
```

**Solutions**:

1. **Check MCP is running**:
   ```bash
   photon mcp <name> --dev
   # Should show: Server started: <name>
   ```

2. **Check Claude Desktop config**:
   ```json
   {
     "mcpServers": {
       "my-mcp": {
         "command": "npx",  // ✅ or "photon"
         "args": ["@portel/photon", "mcp", "my-mcp"]  // ✅ Correct
       }
     }
   }
   ```

3. **Check logs**:
   ```bash
   # macOS
   tail -f ~/Library/Logs/Claude/mcp*.log

   # Windows
   Get-Content "$env:APPDATA\Claude\Logs\mcp*.log" -Wait
   ```

---

## Stale Cache After Upgrade

### "does not provide an export named 'Array'"

**Symptom**:
```
SyntaxError: The requested module '@portel/photon-core' does not provide an export named 'Array'
```

**What happened**: You upgraded `@portel/photon-core` but the dependency cache still has the old version compiled. The old build does not know about reactive collections.

**Fix**:

```bash
photon clear-cache
```

Then run your photon again. The cache rebuilds with the new version. In most cases you will not even see this error, because Photon auto-invalidates the cache when it detects a photon-core version change. But if you are doing something creative with symlinks or local development, the auto-detection can miss it.

### "ECONNREFUSED" / Daemon Unreachable

**Symptom**:
```
Error: connect ECONNREFUSED /tmp/photon-daemon.sock
```

Or any variant that boils down to "I tried to talk to the daemon and nobody answered."

**What happened**: The daemon process crashed, was killed, or never started. This is not as dramatic as it sounds.

**Fix**: Usually, nothing. The next CLI command auto-restarts the daemon and retries. You might see a slightly longer response time on that first call, but everything should work normally after.

If the problem persists:
```bash
# Run diagnostics
photon doctor

# Nuclear option: kill any lingering daemon and let it restart
pkill -f photon-daemon 2>/dev/null
photon doctor
```

### Config Form Shows Stale Values

**Symptom**: You changed the `configure()` method in your photon (added a new field, changed defaults), but the config form in Beam still shows the old fields.

**What happened**: Beam caches the photon schema at startup. Code changes to the backend are not reflected until Beam re-reads the schema.

**Fix**: Restart Beam.

```bash
# Stop Beam (Ctrl+C in the terminal running it), then:
photon beam
```

After restart, Beam recompiles and re-extracts the schema. Your new config fields will appear.

---

## Advanced Debugging

### Enable Verbose Logging

```bash
# Set environment variable
export PHOTON_DEBUG=1

# Or in Claude Desktop config
{
  "mcpServers": {
    "my-mcp": {
      "command": "photon",
      "args": ["mcp", "my-mcp"],
      "env": {
        "PHOTON_DEBUG": "1"
      }
    }
  }
}
```

### Test MCP Directly

```bash
# Start server
photon mcp my-tool --dev

# In another terminal, test with curl (if using stdio)
# Or use the test suite
npm run test:integration
```

### Clear All Caches

```bash
# Clear everything
rm -rf ~/.cache/photon-mcp
rm -rf ~/.photon/.cache

# Clear specific MCP
rm -rf ~/.cache/photon-mcp/dependencies/<mcp-name>
```

---

## Getting Help

If you're still stuck:

1. **Check the logs** (see Connection Refused section)
2. **Search issues**: https://github.com/portel-dev/photon/issues
3. **Create an issue** with:
   - Photon version: `photon --version`
   - Node version: `node --version`
   - OS: `uname -a` (macOS/Linux) or `systeminfo` (Windows)
   - Error message (full output)
   - Minimal reproduction steps

4. **Join community** (if available)

---

## Quick Reference

```bash
# Validation & Config
photon mcp <name> --validate    # Check configuration
photon mcp <name> --config      # Show config template

# Development
photon mcp <name> --dev         # Hot reload mode
photon clear-cache              # Clear all caches

# Security
photon audit                    # Audit all MCPs
photon audit <name>             # Audit specific MCP

# Marketplace
photon conflicts                # Show conflicting MCPs
photon marketplace list         # List marketplaces
photon search <query>           # Search for MCPs

# Debugging
export PHOTON_DEBUG=1           # Enable debug logging
npm run test:load               # Run performance tests
```
