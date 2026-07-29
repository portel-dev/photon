/** Canonicalize the compact values accepted by `@format`. */

export type FormatKind = 'renderer' | 'media';

export interface FormatDeclaration {
  /** Canonical Photon renderer, e.g. `image` or `chart:bar`. */
  outputFormat: string;
  /** Concrete MIME type when the format identifies an encoded payload. */
  mimeType?: string;
  /** Whether this selects a renderer or a serialized media payload. */
  kind: FormatKind;
  /** Original alias used by the author, when applicable. */
  alias?: string;
}

const FORMAT_ALIASES: Record<string, Omit<FormatDeclaration, 'alias'>> = {
  png: { outputFormat: 'image', mimeType: 'image/png', kind: 'media' },
  jpg: { outputFormat: 'image', mimeType: 'image/jpeg', kind: 'media' },
  jpeg: { outputFormat: 'image', mimeType: 'image/jpeg', kind: 'media' },
  webp: { outputFormat: 'image', mimeType: 'image/webp', kind: 'media' },
  svg: { outputFormat: 'image', mimeType: 'image/svg+xml', kind: 'media' },
  bmp: { outputFormat: 'image', mimeType: 'image/bmp', kind: 'media' },
  bar: { outputFormat: 'chart:bar', kind: 'renderer' },
  pie: { outputFormat: 'chart:pie', kind: 'renderer' },
  line: { outputFormat: 'chart:line', kind: 'renderer' },
  donut: { outputFormat: 'chart:donut', kind: 'renderer' },
  area: { outputFormat: 'chart:area', kind: 'renderer' },
  scatter: { outputFormat: 'chart:scatter', kind: 'renderer' },
  histogram: { outputFormat: 'chart:histogram', kind: 'renderer' },
};

export type NormalizedFormat = FormatDeclaration;

export function normalizeFormatDeclaration(
  value: string,
  explicitMimeType?: string
): NormalizedFormat {
  const format = value.trim().toLowerCase();
  const slash = format.indexOf('/');
  if (slash > 0 && format.slice(slash + 1)) {
    const mimeType = format;
    if (mimeType.startsWith('image/')) {
      return { outputFormat: 'image', mimeType, kind: 'media' };
    }
    if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
      return { outputFormat: 'binary', mimeType, kind: 'media' };
    }
    return { outputFormat: format.split('/')[1], mimeType, kind: 'media' };
  }

  const alias = FORMAT_ALIASES[format];
  if (alias) {
    return {
      ...alias,
      alias: format,
      ...(explicitMimeType || alias.mimeType
        ? { mimeType: explicitMimeType || alias.mimeType }
        : {}),
    };
  }
  return {
    outputFormat: value,
    kind: explicitMimeType ? 'media' : 'renderer',
    ...(explicitMimeType ? { mimeType: explicitMimeType } : {}),
  };
}
