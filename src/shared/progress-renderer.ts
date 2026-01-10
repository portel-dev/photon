/**
 * Inline progress renderer for CLI
 * Shows progress bar or spinner on a single line that disappears when complete
 *
 * Always writes to stderr to avoid interfering with stdout data
 */
export class ProgressRenderer {
  private lastLength = 0;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerIndex = 0;
  private isActive = false;
  private spinnerInterval?: NodeJS.Timeout;

  /**
   * Show a spinner with a message (for indeterminate progress)
   * The message updates in place and disappears when done
   */
  showSpinner(message: string): void {
    // Clear previous content if active
    if (this.isActive) {
      this.clearLine();
    }
    this.isActive = true;
    this.updateSpinner(message);
  }

  /**
   * Update the spinner message (reuses current spinner frame)
   */
  private updateSpinner(message: string): void {
    if (!this.isActive) return;
    
    const spinner = this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length];
    const text = `${spinner} ${message}`;
    
    this.clearLine();
    process.stderr.write(text);
    this.lastLength = text.length;
    this.spinnerIndex++;
  }

  /**
   * Start auto-animating spinner (updates every 80ms)
   */
  startSpinner(message: string): void {
    this.stopSpinner();
    this.isActive = true;
    this.spinnerInterval = setInterval(() => {
      this.updateSpinner(message);
    }, 80);
  }

  /**
   * Stop auto-animating spinner
   */
  stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
  }

  /**
   * Render progress bar with percentage (for determinate progress)
   */
  render(value: number, message?: string): void {
    this.isActive = true;
    const pct = Math.round(value * 100);
    const barWidth = 20;
    const filled = Math.round(value * barWidth);
    const empty = barWidth - filled;

    // Progress bar: [████████░░░░░░░░░░░░]
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const spinner = pct < 100 ? this.spinnerFrames[this.spinnerIndex++ % this.spinnerFrames.length] : '✓';

    const text = `${spinner} [${bar}] ${pct.toString().padStart(3)}%${message ? ` ${message}` : ''}`;

    // Clear previous line and write new content
    this.clearLine();
    process.stderr.write(text);
    this.lastLength = text.length;
  }

  /**
   * Clear the progress line
   */
  clearLine(): void {
    if (this.lastLength > 0 || this.isActive) {
      // Use ANSI escape: CR (carriage return) + clear to end of line
      process.stderr.write('\r\x1b[K');
      this.lastLength = 0;
    }
  }

  /**
   * End progress display (clears the line completely)
   */
  done(): void {
    this.stopSpinner();
    if (this.isActive) {
      this.clearLine();
      this.isActive = false;
      this.lastLength = 0;
    }
  }

  /**
   * Print a persistent status message (clears progress first, then prints)
   */
  status(message: string): void {
    this.done();
    console.error(`ℹ ${message}`);
  }

  /**
   * Check if progress is currently being shown
   */
  get active(): boolean {
    return this.isActive;
  }
}
