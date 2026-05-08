/**
 * Parse a photon's `protected cfBindings = { ... }` declaration.
 *
 * Mirrors how `protected settings` is recognized in the schema-extractor
 * (object-literal initializer on a protected class field). Returns null
 * when the photon doesn't declare any CF bindings.
 *
 * The schema is intentionally narrow — only the binding-name → resource
 * mappings (and the boolean opt-ins for ai/images/browser). Anything
 * fancier belongs in the per-photon override JSON layered at deploy
 * time.
 */

import * as ts from 'typescript';
import type { CfBindingsConfig } from './runtime/cf-local.js';

const NAMED_BINDING_CATEGORIES = ['r2', 'kv', 'd1', 'queue', 'vectorize', 'do'] as const;
const BOOLEAN_CATEGORIES = ['ai', 'images', 'browser'] as const;

export function parseCfBindings(tsContent: string): CfBindingsConfig | null {
  if (!tsContent.includes('cfBindings')) return null;

  const sourceFile = ts.createSourceFile('cf-bindings.ts', tsContent, ts.ScriptTarget.Latest, true);

  let result: CfBindingsConfig | null = null;

  const visit = (node: ts.Node): void => {
    if (result) return;

    if (
      ts.isPropertyDeclaration(node) &&
      node.name.getText(sourceFile) === 'cfBindings' &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      result = readBindingsLiteral(node.initializer, sourceFile);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}

function readBindingsLiteral(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile
): CfBindingsConfig {
  const out: CfBindingsConfig = {};

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = prop.name.getText(sourceFile);
    const init = prop.initializer;

    if ((NAMED_BINDING_CATEGORIES as readonly string[]).includes(key)) {
      if (!ts.isObjectLiteralExpression(init)) continue;
      const map: Record<string, string> = {};
      for (const sub of init.properties) {
        if (!ts.isPropertyAssignment(sub)) continue;
        const subKey = unquote(sub.name.getText(sourceFile));
        if (!ts.isStringLiteral(sub.initializer)) continue;
        map[subKey] = sub.initializer.text;
      }
      (out as Record<string, unknown>)[key] = map;
      continue;
    }

    if ((BOOLEAN_CATEGORIES as readonly string[]).includes(key)) {
      if (init.kind === ts.SyntaxKind.TrueKeyword) {
        (out as Record<string, unknown>)[key] = true;
      } else if (init.kind === ts.SyntaxKind.FalseKeyword) {
        (out as Record<string, unknown>)[key] = false;
      }
    }
  }

  return out;
}

function unquote(s: string): string {
  if (s.length >= 2 && (s.startsWith('"') || s.startsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
