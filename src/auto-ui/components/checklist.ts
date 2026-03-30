/**
 * Checklist Component
 * Renders {text, done}[] as interactive checkbox list in CLI
 */

import { UIComponent, ComponentProps } from '../types';
import chalk from 'chalk';

export class ChecklistComponent implements UIComponent {
  supportsFormat(format: 'cli' | 'mcp' | 'web'): boolean {
    return true;
  }

  render(props: ComponentProps): string | object {
    const { data, context } = props;
    if (context.format === 'cli') {
      return this.renderCLI(data);
    }
    return { type: 'checklist', items: data };
  }

  private textKey(item: any): string {
    return item.text || item.title || item.name || item.task || item.label || '';
  }

  private isDone(item: any): boolean {
    return !!(item.done || item.completed || item.checked);
  }

  private renderCLI(data: any[]): string {
    if (!Array.isArray(data) || data.length === 0) {
      return chalk.gray('(no items)');
    }

    // Sort: undone first, done last
    const undone = data.filter((i) => !this.isDone(i));
    const done = data.filter((i) => this.isDone(i));
    const sorted = [...undone, ...done];

    const doneCount = done.length;
    const total = data.length;

    const lines: string[] = [];
    lines.push(chalk.dim(`${doneCount}/${total} done`));
    lines.push('');

    for (const item of sorted) {
      const text = this.textKey(item);
      if (this.isDone(item)) {
        lines.push(`  ${chalk.green('✓')} ${chalk.strikethrough.dim(text)}`);
      } else {
        lines.push(`  ${chalk.dim('○')} ${text}`);
      }
    }

    return lines.join('\n');
  }
}
