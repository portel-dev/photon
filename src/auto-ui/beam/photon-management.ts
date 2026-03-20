/**
 * Photon management operations — configure, reload, remove, update metadata, generate docs.
 *
 * Extracted from beam.ts. All functions take explicit parameters
 * rather than relying on closure-captured state.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { SchemaExtractor, type ConstructorParam } from '@portel/photon-core';
import { PhotonLoader } from '../../loader.js';
import { PhotonDocExtractor } from '../../photon-doc-extractor.js';
import { TemplateManager } from '../../template-manager.js';
import { toEnvVarName } from '../../shared/config-docs.js';
import { logger } from '../../shared/logger.js';
import { broadcastNotification, broadcastToBeam } from '../streamable-http-transport.js';
import {
  applyMethodVisibility,
  extractClassMetadataFromSource,
  backfillEnvDefaults,
} from './class-metadata.js';
import { saveConfig } from './config.js';
import type { AnyPhotonInfo, PhotonInfo, MethodInfo, ConfigParam } from '../types.js';
import type { PhotonConfig } from './types.js';

function generatePhotonId(photonPath: string): string {
  return createHash('sha256').update(photonPath).digest('hex').slice(0, 12);
}

/** Build MethodInfo[] from extracted schemas + templates + source */
function buildMethodList(
  schemas: any[],
  templates: any[],
  source: string,
  uiAssets: any[]
): MethodInfo[] {
  const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];

  const methods: MethodInfo[] = schemas
    .filter((schema: any) => !lifecycleMethods.includes(schema.name))
    .map((schema: any) => {
      const linkedAsset = uiAssets.find(
        (ui: any) => ui.linkedTool === schema.name || ui.linkedTools?.includes(schema.name)
      );
      return {
        name: schema.name,
        description: schema.description || '',
        params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
        returns: { type: 'object' },
        autorun: schema.autorun || false,
        outputFormat: schema.outputFormat,
        layoutHints: schema.layoutHints,
        buttonLabel: schema.buttonLabel,
        icon: schema.icon,
        linkedUi: linkedAsset?.id,
        scheduled: schema.scheduled,
      };
    });

  templates.forEach((template: any) => {
    if (!lifecycleMethods.includes(template.name)) {
      methods.push({
        name: template.name,
        description: template.description || '',
        params: template.inputSchema || { type: 'object', properties: {}, required: [] },
        returns: { type: 'object' },
        isTemplate: true,
        outputFormat: 'markdown',
      });
    }
  });

  applyMethodVisibility(source, methods);
  return methods;
}

/** Extract constructor params as ConfigParam[] */
function extractConfigParams(
  extractor: SchemaExtractor,
  source: string,
  photonName: string
): ConfigParam[] {
  try {
    const params = extractor.extractConstructorParams(source);
    return params
      .filter((p: ConstructorParam) => p.isPrimitive)
      .map((p: ConstructorParam) => ({
        name: p.name,
        envVar: toEnvVarName(photonName, p.name),
        type: p.type,
        isOptional: p.isOptional,
        hasDefault: p.hasDefault,
        defaultValue: p.defaultValue,
      }));
  } catch {
    return [];
  }
}

/**
 * Configure a photon via MCP — apply env vars, save config, reload.
 */
export async function configurePhotonViaMCP(
  photonName: string,
  config: Record<string, any>,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  loader: PhotonLoader,
  savedConfig: PhotonConfig,
  workingDir: string,
  activeLoads?: Set<string>
): Promise<{ success: boolean; error?: string }> {
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  if (activeLoads?.has(photonName)) {
    return {
      success: false,
      error: `${photonName} is currently being reloaded — try again shortly`,
    };
  }
  activeLoads?.add(photonName);

  for (const [key, value] of Object.entries(config)) {
    process.env[key] = String(value);
  }

  savedConfig.photons[photonName] = { ...(savedConfig.photons[photonName] || {}), ...config };
  await saveConfig(savedConfig, workingDir);

  const targetPhoton = photons[photonIndex];
  const isReconfigure = targetPhoton.configured === true;

  try {
    const mcp = isReconfigure
      ? await loader.reloadFile(targetPhoton.path)
      : await loader.loadFile(targetPhoton.path);
    const instance = mcp.instance;

    if (!instance) {
      throw new Error('Failed to create instance');
    }

    photonMCPs.set(photonName, mcp);
    backfillEnvDefaults(instance, targetPhoton.requiredParams || []);

    const extractor = new SchemaExtractor();
    const configSource = await fs.readFile(targetPhoton.path, 'utf-8');
    const { tools: schemas, templates } = extractor.extractAllFromSource(configSource);
    (mcp as any).schemas = schemas;

    const uiAssets = mcp.assets?.ui || [];
    const methods = buildMethodList(schemas, templates, configSource, uiAssets);

    const mainMethod = methods.find((m) => m.name === 'main');
    const classMeta = extractClassMetadataFromSource(configSource);

    const configuredPhoton: PhotonInfo = {
      id: generatePhotonId(targetPhoton.path),
      name: photonName,
      path: targetPhoton.path,
      configured: true,
      methods,
      isApp: !!mainMethod,
      appEntry: mainMethod,
      assets: mcp.assets,
      description: classMeta.description,
      icon: classMeta.icon,
      label: classMeta.label,
      internal: classMeta.internal,
      ...(mcp.injectedPhotons &&
        mcp.injectedPhotons.length > 0 && { injectedPhotons: mcp.injectedPhotons }),
    };

    // Re-find index — array may have shifted during the async work above
    const currentIndex = photons.findIndex((p) => p.name === photonName);
    if (currentIndex === -1) {
      activeLoads?.delete(photonName);
      return { success: false, error: `${photonName} was removed during configuration` };
    }
    photons[currentIndex] = configuredPhoton;
    activeLoads?.delete(photonName);

    logger.info(`✅ ${photonName} configured via MCP`);

    broadcastNotification('notifications/tools/list_changed', {});
    broadcastToBeam('beam/configured', { photon: configuredPhoton });

    return { success: true };
  } catch (error) {
    activeLoads?.delete(photonName);
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to configure ${photonName} via MCP: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Reload a photon via MCP — re-read source, rebuild methods, update in-place.
 */
export async function reloadPhotonViaMCP(
  photonName: string,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  loader: PhotonLoader,
  savedConfig: PhotonConfig,
  broadcastChange: () => void,
  activeLoads?: Set<string>
): Promise<{ success: boolean; photon?: PhotonInfo; error?: string }> {
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  if (activeLoads?.has(photonName)) {
    return {
      success: false,
      error: `${photonName} is currently being reloaded — try again shortly`,
    };
  }
  activeLoads?.add(photonName);

  const photon = photons[photonIndex];
  const photonPath = photon.path;

  const config = savedConfig.photons[photonName] || {};
  for (const [key, value] of Object.entries(config)) {
    process.env[key] = value;
  }

  try {
    const mcp = await loader.reloadFile(photonPath);
    const instance = mcp.instance;

    if (!instance) {
      throw new Error('Failed to create instance');
    }

    photonMCPs.set(photonName, mcp);
    backfillEnvDefaults(instance, photon.requiredParams || []);

    const extractor = new SchemaExtractor();
    const reloadSrc = await fs.readFile(photonPath, 'utf-8');
    const { tools: schemas, templates } = extractor.extractAllFromSource(reloadSrc);
    (mcp as any).schemas = schemas;

    const uiAssets = mcp.assets?.ui || [];
    const methods = buildMethodList(schemas, templates, reloadSrc, uiAssets);

    const mainMethod = methods.find((m) => m.name === 'main');
    const reloadClassMeta = extractClassMetadataFromSource(reloadSrc);

    const reloadedPhoton: PhotonInfo = {
      id: generatePhotonId(photonPath),
      name: photonName,
      path: photonPath,
      configured: true,
      methods,
      isApp: !!mainMethod,
      appEntry: mainMethod,
      description: reloadClassMeta.description,
      icon: reloadClassMeta.icon,
      internal: reloadClassMeta.internal,
      ...(mcp.injectedPhotons &&
        mcp.injectedPhotons.length > 0 && { injectedPhotons: mcp.injectedPhotons }),
    };

    // Re-find index — array may have shifted during the async work above
    const currentIndex = photons.findIndex((p) => p.name === photonName);
    if (currentIndex === -1) {
      activeLoads?.delete(photonName);
      return { success: false, error: `${photonName} was removed during reload` };
    }
    photons[currentIndex] = reloadedPhoton;
    activeLoads?.delete(photonName);

    logger.info(`🔄 ${photonName} reloaded via MCP`);
    broadcastChange();

    return { success: true, photon: reloadedPhoton };
  } catch (error) {
    activeLoads?.delete(photonName);
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to reload ${photonName} via MCP: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Remove a photon — delete from arrays/maps, clear saved config.
 */
export async function removePhotonViaMCP(
  photonName: string,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  savedConfig: PhotonConfig,
  broadcastChange: () => void,
  workingDir: string
): Promise<{ success: boolean; error?: string }> {
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  photons.splice(photonIndex, 1);
  photonMCPs.delete(photonName);

  if (savedConfig.photons[photonName]) {
    delete savedConfig.photons[photonName];
    await saveConfig(savedConfig, workingDir);
  }

  logger.info(`🗑️ ${photonName} removed via MCP`);
  broadcastChange();

  return { success: true };
}

/**
 * Update photon or method metadata in-place.
 */
export async function updateMetadataViaMCP(
  photonName: string,
  methodName: string | null,
  metadata: Record<string, any>,
  photons: AnyPhotonInfo[]
): Promise<{ success: boolean; error?: string }> {
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  if (methodName) {
    if (!photons[photonIndex].configured || !photons[photonIndex].methods) {
      return { success: false, error: 'Photon is not configured or has no methods' };
    }

    const method = photons[photonIndex].methods.find((m: any) => m.name === methodName);
    if (!method) {
      return { success: false, error: `Method not found: ${methodName}` };
    }

    if (metadata.description !== undefined) method.description = metadata.description;
    if (metadata.icon !== undefined) method.icon = metadata.icon;

    logger.info(`📝 Updated metadata for ${photonName}/${methodName}`);
  } else {
    if (metadata.description !== undefined) {
      (photons[photonIndex] as any).description = metadata.description;
    }
    if (metadata.icon !== undefined) {
      (photons[photonIndex] as any).icon = metadata.icon;
    }

    logger.info(`📝 Updated metadata for ${photonName}`);
  }

  return { success: true };
}

/**
 * Generate rich help markdown for a photon.
 * Checks for an existing .md file first; generates and saves one if missing.
 */
export async function generatePhotonHelpMarkdown(
  photonName: string,
  photons: AnyPhotonInfo[]
): Promise<string> {
  const photon = photons.find((p) => p.name === photonName);
  if (!photon) {
    throw new Error(`Photon not found: ${photonName}`);
  }

  if (!photon.path) {
    throw new Error(`Photon path not available: ${photonName}`);
  }

  const sourceDir = path.dirname(photon.path);
  const mdPath = path.join(sourceDir, `${photonName}.md`);

  try {
    const [mdStat, srcStat] = await Promise.all([fs.stat(mdPath), fs.stat(photon.path)]);
    if (mdStat.mtimeMs >= srcStat.mtimeMs) {
      const existing = await fs.readFile(mdPath, 'utf-8');
      if (existing.trim()) {
        return existing;
      }
    }
  } catch {
    // .md doesn't exist or stat failed - regenerate
  }

  const extractor = new PhotonDocExtractor(photon.path);
  const metadata = await extractor.extractFullMetadata();

  const templateMgr = new TemplateManager(sourceDir);
  await templateMgr.ensureTemplates();

  const markdown = await templateMgr.renderTemplate('photon.md', metadata);

  try {
    await fs.writeFile(mdPath, markdown, 'utf-8');
    logger.info(`📄 Generated help doc: ${mdPath}`);
  } catch {
    logger.debug(`Could not save help doc to ${mdPath} (read-only?)`);
  }

  return markdown;
}

// Re-export helper for use by handleFileChange (still in beam.ts)
export { buildMethodList, extractConfigParams, generatePhotonId };
