/**
 * Lookout CLI Wrapper for Visual Testing
 *
 * Calls the lookout photon via CLI to perform AI-powered visual analysis.
 * Requires: lookout photon installed + MLX dependencies (Apple Silicon).
 * When unavailable, all methods return null — tests should skip gracefully.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);
const TIMEOUT = 120_000; // 2 minutes per inference call

// ── Types ────────────────────────────────────────────────────

export interface ReviewResult {
  score: number | null;
  grade: string | null;
  issueCount: number;
  criticalCount: number;
  warningCount: number;
  issues: Array<{
    severity: 'critical' | 'warning' | 'info';
    category: string;
    location: string;
    description: string;
  }>;
  raw: string;
}

export interface ValidateResult {
  total: number;
  passed: number;
  failed: number;
  unclear: number;
  results: Array<{
    promise: string;
    status: 'PASS' | 'FAIL' | 'UNCLEAR';
    evidence: string;
  }>;
  raw: string;
}

export interface CompareResult {
  beforeScore: number | null;
  afterScore: number | null;
  beforeIssues: number;
  afterIssues: number;
  delta: number;
  newIssues: number;
  fixedIssues: number;
  raw: string;
}

// ── Availability Check ───────────────────────────────────────

let _available: boolean | null = null;

/**
 * Check if lookout is available (installed + MLX ready).
 * Caches the result for the process lifetime.
 */
export async function isAvailable(): Promise<boolean> {
  if (_available !== null) return _available;

  try {
    const { stdout } = await execFile('photon', ['lookout', 'status', '--json', '-y'], {
      timeout: 15_000,
      env: { ...process.env, NO_COLOR: '1' },
    });

    // --json wraps the return value; status returns an object with `ready: boolean`
    const data = JSON.parse(stdout.trim());
    _available = data?.ready === true;
  } catch {
    _available = false;
  }

  return _available;
}

// ── Core Methods ─────────────────────────────────────────────

/**
 * Review a screenshot for UI/UX issues.
 * Returns null if lookout is unavailable.
 */
export async function review(imagePath: string): Promise<ReviewResult | null> {
  if (!(await isAvailable())) return null;

  const raw = await run(['lookout', 'review', '--image', imagePath]);
  if (!raw) return null;

  return parseReview(raw);
}

/**
 * Validate a screenshot against feature promises.
 * Returns null if lookout is unavailable.
 */
export async function validate(
  imagePath: string,
  promises: string[]
): Promise<ValidateResult | null> {
  if (!(await isAvailable())) return null;

  // CLI parser expects arrays as JSON strings
  const args = [
    'lookout',
    'validate',
    '--image',
    imagePath,
    '--promises',
    JSON.stringify(promises),
  ];

  const raw = await run(args);
  if (!raw) return null;

  return parseValidate(raw, promises);
}

/**
 * Compare before/after screenshots for regressions.
 * Returns null if lookout is unavailable.
 */
export async function compare(
  beforePath: string,
  afterPath: string
): Promise<CompareResult | null> {
  if (!(await isAvailable())) return null;

  const raw = await run(['lookout', 'compare', '--before', beforePath, '--after', afterPath]);
  if (!raw) return null;

  return parseCompare(raw);
}

// ── Internal Helpers ─────────────────────────────────────────

async function run(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFile('photon', [...args, '-y'], {
      timeout: TIMEOUT,
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 1024 * 1024, // 1MB
    });
    return stdout;
  } catch (err: any) {
    console.error(`  [lookout] CLI error: ${err.message?.slice(0, 200)}`);
    return null;
  }
}

function parseReview(raw: string): ReviewResult {
  // Score: 🟢 85/100 (B)
  const scoreMatch = raw.match(/Score:.*?(\d+)\/100\s*\(([A-F])\)/);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
  const grade = scoreMatch ? scoreMatch[2] : null;

  // Parse issue lines: 🔴 **[CRITICAL]** CATEGORY — location
  const issues: ReviewResult['issues'] = [];
  const issueRegex = /\*\*\[(CRITICAL|WARNING|INFO)\]\*\*\s*(\S+)\s*—\s*(.+)\n\s+(.+)/g;
  let match;
  while ((match = issueRegex.exec(raw)) !== null) {
    issues.push({
      severity: match[1].toLowerCase() as 'critical' | 'warning' | 'info',
      category: match[2],
      location: match[3].trim(),
      description: match[4].trim(),
    });
  }

  return {
    score,
    grade,
    issueCount: issues.length,
    criticalCount: issues.filter((i) => i.severity === 'critical').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    issues,
    raw,
  };
}

function parseValidate(raw: string, promises: string[]): ValidateResult {
  const results: ValidateResult['results'] = [];

  // Output format from lookout:
  //   ✅ **Promise text**
  //     evidence text
  //
  //   ❌ **Promise text**
  //     evidence text
  for (const promise of promises) {
    const escaped = promise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match icon + bold promise, then optional evidence on next line
    const blockRegex = new RegExp(
      `([✅❌❓])\\s*\\*\\*${escaped}\\*\\*[^\\n]*\\n(?:\\s+(.+))?`,
      'i'
    );
    const match = raw.match(blockRegex);

    if (match) {
      const icon = match[1];
      const status = icon === '✅' ? 'PASS' : icon === '❌' ? 'FAIL' : 'UNCLEAR';
      results.push({ promise, status, evidence: (match[2] || '').trim() });
    } else {
      // Looser match — promise text anywhere near a status icon
      const looseRegex = new RegExp(`([✅❌❓]).*?${escaped.slice(0, 30)}`, 'i');
      const looseMatch = raw.match(looseRegex);
      if (looseMatch) {
        const icon = looseMatch[1];
        const status = icon === '✅' ? 'PASS' : icon === '❌' ? 'FAIL' : 'UNCLEAR';
        results.push({ promise, status, evidence: '' });
      } else {
        results.push({ promise, status: 'UNCLEAR', evidence: 'not found in output' });
      }
    }
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: results.filter((r) => r.status === 'FAIL').length,
    unclear: results.filter((r) => r.status === 'UNCLEAR').length,
    results,
    raw,
  };
}

function parseCompare(raw: string): CompareResult {
  // Table: | Score | 85 | 90 |
  const scoreRow = raw.match(/\|\s*Score\s*\|\s*(\d+|\?)\s*\|\s*(\d+|\?)\s*\|/);
  const beforeScore = scoreRow && scoreRow[1] !== '?' ? parseInt(scoreRow[1], 10) : null;
  const afterScore = scoreRow && scoreRow[2] !== '?' ? parseInt(scoreRow[2], 10) : null;

  // | Issues | 2 | 1 |
  const issuesRow = raw.match(/\|\s*Issues\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
  const beforeIssues = issuesRow ? parseInt(issuesRow[1], 10) : 0;
  const afterIssues = issuesRow ? parseInt(issuesRow[2], 10) : 0;

  // Count "New Issues Introduced" section items
  const newSection = raw.match(/## New Issues Introduced\n([\s\S]*?)(?=\n##|\n---|\z)/);
  const newIssues = newSection ? (newSection[1].match(/\*\*\[/g) || []).length : 0;

  // Count "Issues Fixed" section items
  const fixedSection = raw.match(/## Issues Fixed\n([\s\S]*?)(?=\n##|\n---|\z)/);
  const fixedIssues = fixedSection ? (fixedSection[1].match(/~~/g) || []).length / 2 : 0;

  return {
    beforeScore,
    afterScore,
    beforeIssues,
    afterIssues,
    delta: afterIssues - beforeIssues,
    newIssues,
    fixedIssues: Math.floor(fixedIssues),
    raw,
  };
}
