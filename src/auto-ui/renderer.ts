/**
 * Auto-UI Renderer
 * Main orchestrator for automatic UI generation
 */

import { ComponentRegistry } from './registry';
import { UIMetadata, RenderContext, UIHint, ComponentProps } from './types';
import chalk from 'chalk';

export class AutoUIRenderer {
  private context: RenderContext;

  constructor(context: RenderContext) {
    this.context = context;
  }

  render(data: any, metadata: UIMetadata = {}): string | object {
    const hint = metadata.hint || ComponentRegistry.inferHint(data);
    const component = ComponentRegistry.get(hint);

    if (!component) {
      return this.fallbackRender(data, metadata);
    }

    if (!component.supportsFormat(this.context.format)) {
      return this.fallbackRender(data, metadata);
    }

    const props: ComponentProps = {
      data,
      metadata,
      context: this.context
    };

    try {
      return component.render(props);
    } catch (error) {
      console.error(`Error rendering component ${hint}:`, error);
      return this.fallbackRender(data, metadata);
    }
  }

  private fallbackRender(data: any, metadata: UIMetadata): string | object {
    if (this.context.format === 'cli') {
      if (metadata.title) {
        console.log(chalk.bold(metadata.title));
        console.log('');
      }
      
      if (typeof data === 'string') {
        return data;
      }
      
      return JSON.stringify(data, null, 2);
    }

    if (this.context.format === 'mcp') {
      return {
        type: 'raw',
        data,
        metadata
      };
    }

    return {
      component: 'Raw',
      props: {
        data,
        ...metadata
      }
    };
  }

  static extractMetadataFromDocblock(docblock: string): UIMetadata {
    const metadata: UIMetadata = {};

    const hintMatch = docblock.match(/@ui-hint\s+(\w+)/);
    if (hintMatch) {
      metadata.hint = hintMatch[1] as UIHint;
    }

    const titleMatch = docblock.match(/@ui-title\s+(.+)/);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim();
    }

    const descMatch = docblock.match(/@ui-description\s+(.+)/);
    if (descMatch) {
      metadata.description = descMatch[1].trim();
    }

    const columnsMatch = docblock.match(/@ui-columns\s+(.+)/);
    if (columnsMatch) {
      metadata.columns = columnsMatch[1].split(',').map(c => c.trim());
    }

    metadata.sortable = /@ui-sortable/.test(docblock);
    metadata.filterable = /@ui-filterable/.test(docblock);
    metadata.paginated = /@ui-paginated/.test(docblock);
    metadata.expandable = /@ui-expandable/.test(docblock);

    return metadata;
  }

  setContext(context: Partial<RenderContext>): void {
    this.context = { ...this.context, ...context };
  }
}
