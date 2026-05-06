/**
 * Settings persistence for Photon instances.
 *
 * Owns the load → merge → expose-as-Proxy → persist-on-change lifecycle for
 * `protected settings` declared by photons. Extracted from PhotonLoader so
 * the loader doesn't have to know about settings paths, the read-only Proxy,
 * or the auto-generated MCP tool surface.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { readJSON, writeJSON } from './shared/io.js';
import { getInstanceStatePath } from './context-store.js';
import {
  PhotonTool,
  type SettingsSchema,
  type AskYield,
  type InputProvider,
  type OutputHandler,
} from '@portel/photon-core';

type LogFn = (message: string, meta?: Record<string, any>) => void;

interface SettingsToolOptions {
  outputHandler?: OutputHandler;
  inputProvider?: InputProvider;
}

export class SettingsPersistence {
  constructor(
    private readonly baseDir: string | undefined,
    private readonly log: LogFn
  ) {}

  /**
   * Get the settings persistence path for a photon instance.
   * Co-located with state: settings.json sits next to state.json inside
   * the per-instance directory.
   */
  getPath(photonName: string, instanceName: string): string {
    const statePath = getInstanceStatePath(photonName, instanceName, this.baseDir);
    return path.join(path.dirname(statePath), 'settings.json');
  }

  /** Load persisted settings from disk. Returns {} if the file is missing. */
  async load(photonName: string, instanceName: string): Promise<Record<string, any>> {
    try {
      return await readJSON(this.getPath(photonName, instanceName));
    } catch {
      return {};
    }
  }

  /** Persist settings to disk, creating parent directories as needed. */
  async persist(
    photonName: string,
    instanceName: string,
    values: Record<string, any>
  ): Promise<void> {
    const settingsPath = this.getPath(photonName, instanceName);
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await writeJSON(settingsPath, values);
  }

  /**
   * Inject settings into a photon instance:
   * - Load persisted values (persisted wins over in-source defaults)
   * - Replace `instance.settings` with a read-only Proxy
   * - Stamp the writable backing object plus identity on the instance so the
   *   auto-generated `settings` tool can update it later.
   */
  async inject(
    instance: Record<string, unknown>,
    photonName: string,
    instanceName: string,
    schema: SettingsSchema
  ): Promise<void> {
    const defaults = instance.settings as Record<string, any>;
    const persisted = await this.load(photonName, instanceName);

    const backing: Record<string, any> = { ...defaults };
    for (const key of Object.keys(persisted)) {
      if (persisted[key] !== undefined) {
        backing[key] = persisted[key];
      }
    }

    instance._settingsBacking = backing;
    instance._settingsPhotonName = photonName;
    instance._settingsInstanceName = instanceName;
    instance._settingsSchema = schema;

    instance.settings = new Proxy(backing, {
      get(target, prop) {
        if (typeof prop === 'string') {
          return target[prop];
        }
        return undefined;
      },
      set(_target, prop, _value) {
        throw new Error(
          `Cannot directly set settings.${String(prop)}. ` +
            `Use the 'settings' tool to change settings (e.g., settings({ ${String(prop)}: newValue })).`
        );
      },
      deleteProperty(_target, prop) {
        throw new Error(`Cannot delete settings.${String(prop)}. Use the 'settings' tool instead.`);
      },
    });
  }

  /** Generate an MCP tool definition from a SettingsSchema. */
  generateTool(schema: SettingsSchema): PhotonTool {
    const properties: Record<string, any> = {};

    for (const prop of schema.properties) {
      const propSchema: Record<string, any> = { type: prop.type };
      if (prop.description) {
        propSchema.description = prop.description;
      }
      if (prop.default !== undefined) {
        propSchema.default = prop.default;
      }
      properties[prop.name] = propSchema;
    }

    return {
      name: 'settings',
      description:
        'View or update photon settings. Call with no arguments to view current settings. Pass parameters to update specific settings.',
      inputSchema: {
        type: 'object',
        properties,
      },
    };
  }

  /**
   * Execute the auto-generated settings tool:
   * - No params → return current settings (eliciting any required-but-unset values)
   * - Params with values → update those settings, persist, emit change
   * - Params with explicit undefined on a required prop → trigger elicitation
   */
  async execute(
    instance: Record<string, unknown>,
    parameters: Record<string, any> | undefined,
    options?: SettingsToolOptions
  ): Promise<Record<string, any>> {
    const backing = instance._settingsBacking as Record<string, any>;
    const photonName = instance._settingsPhotonName as string;
    const instanceName = instance._settingsInstanceName as string;
    const schema = instance._settingsSchema as SettingsSchema;

    if (!backing || !photonName || !schema) {
      throw new Error('Settings not initialized for this photon');
    }

    if (!parameters || Object.keys(parameters).length === 0) {
      const needsElicitation = schema.properties.filter(
        (p) => p.required && backing[p.name] === undefined
      );

      if (needsElicitation.length > 0 && options?.inputProvider) {
        for (const prop of needsElicitation) {
          const result = await options.inputProvider({
            ask: prop.type === 'number' ? 'number' : 'text',
            message: prop.description || `Enter value for ${prop.name}:`,
          } as AskYield);
          if (result !== undefined && result !== null) {
            const oldValue = backing[prop.name];
            backing[prop.name] = result;
            this.log(`⚙️  Settings: ${prop.name} = ${JSON.stringify(result)} (elicited)`);
            this.emitChange(instance, prop.name, oldValue, result);
          }
        }
        await this.persist(photonName, instanceName, backing);
      }

      return { ...backing };
    }

    const changes: Array<{ property: string; oldValue: any; newValue: any }> = [];

    for (const [key, value] of Object.entries(parameters)) {
      const prop = schema.properties.find((p) => p.name === key);
      if (!prop) continue;

      if (value === undefined && prop.required) {
        if (options?.inputProvider) {
          const result = await options.inputProvider({
            ask: prop.type === 'number' ? 'number' : 'text',
            message: prop.description || `Enter value for ${key}:`,
          } as AskYield);
          if (result !== undefined && result !== null) {
            const oldValue = backing[key];
            backing[key] = result;
            changes.push({ property: key, oldValue, newValue: result });
          }
        }
      } else {
        const oldValue = backing[key];
        backing[key] = value;
        changes.push({ property: key, oldValue, newValue: value });
      }
    }

    if (changes.length > 0) {
      await this.persist(photonName, instanceName, backing);

      for (const change of changes) {
        this.log(
          `⚙️  Settings: ${change.property}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`
        );
        this.emitChange(instance, change.property, change.oldValue, change.newValue);
      }
    }

    return { ...backing };
  }

  /** Emit a `settings:changed` event through the photon's emit system. */
  private emitChange(
    instance: Record<string, unknown>,
    property: string,
    oldValue: any,
    newValue: any
  ): void {
    if (typeof instance.emit === 'function') {
      try {
        (instance.emit as (...args: unknown[]) => void)({
          event: 'settings:changed',
          data: {
            property,
            oldValue,
            newValue,
            timestamp: Date.now(),
          },
        });
      } catch {
        // Best-effort emit
      }
    }
  }
}
