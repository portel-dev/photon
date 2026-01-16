/**
 * Progress Indicator Component
 * Supports spinner, percentage, and step-based progress
 */

import { UIComponent, ComponentProps, ProgressState } from '../types';
import ora from 'ora';

export class ProgressIndicator implements UIComponent {
  private spinner?: ora.Ora;
  private lastMessage?: string;

  supportsFormat(format: 'cli' | 'mcp' | 'web'): boolean {
    return true;
  }

  render(props: ComponentProps): string | object {
    const { data, context } = props;
    const progress = data as ProgressState;

    if (context.format === 'cli') {
      return this.renderCLI(progress);
    } else if (context.format === 'mcp') {
      return this.renderMCP(progress);
    } else {
      return this.renderWeb(progress);
    }
  }

  private renderCLI(progress: ProgressState): string {
    if (progress.type === 'spinner') {
      if (!this.spinner) {
        this.spinner = ora({
          text: progress.message || 'Processing...',
          stream: process.stdout,
          hideCursor: true,
        }).start();
      } else if (progress.message !== this.lastMessage) {
        this.spinner.text = progress.message || 'Processing...';
      }
      this.lastMessage = progress.message;
      return '';
    }

    if (
      progress.type === 'percentage' &&
      progress.current !== undefined &&
      progress.total !== undefined
    ) {
      const percent = Math.round((progress.current / progress.total) * 100);
      const bar = this.createProgressBar(percent);
      const message = progress.message || 'Progress';

      if (!this.spinner) {
        this.spinner = ora().start();
      }
      this.spinner.text = `${message} ${bar} ${percent}%`;

      if (percent >= 100) {
        this.spinner.succeed(`${message} Complete`);
        this.spinner = undefined;
      }
      return '';
    }

    if (progress.type === 'steps') {
      const step = progress.step || 0;
      const total = progress.totalSteps || 0;
      const message = progress.message || 'Step';

      if (!this.spinner) {
        this.spinner = ora().start();
      }
      this.spinner.text = `${message} (${step}/${total})`;

      if (step >= total) {
        this.spinner.succeed(`All steps complete`);
        this.spinner = undefined;
      }
      return '';
    }

    return '';
  }

  private renderMCP(progress: ProgressState): object {
    return {
      type: 'progress',
      progressType: progress.type,
      current: progress.current,
      total: progress.total,
      message: progress.message,
      step: progress.step,
      totalSteps: progress.totalSteps,
    };
  }

  private renderWeb(progress: ProgressState): object {
    return {
      component: 'Progress',
      props: {
        type: progress.type,
        value:
          progress.type === 'percentage' && progress.current && progress.total
            ? (progress.current / progress.total) * 100
            : undefined,
        message: progress.message,
        step: progress.step,
        totalSteps: progress.totalSteps,
      },
    };
  }

  private createProgressBar(percent: number, width: number = 20): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }

  complete(message?: string): void {
    if (this.spinner) {
      if (message) {
        this.spinner.succeed(message);
      } else {
        this.spinner.stop();
      }
      this.spinner = undefined;
    }
  }

  fail(message?: string): void {
    if (this.spinner) {
      if (message) {
        this.spinner.fail(message);
      } else {
        this.spinner.stop();
      }
      this.spinner = undefined;
    }
  }
}
