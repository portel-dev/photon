/**
 * Centralized error handling utilities
 * Provides consistent error formatting, user-friendly messages, and structured error types
 */

import { Logger } from './logger.js';

// ══════════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ══════════════════════════════════════════════════════════════════════════════

export class PhotonError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, any>,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'PhotonError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends PhotonError {
  constructor(message: string, details?: Record<string, any>, suggestion?: string) {
    super(message, 'VALIDATION_ERROR', details, suggestion);
    this.name = 'ValidationError';
  }
}

export class FileSystemError extends PhotonError {
  constructor(message: string, details?: Record<string, any>, suggestion?: string) {
    super(message, 'FILE_SYSTEM_ERROR', details, suggestion);
    this.name = 'FileSystemError';
  }
}

export class NetworkError extends PhotonError {
  constructor(message: string, details?: Record<string, any>, suggestion?: string) {
    super(message, 'NETWORK_ERROR', details, suggestion);
    this.name = 'NetworkError';
  }
}

export class ConfigurationError extends PhotonError {
  constructor(message: string, details?: Record<string, any>, suggestion?: string) {
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
export function formatErrorMessage(error: unknown, options?: {
  includeStack?: boolean;
  context?: string;
}): string {
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
  const message = context
    ? `File not found: ${path} (${context})`
    : `File not found: ${path}`;
  
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

  const message = context
    ? `${context}: ${getErrorMessage(error)}`
    : getErrorMessage(error);

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
  showStack?: boolean;
}

/**
 * Centralized error handler
 */
export function handleError(error: unknown, options: ErrorHandlerOptions = {}): never | void {
  const {
    logger,
    exitOnError = false,
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
    process.exit(1);
  }
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
export function trySync<T>(
  fn: () => T,
  context?: string,
  suggestion?: string
): T {
  try {
    return fn();
  } catch (error) {
    throw wrapError(error, context, suggestion);
  }
}
