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
  memory!: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
  };

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
      locked?: string; // agent name that locked this element
      createdBy?: string;
      updatedAt: number;
    }
  > = {};

  private _nextZ = 1;
  private _loaded = false;

  /** Turn state: who has control */
  private _turn: {
    agent: string;
    message?: string;
    since: number;
  } = { agent: 'human', since: Date.now() };

  /** Load scene from persistent storage */
  private async _load() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const saved = await this.memory.get<{
        scene: Record<string, any>;
        nextZ: number;
        turn?: { agent: string; message?: string; since: number };
      }>('scene');
      if (saved) {
        this._scene = saved.scene || {};
        this._nextZ = saved.nextZ || 1;
        if (saved.turn) this._turn = saved.turn;
      }
    } catch {
      // First run or corrupted — start fresh
    }
  }

  /** Save scene to persistent storage */
  private async _save() {
    await this.memory.set('scene', {
      scene: this._scene,
      nextZ: this._nextZ,
      turn: this._turn,
    });
  }

  /**
   * Open the canvas
   * @ui canvas
   * @readOnly
   */
  async main() {
    await this._load();
    return { elements: Object.values(this._scene), turn: this._turn };
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
  async put({
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
    await this._load();
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
    await this._save();

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
  async remove({ id }: { id: string }) {
    await this._load();
    const existed = id in this._scene;
    delete this._scene[id];
    await this._save();

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
  async clear() {
    await this._load();
    const count = Object.keys(this._scene).length;
    this._scene = {};
    this._nextZ = 1;
    await this._save();

    this.emit({
      emit: 'scene:clear',
    });

    return { cleared: count };
  }

  /**
   * Get the full scene graph — all elements with positions, sizes, and data
   * @readOnly
   */
  async scene() {
    await this._load();
    return {
      elements: Object.values(this._scene),
      count: Object.keys(this._scene).length,
      turn: this._turn,
    };
  }

  /**
   * Pass control to another agent or back to the human.
   * The recipient sees a status banner with the optional message.
   *
   * @param to Who gets control next (e.g. 'human', 'ai', agent name)
   * @param message Optional message explaining what to do next
   */
  async pass({ to, message }: { to: string; message?: string }) {
    await this._load();
    this._turn = { agent: to, message, since: Date.now() };
    await this._save();

    this.emit({
      emit: 'turn:change',
      turn: this._turn,
    });

    return this._turn;
  }

  /**
   * Lock an element so only the specified agent can modify it.
   *
   * @param id Element to lock
   * @param agent Agent name claiming the lock
   */
  async lock({ id, agent }: { id: string; agent: string }) {
    await this._load();
    const el = this._scene[id];
    if (!el) return { error: 'Element not found', id };
    if (el.locked && el.locked !== agent) {
      return { error: `Locked by ${el.locked}`, id };
    }
    el.locked = agent;
    el.updatedAt = Date.now();
    await this._save();

    this.emit({ emit: 'scene:put', element: el });
    return el;
  }

  /**
   * Unlock an element, allowing anyone to modify it.
   *
   * @param id Element to unlock
   */
  async unlock({ id }: { id: string }) {
    await this._load();
    const el = this._scene[id];
    if (!el) return { error: 'Element not found', id };
    delete el.locked;
    el.updatedAt = Date.now();
    await this._save();

    this.emit({ emit: 'scene:put', element: el });
    return el;
  }

  /**
   * Describe the current canvas layout in natural language.
   * Useful for AI agents to understand spatial arrangement without a screenshot.
   * @readOnly
   */
  async describe() {
    await this._load();
    const els = Object.values(this._scene);
    if (els.length === 0) {
      return {
        description: 'The canvas is empty.',
        count: 0,
      };
    }

    // Sort by z-order (back to front)
    const sorted = [...els].sort((a, b) => a.z - b.z);

    // Compute canvas bounds
    const maxX = Math.max(...els.map((e) => e.x + e.w));
    const maxY = Math.max(...els.map((e) => e.y + e.h));

    // Describe each element with spatial context
    const descriptions = sorted.map((el) => {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      const hPos = cx < maxX * 0.33 ? 'left' : cx > maxX * 0.66 ? 'right' : 'center';
      const vPos = cy < maxY * 0.33 ? 'top' : cy > maxY * 0.66 ? 'bottom' : 'middle';
      const pos = vPos === 'middle' && hPos === 'center' ? 'center' : `${vPos}-${hPos}`;
      const size = `${el.w}x${el.h}`;
      const lock = el.locked ? ` [locked by ${el.locked}]` : '';
      const label = el.label || el.id;
      return `- "${label}" (${el.format}, ${size}) at ${pos}, placed by ${el.createdBy || 'unknown'}${lock}`;
    });

    // Detect spatial patterns
    const patterns: string[] = [];
    const xGroups = this._groupBy(els, (e) => Math.round(e.y / 50) * 50);
    const rows = Object.values(xGroups).filter((g) => g.length > 1);
    if (rows.length > 0) {
      patterns.push(`${rows.length} row(s) of aligned elements`);
    }
    const yGroups = this._groupBy(els, (e) => Math.round(e.x / 50) * 50);
    const cols = Object.values(yGroups).filter((g) => g.length > 1);
    if (cols.length > 0) {
      patterns.push(`${cols.length} column(s) of aligned elements`);
    }

    const summary =
      `Canvas has ${els.length} element(s) spanning ${maxX}x${maxY}px.` +
      (patterns.length > 0 ? ' Layout: ' + patterns.join(', ') + '.' : '') +
      ` Turn: ${this._turn.agent}.`;

    return {
      description: summary,
      elements: descriptions,
      bounds: { width: maxX, height: maxY },
      turn: this._turn,
      count: els.length,
    };
  }

  private _groupBy<T>(items: T[], keyFn: (item: T) => number): Record<number, T[]> {
    const groups: Record<number, T[]> = {};
    for (const item of items) {
      const key = keyFn(item);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }

  /**
   * Request a screenshot from the canvas UI.
   * Returns the latest captured screenshot as a base64 data URL.
   * The UI captures the screenshot and sends it back via the capture method.
   * @readOnly
   */
  async screenshot() {
    await this._load();

    // Emit request — client will capture and call 'capture' with the data
    this.emit({ emit: 'canvas:screenshot-request' });

    // Return the last captured screenshot if available
    const last = await this.memory.get<string>('last-screenshot');
    return {
      available: !!last,
      dataUrl: last || null,
      hint: last
        ? 'Screenshot available. Pass the dataUrl to a multimodal model.'
        : 'Screenshot requested. Call screenshot() again after a moment to retrieve it.',
    };
  }

  /**
   * Store a screenshot captured by the canvas UI.
   * Called by the client after a screenshot-request event.
   * @internal
   * @param dataUrl Base64 data URL of the captured image
   */
  async capture({ dataUrl }: { dataUrl: string }) {
    await this.memory.set('last-screenshot', dataUrl);
    return { stored: true };
  }

  /**
   * Register a custom component that can be used as a format on the canvas.
   * Once registered, use the component name as the format in put().
   *
   * @param name Component name (used as format value in put)
   * @param html HTML template string. Use {{key}} placeholders for data binding.
   * @param defaults Default data values for the component
   */
  async registerComponent({
    name,
    html,
    defaults,
  }: {
    name: string;
    html: string;
    defaults?: Record<string, any>;
  }) {
    await this._load();
    const components = (await this.memory.get<Record<string, any>>('components')) || {};
    components[name] = { html, defaults: defaults || {} };
    await this.memory.set('components', components);

    this.emit({
      emit: 'component:registered',
      name,
      html,
      defaults: defaults || {},
    });

    return { registered: name };
  }

  /**
   * List registered custom components with their templates
   * @readOnly
   */
  async listComponents() {
    const components = (await this.memory.get<Record<string, any>>('components')) || {};
    return Object.entries(components).map(([name, spec]: [string, any]) => ({
      name,
      html: spec.html,
      defaults: spec.defaults || {},
    }));
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
