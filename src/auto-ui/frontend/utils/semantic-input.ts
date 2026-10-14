export interface NumericSchemaLike {
  type?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
}

export type SemanticNumericKind = 'latitude' | 'longitude' | 'decimal';

export interface NumericInputSemantics {
  kind?: SemanticNumericKind;
  isCoordinate: boolean;
  minimum?: number;
  maximum?: number;
  step: number;
}

const COORDINATE_STEPS = 0.000001;
const DECIMAL_STEP = 0.01;

function normalizedFormat(format: unknown): string {
  return typeof format === 'string'
    ? format
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
    : '';
}

function keyTokens(key: string): Set<string> {
  return new Set(
    key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

/**
 * Resolve semantic numeric metadata shared by invocation and elicitation forms.
 * Explicit semantic formats take precedence over conservative name heuristics.
 */
export function resolveNumericInput(
  key: string,
  schema: NumericSchemaLike = {}
): NumericInputSemantics {
  const format = normalizedFormat(schema.format);
  let kind: SemanticNumericKind | undefined;

  if (format === 'latitude' || format === 'geo-latitude' || format === 'lat') {
    kind = 'latitude';
  } else if (
    format === 'longitude' ||
    format === 'geo-longitude' ||
    format === 'lon' ||
    format === 'lng'
  ) {
    kind = 'longitude';
  } else if (format === 'decimal' || format === 'float' || format === 'double') {
    kind = 'decimal';
  } else if (!format) {
    const tokens = keyTokens(key);
    if (tokens.has('latitude') || tokens.has('lat')) kind = 'latitude';
    else if (tokens.has('longitude') || tokens.has('lon') || tokens.has('lng')) kind = 'longitude';
  }

  const isCoordinate = kind === 'latitude' || kind === 'longitude';
  const inferredMinimum = kind === 'latitude' ? -90 : kind === 'longitude' ? -180 : undefined;
  const inferredMaximum = kind === 'latitude' ? 90 : kind === 'longitude' ? 180 : undefined;

  return {
    kind,
    isCoordinate,
    minimum: schema.minimum ?? inferredMinimum,
    maximum: schema.maximum ?? inferredMaximum,
    step: schema.multipleOf ?? (isCoordinate ? COORDINATE_STEPS : DECIMAL_STEP),
  };
}

export function isNumericSchema(schema: NumericSchemaLike): boolean {
  return schema.type === 'number' || schema.type === 'integer';
}

export const DEFAULT_COORDINATE_STEP = COORDINATE_STEPS;
