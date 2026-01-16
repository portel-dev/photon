import type { Writable } from 'node:stream';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
  component?: string;
  scope?: string;
  destination?: Writable;
  minimal?: boolean;
  sink?: (record: LogRecord) => void;
}

export interface LogMeta {
  [key: string]: unknown;
}

export interface LogRecord extends LogMeta {
  timestamp: string;
  level: LogLevel;
  message: string;
  component?: string;
  scope?: string;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly json: boolean;
  private readonly component?: string;
  private readonly scope?: string;
  private readonly stream: Writable;
  private readonly minimal: boolean;
  private readonly sink?: (record: LogRecord) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.json = Boolean(options.json);
    this.component = options.component;
    this.scope = options.scope;
    this.stream = options.destination ?? process.stderr;
    this.minimal = Boolean(options.minimal);
    this.sink = options.sink;
  }

  child(overrides: LoggerOptions): Logger {
    const sink = overrides.sink ?? this.sink;
    return new Logger({
      level: overrides.level ?? this.level,
      json: overrides.json ?? this.json,
      component: overrides.component ?? this.component,
      scope: overrides.scope ?? this.scope,
      destination: overrides.destination ?? this.stream,
      minimal: overrides.minimal ?? this.minimal,
      sink,
    });
  }

  log(level: LogLevel, message: string, meta?: LogMeta) {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const record: LogRecord = {
      timestamp,
      level,
      message,
      component: this.component,
      scope: this.scope,
    };
    if (meta && Object.keys(meta).length > 0) {
      Object.assign(record, meta);
    }

    if (this.json) {
      this.stream.write(JSON.stringify(record) + '\n');
    } else if (this.minimal) {
      const segments: string[] = [];
      if (this.component || this.scope) {
        const label = [this.component, this.scope].filter(Boolean).join(':');
        if (label) {
          segments.push(`[${label}]`);
        }
      }
      segments.push(message);
      if (meta && Object.keys(meta).length > 0) {
        const metaClone = { ...meta };
        if ('timestamp' in metaClone) delete (metaClone as any).timestamp;
        segments.push(JSON.stringify(metaClone));
      }
      this.stream.write(segments.join(' ') + '\n');
    } else {
      const parts = [timestamp, level.toUpperCase()];
      if (this.component) {
        parts.push(`[${this.component}${this.scope ? `:${this.scope}` : ''}]`);
      } else if (this.scope) {
        parts.push(`[${this.scope}]`);
      }
      parts.push('-', message);

      if (meta && Object.keys(meta).length > 0) {
        parts.push(JSON.stringify(meta));
      }

      this.stream.write(parts.join(' ') + '\n');
    }

    if (this.sink) {
      this.sink({ ...record });
    }
  }

  info(message: string, meta?: LogMeta) {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: LogMeta) {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: LogMeta) {
    this.log('error', message, meta);
  }

  debug(message: string, meta?: LogMeta) {
    this.log('debug', message, meta);
  }

  private shouldLog(level: LogLevel) {
    return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[this.level];
  }
}

export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

export function normalizeLogLevel(input?: string | null): LogLevel {
  if (!input) {
    return 'info';
  }
  const normalized = input.toLowerCase();
  if (
    normalized === 'error' ||
    normalized === 'warn' ||
    normalized === 'info' ||
    normalized === 'debug'
  ) {
    return normalized;
  }
  throw new Error(`Invalid log level: ${input}. Use error | warn | info | debug.`);
}

// Default logger instance for convenience
export const logger = createLogger();
