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
    get<T>(key: string, scope?: string): Promise<T | null>;
    set<T>(key: string, value: T, scope?: string): Promise<void>;
    delete(key: string, scope?: string): Promise<boolean>;
    keys(scope?: string): Promise<string[]>;
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

  /** Max snapshots to keep per canvas */
  private static MAX_SNAPSHOTS = 100;

  /** Load scene from persistent storage (or from fork data) */
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

    // Check for fork data in global scope (written by another instance's fork())
    if (Object.keys(this._scene).length === 0) {
      try {
        const globalKeys = await this.memory.keys('global');
        for (const key of globalKeys) {
          // Match fork data addressed to this instance
          if (key.startsWith('canvas-fork:')) {
            const forkData = await this.memory.get<{
              scene: Record<string, any>;
              nextZ: number;
              turn: { agent: string; since: number };
            }>(key, 'global');
            if (forkData && forkData.scene) {
              this._scene = forkData.scene;
              this._nextZ = forkData.nextZ || 1;
              this._turn = forkData.turn || this._turn;
              await this.memory.delete(key, 'global'); // consume
              await this._save('forked');
              break;
            }
          }
        }
      } catch {
        // Fork check failed — continue with empty scene
      }
    }
  }

  /** Save scene to persistent storage + auto-snapshot */
  private async _save(action?: string) {
    await this.memory.set('scene', {
      scene: this._scene,
      nextZ: this._nextZ,
      turn: this._turn,
    });

    // Auto-snapshot: record every mutation
    const timeline =
      (await this.memory.get<
        Array<{
          ts: number;
          action: string;
          scene: Record<string, any>;
          elementCount: number;
        }>
      >('timeline')) || [];

    timeline.push({
      ts: Date.now(),
      action: action || 'edit',
      scene: JSON.parse(JSON.stringify(this._scene)),
      elementCount: Object.keys(this._scene).length,
    });

    // Trim old snapshots
    if (timeline.length > Canvas.MAX_SNAPSHOTS) {
      timeline.splice(0, timeline.length - Canvas.MAX_SNAPSHOTS);
    }

    await this.memory.set('timeline', timeline);
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
    const action = existing ? `update ${id}` : `add ${id}`;
    await this._save(action);

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
    await this._save(`remove ${id}`);

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
    await this._save('clear');

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
    await this._save(`lock ${id}`);

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
    await this._save(`unlock ${id}`);

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
   * View the canvas timeline — a history of every change.
   * Each entry has a timestamp, action label, and element count.
   * @readOnly
   */
  async history() {
    const timeline =
      (await this.memory.get<Array<{ ts: number; action: string; elementCount: number }>>(
        'timeline'
      )) || [];

    return timeline.map((entry, i) => ({
      index: i,
      time: new Date(entry.ts).toISOString(),
      action: entry.action,
      elements: entry.elementCount,
    }));
  }

  /**
   * Get the full timeline with scene data for animated playback.
   * Each frame contains the complete scene state so the client can
   * compute Magic Move transitions between consecutive frames.
   * @readOnly
   * @internal
   */
  async playback() {
    const timeline =
      (await this.memory.get<
        Array<{ ts: number; action: string; scene: Record<string, any>; elementCount: number }>
      >('timeline')) || [];

    return timeline.map((entry, i) => ({
      index: i,
      action: entry.action,
      elements: Object.values(entry.scene),
    }));
  }

  /**
   * Save a named checkpoint at the current state.
   * Checkpoints appear in the timeline with a label for easy reference.
   *
   * @param label Name for this checkpoint (e.g. 'before reorganizing')
   */
  async checkpoint({ label }: { label: string }) {
    await this._load();
    await this._save(`checkpoint: ${label}`);

    this.emit({
      emit: 'timeline:checkpoint',
      label,
      ts: Date.now(),
    });

    return { checkpointed: label, elements: Object.keys(this._scene).length };
  }

  /**
   * Restore the canvas to a previous point in the timeline.
   * Replaces the current scene with the snapshot at that index.
   *
   * @param index Timeline index to restore (from history())
   */
  async restore({ index }: { index: number }) {
    const timeline =
      (await this.memory.get<
        Array<{ ts: number; action: string; scene: Record<string, any>; elementCount: number }>
      >('timeline')) || [];

    if (index < 0 || index >= timeline.length) {
      return { error: `Invalid index ${index}. Timeline has ${timeline.length} entries.` };
    }

    const snapshot = timeline[index];
    this._scene = JSON.parse(JSON.stringify(snapshot.scene));
    this._nextZ = Math.max(0, ...Object.values(this._scene).map((e: any) => e.z || 0)) + 1;
    await this._save(`restore to #${index} (${snapshot.action})`);

    // Emit full scene refresh
    this.emit({
      emit: 'scene:restore',
      elements: Object.values(this._scene),
    });

    return {
      restored: index,
      action: snapshot.action,
      time: new Date(snapshot.ts).toISOString(),
      elements: Object.keys(this._scene).length,
    };
  }

  /**
   * Fork the canvas at a timeline point into a new instance.
   * Creates a new canvas instance with the scene from that snapshot.
   *
   * @param name New instance name (e.g. 'dashboard-v2')
   * @param index Timeline index to fork from (defaults to current state)
   */
  async fork({ name, index }: { name: string; index?: number }) {
    await this._load();

    let forkScene: Record<string, any>;
    let forkAction: string;

    if (index !== undefined) {
      const timeline =
        (await this.memory.get<Array<{ ts: number; action: string; scene: Record<string, any> }>>(
          'timeline'
        )) || [];

      if (index < 0 || index >= timeline.length) {
        return { error: `Invalid index ${index}. Timeline has ${timeline.length} entries.` };
      }
      forkScene = timeline[index].scene;
      forkAction = `forked from #${index}`;
    } else {
      forkScene = this._scene;
      forkAction = 'forked from current';
    }

    // Store fork data in global scope so the target instance can find it
    const forkData = {
      scene: JSON.parse(JSON.stringify(forkScene)),
      nextZ: Math.max(0, ...Object.values(forkScene).map((e: any) => e.z || 0)) + 1,
      turn: { agent: 'human', since: Date.now() },
    };

    await this.memory.set(`canvas-fork:${name}`, forkData, 'global');

    this.emit({
      emit: 'timeline:fork',
      name,
      elements: Object.keys(forkScene).length,
    });

    return {
      forked: name,
      from: forkAction,
      elements: Object.keys(forkScene).length,
      hint: `Open canvas/${name} to use the forked canvas`,
    };
  }

  /**
   * Export the current canvas as a standalone photon.
   * Compiles the scene graph into a .photon.ts (data methods) and
   * .photon.html (CSS grid layout with format renderers).
   *
   * @param name Photon name for the exported file (e.g. 'my-dashboard')
   * @param description One-line description of the exported photon
   * @readOnly
   */
  async export({ name, description }: { name: string; description?: string }) {
    await this._load();
    const els = Object.values(this._scene);
    if (els.length === 0) {
      return { error: 'Canvas is empty — nothing to export' };
    }

    const desc = description || `Exported from canvas on ${new Date().toISOString().split('T')[0]}`;
    const sorted = [...els].sort((a, b) => a.z - b.z);

    // ── Detect layout: rows and columns ──
    const rows = this._detectRows(sorted);

    // ── Generate .photon.ts ──
    const methodEntries = sorted.map((el) => {
      const safeName = el.id.replace(/[^a-zA-Z0-9]/g, '_');
      const dataStr = JSON.stringify(el.data, null, 4);
      return [
        `  /**`,
        `   * ${el.label || el.id}`,
        `   * @format ${el.format}`,
        `   * @readOnly`,
        `   */`,
        `  ${safeName}() {`,
        `    return ${dataStr};`,
        `  }`,
      ].join('\n');
    });

    const tsFile = [
      `/**`,
      ` * ${name}`,
      ` *`,
      ` * ${desc}`,
      ` *`,
      ` * @description ${desc}`,
      ` * @ui main`,
      ` */`,
      `export default class ${this._toPascalCase(name)} {`,
      `  /**`,
      `   * Dashboard view`,
      `   * @ui main`,
      `   * @readOnly`,
      `   */`,
      `  main() {`,
      `    return {`,
      ...sorted.map((el) => {
        const safeName = el.id.replace(/[^a-zA-Z0-9]/g, '_');
        return `      ${safeName}: this.${safeName}(),`;
      }),
      `    };`,
      `  }`,
      ``,
      ...methodEntries,
      `}`,
      ``,
    ].join('\n');

    // ── Generate .photon.html with CSS grid ──
    const gridCells = rows
      .map((row, ri) =>
        row
          .map((el) => {
            const safeName = el.id.replace(/[^a-zA-Z0-9]/g, '_');
            return [
              `  <div class="cell" data-method="${safeName}" data-format="${el.format}">`,
              `    <div class="cell-label">${el.label || el.id}</div>`,
              `    <div class="cell-body" id="${safeName}"></div>`,
              `  </div>`,
            ].join('\n');
          })
          .join('\n')
      )
      .join('\n');

    // Compute grid template from row structure
    const maxCols = Math.max(...rows.map((r) => r.length));
    const colTemplate = `repeat(${maxCols}, 1fr)`;
    const rowTemplate = rows.map(() => 'auto').join(' ');

    const htmlFile = [
      `<style>`,
      `  * { box-sizing: border-box; margin: 0; padding: 0; }`,
      `  body {`,
      `    font-family: var(--font-family-sans, -apple-system, BlinkMacSystemFont, sans-serif);`,
      `    background: var(--color-surface, #1a1b26);`,
      `    color: var(--color-on-surface, #e6e6e6);`,
      `    padding: 16px;`,
      `  }`,
      `  .grid {`,
      `    display: grid;`,
      `    grid-template-columns: ${colTemplate};`,
      `    grid-template-rows: ${rowTemplate};`,
      `    gap: 12px;`,
      `  }`,
      `  .cell {`,
      `    background: var(--color-surface-container, #1e2030);`,
      `    border: 1px solid var(--color-outline-variant, #333);`,
      `    border-radius: 8px;`,
      `    padding: 12px;`,
      `    min-height: 120px;`,
      `  }`,
      `  .cell-label {`,
      `    font-size: 11px;`,
      `    color: var(--color-on-surface-muted, #999);`,
      `    margin-bottom: 8px;`,
      `    text-transform: uppercase;`,
      `    letter-spacing: 0.5px;`,
      `  }`,
      `  .cell-body { min-height: 0; }`,
      `</style>`,
      ``,
      `<div class="grid">`,
      gridCells,
      `</div>`,
      ``,
      `<script>`,
      `(function() {`,
      `  window.photon.onResult(function(result) {`,
      `    if (!result) return;`,
      `    var cells = document.querySelectorAll('.cell');`,
      `    for (var i = 0; i < cells.length; i++) {`,
      `      var method = cells[i].getAttribute('data-method');`,
      `      var format = cells[i].getAttribute('data-format');`,
      `      var body = cells[i].querySelector('.cell-body');`,
      `      if (method && result[method] && body) {`,
      `        window.photon.render(body, result[method], format);`,
      `      }`,
      `    }`,
      `  });`,
      `})();`,
      `</script>`,
    ].join('\n');

    return {
      name,
      files: {
        [`${name}.photon.ts`]: tsFile,
        [`${name}/ui/main.html`]: htmlFile,
      },
      elements: sorted.length,
      grid: `${maxCols} columns x ${rows.length} rows`,
    };
  }

  private _detectRows(
    els: Array<{ x: number; y: number; w: number; h: number; [k: string]: any }>
  ): Array<Array<(typeof els)[number]>> {
    if (els.length === 0) return [];
    // Group elements into rows by y-proximity (within 50px = same row)
    const sorted = [...els].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: Array<Array<(typeof els)[number]>> = [];
    let currentRow: Array<(typeof els)[number]> = [sorted[0]];
    let rowY = sorted[0].y;

    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].y - rowY) < 50) {
        currentRow.push(sorted[i]);
      } else {
        rows.push(currentRow.sort((a, b) => a.x - b.x));
        currentRow = [sorted[i]];
        rowY = sorted[i].y;
      }
    }
    rows.push(currentRow.sort((a, b) => a.x - b.x));
    return rows;
  }

  private _toPascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
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
