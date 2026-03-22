/**
 * Spreadsheet — CSV-backed spreadsheet with formulas
 *
 * A spreadsheet engine that works on plain CSV files. Formulas (=SUM, =AVG, etc.)
 * are stored directly in CSV cells and evaluated at runtime. Named instances map
 * to CSV files: `_use('budget')` → `budget.csv` in your spreadsheets folder.
 * Pass a full path to open any CSV: `_use('/path/to/data.csv')`.
 *
 * @version 1.1.0
 * @runtime ^1.14.0
 * @tags spreadsheet, csv, formulas, data
 * @icon 📊
 * @stateful
 * @dependencies @portel/csv@^1.0.0, alasql@^4.0.0
 * @ui dashboard ./ui/spreadsheet.html
 */

import * as fs from 'fs/promises';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
  watch as fsWatch,
  type FSWatcher,
} from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

// Lazy-loaded: installed by @dependencies at runtime
let CsvEngine: any;
let cellToIndex: any;

interface WatchDef {
  name: string;
  query: string;
  action?: string;
  actionParams?: Record<string, any>;
  once: boolean;
  lastTriggered?: string;
  triggerCount: number;
}

class ConcurrencyLock {
  private promise: Promise<void> = Promise.resolve();
  async acquire(): Promise<() => void> {
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = this.promise;
    this.promise = next;
    await current;
    return release!;
  }
}

export default class Spreadsheet {
  private engine: any;
  private loaded = false;
  private _lastLoadSize = -1;
  private _lock = new ConcurrencyLock();
  private _isLargeFileThreshold = 5 * 1024 * 1024; // 5MB
  private _engines: Map<string, any> = new Map();

  // File watcher state
  private _watcher: FSWatcher | null = null;
  private _lastFileSize = 0;
  private _watchDebounce: ReturnType<typeof setTimeout> | null = null;

  declare emit: (data: any) => void;
  declare call: (
    target: string,
    params?: Record<string, any>,
    options?: { instance?: string }
  ) => Promise<any>;
  declare instanceName: string;

  // SQL watch state
  private _watches: Map<string, WatchDef> = new Map();
  private _watcherAutoStarted = false;

  protected settings = {
    /** @property Directory where spreadsheet CSV files are stored */
    folder: path.join(os.homedir(), 'Documents', 'Spreadsheets'),
    /** @property Save format row: true (always), false (never), auto (if original had one or formatting was customized) */
    formatting: 'auto' as 'auto' | 'true' | 'false',
    /** @property Row count for paging in view() */
    pageSize: 100,
  };

  async onInitialize() {
    const csvId = '@portel/csv';
    const csvModule = await import(/* webpackIgnore: true */ csvId);
    CsvEngine = csvModule.CsvEngine || csvModule.default?.CsvEngine;
    cellToIndex = csvModule.cellToIndex || csvModule.default?.cellToIndex;
    this.engine = new CsvEngine();
  }

  private get defaultFolder(): string {
    return this.settings?.folder || path.join(os.homedir(), 'Documents', 'Spreadsheets');
  }

  private get csvPath(): string {
    const name = this.instanceName || 'default';

    if (path.isAbsolute(name)) {
      return name.endsWith('.csv') ? name : name + '.csv';
    }

    if (name.includes('/') || name.includes('\\')) {
      const resolved = path.resolve(name);
      return resolved.endsWith('.csv') ? resolved : resolved + '.csv';
    }

    const dir = this.defaultFolder;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return path.join(dir, name.endsWith('.csv') ? name : name + '.csv');
  }

  // --- Optimized Reading (Generator Pattern) ---

  /**
   * Memory-efficient line-by-line generator
   */
  private async *getLineGenerator(): AsyncGenerator<string> {
    const csvPath = this.csvPath;
    if (!existsSync(csvPath)) return;

    const fileStream = createReadStream(csvPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      yield line;
    }
  }

  /**
   * Helper to get or load an engine for a specific table name
   */
  private async _getCsvEngine(name: string): Promise<any> {
    if (name === this.instanceName || (name === 'default' && !this.instanceName)) {
      await this.load();
      return this.engine;
    }

    if (this._engines.has(name)) return this._engines.get(name)!;

    const csvPath = path.join(this.defaultFolder, name.endsWith('.csv') ? name : name + '.csv');
    if (existsSync(csvPath)) {
      const csv = await fs.readFile(csvPath, 'utf-8');
      const engine = CsvEngine.fromCSV(csv);
      this._engines.set(name, engine);
      return engine;
    }
    throw new Error(`Table "${name}" not found in ${this.defaultFolder}`);
  }

  /**
   * Pre-process Airtable-style formulas ({Field} -> "Field")
   */
  private _processAirtableFormula(formula: string): string {
    // Replace {Field Name} with "Field Name" for SQL/Expression compatibility
    return formula.replace(/\{([^}]+)\}/g, '"$1"');
  }

  // --- Persistence ---

  private async load(): Promise<void> {
    const csvPath = this.csvPath;
    const exists = existsSync(csvPath);
    const currentSize = exists ? statSync(csvPath).size : -1;

    if (this.loaded && currentSize === this._lastLoadSize) return;

    // For very large files, we only load headers and formatting into the engine
    // and use streaming for data operations.
    if (exists && currentSize > this._isLargeFileThreshold) {
      await this.loadHeadersOnly();
      return;
    }

    const release = await this._lock.acquire();
    try {
      if (exists) {
        const csv = await fs.readFile(csvPath, 'utf-8');
        if (csv.trim().length > 0) {
          this.engine = CsvEngine.fromCSV(csv);
          this.loaded = true;
          this._lastLoadSize = currentSize;
          this._lastFileSize = currentSize;
          return;
        }
      }

      this.engine = new CsvEngine();
      this.loaded = true;
      this._lastLoadSize = currentSize;
      this._lastFileSize = exists ? currentSize : 0;
    } finally {
      release();
    }
  }

  private async loadHeadersOnly(): Promise<void> {
    const release = await this._lock.acquire();
    try {
      const generator = this.getLineGenerator();
      const headersLine = await generator.next();
      const formatLine = await generator.next();

      let csv = (headersLine.value || '') + '\n';
      if (formatLine.value?.startsWith('#fmt:')) {
        csv += formatLine.value + '\n';
      }

      this.engine = CsvEngine.fromCSV(csv);
      this.loaded = true;
      this._lastLoadSize = statSync(this.csvPath).size;
      this._lastFileSize = this._lastLoadSize;
    } finally {
      release();
    }
  }

  private async save(): Promise<void> {
    const release = await this._lock.acquire();
    try {
      const dir = path.dirname(this.csvPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const formatRow = this.shouldWriteFormatRow();
      const csv = this.engine.toCSV({ formatRow });
      await fs.writeFile(this.csvPath, csv, 'utf-8');

      // Update size to prevent immediate reload
      this._lastLoadSize = statSync(this.csvPath).size;
      this._lastFileSize = this._lastLoadSize;
    } finally {
      release();
    }
  }

  /**
   * Optimized append: writes directly to end of file without rewriting
   */
  private async appendRows(rows: string[][]): Promise<void> {
    const release = await this._lock.acquire();
    try {
      const csvPath = this.csvPath;
      const csvData = rows.map((r) => r.join(',')).join('\n') + '\n';

      // Ensure file ends with newline before appending
      const stats = statSync(csvPath);
      if (stats.size > 0) {
        const fd = await fs.open(csvPath, 'r+');
        const buffer = Buffer.alloc(1);
        await fd.read(buffer, 0, 1, stats.size - 1);
        if (buffer.toString() !== '\n') {
          await fd.write('\n', stats.size);
        }
        await fd.close();
      }

      await fs.appendFile(csvPath, csvData, 'utf-8');
      this._lastLoadSize = statSync(csvPath).size;
      this._lastFileSize = this._lastLoadSize;
    } finally {
      release();
    }
  }

  private shouldWriteFormatRow(): boolean {
    const fmt = this.settings?.formatting || 'auto';
    if (fmt === 'true') return true;
    if (fmt === 'false') return false;
    return this.engine.getHasFormatRow() || this.engine.getMetaCustomized();
  }

  // --- Response formatting ---

  private buildResponse(message: string): Record<string, any> {
    const snap = this.engine.snapshot(message);
    return { ...snap, file: this.csvPath };
  }

  // --- Tool methods ---

  /**
   * Open spreadsheet UI
   *
   * @ui spreadsheet
   * @autorun
   */
  async main() {
    await this.load();
    return this.buildResponse(`Opened ${path.basename(this.csvPath)}`);
  }

  /**
   * List all tables (CSV files) in the spreadsheets folder
   * @title List Tables
   */
  async list_tables() {
    const dir = this.defaultFolder;
    if (!existsSync(dir)) return { tables: [], message: 'No tables found' };

    const files = await fs.readdir(dir);
    const tables = files
      .filter((f) => f.endsWith('.csv'))
      .map((f) => ({
        name: f.replace('.csv', ''),
        file: f,
        size: statSync(path.join(dir, f)).size,
        modified: statSync(path.join(dir, f)).mtime.toISOString(),
      }));

    return {
      tables,
      count: tables.length,
      message: `Found ${tables.length} table(s) in ${dir}`,
    };
  }

  /**
   * View records (Airtable-compatible)
   *
   * @param maxRecords Max records to return (default 100)
   * @param offset Row offset for pagination
   * @param filterByFormula Optional formula to filter records (e.g. "{Age} > 25")
   * @title List Records
   * @format table
   */
  async list_records(params: { maxRecords?: number; offset?: number; filterByFormula?: string }) {
    await this.load();

    if (params.filterByFormula) {
      const sqlWhere = this._processAirtableFormula(params.filterByFormula);
      // Try to use the engine's query capability with the processed formula
      try {
        const results = await this.engine.query(sqlWhere, params.maxRecords);
        return results;
      } catch (err: any) {
        console.warn('Filter formula failed, returning all records:', err.message);
      }
    }

    return this.view({
      limit: params.maxRecords,
      offset: params.offset,
    });
  }

  /**
   * Lookup a value from another table
   *
   * Mimics the relational "Lookup" field in Airtable/Google Sheets.
   *
   * @param table Other table name (e.g. "Products")
   * @param matchField Field in the other table to match against (e.g. "SKU")
   * @param matchValue Value to search for (e.g. "A101")
   * @param resultField Field to return from the matching row (e.g. "Price")
   * @example lookup({ table: 'Products', matchField: 'SKU', matchValue: 'A101', resultField: 'Price' })
   */
  async lookup(params: {
    table: string;
    matchField: string;
    matchValue: string;
    resultField: string;
  }) {
    const otherEngine = await this._getCsvEngine(params.table);
    const where = `${params.matchField} = "${params.matchValue}"`;
    const result = await otherEngine.query(where, 1);

    if (result && result.data && result.data.length > 0) {
      const headers = otherEngine.getHeaders();
      const resIdx = headers.indexOf(params.resultField);
      if (resIdx !== -1) {
        return { value: result.data[0][resIdx], message: 'Found match' };
      }
    }

    return { value: null, message: 'No match found' };
  }

  /**
   * Get a single record by its row number
   * @param recordId Row number (1-indexed)
   * @title Get Record
   */
  async get_record(params: { recordId: number }) {
    await this.load();
    const row = this.engine.getRow(params.recordId);
    if (!row) throw new Error(`Record ${params.recordId} not found`);
    return { id: params.recordId, fields: row };
  }

  /**
   * Create a new record (Airtable-compatible)
   * @param fields Key-value pairs for the new record
   * @title Create Record
   */
  async create_record(params: { fields: Record<string, string> }) {
    return this.add({ values: params.fields });
  }

  /**
   * Update an existing record (Airtable-compatible)
   * @param recordId Row number (1-indexed)
   * @param fields Key-value pairs to update
   * @title Update Record
   */
  async update_record(params: { recordId: number; fields: Record<string, string> }) {
    return this.update({ row: params.recordId, values: params.fields });
  }

  /**
   * Delete a record (Airtable-compatible)
   * @param recordId Row number (1-indexed)
   * @title Delete Record
   */
  async delete_record(params: { recordId: number }) {
    return this.remove({ row: params.recordId });
  }

  /**
   * Search for records (Airtable-compatible)
   * @param query Text to search for
   * @title Search Records
   */
  async search_records(params: { query: string }) {
    return this.search({ query: params.query });
  }

  /**
   * View the spreadsheet grid
   *
   * Returns the full spreadsheet or a specific range as a formatted table.
   *
   * @param range Optional cell range to view (e.g., "A1:D10")
   * @param offset Row offset for pagination
   * @param limit Max rows to return (defaults to settings.pageSize)
   * @format table
   */
  async view(params?: { range?: string; offset?: number; limit?: number }) {
    await this.load();

    if (params?.range) {
      return {
        ...this.buildResponse(`Viewing range ${params.range}`),
        table: this.engine.toTable(params.range),
      };
    }

    const limit = params?.limit || this.settings.pageSize;
    const offset = params?.offset || 0;

    // For the UI, we still return the snapshot, but we can respect the pagination hints
    return {
      ...this.buildResponse(path.basename(this.csvPath)),
      offset,
      limit,
      total: this.engine.rowCount,
    };
  }

  /**
   * Get a cell value
   *
   * Returns the evaluated value and raw content (formula if any) for a single cell.
   *
   * @param cell Cell reference in A1 notation (e.g., "B3")
   */
  async get(params: { cell: string }) {
    await this.load();

    const { row, col } = cellToIndex(params.cell);

    if (row >= this.engine.rowCount || col >= this.engine.colCount) {
      return { cell: params.cell, value: '', raw: '', message: 'Cell is empty' };
    }

    const raw = this.engine.getRawCell(row, col);
    const value = this.engine.evaluate(row, col);

    return {
      cell: params.cell,
      value,
      raw,
      message: raw.startsWith('=')
        ? `${params.cell} = ${value} (${raw})`
        : `${params.cell} = ${value || '(empty)'}`,
    };
  }

  /**
   * Set a cell value or formula
   *
   * Set a cell to a plain value or a formula starting with "=".
   * Formulas support: SUM, AVG, MAX, MIN, COUNT, IF, LEN, ABS, ROUND, CONCAT.
   * Cell references use A1 notation. Ranges use A1:B2 notation.
   *
   * @param cell Cell reference in A1 notation (e.g., "B3")
   * @param value Value or formula (e.g., "42" or "=SUM(A1:A5)")
   * @example set({ cell: 'B3', value: '=SUM(B1:B2)' })
   */
  async set(params: { cell: string; value: string }) {
    await this.load();

    const { row, col } = cellToIndex(params.cell);

    const oldRaw = this.engine.getRawCell(row, col);
    const oldDisplay = oldRaw.startsWith('=') ? this.engine.evaluate(row, col) : oldRaw;

    this.engine.set(params.cell, String(params.value));
    await this.save();

    const evaluated = this.engine.evaluate(row, col);
    const msg = oldRaw
      ? `Set ${params.cell} = ${evaluated} (was: ${oldDisplay})`
      : `Set ${params.cell} = ${evaluated}`;

    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Add a row of data
   *
   * Add a new row to the bottom of the spreadsheet. Pass column values by header name.
   *
   * @param values Key-value pairs mapping column names to values (e.g., {"Name": "Alice", "Age": "30"})
   * @example add({ values: { Name: 'Alice', Age: '30' } })
   */
  async add(params: { values: Record<string, string> }) {
    await this.load();

    // If file is large and we are just adding a simple row, use optimized append
    const isLarge = statSync(this.csvPath).size > this._isLargeFileThreshold;
    const canAppend = !this.engine.getMetaCustomized(); // Simple append if no formula-heavy meta

    if (isLarge && canAppend) {
      const rowValues = this.engine.getHeaders().map((h: any) => params.values[h] || '');
      await this.appendRows([rowValues]);
      // Update engine state in memory without full reload if possible
      this.engine.add(params.values);
      const msg = `Appended row to large CSV`;
      await this._emitAndWatch(msg);
      return this.buildResponse(msg);
    }

    const rowNum = this.engine.add(params.values);
    await this.save();

    const msg = `Added row ${rowNum}`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Remove a row
   *
   * @param row Row number to remove (1-indexed)
   */
  async remove(params: { row: number }) {
    await this.load();

    this.engine.remove(params.row);
    await this.save();

    const msg = `Removed row ${params.row}`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Remove a column
   *
   * @param column Column letter or header name to remove
   */
  async removeColumn(params: { column: string }) {
    await this.load();

    const oldName = this.engine.removeColumn(params.column);
    await this.save();

    const msg = `Removed column "${oldName}"`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Insert a row at a specific position
   *
   * @param row Row number to insert before (1-indexed)
   * @param values Optional: Key-value pairs for the new row
   */
  async insertRow(params: { row: number; values?: Record<string, string> }) {
    await this.load();

    this.engine.insertRow(params.row, params.values);
    await this.save();

    const msg = `Inserted row at ${params.row}`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Insert a column at a specific position
   *
   * @param column Column letter or header name to insert before
   * @param name Name for the new column
   */
  async insertColumn(params: { column: string; name: string }) {
    await this.load();

    this.engine.insertColumn(params.column, params.name);
    await this.save();

    const msg = `Inserted column "${params.name}" before ${params.column}`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Update or insert a row (Database Upsert)
   *
   * Finds a row matching the `search` criteria. If found, updates it with `values`.
   * If not found, adds a new row with `values`.
   *
   * @param search Key-value pairs to match an existing row (e.g., {"ID": "123"})
   * @param values Key-value pairs to set in the row
   * @example upsert({ search: { ID: '101' }, values: { Name: 'Alice', Status: 'Active' } })
   */
  async upsert(params: { search: Record<string, string>; values: Record<string, string> }) {
    await this.load();

    const result = this.engine.upsert(params.search, params.values);
    await this.save();

    const msg =
      result.type === 'update'
        ? `Updated matching row ${result.row}`
        : `Added new row ${result.row}`;

    await this._emitAndWatch(msg);
    return { ...this.buildResponse(msg), ...result };
  }

  /**
   * Fuzzy search across columns
   *
   * Finds rows containing the query string in any of the specified columns.
   * Uses streaming generator for memory efficiency on large files.
   *
   * @param query Search string
   * @param columns Optional: array of column names to search (searches all if omitted)
   * @param limit Max results to return
   * @format table
   */
  async search(params: { query: string; columns?: string[]; limit?: number }) {
    const csvPath = this.csvPath;
    const isLarge = existsSync(csvPath) && statSync(csvPath).size > this._isLargeFileThreshold;
    const limit = params.limit || 50;

    if (isLarge) {
      const results: any[] = [];
      const query = params.query.toLowerCase();

      const generator = this.getLineGenerator();
      const headersResult = await generator.next();
      const headers = headersResult.value?.split(',') || [];

      const searchIndices = params.columns
        ? params.columns.map((c: string) => headers.indexOf(c)).filter((i: number) => i !== -1)
        : headers.map((_: any, i: number) => i);

      for await (const line of generator) {
        if (line.startsWith('#fmt:')) continue;
        const cells = line.split(',');
        const match = searchIndices.some((i: number) => cells[i]?.toLowerCase().includes(query));

        if (match) {
          const row: any = {};
          headers.forEach((h: any, i: any) => (row[h] = cells[i]));
          results.push(row);
          if (results.length >= limit) break;
        }
      }
      return results;
    }

    await this.load();
    return this.engine.search(params.query, params.columns, params.limit);
  }

  /**
   * Update fields in a row
   *
   * @param row Row number to update (1-indexed)
   * @param values Key-value pairs mapping column names to new values
   * @example update({ row: 3, values: { Age: '42' } })
   */
  async update(params: { row: number; values: Record<string, string> }) {
    await this.load();

    const changes = this.engine.update(params.row, params.values);
    await this.save();

    const msg = `Updated row ${params.row}: ${changes.join(', ')}`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Query rows by condition
   *
   * Filter rows where a column matches a condition. Supports: =, !=, >, <, >=, <=, contains.
   *
   * @param where Condition string (e.g., "Age > 25", "Name contains Ali")
   * @param limit Max rows to return
   * @example query({ where: 'Age > 25' })
   */
  async query(params: { where: string; limit?: number }) {
    await this.load();
    return this.engine.query(params.where, params.limit);
  }

  /**
   * Sort by column
   *
   * Sorts all data rows by the specified column.
   *
   * @param column Column name or letter to sort by
   * @param order Sort order: "asc" or "desc" (default: "asc")
   * @example sort({ column: 'Age', order: 'desc' })
   */
  async sort(params: { column: string; order?: string }) {
    await this.load();

    this.engine.sort(params.column, params.order);
    await this.save();

    const msg = `Sorted by ${params.column} (${params.order || 'asc'})`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Fill a range with values or a pattern
   *
   * @param range Cell range (e.g., "A1:A10")
   * @param pattern Comma-separated values to repeat (e.g., "1,2,3")
   * @example fill({ range: 'A1:A10', pattern: '1,2,3' })
   */
  async fill(params: { range: string; pattern: string }) {
    await this.load();

    this.engine.fill(params.range, params.pattern);
    await this.save();

    const msg = `Filled ${params.range} with pattern [${params.pattern}]`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Show column headers and detected types
   *
   * @format table
   */
  async schema() {
    await this.load();

    const schema = this.engine.schema();
    const table =
      '| Column | Type | Non-empty | Total |\n|--------|------|-----------|-------|\n' +
      schema.map((s: any) => `| ${s.column} | ${s.type} | ${s.nonEmpty} | ${s.total} |`).join('\n');

    return {
      table,
      schema,
      headers: this.engine.getHeaders(),
      message: `${this.engine.colCount} columns, ${this.engine.rowCount} rows`,
      file: this.csvPath,
    };
  }

  /**
   * Resize the spreadsheet grid
   *
   * @param rows New number of rows
   * @param cols New number of columns
   */
  async resize(params: { rows?: number; cols?: number }) {
    await this.load();

    this.engine.resize(params.rows, params.cols);
    await this.save();

    return this.buildResponse(
      `Resized to ${this.engine.rowCount} rows x ${this.engine.colCount} cols`
    );
  }

  /**
   * Import CSV data
   *
   * Load data from a CSV file path or raw CSV text. The first row is treated as headers.
   *
   * @param file Path to a CSV file to import
   * @param csv Raw CSV text to import (alternative to file)
   * @example ingest({ csv: 'Name,Age\\nAlice,30\\nBob,25' })
   */
  async ingest(params: { file?: string; csv?: string }) {
    let csvText: string;

    if (params.file) {
      csvText = await fs.readFile(params.file, 'utf-8');
    } else if (params.csv) {
      csvText = params.csv;
    } else {
      throw new Error('Provide either "file" path or "csv" text');
    }

    this.engine = CsvEngine.fromCSV(csvText);
    this.loaded = true;

    await this.save();

    const msg = `Imported ${this.engine.rowCount} rows x ${this.engine.colCount} cols`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Export as CSV
   *
   * Returns the raw CSV content (with formulas preserved), or saves to a file.
   *
   * @param file Optional file path to save CSV to
   */
  async dump(params?: { file?: string }) {
    await this.load();

    const csvText = this.engine.toCSV({ formatRow: this.shouldWriteFormatRow() });

    if (params?.file) {
      const dir = path.dirname(params.file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      await fs.writeFile(params.file, csvText, 'utf-8');
      return { message: `Exported to ${params.file}`, file: params.file };
    }

    const lineCount = csvText.split('\n').filter((l: string) => l.length > 0).length - 1;
    return { csv: csvText, message: `CSV export (${lineCount} rows)` };
  }

  /**
   * Clear cells
   *
   * Clear all cells or a specific range.
   *
   * @param range Optional range to clear (e.g., "B:B" or "A1:C5"). Clears all if omitted.
   */
  async clear(params?: { range?: string }) {
    await this.load();

    this.engine.clear(params?.range);
    await this.save();

    const msg = params?.range ? `Cleared range ${params.range}` : 'Cleared all cells';
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Rename a column header
   *
   * @param column Column letter or current header name
   * @param name New header name
   * @example rename({ column: 'A', name: 'Product' })
   */
  async rename(params: { column: string; name: string }) {
    await this.load();

    const old = this.engine.rename(params.column, params.name);
    await this.save();

    return this.buildResponse(`Renamed column: "${old}" -> "${params.name}"`);
  }

  /**
   * Set column formatting
   *
   * Set alignment, type, or width for a column. This creates a format row in the CSV
   * when formatting is set to "auto" (default).
   *
   * @param column Column letter or header name
   * @param align Alignment: "left", "right", or "center"
   * @param type Column type: "text", "number", "currency", "percent", "date", "bool", "select", "formula", "markdown", "longtext"
   * @param width Column width in pixels
   * @param wrap Enable text wrapping for this column
   * @example format({ column: 'B', align: 'right', type: 'number' })
   * @example format({ column: 'C', type: 'markdown', wrap: true })
   */
  async format(params: {
    column: string;
    align?: string;
    type?: string;
    width?: number;
    wrap?: boolean;
  }) {
    await this.load();

    this.engine.format(params.column, {
      align: params.align,
      type: params.type,
      width: params.width,
      wrap: params.wrap,
    });
    await this.save();

    const changes = [
      params.align && `align=${params.align}`,
      params.type && `type=${params.type}`,
      params.width !== undefined && `width=${params.width}`,
      params.wrap !== undefined && `wrap=${params.wrap}`,
    ]
      .filter(Boolean)
      .join(', ');

    const msg = `Formatted ${params.column}: ${changes}`;
    await this._emitAndWatch(msg);
    return this.buildResponse(msg);
  }

  /**
   * Watch the CSV file for appended rows
   *
   * Starts watching the underlying CSV file. When external processes append rows,
   * the spreadsheet updates in real-time. Use `unwatch` to stop.
   */
  async tail() {
    await this.load();

    if (this._watcher) {
      return {
        message: `Already watching ${path.basename(this.csvPath)}`,
        file: this.csvPath,
        watching: true,
      };
    }

    this._startFileWatching();
    this._watcherAutoStarted = false;

    const msg = `Watching ${path.basename(this.csvPath)} for changes`;
    return { ...this.buildResponse(msg), watching: true };
  }

  /**
   * Stop watching the CSV file
   *
   * Stops the file watcher started by `tail`.
   */
  async untail() {
    this._watcherAutoStarted = false;
    this._stopFileWatching();
    return { message: 'Stopped watching', watching: false };
  }

  /**
   * Append rows to the spreadsheet
   *
   * Batch-append one or more rows. Each row is a list of values matching
   * the column order, or a key-value object mapping column names to values.
   * Emits after all rows are added so charts and UIs update once.
   *
   * @param rows Array of rows to append. Each row is either an array of values or a {column: value} object.
   * @example push({ rows: [["Alice", "30"], ["Bob", "25"]] })
   * @example push({ rows: [{"Name": "Alice", "Age": "30"}] })
   */
  async push(params: { rows: (string[] | Record<string, string>)[] }) {
    await this.load();

    const isLarge = statSync(this.csvPath).size > this._isLargeFileThreshold;
    if (isLarge) {
      const headers = this.engine.getHeaders();
      const rowsToAppend = params.rows.map((row) => {
        if (Array.isArray(row)) return row;
        return headers.map((h: any) => row[h] || '');
      });

      await this.appendRows(rowsToAppend);
      // Synchronize engine row count
      for (const r of params.rows)
        this.engine.add(typeof r === 'object' && !Array.isArray(r) ? r : {});

      const msg = `Stream-pushed ${rowsToAppend.length} rows`;
      await this._emitAndWatch(msg, { autoScroll: true });
      return this.buildResponse(msg);
    }

    const added = this.engine.push(params.rows);
    await this.save();

    const msg = `Pushed ${added} row(s) (${this.engine.rowCount} total)`;
    await this._emitAndWatch(msg, { autoScroll: true });
    return this.buildResponse(msg);
  }

  /** Handle file change detected by watcher */
  private async _onFileChanged(): Promise<void> {
    try {
      const csvPath = this.csvPath;
      if (!existsSync(csvPath)) return;

      const currentSize = statSync(csvPath).size;
      if (currentSize <= this._lastFileSize) {
        if (currentSize < this._lastFileSize) {
          this.loaded = false;
          await this.load();
          this._lastFileSize = currentSize;
          await this._emitAndWatch('File reloaded (truncated)', { autoScroll: false });
        }
        return;
      }

      // Read only the new bytes appended since last check
      const fd = await fs.open(csvPath, 'r');
      const newBytes = Buffer.alloc(currentSize - this._lastFileSize);
      await fd.read(newBytes, 0, newBytes.length, this._lastFileSize);
      await fd.close();
      this._lastFileSize = currentSize;

      const newText = newBytes.toString('utf-8');
      const newLines = newText.split('\n').filter((l) => l.trim().length > 0);

      if (newLines.length === 0) return;

      const added = this.engine.appendCSVLines(newLines);

      if (added > 0) {
        const msg = `+${added} row(s) from file (${this.engine.rowCount} total)`;
        await this._emitAndWatch(msg, { autoScroll: true });
      }
    } catch (err) {
      console.error('File watch handler error:', err);
    }
  }

  // --- SQL & Watch tools ---

  /**
   * Run a SQL query on the spreadsheet data
   *
   * Query the spreadsheet using SQL syntax. Table name is `data`.
   * Column names with spaces or special characters need double quotes.
   *
   * @param query SQL query string (e.g., "SELECT * FROM data WHERE Age > 25")
   * @example sql({ query: "SELECT Name, Age FROM data WHERE Age > 25 ORDER BY Age DESC" })
   * @example sql({ query: "SELECT COUNT(*) as total FROM data" })
   */
  async sql(params: { query: string }) {
    await this.load();
    return await this.engine.sql(params.query);
  }

  /**
   * Create a live SQL watch
   *
   * Registers a named SQL query that re-runs after every data change.
   * When the query returns rows, an alert is emitted. Optionally triggers
   * a cross-photon action (e.g., "slack.send").
   *
   * @param name Unique watch name (e.g., "price-alert")
   * @param query SQL query — fires when it returns rows (e.g., "SELECT * FROM data WHERE Price < 50")
   * @param action Optional cross-photon call target (e.g., "slack.send")
   * @param actionParams Optional parameters passed to the action
   * @param once If true, auto-removes after first trigger
   * @example watch({ name: "big-orders", query: "SELECT * FROM data WHERE Amount > 1000" })
   * @example watch({ name: "notify", query: "SELECT * FROM data WHERE Status = 'critical'", action: "slack.send", actionParams: { text: "Critical row found!" }, once: true })
   */
  async watch(params: {
    name: string;
    query: string;
    action?: string;
    actionParams?: Record<string, any>;
    once?: boolean;
  }) {
    await this.load();

    const def: WatchDef = {
      name: params.name,
      query: params.query,
      action: params.action,
      actionParams: params.actionParams,
      once: params.once ?? false,
      triggerCount: 0,
    };

    this._watches.set(params.name, def);

    if (!this._watcher) {
      this._startFileWatching();
      this._watcherAutoStarted = true;
    }

    // Run query immediately to check current state
    let currentMatches = 0;
    try {
      const result = await this.engine.sql(params.query);
      currentMatches = Array.isArray(result.result) ? result.result.length : 0;
    } catch {
      /* validation happens on first real run */
    }

    return {
      message: `Watch "${params.name}" created${currentMatches > 0 ? ` (${currentMatches} rows match now)` : ''}`,
      watch: params.name,
      currentMatches,
      watches: this._watches.size,
    };
  }

  /**
   * Remove a live SQL watch
   *
   * @param name Watch name to remove
   */
  async unwatch(params: { name: string }) {
    const existed = this._watches.delete(params.name);

    if (this._watches.size === 0 && this._watcherAutoStarted) {
      this._stopFileWatching();
      this._watcherAutoStarted = false;
    }

    return {
      message: existed ? `Removed watch "${params.name}"` : `Watch "${params.name}" not found`,
      watches: this._watches.size,
    };
  }

  /**
   * List active SQL watches
   *
   * Shows all registered watches with their trigger counts and status.
   */
  async watches() {
    const list = Array.from(this._watches.values()).map((w) => ({
      name: w.name,
      query: w.query,
      action: w.action,
      once: w.once,
      triggerCount: w.triggerCount,
      lastTriggered: w.lastTriggered || null,
    }));

    return {
      watches: list,
      count: list.length,
      message: list.length > 0 ? `${list.length} active watch(es)` : 'No active watches',
    };
  }

  // --- File watching helpers ---

  private _startFileWatching(): void {
    if (this._watcher) return;

    const csvPath = this.csvPath;
    if (!existsSync(csvPath)) return;

    this._lastFileSize = statSync(csvPath).size;
    this._watcher = fsWatch(csvPath, () => {
      if (this._watchDebounce) clearTimeout(this._watchDebounce);
      this._watchDebounce = setTimeout(() => {
        void this._onFileChanged();
      }, 200);
    });
  }

  private _stopFileWatching(): void {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
      if (this._watchDebounce) {
        clearTimeout(this._watchDebounce);
        this._watchDebounce = null;
      }
    }
  }

  // --- Emit + watch pipeline ---

  private async _emitAndWatch(msg: string, opts: Record<string, any> = {}): Promise<void> {
    this.emit({ emit: 'data', ...this.buildResponse(msg), ...opts });
    await this._rerunWatches();
  }

  private async _rerunWatches(): Promise<void> {
    if (this._watches.size === 0) return;

    for (const [name, watch] of this._watches) {
      try {
        const result = await this.engine.sql(watch.query);
        if (Array.isArray(result.result) && result.result.length > 0) {
          watch.triggerCount++;
          watch.lastTriggered = new Date().toISOString();
          this.emit({
            emit: 'alert',
            watch: name,
            rows: result.result,
            count: result.result.length,
          });

          if (watch.action && this.call) {
            try {
              await this.call(watch.action, { ...watch.actionParams, _matchedRows: result.result });
            } catch (err) {
              console.error(`Watch "${name}" action failed:`, err);
            }
          }

          if (watch.once) this._watches.delete(name);
        }
      } catch (err) {
        console.error(`Watch "${name}" query error:`, err);
      }
    }
  }
}
