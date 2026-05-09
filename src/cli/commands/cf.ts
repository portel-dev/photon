/**
 * `photon cf` — inspect and edit a photon's CF binding overrides.
 *
 * The override JSON layers on top of `protected cfBindings` so users can
 * repoint a binding (e.g., point `kv: cache` at a different namespace)
 * without editing photon source. This command surface is intentionally
 * thin; the heavier "create resource", "test connection", and Beam UI
 * panel land in later phases.
 *
 * Examples:
 *   photon cf bindings my-photon                       # show declared + override
 *   photon cf set my-photon kv.cache prod-cache       # repoint a binding
 *   photon cf set my-photon ai true                    # toggle a boolean opt-in
 *   photon cf reset my-photon                          # drop the override
 */

import type { Command } from 'commander';
import * as fs from 'fs';
import { resolvePhotonPath } from '../../path-resolver.js';
import { getDefaultContext } from '../../context.js';
import { PhotonLoader } from '../../loader.js';
import type { CfBindingsConfig } from '../../runtime/cf-local.js';
import { printError, printInfo } from '../../cli-formatter.js';

const NAMED_CATEGORIES = new Set(['r2', 'kv', 'd1', 'queue', 'vectorize', 'do']);
const BOOLEAN_CATEGORIES = new Set(['ai', 'images', 'browser']);

export function registerCfCommands(program: Command): void {
  const cf = program
    .command('cf', { hidden: false })
    .description("Inspect and edit a photon's Cloudflare binding overrides")
    .configureHelp({ sortSubcommands: false });

  cf.command('bindings')
    .argument('<name>', 'Photon name')
    .description('Show declared bindings, override, and effective merge for a photon')
    .action(async (name: string) => {
      try {
        const { loader, tsContent } = await openPhoton(name);
        const { declared, override, effective } = await loader.getEffectiveCfBindings(
          name,
          tsContent
        );
        if (!declared) {
          printInfo(`Photon ${name} has no protected cfBindings declaration.`);
          return;
        }
        renderBindingsTable(declared, override, effective);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cf.command('set')
    .argument('<name>', 'Photon name')
    .argument(
      '<path>',
      'Binding path: <category>.<name> for named bindings, or <category> for booleans'
    )
    .argument('<value>', 'Resource id (named) or true/false (boolean)')
    .description('Override a single binding')
    .action(async (name: string, bindingPath: string, value: string) => {
      try {
        const { loader, tsContent } = await openPhoton(name);
        const { declared, override } = await loader.getEffectiveCfBindings(name, tsContent);
        if (!declared) {
          printError(`Photon ${name} has no protected cfBindings declaration.`);
          process.exit(1);
        }
        const next: CfBindingsConfig = { ...(override ?? {}) };
        applyOverride(next, bindingPath, value);
        const savedAt = await loader.saveCfOverride(name, next);
        printInfo(`Updated override for ${name} at ${savedAt}`);
        renderBindingsTable(declared, next, mergeForDisplay(declared, next));
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cf.command('reset')
    .argument('<name>', 'Photon name')
    .description('Remove the override file, falling back to declared bindings')
    .action(async (name: string) => {
      try {
        const { loader } = await openPhoton(name);
        const overridePath = loader.getCfOverridePath(name);
        try {
          await fs.promises.unlink(overridePath);
          printInfo(`Removed override at ${overridePath}`);
        } catch (e) {
          if ((e as { code?: string }).code === 'ENOENT') {
            printInfo(`No override exists for ${name}; nothing to reset.`);
          } else {
            throw e;
          }
        }
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

async function openPhoton(name: string): Promise<{ loader: PhotonLoader; tsContent: string }> {
  const workingDir = getDefaultContext().baseDir;
  const photonPath = await resolvePhotonPath(name, workingDir);
  if (!photonPath) {
    throw new Error(`Photon not found: ${name}. Searched in: ${workingDir}`);
  }
  const tsContent = await fs.promises.readFile(photonPath, 'utf8');
  const loader = new PhotonLoader(false, undefined, workingDir);
  return { loader, tsContent };
}

function applyOverride(into: CfBindingsConfig, bindingPath: string, value: string): void {
  const dotIdx = bindingPath.indexOf('.');
  if (dotIdx === -1) {
    if (!BOOLEAN_CATEGORIES.has(bindingPath)) {
      throw new Error(
        `Bare path '${bindingPath}' is only valid for boolean categories (${Array.from(BOOLEAN_CATEGORIES).join(', ')}). ` +
          `Use <category>.<name> for named bindings.`
      );
    }
    if (value !== 'true' && value !== 'false') {
      throw new Error(
        `Boolean override for '${bindingPath}' must be 'true' or 'false', got '${value}'.`
      );
    }
    (into as Record<string, unknown>)[bindingPath] = value === 'true';
    return;
  }
  const category = bindingPath.slice(0, dotIdx);
  const bindingName = bindingPath.slice(dotIdx + 1);
  if (!NAMED_CATEGORIES.has(category)) {
    throw new Error(
      `Unknown CF category '${category}'. Valid: ${Array.from(NAMED_CATEGORIES).join(', ')} (named) or ${Array.from(BOOLEAN_CATEGORIES).join(', ')} (boolean).`
    );
  }
  const map = ((into as Record<string, Record<string, string>>)[category] ??= {});
  map[bindingName] = value;
}

function mergeForDisplay(declared: CfBindingsConfig, override: CfBindingsConfig): CfBindingsConfig {
  const out: CfBindingsConfig = { ...declared };
  for (const cat of NAMED_CATEGORIES) {
    const o = (override as Record<string, Record<string, string> | undefined>)[cat];
    if (o) {
      const d = (declared as Record<string, Record<string, string> | undefined>)[cat] ?? {};
      (out as Record<string, Record<string, string>>)[cat] = { ...d, ...o };
    }
  }
  for (const cat of BOOLEAN_CATEGORIES) {
    const o = (override as Record<string, unknown>)[cat];
    if (typeof o === 'boolean') (out as Record<string, unknown>)[cat] = o;
  }
  return out;
}

function renderBindingsTable(
  declared: CfBindingsConfig,
  override: CfBindingsConfig | null,
  effective: CfBindingsConfig | null
): void {
  const rows: {
    category: string;
    binding: string;
    declared: string;
    override: string;
    effective: string;
  }[] = [];
  for (const cat of NAMED_CATEGORIES) {
    const d = (declared as Record<string, Record<string, string> | undefined>)[cat] ?? {};
    const o = override
      ? ((override as Record<string, Record<string, string> | undefined>)[cat] ?? {})
      : {};
    const e = effective
      ? ((effective as Record<string, Record<string, string> | undefined>)[cat] ?? {})
      : d;
    const allBindings = new Set([...Object.keys(d), ...Object.keys(o)]);
    for (const name of allBindings) {
      rows.push({
        category: cat,
        binding: name,
        declared: d[name] ?? '—',
        override: o[name] ?? '—',
        effective: e[name] ?? '—',
      });
    }
  }
  for (const cat of BOOLEAN_CATEGORIES) {
    const d = (declared as Record<string, unknown>)[cat];
    const o = override ? (override as Record<string, unknown>)[cat] : undefined;
    const e = effective ? (effective as Record<string, unknown>)[cat] : d;
    if (typeof d === 'boolean' || typeof o === 'boolean') {
      rows.push({
        category: cat,
        binding: '(toggle)',
        declared: typeof d === 'boolean' ? String(d) : '—',
        override: typeof o === 'boolean' ? String(o) : '—',
        effective: typeof e === 'boolean' ? String(e) : '—',
      });
    }
  }
  if (rows.length === 0) {
    printInfo('No bindings declared.');
    return;
  }
  const headers = ['Category', 'Binding', 'Declared', 'Override', 'Effective'];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => Object.values(r)[i].length))
  );
  const sep = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const top = widths.map((w) => '─'.repeat(w + 2)).join('┬');
  const bot = widths.map((w) => '─'.repeat(w + 2)).join('┴');
  const fmt = (cells: string[]): string =>
    '│' + cells.map((c, i) => ` ${c.padEnd(widths[i])} `).join('│') + '│';
  console.log('┌' + top + '┐');
  console.log(fmt(headers));
  console.log('├' + sep + '┤');
  for (const r of rows) console.log(fmt(Object.values(r)));
  console.log('└' + bot + '┘');
}
