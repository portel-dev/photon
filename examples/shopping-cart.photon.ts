/**
 * AI Shopping Assistant
 *
 * Demonstrates the AI+Human transaction workflow for e-commerce:
 * 1. AI suggests products based on query
 * 2. Human reviews and selects items
 * 3. Human confirms purchase
 * 4. System processes order
 *
 * @version 1.0.0
 * @author Photon Team
 * @runtime ^1.4.0
 */

import { io } from '@portel/photon-core';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  image: string;
  category: string;
  stock: number;
  badge?: string;
}

interface CartItem extends Product {
  quantity: number;
}

export default class ShoppingCart {
  private cart: CartItem[] = [];

  // Mock product database
  private products: Product[] = [
    {
      id: 'prod-1',
      name: 'Wireless Bluetooth Headphones',
      description: 'Premium noise-cancelling with 30hr battery',
      price: 79.99,
      originalPrice: 129.99,
      image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200',
      category: 'electronics',
      stock: 15,
      badge: 'Sale'
    },
    {
      id: 'prod-2',
      name: 'Mechanical Gaming Keyboard',
      description: 'RGB backlit with Cherry MX switches',
      price: 149.99,
      image: 'https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?w=200',
      category: 'electronics',
      stock: 8
    },
    {
      id: 'prod-3',
      name: 'Ergonomic Office Chair',
      description: 'Lumbar support with breathable mesh',
      price: 299.99,
      image: 'https://images.unsplash.com/photo-1592078615290-033ee584e267?w=200',
      category: 'furniture',
      stock: 3,
      badge: 'Low Stock'
    },
    {
      id: 'prod-4',
      name: 'USB-C Hub 7-in-1',
      description: 'HDMI, USB 3.0, SD card reader',
      price: 49.99,
      image: 'https://images.unsplash.com/photo-1625723044792-44de16fb4e68?w=200',
      category: 'electronics',
      stock: 25,
      badge: 'Bestseller'
    },
    {
      id: 'prod-5',
      name: 'Desk LED Light Bar',
      description: 'Monitor light with adjustable color temp',
      price: 39.99,
      originalPrice: 59.99,
      image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200',
      category: 'accessories',
      stock: 0,
      badge: 'Out of Stock'
    },
    {
      id: 'prod-6',
      name: 'Portable SSD 1TB',
      description: 'USB 3.2 with 1050MB/s transfer',
      price: 119.99,
      image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=200',
      category: 'electronics',
      stock: 12
    }
  ];

  /**
   * AI-powered product search and selection
   *
   * The AI suggests relevant products, human reviews and selects.
   *
   * @param query Natural language search query
   */
  async *search(params: { query: string }) {
    yield io.emit.status('Searching products...');

    // Simulate AI search (in real app, this would use embeddings/LLM)
    const query = params.query.toLowerCase();
    const matches = this.products.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      p.category.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
      yield io.emit.toast('No products found', 'warning');
      return { found: 0, message: 'No products match your search' };
    }

    yield io.emit.status(`Found ${matches.length} products`);

    // Get unique categories for filters
    const uniqueCategories = Array.from(new Set(matches.map(p => p.category.charAt(0).toUpperCase() + p.category.slice(1))));
    const categories = ['All', ...uniqueCategories];

    // Present products for selection with rich UI, filters, and search
    const selected: string[] = yield io.ask.select(
      `AI found ${matches.length} products for "${params.query}". Select items to add to cart:`,
      matches.map(p => ({
        value: p.id,
        label: p.name,
        description: p.description,
        image: p.image,
        price: p.price,
        originalPrice: p.originalPrice,
        badge: p.badge,
        badgeType: p.badge === 'Sale' ? 'success' as const :
                   p.badge === 'Low Stock' ? 'warning' as const :
                   p.badge === 'Out of Stock' ? 'error' as const :
                   p.badge === 'Bestseller' ? 'info' as const : 'default' as const,
        category: p.category,
        disabled: p.stock === 0,
        disabledReason: p.stock === 0 ? 'Currently out of stock' : undefined
      })),
      {
        multi: true,
        layout: 'list',
        filters: categories,
        filterField: 'category',
        searchable: true,
        searchPlaceholder: 'Search products...'
      }
    );

    if (!selected || selected.length === 0) {
      return { added: 0, message: 'No items selected' };
    }

    // Add selected items to cart
    for (const productId of selected) {
      const product = this.products.find(p => p.id === productId);
      if (product) {
        const existing = this.cart.find(c => c.id === productId);
        if (existing) {
          existing.quantity++;
        } else {
          this.cart.push({ ...product, quantity: 1 });
        }
      }
    }

    yield io.emit.toast(`Added ${selected.length} items to cart`, 'success');

    return {
      added: selected.length,
      cartTotal: this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
      cartItems: this.cart.length
    };
  }

  /**
   * View and manage shopping cart
   *
   * Review cart items, adjust quantities, or remove items.
   */
  async *viewCart() {
    if (this.cart.length === 0) {
      yield io.emit.toast('Your cart is empty', 'info');
      return { items: [], total: 0 };
    }

    const total = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Show cart items with adjustable quantities (+/- buttons)
    const result: any = yield io.ask.select(
      `Your cart (${this.cart.length} items, $${total.toFixed(2)}). Adjust quantities or uncheck to remove:`,
      this.cart.map(item => ({
        value: item.id,
        label: item.name,
        image: item.image,
        price: item.price,
        quantity: item.quantity,
        adjustable: true,
        minQuantity: 0,  // 0 allows removal via quantity control
        maxQuantity: 10,
        selected: true,
        meta: { unitPrice: item.price }
      })),
      { multi: true, layout: 'list' }
    );

    // Handle result - may include quantities from adjustments
    const keepItems = Array.isArray(result) ? result : (result?.value || []);
    const quantities = result?.quantities || {};

    // Update cart with new quantities and remove unchecked/zeroed items
    this.cart = this.cart
      .filter(item => keepItems.includes(item.id))
      .map(item => {
        if (quantities[item.id] !== undefined) {
          item.quantity = quantities[item.id];
        }
        return item;
      })
      .filter(item => item.quantity > 0);

    const newTotal = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return {
      items: this.cart.map(i => ({ name: i.name, qty: i.quantity, subtotal: i.price * i.quantity })),
      total: newTotal
    };
  }

  /**
   * Complete the checkout process
   *
   * Review final cart and confirm purchase.
   */
  async *checkout() {
    if (this.cart.length === 0) {
      yield io.emit.toast('Your cart is empty', 'warning');
      return { success: false, message: 'Add items to cart first' };
    }

    const total = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const tax = total * 0.08;
    const grandTotal = total + tax;

    // Final review
    yield io.emit.status('Preparing checkout...');

    // Show order summary
    const confirmed: boolean = yield io.ask.confirm(
      `Complete purchase?\n\nSubtotal: $${total.toFixed(2)}\nTax (8%): $${tax.toFixed(2)}\n─────────\nTotal: $${grandTotal.toFixed(2)}`,
      { dangerous: false }
    );

    if (!confirmed) {
      yield io.emit.toast('Checkout cancelled', 'info');
      return { success: false, message: 'Checkout cancelled by user' };
    }

    // Collect shipping info
    yield io.emit.status('Collecting shipping information...');

    const shipping = yield io.ask.form('Enter shipping details:', {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Full Name' },
        address: { type: 'string', title: 'Street Address' },
        city: { type: 'string', title: 'City' },
        zip: { type: 'string', title: 'ZIP Code' },
        email: { type: 'string', format: 'email', title: 'Email' }
      },
      required: ['name', 'address', 'city', 'zip', 'email']
    });

    // Process order
    yield io.emit.progress(0.3, 'Processing payment...');
    await this.delay(1000);

    yield io.emit.progress(0.6, 'Confirming order...');
    await this.delay(800);

    yield io.emit.progress(1.0, 'Order complete!');

    // Generate order number
    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;

    // Clear cart
    const orderedItems = [...this.cart];
    this.cart = [];

    yield io.emit.toast('Order placed successfully!', 'success');

    return {
      success: true,
      orderNumber,
      items: orderedItems.map(i => ({ name: i.name, qty: i.quantity })),
      total: grandTotal,
      shipping: { name: shipping.name, city: shipping.city }
    };
  }

  /**
   * Get current cart status
   * @autorun
   */
  async cartStatus() {
    const itemCount = this.cart.reduce((sum, item) => sum + item.quantity, 0);
    const total = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return {
      items: itemCount,
      total: `$${total.toFixed(2)}`,
      products: this.cart.map(i => `${i.name} ×${i.quantity}`)
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
