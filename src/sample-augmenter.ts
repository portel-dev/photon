/**
 * Augments `this.sample()` calls with three composable behaviors:
 *
 * 1. Memory include convention — keys prefixed `include_system_` auto-inject
 *    into systemPrompt; `include_transient_` inject as a trailing context
 *    message appended to the messages array.
 *
 *    Note: the FileMemoryBackend sanitizes key names (replaces [^a-zA-Z0-9_.-]
 *    with '_'), so colons are not safe in key names. Underscore separators
 *    are used throughout to guarantee the stored filenames and prefix filters
 *    always agree.
 *
 * 2. Transient context registry (ContextRegistry) — in-memory named sections
 *    with high/medium/low priority. Assembled into the trailing message
 *    alongside memory transient includes. Low-priority sections are dropped
 *    first under budget pressure.
 *
 * 3. Repeat-loop detection (RepeatDetector) — tracks the last 8 responses.
 *    On consecutive duplicates, injects a graded signal into the next call's
 *    systemPrompt so the model sees loop pressure as inline feedback.
 *
 * All three compose inside assembleSampleParams(), which is called by
 * the augmented this.sample() in loader.ts before forwarding to samplingProvider.
 */

// ─── Context Registry ────────────────────────────────────────────────────────

export type ContextPriority = 'high' | 'medium' | 'low';

interface ContextSection {
  name: string;
  content: string;
  priority: ContextPriority;
}

const PRIORITY_RANK: Record<ContextPriority, number> = { high: 2, medium: 1, low: 0 };
const DEFAULT_BUDGET = 8_000;

export class ContextRegistry {
  private _sections = new Map<string, ContextSection>();

  add(name: string, content: string, priority: ContextPriority = 'medium'): void {
    this._sections.set(name, { name, content, priority });
  }

  clear(name: string): void {
    this._sections.delete(name);
  }

  clearAll(): void {
    this._sections.clear();
  }

  /**
   * Assemble all sections into a single text block within `budget` chars.
   * Sections are sorted by priority descending (high kept longest).
   * Whole sections are dropped — never truncated mid-content.
   * Returns '' when empty or when all sections exceed the budget.
   */
  assemble(budget: number = DEFAULT_BUDGET): string {
    if (this._sections.size === 0) return '';

    // Sort descending by priority so dropping from the tail removes low-priority first
    const sorted = [...this._sections.values()].sort(
      (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    );

    let included = sorted;
    while (included.length > 0) {
      const text = included.map((s) => `# ${s.name}\n${s.content}`).join('\n\n');
      if (text.length <= budget) return text;
      included = included.slice(0, included.length - 1);
    }
    return '';
  }
}

// ─── Repeat Detector ─────────────────────────────────────────────────────────

const HISTORY_SIZE = 8;
const MIN_NORMALIZED_LENGTH = 20;

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

export class RepeatDetector {
  private _history: string[] = [];
  private _streak = 0;
  private _pendingSignal: string | null = null;

  /**
   * Record a response after samplingProvider returns.
   * Updates the pending signal for injection on the next call.
   */
  record(response: string): void {
    const norm = normalizeText(response);
    if (norm.length < MIN_NORMALIZED_LENGTH) return;

    if (this._history.includes(norm)) {
      this._streak++;
      const level = this._streak === 1 ? 'INFO' : this._streak === 2 ? 'WARN' : 'ERROR';
      this._pendingSignal = `[${level}: Response appears to be repeating. Try a different approach.]`;
    } else {
      this._streak = 0;
      this._pendingSignal = null;
    }

    this._history.push(norm);
    if (this._history.length > HISTORY_SIZE) this._history.shift();
  }

  /** Read the pending signal to inject at the start of the next sample() call. */
  consumeSignal(): string | null {
    return this._pendingSignal;
  }
}

// ─── Parameter Assembly ───────────────────────────────────────────────────────

export interface SampleParams {
  prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: any }>;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  modelPreferences?: unknown;
  stopSequences?: string[];
  includeContext?: 'none' | 'thisServer' | 'allServers';
}

export interface AugmentedSampleParams {
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  systemPrompt: string | undefined;
  maxTokens: number;
  temperature: number | undefined;
  modelPreferences: unknown;
  stopSequences: string[] | undefined;
  includeContext: string | undefined;
}

/**
 * Assemble the final messages + systemPrompt to pass to samplingProvider.
 *
 * Reads memory includes and the context registry, then composes them with
 * the caller-supplied params. Fail-soft: errors in memory reads or registry
 * assembly are swallowed so a broken memory backend never kills a sample() call.
 */
export async function assembleSampleParams(
  params: SampleParams,
  memory: any,
  context: ContextRegistry,
  repeatSignal: string | null
): Promise<AugmentedSampleParams> {
  const baseMessages: Array<{ role: 'user' | 'assistant'; content: any }> = params.messages ?? [
    { role: 'user' as const, content: { type: 'text', text: params.prompt! } },
  ];

  let memorySystemParts: string[] = [];
  let memoryTransientParts: string[] = [];

  try {
    const [systemEntries, transientEntries] = await Promise.all([
      memory.list('include_system_') as Promise<Array<{ key: string; value: string }>>,
      memory.list('include_transient_') as Promise<Array<{ key: string; value: string }>>,
    ]);
    memorySystemParts = systemEntries.map((e: { value: string }) => e.value).filter(Boolean);
    memoryTransientParts = transientEntries.map((e: { value: string }) => e.value).filter(Boolean);
  } catch {
    // Fail-soft: leave both arrays empty
  }

  // Build systemPrompt: repeat signal → memory system includes → caller systemPrompt
  const systemParts: string[] = [];
  if (repeatSignal) systemParts.push(repeatSignal);
  if (memorySystemParts.length) systemParts.push(memorySystemParts.join('\n\n'));
  if (params.systemPrompt) systemParts.push(params.systemPrompt);
  const systemPrompt = systemParts.length ? systemParts.join('\n\n') : undefined;

  // Build trailing transient message: memory transient includes + context registry
  const transientParts: string[] = [];
  if (memoryTransientParts.length) transientParts.push(memoryTransientParts.join('\n\n'));

  let contextText = '';
  try {
    contextText = context.assemble();
  } catch {
    // Fail-soft
  }
  if (contextText) transientParts.push(contextText);

  const messages =
    transientParts.length > 0
      ? [
          ...baseMessages,
          {
            role: 'user' as const,
            content: { type: 'text', text: transientParts.join('\n\n') },
          },
        ]
      : baseMessages;

  return {
    messages,
    systemPrompt,
    maxTokens: params.maxTokens ?? 1024,
    temperature: params.temperature,
    modelPreferences: params.modelPreferences,
    stopSequences: params.stopSequences,
    includeContext: params.includeContext,
  };
}
