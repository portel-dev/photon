/**
 * Card Component
 * Renders data as cards with key-value pairs
 */

import { UIComponent, ComponentProps } from '../types';
import chalk from 'chalk';
import boxen from 'boxen';

export class CardComponent implements UIComponent {
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

  private renderCLI(data: any, metadata: any): string {
    if (typeof data !== 'object' || data === null) {
      return String(data);
    }

    const lines: string[] = [];
    
    if (metadata.title) {
      lines.push(chalk.bold(metadata.title));
      lines.push('');
    }

    Object.entries(data).forEach(([key, value]) => {
      const formattedKey = chalk.cyan(key + ':');
      const formattedValue = typeof value === 'object' 
        ? JSON.stringify(value, null, 2) 
        : String(value);
      lines.push(`${formattedKey} ${formattedValue}`);
    });

    return boxen(lines.join('\n'), {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'gray'
    });
  }

  private renderMCP(data: any, metadata: any): object {
    return {
      type: 'card',
      data,
      metadata: {
        title: metadata.title,
        description: metadata.description
      }
    };
  }

  private renderWeb(data: any, metadata: any): object {
    return {
      component: 'Card',
      props: {
        data,
        title: metadata.title,
        description: metadata.description
      }
    };
  }
}
