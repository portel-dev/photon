import { resolveNumericInput, type NumericSchemaLike } from './semantic-input.js';

export interface FieldAction {
  action: 'geolocation';
  target?: 'latitude' | 'longitude';
  label: string;
}

export interface SemanticActionSchema extends NumericSchemaLike {
  ['x-action']?: { action?: string; target?: string; label?: string };
}

export interface GeolocationCoordinatesLike {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface GeolocationPositionLike {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
}

interface BrowserGeolocationPositionLike {
  coords: GeolocationCoordinatesLike;
  timestamp?: number;
}

export interface GeolocationErrorLike {
  code: number;
  message?: string;
}

export interface GeolocationLike {
  getCurrentPosition(
    success: (position: BrowserGeolocationPositionLike) => void,
    error?: (error: GeolocationErrorLike) => void,
    options?: {
      enableHighAccuracy?: boolean;
      timeout?: number;
      maximumAge?: number;
    }
  ): void;
}

export type SemanticActionErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'position-unavailable'
  | 'timeout';

export class SemanticActionError extends Error {
  constructor(
    public readonly code: SemanticActionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SemanticActionError';
  }
}

const LOCATION_LABEL = 'Use current location';

function normalizeAction(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
    : '';
}

/** Resolve a safe, declarative browser action for a schema field. */
export function getSemanticAction(
  key: string,
  schema: SemanticActionSchema = {}
): FieldAction | undefined {
  const explicitFormat = typeof schema.format === 'string' && schema.format.trim() !== '';
  const explicitAction = schema['x-action'];
  const actionName = normalizeAction(explicitAction?.action);

  if (actionName && actionName !== 'geolocation') return undefined;
  if (actionName === 'geolocation') {
    const target = explicitAction?.target;
    return {
      action: 'geolocation',
      target: target === 'latitude' || target === 'longitude' ? target : undefined,
      label: explicitAction?.label || LOCATION_LABEL,
    };
  }

  const numeric = resolveNumericInput(key, schema);
  if (numeric.kind === 'latitude' || numeric.kind === 'longitude') {
    return {
      action: 'geolocation',
      target: numeric.kind,
      label: LOCATION_LABEL,
    };
  }

  // An unrelated explicit format must suppress name-based action inference.
  if (explicitFormat) return undefined;
  return undefined;
}

function browserGeolocation(): GeolocationLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.geolocation as GeolocationLike | undefined;
}

function isSecureBrowserContext(): boolean {
  if (typeof window === 'undefined' || typeof window.isSecureContext !== 'boolean') return true;
  return (
    window.isSecureContext ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
}

function locationError(error: GeolocationErrorLike | undefined): SemanticActionError {
  if (error?.code === 1) {
    return new SemanticActionError(
      'permission-denied',
      'Location permission was denied. Enter coordinates manually.'
    );
  }
  if (error?.code === 3) {
    return new SemanticActionError(
      'timeout',
      'Location request timed out. Try again or enter coordinates manually.'
    );
  }
  return new SemanticActionError(
    'position-unavailable',
    'Location is unavailable. Try again or enter coordinates manually.'
  );
}

/** Request location after an explicit user action; never requests it during render. */
export function requestCurrentLocation(
  geolocation: GeolocationLike | undefined = browserGeolocation()
): Promise<GeolocationPositionLike> {
  if (!isSecureBrowserContext()) {
    return Promise.reject(
      new SemanticActionError(
        'insecure-context',
        'Location requires a secure connection. Enter coordinates manually.'
      )
    );
  }
  if (!geolocation) {
    return Promise.reject(
      new SemanticActionError(
        'unsupported',
        'Location is not supported in this browser. Enter coordinates manually.'
      )
    );
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          reject(
            new SemanticActionError(
              'position-unavailable',
              'Location returned invalid coordinates. Enter coordinates manually.'
            )
          );
          return;
        }
        resolve({
          latitude,
          longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (error) => reject(locationError(error)),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}
