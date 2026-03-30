/**
 * Text Layout Service
 *
 * Wraps @chenglou/pretext for fast, DOM-free text measurement.
 * Two-phase design: prepare() is expensive (once per text), layout() is pure math (on every resize).
 *
 * Use cases:
 * - Pre-compute text height without DOM reflow
 * - Flow text around shapes (variable width per line)
 * - Find optimal width for text (shrink-wrap / width-tight)
 * - Compute font size that fits text in a fixed area
 */

import {
  prepare,
  prepareWithSegments,
  layout,
  layoutWithLines,
  layoutNextLine,
  walkLineRanges,
  clearCache,
  type PreparedText,
  type PreparedTextWithSegments,
  type LayoutResult,
  type LayoutLine,
  type LayoutLinesResult,
  type LayoutCursor,
} from '@chenglou/pretext';

export {
  prepare,
  prepareWithSegments,
  layout,
  layoutWithLines,
  layoutNextLine,
  walkLineRanges,
  clearCache,
  type PreparedText,
  type PreparedTextWithSegments,
  type LayoutResult,
  type LayoutLine,
  type LayoutLinesResult,
  type LayoutCursor,
};

// ════════════════════════════════════════════════════════════════════════════════
// HIGH-LEVEL UTILITIES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Measure text height for a given width — single call, no caching.
 * Use prepare() + layout() separately when measuring the same text at multiple widths.
 */
export function measureHeight(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number
): number {
  const p = prepare(text, font);
  return layout(p, maxWidth, lineHeight).height;
}

/**
 * Find the narrowest width that fits text in `targetLines` lines.
 * Uses binary search — O(log(maxWidth - minWidth)) calls to layout().
 */
export function fitWidth(
  text: string,
  font: string,
  lineHeight: number,
  targetLines: number,
  minWidth = 40,
  maxWidth = 2000
): number {
  const p = prepare(text, font);
  let lo = minWidth;
  let hi = maxWidth;

  // Verify text fits at maxWidth in targetLines
  const maxResult = layout(p, hi, lineHeight);
  if (maxResult.lineCount > targetLines) return hi; // can't fit

  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    const result = layout(p, mid, lineHeight);
    if (result.lineCount <= targetLines) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
}

/**
 * Find the largest font size that fits text in a fixed area.
 * Binary search over font sizes.
 */
export function fitFontSize(
  text: string,
  fontFamily: string,
  maxWidth: number,
  maxHeight: number,
  lineHeightRatio = 1.5,
  minSize = 8,
  maxSize = 120
): number {
  let lo = minSize;
  let hi = maxSize;

  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    const font = `${mid}px ${fontFamily}`;
    const lh = mid * lineHeightRatio;
    const p = prepare(text, font);
    const result = layout(p, maxWidth, lh);
    if (result.height <= maxHeight) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.floor(lo);
}

// ════════════════════════════════════════════════════════════════════════════════
// FLOW LAYOUT — text around shapes
// ════════════════════════════════════════════════════════════════════════════════

export interface FlowObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Padding around the obstacle */
  padding?: number;
}

export interface FlowLine {
  text: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Flow text around rectangular obstacles (images, embeds, etc).
 * Returns positioned lines that avoid the obstacles.
 */
export function flowTextAroundObstacles(
  text: string,
  font: string,
  containerWidth: number,
  lineHeight: number,
  obstacles: FlowObstacle[]
): FlowLine[] {
  const prepared = prepareWithSegments(text, font);
  const lines: FlowLine[] = [];
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  let y = 0;

  while (true) {
    // Determine available width at this y position
    const { x, width } = getAvailableSpan(y, lineHeight, containerWidth, obstacles);

    // Skip lines that have zero width (fully blocked by obstacle)
    if (width < 20) {
      y += lineHeight;
      continue;
    }

    const line = layoutNextLine(prepared, cursor, width);
    if (!line) break;

    lines.push({
      text: line.text,
      x,
      y,
      width: line.width,
    });

    cursor = line.end;
    y += lineHeight;
  }

  return lines;
}

/**
 * Get the available horizontal span at a given y position,
 * accounting for obstacles that overlap this line.
 */
function getAvailableSpan(
  y: number,
  lineHeight: number,
  containerWidth: number,
  obstacles: FlowObstacle[]
): { x: number; width: number } {
  let left = 0;
  let right = containerWidth;

  for (const obs of obstacles) {
    const pad = obs.padding ?? 8;
    const obsTop = obs.y - pad;
    const obsBottom = obs.y + obs.height + pad;
    const obsLeft = obs.x - pad;
    const obsRight = obs.x + obs.width + pad;

    // Check if this obstacle overlaps vertically with this line
    if (y + lineHeight > obsTop && y < obsBottom) {
      // Obstacle on the left side — push text right
      if (obsLeft <= left + 10) {
        left = Math.max(left, obsRight);
      }
      // Obstacle on the right side — push text left
      else if (obsRight >= right - 10) {
        right = Math.min(right, obsLeft);
      }
      // Obstacle in the middle — use the wider side
      else {
        const leftGap = obsLeft - left;
        const rightGap = right - obsRight;
        if (leftGap >= rightGap) {
          right = obsLeft;
        } else {
          left = obsRight;
        }
      }
    }
  }

  return { x: left, width: Math.max(0, right - left) };
}

// ════════════════════════════════════════════════════════════════════════════════
// MULTI-COLUMN LAYOUT
// ════════════════════════════════════════════════════════════════════════════════

export interface ColumnLayout {
  columns: FlowLine[][];
  totalHeight: number;
}

/**
 * Lay out text in balanced columns.
 * Uses binary search to find the height that balances content across columns.
 */
export function layoutColumns(
  text: string,
  font: string,
  totalWidth: number,
  lineHeight: number,
  columnCount: number,
  gap = 24
): ColumnLayout {
  const colWidth = (totalWidth - gap * (columnCount - 1)) / columnCount;
  const prepared = prepareWithSegments(text, font);

  // First pass: measure total height in single column
  const singleCol = layoutWithLines(prepared, colWidth, lineHeight);
  const targetHeight = Math.ceil(singleCol.height / columnCount);

  // Lay out columns, breaking at target height
  const columns: FlowLine[][] = [];
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };

  for (let col = 0; col < columnCount; col++) {
    const colLines: FlowLine[] = [];
    const colX = col * (colWidth + gap);
    let y = 0;

    while (y < targetHeight + lineHeight) {
      const line = layoutNextLine(prepared, cursor, colWidth);
      if (!line) break;

      colLines.push({ text: line.text, x: colX, y, width: line.width });
      cursor = line.end;
      y += lineHeight;
    }

    columns.push(colLines);
    if (!layoutNextLine(prepared, cursor, colWidth)) break; // no more text
  }

  const maxColHeight = Math.max(...columns.map((col) => col.length * lineHeight));
  return { columns, totalHeight: maxColHeight };
}
