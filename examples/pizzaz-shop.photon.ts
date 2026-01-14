/**
 * Pizzaz Shop - AI Pizza Ordering Assistant
 *
 * Demonstrates the AI+Human transaction workflow for food ordering:
 * 1. AI suggests pizzas based on preferences
 * 2. Human selects and customizes items
 * 3. Human reviews cart and confirms order
 * 4. System processes order with delivery info
 *
 * @version 1.0.0
 * @author Photon Team
 * @runtime ^1.4.0
 */

import { io } from '@portel/photon-core';

interface Pizza {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: 'classic' | 'specialty' | 'vegetarian' | 'meat-lovers';
  toppings: string[];
  spicy?: boolean;
  popular?: boolean;
}

interface OrderItem {
  pizza: Pizza;
  size: 'small' | 'medium' | 'large';
  quantity: number;
  extraToppings: string[];
  notes?: string;
}

const SIZE_MULTIPLIERS = {
  small: 0.8,
  medium: 1.0,
  large: 1.3
};

export default class PizzazShop {
  private cart: OrderItem[] = [];

  // Pizza menu
  private menu: Pizza[] = [
    {
      id: 'margherita',
      name: 'Margherita',
      description: 'Fresh mozzarella, tomato sauce, basil',
      price: 12.99,
      image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=200',
      category: 'classic',
      toppings: ['mozzarella', 'tomato sauce', 'basil'],
      popular: true
    },
    {
      id: 'pepperoni',
      name: 'Pepperoni',
      description: 'Classic pepperoni with mozzarella',
      price: 14.99,
      image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=200',
      category: 'meat-lovers',
      toppings: ['pepperoni', 'mozzarella', 'tomato sauce'],
      popular: true
    },
    {
      id: 'bbq-chicken',
      name: 'BBQ Chicken',
      description: 'Grilled chicken, BBQ sauce, red onion, cilantro',
      price: 16.99,
      image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200',
      category: 'specialty',
      toppings: ['chicken', 'bbq sauce', 'red onion', 'cilantro', 'mozzarella']
    },
    {
      id: 'meat-supreme',
      name: 'Meat Supreme',
      description: 'Pepperoni, sausage, bacon, ham, beef',
      price: 18.99,
      image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=200',
      category: 'meat-lovers',
      toppings: ['pepperoni', 'sausage', 'bacon', 'ham', 'beef', 'mozzarella']
    },
    {
      id: 'veggie-garden',
      name: 'Veggie Garden',
      description: 'Bell peppers, mushrooms, olives, onions, tomatoes',
      price: 14.99,
      image: 'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?w=200',
      category: 'vegetarian',
      toppings: ['bell peppers', 'mushrooms', 'olives', 'onions', 'tomatoes', 'mozzarella']
    },
    {
      id: 'quattro-formaggi',
      name: 'Quattro Formaggi',
      description: 'Four cheese: mozzarella, gorgonzola, parmesan, ricotta',
      price: 15.99,
      image: 'https://images.unsplash.com/photo-1548369937-47519962c11a?w=200',
      category: 'vegetarian',
      toppings: ['mozzarella', 'gorgonzola', 'parmesan', 'ricotta']
    },
    {
      id: 'hawaiian',
      name: 'Hawaiian',
      description: 'Ham, pineapple, mozzarella',
      price: 14.99,
      image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200',
      category: 'classic',
      toppings: ['ham', 'pineapple', 'mozzarella', 'tomato sauce']
    },
    {
      id: 'diavola',
      name: 'Diavola',
      description: 'Spicy salami, chili flakes, jalapeños',
      price: 15.99,
      image: 'https://images.unsplash.com/photo-1458642849426-cfb724f15ef7?w=200',
      category: 'specialty',
      toppings: ['spicy salami', 'chili flakes', 'jalapeños', 'mozzarella'],
      spicy: true
    }
  ];

  // Extra toppings available
  private extraToppings = [
    { id: 'extra-cheese', name: 'Extra Cheese', price: 2.00 },
    { id: 'pepperoni', name: 'Pepperoni', price: 1.50 },
    { id: 'mushrooms', name: 'Mushrooms', price: 1.00 },
    { id: 'olives', name: 'Olives', price: 1.00 },
    { id: 'onions', name: 'Onions', price: 0.75 },
    { id: 'bell-peppers', name: 'Bell Peppers', price: 1.00 },
    { id: 'jalapenos', name: 'Jalapeños', price: 0.75 },
    { id: 'bacon', name: 'Bacon', price: 2.00 },
    { id: 'anchovies', name: 'Anchovies', price: 1.50 }
  ];

  /**
   * Browse the pizza menu
   *
   * Filter by category and select pizzas to add to cart.
   */
  async *browseMenu() {
    yield io.emit.status('Loading menu...');

    // Get unique categories for filter buttons
    const categories = ['All', 'Classic', 'Specialty', 'Vegetarian', 'Meat Lovers'];

    // Present menu with filters and search
    const selected: string[] = yield io.ask.select(
      '🍕 Welcome to Pizzaz! Select pizzas to add to your order:',
      this.menu.map(pizza => ({
        value: pizza.id,
        label: pizza.name,
        description: pizza.description,
        image: pizza.image,
        price: pizza.price,
        badge: pizza.popular ? 'Popular' : pizza.spicy ? '🌶️ Spicy' : undefined,
        badgeType: pizza.popular ? 'info' as const : pizza.spicy ? 'error' as const : 'default' as const,
        category: pizza.category.replace('-', ' ')
      })),
      {
        multi: true,
        layout: 'list',
        filters: categories,
        filterField: 'category',
        searchable: true,
        searchPlaceholder: 'Search pizzas...'
      }
    );

    if (!selected || selected.length === 0) {
      return { message: 'No pizzas selected. Browse our menu anytime!' };
    }

    // For each selected pizza, ask for customization
    for (const pizzaId of selected) {
      const pizza = this.menu.find(p => p.id === pizzaId);
      if (!pizza) continue;

      yield io.emit.status(`Customizing ${pizza.name}...`);

      // Ask for size
      const size: string = yield io.ask.select(
        `Choose size for ${pizza.name}:`,
        [
          { value: 'small', label: 'Small (10")', description: `$${(pizza.price * 0.8).toFixed(2)}` },
          { value: 'medium', label: 'Medium (12")', description: `$${pizza.price.toFixed(2)}` },
          { value: 'large', label: 'Large (14")', description: `$${(pizza.price * 1.3).toFixed(2)}` }
        ],
        { layout: 'list' }
      );

      // Ask for extra toppings
      const extras: string[] = yield io.ask.select(
        `Add extra toppings to ${pizza.name}? (+$0.75-$2.00 each)`,
        this.extraToppings.map(t => ({
          value: t.id,
          label: t.name,
          description: `+$${t.price.toFixed(2)}`
        })),
        { multi: true, layout: 'list' }
      );

      // Add to cart
      this.cart.push({
        pizza,
        size: size as 'small' | 'medium' | 'large',
        quantity: 1,
        extraToppings: extras || []
      });
    }

    yield io.emit.toast(`Added ${selected.length} pizza(s) to cart!`, 'success');

    return {
      added: selected.length,
      cartItems: this.cart.length,
      cartTotal: this.calculateTotal()
    };
  }

  /**
   * Get AI pizza recommendations
   *
   * Tell us your preferences and we'll suggest the perfect pizzas!
   *
   * @param preferences What kind of pizza are you in the mood for?
   */
  async *recommend(params: { preferences: string }) {
    yield io.emit.status('Analyzing your preferences...');
    yield io.emit.thinking(true);

    // Simple keyword matching for demo (real app would use LLM)
    const prefs = params.preferences.toLowerCase();
    let recommendations: Pizza[] = [];

    if (prefs.includes('meat') || prefs.includes('protein')) {
      recommendations = this.menu.filter(p => p.category === 'meat-lovers');
    } else if (prefs.includes('veggie') || prefs.includes('vegetarian') || prefs.includes('healthy')) {
      recommendations = this.menu.filter(p => p.category === 'vegetarian');
    } else if (prefs.includes('spicy') || prefs.includes('hot')) {
      recommendations = this.menu.filter(p => p.spicy);
    } else if (prefs.includes('classic') || prefs.includes('simple') || prefs.includes('traditional')) {
      recommendations = this.menu.filter(p => p.category === 'classic');
    } else if (prefs.includes('popular') || prefs.includes('best')) {
      recommendations = this.menu.filter(p => p.popular);
    } else {
      // Default to popular items
      recommendations = this.menu.filter(p => p.popular || p.category === 'specialty');
    }

    yield io.emit.thinking(false);

    if (recommendations.length === 0) {
      recommendations = this.menu.slice(0, 3);
    }

    yield io.emit.status(`Found ${recommendations.length} recommendations!`);

    // Present recommendations
    const selected: string[] = yield io.ask.select(
      `Based on "${params.preferences}", here are my top picks:`,
      recommendations.map(pizza => ({
        value: pizza.id,
        label: pizza.name,
        description: pizza.description,
        image: pizza.image,
        price: pizza.price,
        badge: pizza.popular ? '⭐ Recommended' : undefined,
        badgeType: 'success' as const,
        category: pizza.category
      })),
      { multi: true, layout: 'list' }
    );

    if (!selected || selected.length === 0) {
      return { message: 'No pizzas selected. Try browsing the full menu!' };
    }

    // Quick add with medium size (skip customization for speed)
    for (const pizzaId of selected) {
      const pizza = this.menu.find(p => p.id === pizzaId);
      if (pizza) {
        this.cart.push({
          pizza,
          size: 'medium',
          quantity: 1,
          extraToppings: []
        });
      }
    }

    yield io.emit.toast(`Added ${selected.length} recommended pizza(s)!`, 'success');

    return {
      added: selected.length,
      cartTotal: this.calculateTotal()
    };
  }

  /**
   * View and modify your cart
   *
   * Adjust quantities, remove items, or proceed to checkout.
   */
  async *viewCart() {
    if (this.cart.length === 0) {
      yield io.emit.toast('Your cart is empty!', 'info');
      return { items: [], total: 0, message: 'Add some pizzas first!' };
    }

    const total = this.calculateTotal();

    // Show cart with adjustable quantities
    const result: any = yield io.ask.select(
      `🛒 Your Cart ($${total.toFixed(2)}). Adjust quantities or uncheck to remove:`,
      this.cart.map((item, idx) => ({
        value: `${idx}`,
        label: `${item.pizza.name} (${item.size})`,
        description: item.extraToppings.length > 0
          ? `+${item.extraToppings.join(', ')}`
          : item.pizza.toppings.slice(0, 3).join(', '),
        image: item.pizza.image,
        price: this.calculateItemPrice(item),
        quantity: item.quantity,
        adjustable: true,
        minQuantity: 0,
        maxQuantity: 5,
        selected: true
      })),
      { multi: true, layout: 'list' }
    );

    // Handle result with quantities
    const keepIndices = Array.isArray(result) ? result : (result?.value || []);
    const quantities = result?.quantities || {};

    // Update cart
    this.cart = this.cart
      .map((item, idx) => {
        if (quantities[`${idx}`] !== undefined) {
          item.quantity = quantities[`${idx}`];
        }
        return item;
      })
      .filter((item, idx) => keepIndices.includes(`${idx}`) && item.quantity > 0);

    const newTotal = this.calculateTotal();

    return {
      items: this.cart.map(i => ({
        name: i.pizza.name,
        size: i.size,
        qty: i.quantity,
        subtotal: this.calculateItemPrice(i)
      })),
      total: newTotal
    };
  }

  /**
   * Complete your order
   *
   * Review cart, enter delivery info, and place your order!
   */
  async *checkout() {
    if (this.cart.length === 0) {
      yield io.emit.toast('Your cart is empty!', 'warning');
      return { success: false, message: 'Add pizzas to your cart first!' };
    }

    const subtotal = this.calculateTotal();
    const deliveryFee = 3.99;
    const tax = subtotal * 0.08;
    const total = subtotal + deliveryFee + tax;

    // Show order summary and confirm
    const confirmed: boolean = yield io.ask.confirm(
      `📦 Order Summary\n\n` +
      this.cart.map(i => `• ${i.pizza.name} (${i.size}) ×${i.quantity}`).join('\n') +
      `\n\nSubtotal: $${subtotal.toFixed(2)}\n` +
      `Delivery: $${deliveryFee.toFixed(2)}\n` +
      `Tax: $${tax.toFixed(2)}\n` +
      `━━━━━━━━━━━━━━\n` +
      `Total: $${total.toFixed(2)}\n\n` +
      `Proceed to delivery info?`
    );

    if (!confirmed) {
      yield io.emit.toast('Checkout cancelled', 'info');
      return { success: false, message: 'Checkout cancelled' };
    }

    // Collect delivery info
    yield io.emit.status('Enter delivery information...');

    const delivery = yield io.ask.form('🚗 Delivery Details', {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Your Name' },
        phone: { type: 'string', title: 'Phone Number' },
        address: { type: 'string', title: 'Street Address' },
        apt: { type: 'string', title: 'Apt/Suite (optional)' },
        city: { type: 'string', title: 'City' },
        zip: { type: 'string', title: 'ZIP Code' },
        instructions: { type: 'string', title: 'Delivery Instructions (optional)' }
      },
      required: ['name', 'phone', 'address', 'city', 'zip']
    });

    // Process order
    yield io.emit.progress(0.2, 'Validating order...');
    await this.delay(500);

    yield io.emit.progress(0.5, 'Processing payment...');
    await this.delay(800);

    yield io.emit.progress(0.8, 'Sending to kitchen...');
    await this.delay(600);

    yield io.emit.progress(1.0, 'Order confirmed!');

    // Generate order number
    const orderNumber = `PZZ-${Date.now().toString(36).toUpperCase()}`;

    // Estimate delivery time (30-45 min)
    const eta = new Date(Date.now() + 35 * 60 * 1000);
    const etaStr = eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Clear cart
    const orderedItems = [...this.cart];
    this.cart = [];

    yield io.emit.toast('🎉 Order placed successfully!', 'success');

    return {
      success: true,
      orderNumber,
      estimatedDelivery: etaStr,
      items: orderedItems.map(i => ({
        name: i.pizza.name,
        size: i.size,
        qty: i.quantity
      })),
      total: total.toFixed(2),
      deliveryAddress: `${delivery.address}, ${delivery.city}`
    };
  }

  /**
   * Get cart status
   * @autorun
   */
  async cartStatus() {
    const itemCount = this.cart.reduce((sum, i) => sum + i.quantity, 0);
    const total = this.calculateTotal();

    return {
      items: itemCount,
      total: `$${total.toFixed(2)}`,
      pizzas: this.cart.map(i => `${i.pizza.name} ×${i.quantity}`)
    };
  }

  // Helper methods
  private calculateItemPrice(item: OrderItem): number {
    const basePrice = item.pizza.price * SIZE_MULTIPLIERS[item.size];
    const toppingsCost = item.extraToppings.reduce((sum, tId) => {
      const topping = this.extraToppings.find(t => t.id === tId);
      return sum + (topping?.price || 0);
    }, 0);
    return (basePrice + toppingsCost) * item.quantity;
  }

  private calculateTotal(): number {
    return this.cart.reduce((sum, item) => sum + this.calculateItemPrice(item), 0);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
