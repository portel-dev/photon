/**
 * Centralized error handling utilities
 * Provides consistent error formatting, user-friendly messages, and structured error types
 */

import { Logger } from './logger.js';

// ══════════════════════════════════════════════════════════════════════════════
// EXIT CODES (following Unix conventions)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Standard CLI exit codes following Unix conventions
 * @see https://tldp.org/LDP/abs/html/exitcodes.html
 */
export const ExitCode = {
  /** Command completed successfully */
  SUCCESS: 0,
  /** General/unspecified error */
  ERROR: 1,
  /** Invalid command-line argument or usage */
  INVALID_ARGUMENT: 2,
  /** Configuration error (missing or invalid config) */
  CONFIG_ERROR: 3,
  /** File or resource not found */
  NOT_FOUND: 4,
  /** Network or connection error */
  NETWORK_ERROR: 5,
  /** Validation error (input validation failed) */
  VALIDATION_ERROR: 6,
  /** Permission denied */
  PERMISSION_DENIED: 13,
  /** Operation was cancelled by user */
  CANCELLED: 130,
} as const;

export type ExitCodeType = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Get appropriate exit code for an error
 */
export function getExitCode(error: unknown): ExitCodeType {
  if (error instanceof ValidationError) {
    return ExitCode.VALIDATION_ERROR;
  }
  if (error instanceof ConfigurationError) {
    return ExitCode.CONFIG_ERROR;
  }
  if (error instanceof NetworkError) {
    return ExitCode.NETWORK_ERROR;
  }
  if (error instanceof FileSystemError) {
    const details = error.details as { code?: string } | undefined;
    if (details?.code === 'ENOENT') {
      return ExitCode.NOT_FOUND;
    }
    if (details?.code === 'EACCES' || details?.code === 'EPERM') {
      return ExitCode.PERMISSION_DENIED;
    }
    return ExitCode.ERROR;
  }
  if (isNodeError(error)) {
    if (error.code === 'ENOENT') return ExitCode.NOT_FOUND;
    if (error.code === 'EACCES' || error.code === 'EPERM') return ExitCode.PERMISSION_DENIED;
  }
  return ExitCode.ERROR;
}

// ══════════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ══════════════════════════════════════════════════════════════════════════════

export class PhotonError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'PhotonError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends PhotonError {
  constructor(message: string, details?: Record<string, unknown>, suggestion?: string) {
    super(message, 'VALIDATION_ERROR', details, suggestion);
    this.name = 'ValidationError';
  }
}

export class FileSystemError extends PhotonError {
  constructor(message: string, details?: Record<string, unknown>, suggestion?: string) {
    super(message, 'FILE_SYSTEM_ERROR', details, suggestion);
    this.name = 'FileSystemError';
  }
}

export class NetworkError extends PhotonError {
  constructor(message: string, details?: Record<string, unknown>, suggestion?: string) {
    super(message, 'NETWORK_ERROR', details, suggestion);
    this.name = 'NetworkError';
  }
}

export class ConfigurationError extends PhotonError {
  constructor(message: string, details?: Record<string, unknown>, suggestion?: string) {
    super(message, 'CONFIGURATION_ERROR', details, suggestion);
    this.name = 'ConfigurationError';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ERROR UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Safe error message extraction
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Unknown error';
}

/**
 * Safe error stack extraction
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error && error.stack) {
    return error.stack;
  }
  return undefined;
}

/**
 * Check if error is a specific type
 */
export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof PhotonError && error.code === code;
}

/**
 * Check if error is a Node.js file system error
 */
export function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  if (!(error instanceof Error)) return false;
  const nodeError = error as NodeJS.ErrnoException;
  if (code) {
    return nodeError.code === code;
  }
  return nodeError.code !== undefined;
}

/**
 * Format error for user display
 */
export function formatErrorMessage(
  error: unknown,
  options?: {
    includeStack?: boolean;
    context?: string;
  }
): string {
  const message = getErrorMessage(error);
  const parts: string[] = [];

  if (options?.context) {
    parts.push(`${options.context}:`);
  }

  parts.push(message);

  if (error instanceof PhotonError && error.suggestion) {
    parts.push(`\nSuggestion: ${error.suggestion}`);
  }

  if (options?.includeStack) {
    const stack = getErrorStack(error);
    if (stack) {
      parts.push(`\nStack trace:\n${stack}`);
    }
  }

  return parts.join(' ');
}

/**
 * Wrap Node.js ENOENT errors with helpful context
 */
export function handleFileNotFound(path: string, context?: string): FileSystemError {
  const message = context ? `File not found: ${path} (${context})` : `File not found: ${path}`;

  return new FileSystemError(
    message,
    { path },
    'Check that the file exists and you have read permissions'
  );
}

/**
 * Wrap Node.js EACCES errors with helpful context
 */
export function handlePermissionDenied(path: string, context?: string): FileSystemError {
  const message = context
    ? `Permission denied: ${path} (${context})`
    : `Permission denied: ${path}`;

  return new FileSystemError(
    message,
    { path },
    'Check file permissions and ensure you have access rights'
  );
}

/**
 * Convert unknown error to PhotonError
 */
export function wrapError(error: unknown, context?: string, suggestion?: string): PhotonError {
  if (error instanceof PhotonError) {
    return error;
  }

  const message = context ? `${context}: ${getErrorMessage(error)}` : getErrorMessage(error);

  // Handle Node.js errors
  if (isNodeError(error)) {
    if (error.code === 'ENOENT' && error.path) {
      return handleFileNotFound(error.path, context);
    }
    if (error.code === 'EACCES' && error.path) {
      return handlePermissionDenied(error.path, context);
    }
    return new FileSystemError(message, { code: error.code, path: error.path }, suggestion);
  }

  return new PhotonError(message, 'UNKNOWN_ERROR', undefined, suggestion);
}

// ══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLER
// ══════════════════════════════════════════════════════════════════════════════

export interface ErrorHandlerOptions {
  logger?: Logger;
  exitOnError?: boolean;
  exitCode?: ExitCodeType;
  showStack?: boolean;
}

/**
 * Centralized error handler
 */
export function handleError(error: unknown, options: ErrorHandlerOptions = {}): never | void {
  const {
    logger,
    exitOnError = false,
    exitCode,
    showStack = process.env.DEBUG === 'true',
  } = options;

  const message = formatErrorMessage(error, {
    includeStack: showStack,
  });

  if (logger) {
    logger.error(message);
    if (showStack && error instanceof Error && error.stack) {
      logger.debug(error.stack);
    }
  } else {
    console.error(`❌ ${message}`);
  }

  if (error instanceof PhotonError && error.details) {
    if (logger) {
      logger.debug('Error details:', error.details);
    } else if (showStack) {
      console.error('Error details:', error.details);
    }
  }

  if (exitOnError) {
    // Use provided exit code, or derive from error type
    const code = exitCode ?? getExitCode(error);
    process.exit(code);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLI ERROR UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Print error to stderr and exit with appropriate code
 * Use this for CLI commands to ensure consistent error handling
 */
export function exitWithError(
  message: string,
  options?: {
    exitCode?: ExitCodeType;
    suggestion?: string;
    searchedIn?: string;
    logger?: Logger;
  }
): never {
  const { exitCode = ExitCode.ERROR, suggestion, searchedIn, logger } = options || {};

  if (logger) {
    logger.error(message);
    if (searchedIn) {
      logger.error(`Searched in: ${searchedIn}`);
    }
    if (suggestion) {
      logger.info(`Tip: ${suggestion}`);
    }
  } else {
    console.error(`✗ ${message}`);
    if (searchedIn) {
      console.error(`  Searched in: ${searchedIn}`);
    }
    if (suggestion) {
      console.error(`  Tip: ${suggestion}`);
    }
  }

  process.exit(exitCode);
}

/**
 * Exit successfully with optional message
 */
export function exitSuccess(message?: string, logger?: Logger): never {
  if (message) {
    if (logger) {
      logger.info(message);
    } else {
      console.error(`✓ ${message}`);
    }
  }
  process.exit(ExitCode.SUCCESS);
}

/**
 * Async error wrapper for cleaner try-catch
 */
export async function tryAsync<T>(
  fn: () => Promise<T>,
  context?: string,
  suggestion?: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw wrapError(error, context, suggestion);
  }
}

/**
 * Sync error wrapper for cleaner try-catch
 */
export function trySync<T>(fn: () => T, context?: string, suggestion?: string): T {
  try {
    return fn();
  } catch (error) {
    throw wrapError(error, context, suggestion);
  }
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    context?: string;
    retryIf?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    context,
    retryIf = () => true,
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if condition not met
      if (!retryIf(error)) {
        throw wrapError(error, context, `Operation failed and is not retryable`);
      }

      // Don't retry on last attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Exponential backoff
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw wrapError(lastError, context, `Operation failed after ${maxAttempts} attempts`);
}

/**
 * Check if an error is retryable (network/transient errors)
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Network errors
  if (
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('timeout') ||
    message.includes('network') ||
    name === 'timeouterror' ||
    name === 'networkerror'
  ) {
    return true;
  }

  // Rate limiting
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return true;
  }

  // Service unavailable
  if (message.includes('503') || message.includes('service unavailable')) {
    return true;
  }

  return false;
}
