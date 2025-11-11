# Photon Naming Conventions

Clean, consistent naming is crucial for photons, especially when used as CLI tools. This guide establishes conventions to make photons intuitive and easy to use.

## Why Naming Matters

When used as CLI tools, photon names directly impact user experience:

```bash
# ❌ Bad: Redundant and verbose
photon cli time getCurrentTime --timezone "America/New_York"
photon cli git removeBranch --name feature-x

# ✅ Good: Concise and clear
photon cli time current --timezone "America/New_York"
photon cli git remove --branch feature-x
```

## Core Principles

### 1. **Avoid Redundancy**

The photon name provides context, so don't repeat it in method names.

```typescript
// ❌ Bad - Repeats photon name
export default class Time {
  async getCurrentTime() { }
  async convertTime() { }
  async listTimezones() { }
}

// ✅ Good - Concise, context is clear from photon name
export default class Time {
  async current() { }
  async convert() { }
  async timezones() { }
}
```

**CLI Usage:**
- Bad: `photon cli time getCurrentTime`
- Good: `photon cli time current`

### 2. **Keep Methods Concise**

CLI commands should be short and memorable.

```typescript
// ❌ Bad - Too verbose
async calculateExpression() { }
async retrieveUserProfile() { }
async removeAllDocuments() { }

// ✅ Good - Short and clear
async calculate() { }
async profile() { }
async clear() { }
```

### 3. **Use Standard Verbs**

Stick to common CRUD operations and their variations:

| Operation | Verb Choices |
|-----------|-------------|
| Create | `create`, `add`, `new` |
| Read | `get`, `list`, `find`, `search` |
| Update | `update`, `set`, `modify` |
| Delete | `delete`, `remove`, `clear` |
| Special | `execute`, `run`, `invoke` |

```typescript
// ✅ Good - Clear action verbs
async create() { }    // Create new resource
async list() { }      // List multiple items
async get() { }       // Get single item
async update() { }    // Update existing
async delete() { }    // Remove item
async clear() { }     // Clear all
```

### 4. **Singular vs Plural**

- **Singular**: Operations on single items
- **Plural**: Operations on collections

```typescript
// ✅ Good distinction
async user() { }       // Get single user
async users() { }      // List all users
async delete() { }     // Delete one item
async clear() { }      // Clear all items
```

### 5. **Prefix Conventions**

Use prefixes sparingly, only when necessary for clarity:

| Prefix | When to Use | Example |
|--------|-------------|---------|
| `get-` | Only if ambiguous | `getByEmail()` when you also have `getById()` |
| `set-` | For configuration | `setVolume()`, `setBrightness()` |
| `is-` / `has-` | Boolean checks | `isConnected()`, `hasAccess()` |
| `list-` | When noun form is ambiguous | `listTimezones()` vs `timezones` (property) |

### 6. **Parameter Names**

Parameters should be clear and use common terminology:

```typescript
// ❌ Bad - Cryptic abbreviations
async send(params: { msg: string; addr: string }) { }

// ✅ Good - Clear, full names
async send(params: { message: string; address: string }) { }

// ✅ Good - Use common short forms when universally understood
async send(params: { message: string; to: string; cc?: string }) { }
```

**Common Parameter Patterns:**
- `id` - Unique identifier
- `name` - Human-readable name
- `filter` - Query filter criteria
- `limit` - Maximum results
- `offset` - Pagination offset
- `sort` - Sort specification
- `query` - Search query string

### 7. **Enum Values**

Use lowercase with hyphens for enum values (kebab-case):

```typescript
// ❌ Bad - Mixed conventions
state?: 'OPEN' | 'closed' | 'In_Progress'

// ✅ Good - Consistent kebab-case
state?: 'open' | 'closed' | 'in-progress'

// ✅ Also acceptable - lowercase without hyphens
state?: 'open' | 'closed' | 'pending'
```

## Photon-Specific Patterns

### Resource-Based Photons

For photons managing resources (users, files, containers):

```typescript
export default class Docker {
  // List all
  async containers() { }
  async images() { }

  // CRUD operations
  async start(params: { container: string }) { }
  async stop(params: { container: string }) { }
  async remove(params: { container: string }) { }

  // Bulk operations - add suffix
  async removeMany(params: { containers: string[] }) { }
}
```

### Service-Based Photons

For photons wrapping external services:

```typescript
export default class Slack {
  async post(params: { channel: string; message: string }) { }
  async channels() { }
  async history(params: { channel: string }) { }
  async search(params: { query: string }) { }
}
```

### Utility Photons

For photons providing utilities or transformations:

```typescript
export default class Math {
  async calculate(params: { expression: string }) { }
  async random(params: { min: number; max: number }) { }
}

export default class Time {
  async current(params: { timezone: string }) { }
  async convert(params: { from: string; to: string; time: string }) { }
  async timezones() { }
}
```

## Real-World Examples

### Before & After: GitHub Issues

```typescript
// ❌ Before - Redundant and verbose
export default class GitHubIssues {
  async listIssues() { }
  async getIssue() { }
  async createIssue() { }
  async updateIssue() { }
  async addComment() { }
  async listComments() { }
}

// ✅ After - Clean and concise
export default class GitHubIssues {
  async list() { }
  async get() { }
  async create() { }
  async update() { }
  async comment() { }      // Add a comment
  async comments() { }     // List comments
}
```

**CLI Usage:**
```bash
# Before
photon cli github-issues listIssues --owner foo --repo bar
photon cli github-issues addComment --issue 123 --body "Fixed"

# After
photon cli github-issues list --owner foo --repo bar
photon cli github-issues comment --issue 123 --body "Fixed"
```

### Before & After: MongoDB

```typescript
// ❌ Before - Repetitive prefixes
export default class MongoDB {
  async findDocuments() { }
  async findOneDocument() { }
  async insertDocument() { }
  async updateDocument() { }
  async deleteDocument() { }
}

// ✅ After - Collection context is implicit
export default class MongoDB {
  async find() { }
  async findOne() { }    // Keep 'One' suffix for clarity
  async insert() { }
  async update() { }
  async delete() { }
}
```

### Before & After: Redis

```typescript
// ❌ Before - Over-specified
export default class Redis {
  async getValue() { }
  async setValue() { }
  async deleteKey() { }
  async keyExists() { }
  async getAllKeys() { }
}

// ✅ After - Redis commands are well-known
export default class Redis {
  async get() { }
  async set() { }
  async del() { }     // Match Redis command name
  async exists() { }
  async keys() { }
}
```

## Special Cases

### When Repetition is OK

Sometimes repetition adds necessary clarity:

```typescript
// ✅ OK - Distinguishes between operations
export default class Git {
  async branch() { }        // Show current branch
  async branches() { }      // List all branches
  async createBranch() { }  // Create new branch (clearer than just 'create')
}

// ✅ OK - Common terminology
export default class Docker {
  async build() { }         // Build image
  async buildImage() { }    // More explicit, also OK
}
```

### Compound Operations

For complex operations combining multiple actions:

```typescript
// ✅ Good - Descriptive of complex action
async syncAndPush() { }
async fetchAndMerge() { }
async backupAndRestore() { }
```

### Toggle/Switch Operations

```typescript
// ✅ Good patterns
async toggle() { }          // Toggle boolean state
async enable() { }          // Enable explicitly
async disable() { }         // Disable explicitly
async mute() { }            // Common action
async unmute() { }          // Opposite action
```

## Checklist for New Photons

Before finalizing a photon, ask:

- [ ] Are method names concise (ideally 1-2 words)?
- [ ] Do I avoid repeating the photon name in methods?
- [ ] Do I use standard verbs (get, set, list, create, update, delete)?
- [ ] Are enum values consistently lowercase/kebab-case?
- [ ] Would this read naturally as a CLI command?
- [ ] Are parameter names clear and unabbreviated?
- [ ] Do singular/plural forms make sense?

## Testing Your Names

Test your naming by saying the full CLI command out loud:

```bash
# Does it flow naturally?
photon cli time current --timezone "America/New_York"  # ✅ Yes
photon cli math calculate --expression "2 + 2"         # ✅ Yes
photon cli docker containers                            # ✅ Yes

# Does it sound redundant or awkward?
photon cli time getCurrentTime --timezone "..."        # ❌ No
photon cli math evaluateMathExpression --expression... # ❌ No
photon cli docker listDockerContainers                 # ❌ No
```

## Summary

1. **Be concise** - Short method names are better
2. **Avoid redundancy** - Photon name provides context
3. **Use standard verbs** - Stick to CRUD operations
4. **Think CLI-first** - Imagine the command-line usage
5. **Be consistent** - Follow patterns across photons
6. **Test it out loud** - Does it sound natural?

Remember: Good naming makes photons a joy to use both as MCP servers and CLI tools!
