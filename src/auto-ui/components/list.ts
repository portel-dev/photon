/**
 * List Component
 * Renders lists with various formatting options
 */

import { UIComponent, ComponentProps } from '../types';
import chalk from 'chalk';

export class ListComponent implements UIComponent {
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

  private renderCLI(data: any[], metadata: any): string {
    if (!Array.isArray(data) || data.length === 0) {
      return chalk.gray('(empty list)');
    }

    const lines = data.map((item, index) => {
      const bullet = metadata.numbered ? `${index + 1}.` : '•';
      const content = typeof item === 'object' ? JSON.stringify(item) : String(item);
      return `${chalk.dim(bullet)} ${content}`;
    });

    if (metadata.title) {
      lines.unshift(chalk.bold(metadata.title));
      lines.unshift('');
    }

    return lines.join('\n');
  }

  private renderMCP(data: any[], metadata: any): object {
    return {
      type: 'list',
      items: data,
      metadata: {
        ordered: metadata.numbered ?? false,
        title: metadata.title,
      },
    };
  }

  private renderWeb(data: any[], metadata: any): object {
    return {
      component: 'List',
      props: {
        items: data,
        title: metadata.title,
        ordered: metadata.numbered ?? false,
      },
    };
  }
}
