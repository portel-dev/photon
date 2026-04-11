/**
 * Canvas — co-creative scene graph
 *
 * Shared canvas where AI agents and humans collaboratively place,
 * move, resize, and update rendered elements. Either party can start,
 * either can edit, control passes back and forth fluidly.
 *
 * Each element renders using the runtime's 50+ format renderers
 * (metric, chart:bar, table, gauge, timeline, etc.).
 *
 * @description Co-creative canvas for AI and humans
 * @icon 🎨
 * @stateful
 */
export default class Canvas {
  // Injected by runtime — declared for capability detection
  emit!: (data: any) => void;
  formats!: Record<string, { data: string; example: unknown }>;

  /** Scene graph: element ID → element */
  private _scene: Record<
    string,
    {
      id: string;
      format: string;
      data: any;
      x: number;
      y: number;
      w: number;
      h: number;
      z: number;
      label?: string;
      createdBy?: string;
      updatedAt: number;
    }
  > = {};

  private _nextZ = 1;

  /**
   * Open the canvas
   * @ui canvas
   * @readOnly
   */
  main() {
    return { elements: Object.values(this._scene) };
  }

  /**
   * Place or update an element on the canvas.
   * Creates if new, merges if exists — only provided fields change.
   *
   * @param id Element identifier
   * @param format Renderer format (metric, chart:bar, table, gauge, etc.)
   * @param data Data matching the format spec
   * @param x Horizontal position in pixels
   * @param y Vertical position in pixels
   * @param w Width in pixels
   * @param h Height in pixels
   * @param z Z-order layer (higher = on top)
   * @param label Human-readable label shown on the element
   */
  put({
    id,
    format,
    data,
    x,
    y,
    w,
    h,
    z,
    label,
  }: {
    id: string;
    format?: string;
    data?: any;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    z?: number;
    label?: string;
  }) {
    const existing = this._scene[id];
    const element = {
      id,
      format: format ?? existing?.format ?? 'card',
      data: data !== undefined ? data : existing?.data,
      x: x ?? existing?.x ?? 50,
      y: y ?? existing?.y ?? 50,
      w: w ?? existing?.w ?? 300,
      h: h ?? existing?.h ?? 200,
      z: z ?? existing?.z ?? this._nextZ++,
      label: label ?? existing?.label,
      createdBy: existing?.createdBy ?? 'ai',
      updatedAt: Date.now(),
    };
    this._scene[id] = element;

    // Emit scene change — flows through SSE → bridge → onEmit
    this.emit({
      emit: 'scene:put',
      element,
    });

    return element;
  }

  /**
   * Remove an element from the canvas
   * @param id Element identifier to remove
   */
  remove({ id }: { id: string }) {
    const existed = id in this._scene;
    delete this._scene[id];

    this.emit({
      emit: 'scene:remove',
      id,
    });

    return { removed: existed, id };
  }

  /**
   * Clear all elements from the canvas
   * @destructive
   */
  clear() {
    const count = Object.keys(this._scene).length;
    this._scene = {};
    this._nextZ = 1;

    this.emit({
      emit: 'scene:clear',
    });

    return { cleared: count };
  }

  /**
   * Get the full scene graph — all elements with positions, sizes, and data
   * @readOnly
   */
  scene() {
    return {
      elements: Object.values(this._scene),
      count: Object.keys(this._scene).length,
    };
  }

  /**
   * List all available render formats with expected data shapes
   * @readOnly
   * @format table
   */
  listFormats() {
    const catalog = this.formats;
    if (!catalog || typeof catalog !== 'object') return [];
    return Object.entries(catalog).map(([name, spec]: [string, any]) => ({
      format: name,
      data: spec.data,
    }));
  }
}
