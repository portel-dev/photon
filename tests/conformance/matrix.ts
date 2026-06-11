/**
 * Conformance matrix generator
 *
 * Generates cross-transport parity checks from a photon's own extracted
 * schema instead of hand-written test cases. For every method the photon
 * declares, this asserts:
 *
 *   1. The method is exposed identically on STDIO MCP and SSE HTTP
 *      (tool surface, input schema, annotations).
 *   2. Invoking it with schema-synthesized arguments returns equivalent
 *      data on CLI (--json), STDIO MCP, and SSE HTTP.
 *
 * Hand-written parity tests (transport-parity.test.ts) cover specific
 * regressions; this matrix guarantees coverage of every method without
 * anyone remembering to add a case.
 *
 * Methods marked @destructive, @webhook, or @scheduled are exercised for
 * schema parity only, never invoked.
 */

import { SchemaExtractor } from '@portel/photon-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';

export interface ConformanceOptions {
  /** Path to dist/cli.js */
  cliPath: string;
  /** Port for the SSE server */
  ssePort: number;
  /** Method names to skip invocation for (nondeterministic, needs env, etc.) */
  skipInvocation?: string[];
  /** Per-method argument overrides when synthesis is not enough */
  argOverrides?: Record<string, Record<string, unknown>>;
}

export interface ConformanceFailure {
  method: string;
  check: string;
  detail: string;
}

export interface ConformanceReport {
  photon: string;
  methods: number;
  invoked: number;
  checks: number;
  failures: ConformanceFailure[];
}

interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  format?: string;
  default?: unknown;
}

interface ToolSchemaLike {
  name: string;
  inputSchema?: JsonSchemaLike;
  destructiveHint?: boolean;
  webhook?: string;
  scheduled?: string;
}

// ─────────────────────────────────────────────────────────
// Argument synthesis from JSON schema
// ─────────────────────────────────────────────────────────

const FORMAT_SAMPLES: Record<string, string> = {
  date: '2026-01-02',
  'date-time': '2026-01-02T03:04:05Z',
  time: '03:04:05',
  email: 'test@example.com',
  uri: 'https://example.com',
  url: 'https://example.com',
  uuid: '00000000-0000-4000-8000-000000000000',
};

export function synthesizeValue(schema: JsonSchemaLike | undefined): unknown {
  if (!schema) return 'test';
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case 'number':
    case 'integer': {
      let n = schema.minimum ?? 1;
      if (schema.maximum !== undefined && n > schema.maximum) n = schema.maximum;
      if (schema.multipleOf) n = Math.ceil(n / schema.multipleOf) * schema.multipleOf;
      return n;
    }
    case 'boolean':
      return true;
    case 'array':
      return [synthesizeValue(schema.items)];
    case 'object': {
      const obj: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(schema.properties ?? {})) {
        obj[key] = synthesizeValue(prop);
      }
      return obj;
    }
    default:
      return schema.format && FORMAT_SAMPLES[schema.format]
        ? FORMAT_SAMPLES[schema.format]
        : 'test';
  }
}

export function synthesizeArgs(inputSchema: JsonSchemaLike | undefined): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!inputSchema?.properties) return args;
  const required = new Set(inputSchema.required ?? []);
  for (const [name, prop] of Object.entries(inputSchema.properties)) {
    if (required.has(name)) args[name] = synthesizeValue(prop);
  }
  return args;
}

// ─────────────────────────────────────────────────────────
// Result canonicalization and comparison
// ─────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function parseLoose(text: string): unknown {
  const stripped = stripAnsi(text).trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return stripped;
  }
}

function canonicalizeMcpResult(result: unknown): unknown {
  const r = result as { structuredContent?: unknown; content?: { type: string; text?: string }[] };
  if (r?.structuredContent !== undefined) return r.structuredContent;
  if (Array.isArray(r?.content)) {
    const text = r.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return parseLoose(text);
  }
  return result;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, function replacer(this: unknown, _key: string, val: unknown) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

function baseToolName(name: string): string {
  const slashBase = name.includes('/') ? name.split('/').pop()! : name;
  return slashBase.includes('.') ? slashBase.split('.').pop()! : slashBase;
}

// ─────────────────────────────────────────────────────────
// Transport drivers
// ─────────────────────────────────────────────────────────

function runCli(
  cliPath: string,
  photonFile: string,
  method: string,
  args: Record<string, unknown>
): unknown {
  const flags: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    flags.push(`--${key}`);
    flags.push(typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const proc = spawnSync('node', [cliPath, photonFile, method, ...flags, '--json'], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: 30000,
  });
  if (proc.status !== 0) {
    throw new Error(`CLI exited ${proc.status}: ${stripAnsi(proc.stderr || proc.stdout || '')}`);
  }
  return parseLoose(proc.stdout);
}

async function createStdioClient(
  cliPath: string,
  photonName: string,
  photonDir: string
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, 'mcp', photonName],
    env: { ...process.env, PHOTON_DIR: photonDir },
  });
  const client = new Client({ name: 'conformance', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function startSseServer(
  cliPath: string,
  photonName: string,
  photonDir: string,
  port: number
): Promise<ChildProcess> {
  const proc = spawn(
    'node',
    [cliPath, 'mcp', photonName, '--transport', 'sse', '--port', String(port)],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PHOTON_DIR: photonDir } }
  );
  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) return proc;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`SSE server did not start within 20s. Stderr: ${stderr.slice(-500)}`);
}

async function createSseClient(port: number): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));
  const client = new Client({ name: 'conformance', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

// ─────────────────────────────────────────────────────────
// The matrix
// ─────────────────────────────────────────────────────────

export async function runConformanceMatrix(
  photonFile: string,
  options: ConformanceOptions
): Promise<ConformanceReport> {
  const { cliPath, ssePort } = options;
  const skipInvocation = new Set(options.skipInvocation ?? []);
  const photonDir = path.dirname(photonFile);
  const photonName = path.basename(photonFile).replace(/\.photon\.ts$/, '');

  const source = fs.readFileSync(photonFile, 'utf-8');
  const extractor = new SchemaExtractor();
  const metadata = extractor.extractAllFromSource(source);
  const declared = metadata.tools as ToolSchemaLike[];

  const report: ConformanceReport = {
    photon: photonName,
    methods: declared.length,
    invoked: 0,
    checks: 0,
    failures: [],
  };
  const fail = (method: string, check: string, detail: string) => {
    report.failures.push({ method, check, detail });
  };
  const check = (method: string, name: string, passed: boolean, detail: string) => {
    report.checks++;
    if (passed) {
      console.log(`  ✅ ${method} · ${name}`);
    } else {
      console.error(`  ❌ ${method} · ${name}: ${detail}`);
      fail(method, name, detail);
    }
  };

  let stdioClient: Client | null = null;
  let sseClient: Client | null = null;
  let sseProc: ChildProcess | null = null;

  try {
    [stdioClient, sseProc] = await Promise.all([
      createStdioClient(cliPath, photonName, photonDir),
      startSseServer(cliPath, photonName, photonDir, ssePort),
    ]);
    sseClient = await createSseClient(ssePort);

    const stdioTools = (await stdioClient.listTools()).tools;
    const sseTools = (await sseClient.listTools()).tools;
    const stdioByBase = new Map(stdioTools.map((t) => [baseToolName(t.name), t]));
    const sseByBase = new Map(sseTools.map((t) => [baseToolName(t.name), t]));

    // ── Surface parity: same tool set on both MCP transports ──
    {
      const stdioNames = [...stdioByBase.keys()].sort();
      const sseNames = [...sseByBase.keys()].sort();
      check(
        '*',
        'tool surface identical (STDIO vs SSE)',
        stableStringify(stdioNames) === stableStringify(sseNames),
        `STDIO=[${stdioNames}] SSE=[${sseNames}]`
      );
    }

    // ── Every declared method is exposed ──
    for (const tool of declared) {
      const base = baseToolName(tool.name);
      check(
        base,
        'declared method exposed on both transports',
        stdioByBase.has(base) && sseByBase.has(base),
        `STDIO=${stdioByBase.has(base)} SSE=${sseByBase.has(base)}`
      );
    }

    // ── Per-tool schema and annotation parity ──
    for (const base of stdioByBase.keys()) {
      const st = stdioByBase.get(base) as Record<string, unknown> | undefined;
      const ss = sseByBase.get(base) as Record<string, unknown> | undefined;
      if (!st || !ss) continue;
      check(
        base,
        'inputSchema identical',
        stableStringify(st.inputSchema) === stableStringify(ss.inputSchema),
        `STDIO=${stableStringify(st.inputSchema)} SSE=${stableStringify(ss.inputSchema)}`
      );
      check(
        base,
        'annotations identical',
        stableStringify(st.annotations ?? null) === stableStringify(ss.annotations ?? null),
        `STDIO=${stableStringify(st.annotations ?? null)} SSE=${stableStringify(ss.annotations ?? null)}`
      );
    }

    // ── Invocation parity: every safe declared method, all three transports ──
    for (const tool of declared) {
      const base = baseToolName(tool.name);
      if (tool.destructiveHint === true || tool.webhook || tool.scheduled) {
        console.log(`  ⏭  ${base} · invocation skipped (destructive/webhook/scheduled)`);
        continue;
      }
      if (skipInvocation.has(base)) {
        console.log(`  ⏭  ${base} · invocation skipped (per options)`);
        continue;
      }
      const args = options.argOverrides?.[base] ?? synthesizeArgs(tool.inputSchema);
      report.invoked++;

      let cliData: unknown, stdioData: unknown, sseData: unknown;
      try {
        const stdioName = stdioByBase.get(base)?.name ?? base;
        const sseName = sseByBase.get(base)?.name ?? base;
        [stdioData, sseData] = await Promise.all([
          stdioClient
            .callTool({ name: stdioName, arguments: args as Record<string, unknown> })
            .then(canonicalizeMcpResult),
          sseClient
            .callTool({ name: sseName, arguments: args as Record<string, unknown> })
            .then(canonicalizeMcpResult),
        ]);
        cliData = runCli(cliPath, photonFile, base, args);
      } catch (e) {
        check(base, 'invocation succeeds on all transports', false, String(e));
        continue;
      }

      const argStr = stableStringify(args);
      check(
        base,
        `STDIO === SSE for args ${argStr}`,
        stableStringify(stdioData) === stableStringify(sseData),
        `STDIO=${stableStringify(stdioData)} SSE=${stableStringify(sseData)}`
      );
      check(
        base,
        `CLI === MCP for args ${argStr}`,
        stableStringify(cliData) === stableStringify(stdioData),
        `CLI=${stableStringify(cliData)} STDIO=${stableStringify(stdioData)}`
      );
    }
  } finally {
    if (stdioClient) await stdioClient.close().catch(() => {});
    if (sseClient) await sseClient.close().catch(() => {});
    if (sseProc) sseProc.kill();
  }

  return report;
}
