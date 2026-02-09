# Marketplace Publishing Guide

Create and manage photon marketplaces for teams, organizations, or public distribution.

---

## Table of Contents

- [Overview](#overview)
- [Marketplace Types](#marketplace-types)
- [Creating a Marketplace](#creating-a-marketplace)
- [Publishing Photons](#publishing-photons)
- [Quality Guidelines](#quality-guidelines)
- [Manifest Format](#manifest-format)
- [Versioning](#versioning)
- [Discovery](#discovery)
- [Private Marketplaces](#private-marketplaces)

---

## Overview

Photon marketplaces are Git repositories containing `.photon.ts` files with a manifest that describes available photons. Users can add marketplaces and install photons with a single command:

```bash
# Add a marketplace
photon marketplace add my-team https://github.com/my-org/photons

# Install from marketplace
photon add my-team/analytics
```

---

## Marketplace Types

### Official Marketplace

The default marketplace maintained by Portel:

```bash
photon add analytics  # Installs from official marketplace
```

### Organization Marketplaces

Private or internal marketplaces for teams:

```bash
photon marketplace add acme https://github.com/acme-corp/mcp-tools
photon add acme/sales-report
```

### Personal Marketplaces

Share your own photons:

```bash
photon marketplace add john https://github.com/john/my-photons
```

---

## Creating a Marketplace

### 1. Initialize Repository

```bash
mkdir my-photons
cd my-photons
git init
photon maker init
```

This creates:
- `.marketplace/photons.json` - Manifest file
- `.githooks/pre-commit` - Auto-sync manifest on commit

### 2. Add Photons

Create your photon files:

```typescript
// analytics.photon.ts
/**
 * Analytics Dashboard
 * @description Track metrics and generate reports
 * @icon mdi:chart-line
 * @version 1.0.0
 */
export default class AnalyticsPhoton {
  async getDailyMetrics() { ... }
  async generateReport() { ... }
}
```

### 3. Generate Manifest

```bash
photon maker sync
```

This scans all `.photon.ts` files and updates the manifest.

### 4. Enable Pre-commit Hook

```bash
git config core.hooksPath .githooks
```

Now the manifest auto-updates on every commit.

---

## Publishing Photons

### Pre-publish Checklist

- [ ] **Validation** - Run `photon maker validate <name>`
- [ ] **Documentation** - Clear class-level JSDoc with description
- [ ] **Icon** - Add `@icon` tag for discoverability
- [ ] **Version** - Add `@version` tag following semver
- [ ] **Tests** - Include test methods or test files
- [ ] **Security** - Review for vulnerabilities (see SECURITY.md)

### Publishing Workflow

1. **Create or update photon**
   ```bash
   # Create new photon
   photon maker new my-feature

   # Validate
   photon maker validate my-feature
   ```

2. **Sync manifest**
   ```bash
   photon maker sync
   ```

3. **Commit and push**
   ```bash
   git add -A
   git commit -m "feat: add my-feature photon"
   git push
   ```

4. **Users can now install**
   ```bash
   photon add my-marketplace/my-feature
   ```

---

## Quality Guidelines

### Documentation

Every photon should have:

```typescript
/**
 * Clear, Descriptive Name
 *
 * Detailed description explaining what this photon does,
 * its use cases, and any requirements.
 *
 * ## Features
 * - Feature 1: Description
 * - Feature 2: Description
 *
 * ## Requirements
 * - Requirement 1
 * - Requirement 2
 *
 * @icon mdi:appropriate-icon
 * @version 1.0.0
 */
export default class MyPhoton {
  /**
   * Tool description - what it does and when to use it
   * @param input Clear parameter description
   * @returns What the tool returns
   */
  async myTool(params: { input: string }): Promise<Output> { ... }
}
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| File | kebab-case.photon.ts | `sales-report.photon.ts` |
| Class | PascalCase + Photon suffix | `SalesReportPhoton` |
| Methods | camelCase | `generateReport` |
| Parameters | camelCase | `dateRange`, `includeCharts` |

### Error Handling

```typescript
// Good: Informative errors
async getReport(params: { id: string }) {
  const report = await this.db.get(params.id);
  if (!report) {
    throw new Error(`Report not found: ${params.id}`);
  }
  return report;
}

// Bad: Generic errors
async getReport(params: { id: string }) {
  const report = await this.db.get(params.id);
  if (!report) {
    throw new Error('Error');  // Unhelpful!
  }
  return report;
}
```

### Performance

- Keep response times under 5 seconds for interactive tools
- Use progress indicators for long operations
- Implement pagination for large result sets
- Cache expensive computations when appropriate

---

## Manifest Format

The `.marketplace/photons.json` manifest:

```json
{
  "name": "my-photons",
  "description": "My collection of photons",
  "version": "1.0.0",
  "photons": [
    {
      "name": "analytics",
      "path": "analytics.photon.ts",
      "description": "Track metrics and generate reports",
      "icon": "mdi:chart-line",
      "version": "1.0.0",
      "tools": ["getDailyMetrics", "generateReport"],
      "tags": ["analytics", "reporting", "metrics"]
    },
    {
      "name": "notifications",
      "path": "notifications.photon.ts",
      "description": "Send notifications via multiple channels",
      "icon": "mdi:bell",
      "version": "1.2.0",
      "tools": ["sendEmail", "sendSlack", "sendSMS"],
      "tags": ["notifications", "messaging"]
    }
  ]
}
```

### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| name | Yes | Marketplace identifier |
| description | Yes | What this marketplace provides |
| version | Yes | Marketplace version (semver) |
| photons | Yes | Array of photon entries |
| photons[].name | Yes | Photon identifier |
| photons[].path | Yes | Relative path to .photon.ts file |
| photons[].description | Yes | Short description |
| photons[].icon | No | Material Design Icons identifier |
| photons[].version | No | Photon version |
| photons[].tools | No | List of tool names |
| photons[].tags | No | Discovery tags |

---

## Versioning

### Photon Versions

Use semantic versioning in JSDoc:

```typescript
/**
 * My Photon
 * @version 2.1.0
 */
```

Version meaning:
- **MAJOR** (2.x.x): Breaking changes to tool interfaces
- **MINOR** (x.1.x): New tools, backward-compatible
- **PATCH** (x.x.1): Bug fixes, no interface changes

### Upgrade Path

When making breaking changes:

1. **Deprecate first**: Add `@deprecated` to old tools
2. **Document migration**: Explain how to update
3. **Support both**: Keep old interface for one version
4. **Remove**: After users have migrated

```typescript
/**
 * Old method - use newMethod instead
 * @deprecated Use newMethod() which supports additional options
 */
async oldMethod(params: { query: string }) {
  return this.newMethod({ query: params.query, limit: 10 });
}

/**
 * New method with improved interface
 * @version 2.0.0
 */
async newMethod(params: { query: string; limit?: number }) {
  // Implementation
}
```

---

## Discovery

### Search

Users find photons via search:

```bash
# Search official marketplace
photon search analytics

# Search specific marketplace
photon search my-team/sales
```

### Tags

Add tags for discoverability:

```typescript
/**
 * Sales Analytics
 * @tags analytics, sales, reporting, dashboard
 */
```

### Categories

Common categories:

| Category | Description |
|----------|-------------|
| data | Data processing, ETL |
| api | External API integrations |
| productivity | Task management, notes |
| devops | CI/CD, infrastructure |
| communication | Email, Slack, notifications |
| finance | Payments, accounting |
| ai | AI/ML tools and utilities |

---

## Private Marketplaces

### GitHub Private Repos

For private organization marketplaces:

```bash
# Add with SSH URL
photon marketplace add acme git@github.com:acme-corp/photons.git

# Or HTTPS with token
photon marketplace add acme https://token@github.com/acme-corp/photons.git
```

### Self-Hosted

Host your own marketplace server:

1. Serve the repository via HTTPS
2. Ensure `.marketplace/photons.json` is accessible
3. Configure authentication as needed

### Access Control

For enterprise deployments:

```json
{
  "access": {
    "type": "private",
    "allowedTeams": ["engineering", "data-science"],
    "requireApproval": true
  }
}
```

---

## Claude Code Integration

### Generate Plugin Files

```bash
photon maker sync --claude-code
```

This creates:
- `.claude-plugin/marketplace.json` - Plugin manifest
- `.claude-plugin/tools/` - Tool definitions

### Pre-commit Hook

The hook auto-generates plugin files:

```bash
# .githooks/pre-commit
photon maker sync --claude-code
git add .claude-plugin/
```

---

## Troubleshooting

### Manifest Not Updating

```bash
# Force regenerate
photon maker sync --force

# Check for errors
photon maker validate .
```

### Authentication Issues

```bash
# Check marketplace config
photon marketplace list

# Remove and re-add with correct credentials
photon marketplace remove my-marketplace
photon marketplace add my-marketplace <url>
```

### Version Conflicts

```bash
# Show installed version
photon info my-photon

# Force upgrade
photon upgrade my-photon --force
```

---

## Next Steps

- [GUIDE.md](../GUIDE.md) - Photon development guide
- [SECURITY.md](../../SECURITY.md) - Security best practices
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment options
