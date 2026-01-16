# Photon Development Best Practices

Guidelines for creating high-quality, consistent Photon MCPs.

## 1. JSDoc Header Tags

Every Photon file must include these tags in the class-level JSDoc:

### Required Tags

```typescript
/**
 * My Photon - Brief description
 *
 * Detailed description of what this photon does.
 * Include common use cases and examples.
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */
```

| Tag | Description | Example |
|-----|-------------|---------|
| `@version` | Semantic version | `@version 1.0.0` |
| `@author` | Author name | `@author Portel` |
| `@license` | License type | `@license MIT` |

### Conditional Tags

| Tag | When to Use | Example |
|-----|-------------|---------|
| `@dependencies` | External npm packages | `@dependencies axios@^1.6.0, cheerio@^1.0.0` |
| `@runtime` | Using newer runtime features (io, elicitation) | `@runtime ^1.4.0` |
| `@tags` | Categorization for discovery | `@tags commerce, payments, api` |
| `@stateful` | Maintains state across calls | `@stateful true` |
| `@idleTimeout` | Custom idle timeout (ms) | `@idleTimeout 600000` |

### Example: Full Header

```typescript
/**
 * Shopping Cart - AI-powered e-commerce assistant
 *
 * Demonstrates the AI+Human transaction workflow:
 * 1. AI suggests products based on query
 * 2. Human reviews and selects items
 * 3. Human confirms purchase
 *
 * Example: search({ query: "wireless headphones" })
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 * @runtime ^1.4.0
 * @dependencies @portel/photon-core@latest
 * @tags commerce, ai-assistant, elicitation
 */
```

---

## 2. Method Naming Conventions

Methods should read like natural English when called via CLI.

### Principles

1. **Avoid redundancy** - Don't repeat the class name in methods
2. **Use concise verbs** - Single words when possible
3. **Standard CRUD** - `create`, `get`, `list`, `update`, `delete`
4. **Singular vs plural** - Singular for one item, plural for collections

### Examples

| Bad | Good | CLI Usage |
|-----|------|-----------|
| `getUsers()` | `users()` | `user-service.users` |
| `getUserById()` | `user()` | `user-service.user` |
| `createUser()` | `create()` | `user-service.create` |
| `deleteUser()` | `delete()` | `user-service.delete` |
| `getCurrentTime()` | `now()` | `time.now` |
| `listTimezones()` | `timezones()` | `time.timezones` |
| `addToCart()` | `add()` | `shop.add` |
| `viewCart()` | `cart()` | `shop.cart` |
| `applyDiscount()` | `discount()` | `shop.discount` |

### Standard Verbs

| Action | Verb | Example |
|--------|------|---------|
| Get single item | `get` or noun | `user()`, `product()` |
| List items | plural noun | `users()`, `products()` |
| Create | `create`, `add`, `new` | `create()`, `add()` |
| Update | `update`, `set` | `update()`, `set()` |
| Delete | `delete`, `remove` | `delete()`, `remove()` |
| Search | `search`, `find` | `search()`, `find()` |
| Execute | `run`, `execute` | `run()`, `execute()` |

---

## 3. Method Documentation

Every public method needs proper JSDoc.

### Required Elements

```typescript
/**
 * Brief description of what the method does
 *
 * @param paramName Description of parameter
 * @format list {@title name, @subtitle description}
 */
async users(params?: { limit?: number }): Promise<User[]>
```

### Parameter Documentation

```typescript
/**
 * Search products in catalog
 *
 * @param query Search query string
 * @param category Filter by category {@example "electronics"}
 * @param limit Max results (default: 10) {@min 1} {@max 100}
 */
async search(params: {
  query: string;
  category?: string;
  limit?: number;
}): Promise<Product[]>
```

### Format Hints

| Format | Use Case |
|--------|----------|
| `@format list` | Array of objects |
| `@format table` | Tabular data |
| `@format card` | Single object |
| `@format json` | Raw JSON |
| `@format markdown` | Markdown content |
| `@format html` | HTML content |
| `@format none` | No rendering (actions) |

### UI Template Linking

```typescript
/**
 * Dashboard main view
 *
 * @icon 📋
 * @ui tasks
 */
async main(): Promise<Task[]>
```

---

## 4. Code Organization

### File Structure

```
my-photon.photon.ts      # Main photon file
my-photon/
  ui/
    tasks.html           # Custom UI templates
    overview.html
  data/
    config.json          # Persistent data
```

### Class Structure

```typescript
export default class MyPhoton {
  // 1. Private fields
  private data: Map<string, any>;

  // 2. Constructor
  constructor(config?: string) { }

  // 3. Lifecycle hooks
  async onInitialize() { }

  // 4. Public methods (alphabetical or grouped by feature)
  async methodA() { }
  async methodB() { }

  // 5. Private helpers (prefixed with _)
  private _helper() { }
}
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Class | PascalCase | `ShoppingCart` |
| Methods | camelCase | `addItem()` |
| Private methods | _prefix | `_validateInput()` |
| Constants | UPPER_SNAKE | `MAX_ITEMS` |
| Interfaces | PascalCase | `CartItem` |

---

## 5. Error Handling

### Throw Descriptive Errors

```typescript
// Good
if (!cart) {
  throw new Error(`Cart not found: ${cartId}`);
}

// Bad
if (!cart) {
  throw new Error('Not found');
}
```

### Validate Input Early

```typescript
async update(params: { id: string; quantity: number }) {
  if (!params.id) {
    throw new Error('Product ID is required');
  }
  if (params.quantity < 0) {
    throw new Error('Quantity must be non-negative');
  }
  // ... proceed with valid input
}
```

---

## 6. Return Value Guidelines

### Consistent Response Structure

```typescript
// For actions that might fail
return {
  success: true,
  message: 'Item added to cart',
  data: { cartId, itemCount }
};

// For queries
return {
  items: [...],
  total: 42,
  page: 1
};
```

### Use Formatted Strings for Display

```typescript
// Good - formatted for display
return {
  price: `$${amount.toFixed(2)}`,
  date: new Date(timestamp).toLocaleDateString()
};

// Bad - raw values
return {
  price: 29.99,
  date: '2024-01-15T10:30:00Z'
};
```

---

## 7. State Management

### Persist Important Data

```typescript
const DATA_FILE = path.join(os.homedir(), '.photon', 'my-photon', 'data.json');

private async load(): Promise<Data> {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return DEFAULT_DATA;
  }
}

private async save(data: Data): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}
```

### Mark Stateful Photons

```typescript
/**
 * @stateful true
 * @idleTimeout 600000
 */
```

---

## 8. Testing Checklist

Before release, verify:

- [ ] All methods have JSDoc with descriptions
- [ ] All parameters are documented
- [ ] Error cases throw descriptive errors
- [ ] Return values are properly formatted
- [ ] State persists correctly (if applicable)
- [ ] No hardcoded paths (use `os.homedir()`)
- [ ] Dependencies are declared in header
- [ ] Version, author, license tags present

---

## 9. Quick Reference

### Minimal Photon Template

```typescript
/**
 * My Photon - Brief description
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

export default class MyPhoton {
  /**
   * Main entry point
   */
  async main(): Promise<string> {
    return 'Hello from MyPhoton!';
  }
}
```

### Full-Featured Template

```typescript
/**
 * My Photon - Comprehensive description
 *
 * Detailed explanation of features:
 * - Feature 1
 * - Feature 2
 *
 * Example: main({ option: "value" })
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 * @runtime ^1.4.0
 * @dependencies @portel/photon-core@latest
 * @tags category1, category2
 */

import { io } from '@portel/photon-core';

interface Item {
  id: string;
  name: string;
}

export default class MyPhoton {
  private items: Item[] = [];

  async onInitialize() {
    // Setup logic
  }

  /**
   * List all items
   * @format list {@title name}
   */
  async items(): Promise<Item[]> {
    return this.items;
  }

  /**
   * Add a new item
   * @param name Item name
   */
  async add(params: { name: string }): Promise<Item> {
    const item = { id: String(Date.now()), name: params.name };
    this.items.push(item);
    return item;
  }
}
```
