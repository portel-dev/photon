/**
 * Inline progress renderer for CLI
 * Shows progress bar with animation on a single line
 *
 * Always writes to stderr to avoid interfering with stdout data
 */
export class ProgressRenderer {
  private lastLength = 0;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerIndex = 0;
  private isActive = false;

  /**
   * Render progress inline (overwrites current line)
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
    if (this.lastLength > 0) {
      process.stderr.write('\r' + ' '.repeat(this.lastLength) + '\r');
    }
  }

  /**
   * End progress display (clears the line)
   */
  done(): void {
    if (this.isActive) {
      this.clearLine();
      this.isActive = false;
      this.lastLength = 0;
    }
  }

  /**
   * Print a status message (clears progress first)
   */
  status(message: string): void {
    this.done();
    console.error(`ℹ ${message}`);
  }
}
