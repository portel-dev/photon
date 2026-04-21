/**
 * Runtime-agnostic SQLite loader.
 *
 * Under Bun: uses the built-in `bun:sqlite` (zero install). Under Node: falls
 * back to `better-sqlite3` loaded as an optional peer dependency. API surface
 * of both databases is equivalent for the subset we use (`prepare`, `run`,
 * `get`, `all`, `exec`, `pragma`, `transaction`, `close`), so callers can
 * treat the returned handle uniformly.
 *
 * Callers should treat the database handle as `SqliteDatabase` (structurally
 * typed) and the statement handle as `SqliteStatement`. Runtime detection
 * happens once per process; subsequent opens reuse the same constructor.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqliteDatabase = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqliteStatement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqliteCtor = new (path: string, opts?: any) => SqliteDatabase;

let cachedCtor: SqliteCtor | null = null;
let cachedRuntime: 'bun' | 'node' | null = null;

/**
 * @returns 'bun' if running under Bun, else 'node'.
 */
export function detectSqliteRuntime(): 'bun' | 'node' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasBun = typeof (globalThis as any).Bun !== 'undefined';
  return hasBun ? 'bun' : 'node';
}

/**
 * Load the SQLite Database constructor for the current runtime.
 * Caches the result so subsequent calls skip the dynamic import.
 */
export async function loadSqliteCtor(): Promise<SqliteCtor> {
  if (cachedCtor) return cachedCtor;
  const runtime = detectSqliteRuntime();
  cachedRuntime = runtime;

  if (runtime === 'bun') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await dynamicImport('bun:sqlite');
    cachedCtor = mod.Database as SqliteCtor;
    return cachedCtor;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await dynamicImport('better-sqlite3');
    cachedCtor = (mod.default ?? mod) as SqliteCtor;
    return cachedCtor;
  } catch (err) {
    // Two common causes: not installed, or install script was blocked by
    // Bun's default trust gate so the native binding never compiled.
    // Surface both with copy-pasteable fix commands.
    const msg = err instanceof Error ? err.message : String(err);
    const looksTrustBlocked =
      /MODULE_NOT_FOUND|Cannot find module|find the prebuilt|ELIFECYCLE|postinstall/i.test(msg);
    throw new Error(
      looksTrustBlocked
        ? 'SQLite backend requires better-sqlite3 but its install script was blocked.\n' +
            '  Fix (Bun):  bun pm -g trust better-sqlite3\n' +
            '  Fix (npm):  npm rebuild better-sqlite3\n' +
            '  Under Bun, bun:sqlite works out of the box without better-sqlite3.'
        : 'SQLite not available on Node: install with `npm install better-sqlite3`. Under Bun no install is needed (bun:sqlite is built in).'
    );
  }
}

/**
 * Open a SQLite database at `path` with sensible defaults (WAL journal,
 * foreign keys on). The schema init function runs once on the returned
 * handle before it's returned to the caller.
 */
export async function openSqlite(
  path: string,
  initSchema: (db: SqliteDatabase) => void
): Promise<SqliteDatabase> {
  const Ctor = await loadSqliteCtor();
  const db = new Ctor(path);
  applyDefaultPragmas(db);
  initSchema(db);
  return db;
}

/**
 * Best-effort pragma application. Both backends accept the pragma() helper
 * but some older versions don't; swallowing errors keeps startup robust.
 */
function applyDefaultPragmas(db: SqliteDatabase): void {
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  } catch {
    // non-fatal; the DB still works without WAL
  }
}

/**
 * @returns whether SQLite is currently available in this process.
 */
export async function isSqliteAvailable(): Promise<boolean> {
  try {
    await loadSqliteCtor();
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns the cached runtime label, or null if the loader hasn't run yet.
 * For diagnostics and logs.
 */
export function getResolvedSqliteRuntime(): 'bun' | 'node' | null {
  return cachedRuntime;
}

/**
 * Dynamic import that bypasses TypeScript module-resolution checks,
 * letting us reference `bun:sqlite` (which only exists under Bun) and
 * `better-sqlite3` (an optional dep) without compile-time errors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dynamicImport(modName: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return await new Function('m', 'return import(m)')(modName);
}

/**
 * Internal: reset the cached constructor. For tests only.
 */
export function __resetSqliteCache(): void {
  cachedCtor = null;
  cachedRuntime = null;
}
