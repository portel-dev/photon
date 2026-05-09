/**
 * Source scanner for the new `Cloudflare` injection surface.
 *
 * A photon that takes `private cf: Cloudflare` (or any other parameter
 * name typed `Cloudflare`) reaches into per-binding resources via
 * `cf.kv(qualifier?)`, `cf.r2(qualifier?)`, etc. The runtime needs to
 * know — at boot time, before any tool runs — which **qualifiers** the
 * photon will use, because both miniflare (local sandbox) and
 * wrangler.toml (deploy) require every binding to be declared up front.
 *
 * This scanner walks the photon source and discovers:
 *   1. Constructor parameter names typed `Cloudflare` (so we recognize
 *      `this.<paramName>.kv(...)` regardless of what the author named
 *      the field — `cf`, `xCloud`, `cloud`, etc.).
 *   2. Every literal qualifier passed to a scoped category method on
 *      one of those parameter names.
 *   3. The boolean `share` flags inferred from any reference to the
 *      shared categories (`ai`, `images`, `browser`).
 *
 * Dynamic qualifiers (e.g. `cf.kv(this.tenantId)`) are flagged as
 * `dynamicQualifiers` per category so the runtime can throw a clear
 * error pointing the author at `protected cfBindings` overrides — far
 * better than letting miniflare crash with "binding undefined."
 *
 * Single source of truth for both runtime seeding and deploy autogen,
 * so the binding-name convention can never drift between the two
 * (a real risk before this scanner — `bindingNameFor(...)` lived in one
 * place but every consumer recomputed it).
 */

import * as ts from 'typescript';
import { bindingNameFor, type ScopedBindingCategory } from '@portel/photon-core';

/** Categories that take an optional qualifier and use auto-naming. */
const SCOPED_CATEGORIES: readonly ScopedBindingCategory[] = [
  'kv',
  'r2',
  'd1',
  'queue',
  'vectorize',
] as const;

/** Categories with a single shared binding per Worker (no qualifier). */
const SHARED_CATEGORIES = ['ai', 'images', 'browser'] as const;

export type SharedCategory = (typeof SHARED_CATEGORIES)[number];

export interface CfUsage {
  /**
   * Per-category set of literal qualifier strings the photon uses.
   * The empty-string entry `''` means the default (no-qualifier) call
   * `cf.kv()`. Other entries are the literal arg passed to a qualified
   * call like `cf.kv('cache')`.
   */
  qualifiers: Record<ScopedBindingCategory, Set<string>>;
  /**
   * Categories where at least one call passed a non-literal expression
   * (e.g. a variable). The runtime can't statically resolve the
   * binding name; surfaces as a clear error rather than a silent
   * miniflare miss.
   */
  dynamicQualifiers: Set<ScopedBindingCategory>;
  /** True if the photon reads the corresponding shared binding. */
  shared: Record<SharedCategory, boolean>;
  /**
   * Constructor parameter names (or property names) recognized as the
   * Cloudflare access path on this photon. Always at least includes
   * `cf` for the legacy `this.cf` shape so existing static-analysis
   * sites continue to work; extended with any additional names found
   * via a typed constructor parameter.
   */
  accessPaths: Set<string>;
}

function emptyUsage(): CfUsage {
  const qualifiers = {} as Record<ScopedBindingCategory, Set<string>>;
  for (const cat of SCOPED_CATEGORIES) qualifiers[cat] = new Set();
  return {
    qualifiers,
    dynamicQualifiers: new Set(),
    shared: { ai: false, images: false, browser: false },
    accessPaths: new Set(['cf']),
  };
}

/**
 * Scan a photon's TypeScript source and return everything the runtime
 * + deploy code-gen needs to know about its CF usage.
 */
export function scanCfUsage(tsContent: string): CfUsage {
  const usage = emptyUsage();
  if (!tsContent) return usage;

  const sourceFile = ts.createSourceFile('cf-usage.ts', tsContent, ts.ScriptTarget.Latest, true);

  // (1) Walk every class declaration and discover constructor params
  // typed `Cloudflare`. The param name becomes an additional access
  // path the call-scanner recognises.
  const visitForAccessPaths = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        if (!ts.isConstructorDeclaration(member)) continue;
        for (const param of member.parameters) {
          if (!param.name || !ts.isIdentifier(param.name)) continue;
          if (!param.type) continue;
          const typeText = param.type.getText(sourceFile).trim();
          if (typeText === 'Cloudflare' || typeText.startsWith('Cloudflare ')) {
            usage.accessPaths.add(param.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visitForAccessPaths);
  };
  visitForAccessPaths(sourceFile);

  // (2) Walk every property/element access. We're looking for two
  // shapes: `this.<accessPath>.<category>(...)` (scoped) and
  // `this.<accessPath>.<sharedCategory>` (shared). Tracking both in
  // one walker keeps source-file traversal cost down on big photons.
  const visitForUsage = (node: ts.Node): void => {
    // Scoped category call: `this.<path>.<cat>(<qualifier?>)`
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const access = node.expression;
      const cat = access.name.getText(sourceFile);
      if ((SCOPED_CATEGORIES as readonly string[]).includes(cat)) {
        if (matchesAccessPath(access.expression, sourceFile, usage.accessPaths)) {
          recordScopedCall(usage, cat as ScopedBindingCategory, node, sourceFile);
        }
      }
    }

    // Shared category access: `this.<path>.<shared>` (no call required —
    // `this.cf.ai.run(...)` reads `ai` first).
    if (ts.isPropertyAccessExpression(node)) {
      const cat = node.name.getText(sourceFile);
      if ((SHARED_CATEGORIES as readonly string[]).includes(cat)) {
        if (matchesAccessPath(node.expression, sourceFile, usage.accessPaths)) {
          usage.shared[cat as SharedCategory] = true;
        }
      }
    }

    ts.forEachChild(node, visitForUsage);
  };
  visitForUsage(sourceFile);

  return usage;
}

/**
 * Does `expr` resolve to one of the photon's recognized Cloudflare
 * access paths? Accepts both `this.cf` and bare `cf` (the latter shows
 * up when an author destructures the parameter into a local).
 */
function matchesAccessPath(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  paths: Set<string>
): boolean {
  // `this.<name>` or `(this as ...).<name>`
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name.getText(sourceFile);
    if (!paths.has(name)) return false;
    const receiver = unwrapTypeAssertion(expr.expression);
    return receiver.kind === ts.SyntaxKind.ThisKeyword;
  }
  return false;
}

function unwrapTypeAssertion(expr: ts.Expression): ts.Expression {
  // `(this as Foo).cf`, `(<Foo>this).cf`, `(this as unknown as Foo).cf`
  if (ts.isParenthesizedExpression(expr)) {
    return unwrapTypeAssertion(expr.expression);
  }
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    return unwrapTypeAssertion(expr.expression);
  }
  return expr;
}

function recordScopedCall(
  usage: CfUsage,
  cat: ScopedBindingCategory,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile
): void {
  const args = call.arguments;
  if (args.length === 0) {
    usage.qualifiers[cat].add('');
    return;
  }
  const first = args[0];
  if (ts.isStringLiteralLike(first)) {
    usage.qualifiers[cat].add(first.text);
    return;
  }
  // Non-literal — author passed a variable / expression. Track so the
  // runtime can fail clearly when this binding is reached for.
  usage.dynamicQualifiers.add(cat);
  // Best-effort: also add '' so the default binding is at least
  // configured. The dynamic call may still hit a name the runtime
  // doesn't know, but the default keeps simple branches working.
  usage.qualifiers[cat].add('');
}

/**
 * All scoped binding names the photon will use, expanded against the
 * photon's name. Hands a deduplicated list to miniflare-config emission
 * and wrangler.toml emission. Dynamic qualifiers contribute only the
 * default name — the rest must come from `protected cfBindings`
 * overrides.
 */
export function expandScopedBindingNames(
  photonName: string,
  usage: CfUsage
): Record<ScopedBindingCategory, string[]> {
  const out = {} as Record<ScopedBindingCategory, string[]>;
  for (const cat of SCOPED_CATEGORIES) {
    const names: string[] = [];
    for (const qualifier of usage.qualifiers[cat]) {
      names.push(bindingNameFor(photonName, cat, qualifier || undefined));
    }
    out[cat] = names;
  }
  return out;
}

export { SCOPED_CATEGORIES, SHARED_CATEGORIES };
