/**
 * Centralized error handling utilities
 */

import { Logger } from './logger.js';
import { PhotonError, ValidationError } from '@portel/photon-core';

// Re-export base error classes from photon-core
export { PhotonError, ValidationError };

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

type ExitCodeType = (typeof ExitCode)[keyof typeof ExitCode];

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
 * Convert unknown error to PhotonError
 */
export function wrapError(error: unknown, context?: string, suggestion?: string): PhotonError {
  if (error instanceof PhotonError) {
    return error;
  }

  const message = context ? `${context}: ${getErrorMessage(error)}` : getErrorMessage(error);

  // Preserve root cause per ECMAScript `Error` cause proposal — enables OTel
  // recordException to capture the original stack trace.
  const withCause = (err: PhotonError): PhotonError => {
    if (error instanceof Error) (err as Error & { cause?: unknown }).cause = error;
    return err;
  };

  // Handle Node.js errors with helpful context
  if (isNodeError(error)) {
    if (error.code === 'ENOENT' && error.path) {
      return withCause(
        new PhotonError(
          `File not found: ${error.path}${context ? ` (${context})` : ''}`,
          'FILE_SYSTEM_ERROR',
          { path: error.path },
          'Check that the file exists and you have read permissions'
        )
      );
    }
    if (error.code === 'EACCES' && error.path) {
      return withCause(
        new PhotonError(
          `Permission denied: ${error.path}${context ? ` (${context})` : ''}`,
          'FILE_SYSTEM_ERROR',
          { path: error.path },
          'Check file permissions and ensure you have access rights'
        )
      );
    }
    return withCause(
      new PhotonError(
        message,
        'FILE_SYSTEM_ERROR',
        { code: error.code, path: error.path },
        suggestion
      )
    );
  }

  return withCause(new PhotonError(message, 'UNKNOWN_ERROR', undefined, suggestion));
}

// ══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Centralized error handler for CLI commands
 */
export function handleError(
  error: unknown,
  options: {
    logger?: Logger;
    exitOnError?: boolean;
    exitCode?: ExitCodeType;
    showStack?: boolean;
  } = {}
): never | void {
  const {
    logger,
    exitOnError = false,
    exitCode,
    showStack = process.env.DEBUG === 'true',
  } = options;

  const message = getErrorMessage(error);
  const suggestion = error instanceof PhotonError ? error.suggestion : undefined;
  const stack = error instanceof Error ? error.stack : undefined;

  const parts = [message];
  if (suggestion) parts.push(`\nSuggestion: ${suggestion}`);
  if (showStack && stack) parts.push(`\nStack trace:\n${stack}`);
  const formatted = parts.join(' ');

  if (logger) {
    logger.error(formatted);
    if (showStack && stack) {
      logger.debug(stack);
    }
  } else {
    console.error(`❌ ${formatted}`);
  }

  if (error instanceof PhotonError && error.details) {
    if (logger) {
      logger.debug('Error details:', error.details);
    } else if (showStack) {
      console.error('Error details:', error.details);
    }
  }

  if (exitOnError) {
    const code = exitCode ?? ExitCode.ERROR;
    process.exit(code);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLI ERROR UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Print error to stderr and exit with appropriate code
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

// ══════════════════════════════════════════════════════════════════════════════
// TOOL ERROR FORMATTING (shared across STDIO and SSE transports)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Format a tool call error into a structured message for AI clients.
 * Used by both STDIO and SSE transports to ensure consistent error reporting.
 */
export function formatToolError(
  toolName: string,
  error: unknown
): { text: string; errorType: string; retryable: boolean } {
  let errorMessage = error instanceof Error ? error.message : String(error);
  let errorType = 'runtime_error';
  let suggestion = '';
  let retryable = false;

  const errorName = error instanceof Error ? error.name : '';
  const nodeCode =
    error && typeof error === 'object' && 'code' in error ? String((error as any).code) : '';

  // Photon authors can attach userMessage and hint for friendly display
  const userMessage =
    error && typeof error === 'object' && 'userMessage' in error ? String(error.userMessage) : '';
  const userHint = error && typeof error === 'object' && 'hint' in error ? String(error.hint) : '';

  if (userMessage) errorMessage = userMessage;

  // Prefer typed classification (error.name / error.code) over substring matching.
  if (errorName === 'PhotonCircuitOpenError') {
    errorType = 'circuit_open';
    suggestion =
      'Circuit breaker is open after repeated failures. Back off and retry after the reset window.';
    retryable = true;
  } else if (errorName === 'PhotonTimeoutError' || nodeCode === 'ETIMEDOUT') {
    errorType = 'timeout_error';
    suggestion = 'The operation took too long. Try again or check external service availability.';
    retryable = true;
  } else if (errorName === 'ValidationError') {
    errorType = 'validation_error';
    suggestion = 'Check the parameters provided match the tool schema requirements.';
    retryable = false;
  } else if (
    nodeCode === 'ECONNREFUSED' ||
    nodeCode === 'ENETUNREACH' ||
    nodeCode === 'EAI_AGAIN'
  ) {
    errorType = 'network_error';
    suggestion =
      'Cannot connect to external service. Check network connection and service availability.';
    retryable = true;
  } else if (nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    errorType = 'permission_error';
    suggestion = 'Permission denied. Check file/resource access permissions.';
    retryable = false;
  } else if (nodeCode === 'ENOENT') {
    errorType = 'not_found_error';
    suggestion = 'Resource not found. Check that the file or resource exists.';
    retryable = false;
  } else if (userHint) {
    suggestion = userHint;
  } else if (errorMessage.includes('not a function') || errorMessage.includes('undefined')) {
    errorType = 'implementation_error';
    suggestion =
      'The tool implementation may have an issue. Check that all methods are properly defined.';
  } else if (errorMessage.includes('required') || errorMessage.includes('validation')) {
    errorType = 'validation_error';
    suggestion = 'Check the parameters provided match the tool schema requirements.';
  } else if (errorMessage.includes('timeout')) {
    errorType = 'timeout_error';
    suggestion = 'The operation took too long. Try again or check external service availability.';
    retryable = true;
  } else if (errorMessage.includes('network')) {
    errorType = 'network_error';
    suggestion =
      'Cannot connect to external service. Check network connection and service availability.';
    retryable = true;
  } else if (errorMessage.includes('permission')) {
    errorType = 'permission_error';
    suggestion = 'Permission denied. Check file/resource access permissions.';
  } else if (errorMessage.includes('not found')) {
    errorType = 'not_found_error';
    suggestion = 'Resource not found. Check that the file or resource exists.';
  }

  if (userHint && !suggestion) suggestion = userHint;

  let text = `Tool Error: ${toolName}\n\nError Type: ${errorType}\nMessage: ${errorMessage}\n`;
  if (suggestion) text += `\nSuggestion: ${suggestion}\n`;
  text += `Retryable: ${retryable}\n`;

  return { text, errorType, retryable };
}
