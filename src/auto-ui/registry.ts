/**
 * Component Registry
 * Manages available UI components and routes data to appropriate renderers
 */

import { UIComponent, UIHint } from './types';
import { ProgressIndicator } from './components/progress';
import { TableComponent } from './components/table';
import { TreeComponent } from './components/tree';
import { ListComponent } from './components/list';
import { CardComponent } from './components/card';
import { FormComponent } from './components/form';

export class ComponentRegistry {
  private static components = new Map<UIHint, UIComponent>();

  static {
    this.components.set('progress', new ProgressIndicator());
    this.components.set('table', new TableComponent());
    this.components.set('tree', new TreeComponent());
    this.components.set('list', new ListComponent());
    this.components.set('card', new CardComponent());
    this.components.set('form', new FormComponent());
  }

  static get(hint: UIHint): UIComponent | undefined {
    return this.components.get(hint);
  }

  static register(hint: UIHint, component: UIComponent): void {
    this.components.set(hint, component);
  }

  static has(hint: UIHint): boolean {
    return this.components.has(hint);
  }

  static inferHint(data: any): UIHint {
    if (data === null || data === undefined) {
      return 'text';
    }

    if (typeof data === 'string') {
      return 'text';
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return 'text';
    }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return 'list';
      }
      
      if (typeof data[0] === 'object' && data[0] !== null) {
        const hasChildren = data[0].children !== undefined;
        return hasChildren ? 'tree' : 'table';
      }
      
      return 'list';
    }

    if (typeof data === 'object') {
      if (data.children !== undefined) {
        return 'tree';
      }
      
      if (data.type === 'progress') {
        return 'progress';
      }
      
      return 'card';
    }

    return 'json';
  }
}
