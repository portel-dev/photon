/**
 * StartupSequencer — Manages ordered output during Beam startup.
 *
 * Replaces the ad-hoc output buffering (outputQueue, suppressOutput,
 * console monkey-patching) in startBeam() with a clean state machine.
 *
 * States: buffering → url_shown → ready
 *
 * During 'buffering', all console output is queued.
 * At 'url_shown' (TTY only), a status line is shown on stderr.
 * At 'ready', queued output is flushed and console is restored.
 */

export class StartupSequencer {
  private state: 'buffering' | 'url_shown' | 'ready' = 'buffering';
  private queue: string[] = [];
  private url: string | null = null;

  // Saved originals
  private originalLog = console.log;
  private originalWarn = console.warn;
  private originalError = console.error;
  private originalStderrWrite = process.stderr.write.bind(process.stderr);
  private isTTY = process.stderr.isTTY;

  private version: string;
  private workingDir: string;

  constructor(version: string, workingDir: string) {
    this.version = version;
    this.workingDir = workingDir;
    this.intercept();
  }

  /** Replace console methods to queue output during startup. */
  private intercept(): void {
    const queued = (...args: any[]) => {
      if (this.state === 'ready') {
        this.originalLog(...args);
      } else {
        this.queue.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }
    };

    console.log = queued;
    console.warn = queued;
    console.error = queued;

    process.stderr.write = ((chunk: any, ...args: any[]) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      if (this.state !== 'ready' && !str.includes('⚡ Photon Beam')) {
        return true; // Suppress logger output during startup
      }
      return this.originalStderrWrite(chunk, ...args);
    }) as any;
  }

  /** Show the URL status line (called when server starts listening). */
  showUrl(url: string): void {
    this.url = url;
    const status = this.formatStatus();

    if (this.state === 'buffering') {
      if (this.isTTY) {
        this.originalStderrWrite(`\r${status.padEnd(120)}`);
      } else {
        // Non-TTY (CI, subprocess, piped): print immediately so callers
        // can detect that Beam started without waiting for full ready()
        this.originalLog(status);
      }
      this.state = 'url_shown';
    }
  }

  /**
   * Mark startup as complete — flush queued output and restore console.
   * Call this after all photons are loaded.
   */
  ready(): void {
    const status = this.formatStatus();

    if (this.state === 'url_shown') {
      if (this.isTTY) {
        // Was showing inline TTY status — add newline before restoring
        this.originalStderrWrite('\n');
      }
      // Non-TTY: showUrl() already printed the status line, skip
    } else {
      // Never showed URL — print the full status line
      this.originalLog(`\n${status}\n`);
    }

    this.state = 'ready';
    this.restore();
    this.flush();
  }

  /** Restore original console methods. */
  private restore(): void {
    console.log = this.originalLog;
    console.warn = this.originalWarn;
    console.error = this.originalError;
    process.stderr.write = this.originalStderrWrite as any;
  }

  /** Flush all queued messages to stderr. */
  private flush(): void {
    for (const msg of this.queue) {
      this.originalError(msg);
    }
    this.queue = [];
  }

  /** Format the status line. */
  private formatStatus(): string {
    const urlPart = this.url ? ` → ${this.url}` : '';
    return `⚡ Photon Beam v${this.version} (${this.workingDir})${urlPart}`;
  }
}
