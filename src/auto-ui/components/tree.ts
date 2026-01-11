/**
 * Tree Component
 * Renders hierarchical data as a tree structure
 */

import { UIComponent, ComponentProps } from '../types';
import chalk from 'chalk';

export class TreeComponent implements UIComponent {
  supportsFormat(format: 'cli' | 'mcp' | 'web'): boolean {
    return true;
  }

  render(props: ComponentProps): string | object {
    const { data, metadata, context } = props;

    if (context.format === 'cli') {
      return this.renderCLI(data, metadata);
    } else if (context.format === 'mcp') {
      return this.renderMCP(data, metadata);
    } else {
      return this.renderWeb(data, metadata);
    }
  }

  private renderCLI(node: any, metadata: any, prefix: string = '', isLast: boolean = true): string {
    if (!node) return '';

    const lines: string[] = [];
    const connector = isLast ? '└── ' : '├── ';
    const extension = isLast ? '    ' : '│   ';

    const label = node.label || node.name || String(node);
    lines.push(prefix + connector + chalk.cyan(label));

    const children = node.children || [];
    if (Array.isArray(children)) {
      children.forEach((child, index) => {
        const isLastChild = index === children.length - 1;
        lines.push(this.renderCLI(child, metadata, prefix + extension, isLastChild));
      });
    }

    return lines.join('\n');
  }

  private renderMCP(data: any, metadata: any): object {
    return {
      type: 'tree',
      root: data,
      metadata: {
        expandable: metadata.expandable ?? true,
        title: metadata.title
      }
    };
  }

  private renderWeb(data: any, metadata: any): object {
    return {
      component: 'Tree',
      props: {
        data,
        title: metadata.title,
        expandable: metadata.expandable ?? true,
        defaultExpanded: true
      }
    };
  }
}
