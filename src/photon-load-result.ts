import type {
  PhotonClassExtended,
  PhotonTool,
  TemplateInfo,
  StaticInfo,
  SettingsSchema,
} from '@portel/photon-core';
import type { ExposeDef } from './shared/expose-route-extractor.js';
import type { HttpRouteDef } from './shared/http-route-extractor.js';
import type { PhotonAuthDirective } from './auth/directive.js';

export interface PhotonLoadResultInput {
  name: string;
  description?: string;
  tools: PhotonTool[];
  templates: TemplateInfo[];
  statics: StaticInfo[];
  instance: any;
  assets: PhotonClassExtended['assets'];
  injectedPhotons: string[];
  classConstructor: Record<string, (...args: unknown[]) => unknown>;
  accessClasses: Record<string, any>;
  sharedStates?: string[];
  settingsSchema?: SettingsSchema;
  icon?: string;
  stateful?: boolean;
  auth?: string;
  authDirective?: PhotonAuthDirective;
  httpRoutes?: HttpRouteDef[];
  exposes?: ExposeDef[];
}

/**
 * Assemble the protocol-facing Photon projection after hydration.
 * Source loading and preloaded loading both feed this pure finalization seam.
 */
export function buildPhotonLoadResult(input: PhotonLoadResultInput): PhotonClassExtended & {
  settingsSchema?: SettingsSchema;
  icon?: string;
  stateful?: boolean;
  auth?: string;
  authDirective?: PhotonAuthDirective;
  _httpRoutes?: HttpRouteDef[];
  _exposes?: ExposeDef[];
  _accessClasses?: Record<string, any>;
  sharedStates?: string[];
} {
  const result = {
    name: input.name,
    description: input.description || `${input.name} MCP`,
    tools: input.tools,
    templates: input.templates,
    statics: input.statics,
    instance: input.instance,
    assets: input.assets,
    injectedPhotons: input.injectedPhotons.length > 0 ? input.injectedPhotons : undefined,
    classConstructor: input.classConstructor,
    _accessClasses: input.accessClasses,
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.stateful ? { stateful: true } : {}),
    ...(input.auth ? { auth: input.auth } : {}),
    ...(input.authDirective ? { authDirective: input.authDirective } : {}),
    ...(input.httpRoutes?.length ? { _httpRoutes: input.httpRoutes } : {}),
    ...(input.exposes?.length ? { _exposes: input.exposes } : {}),
    ...(input.sharedStates?.length ? { sharedStates: input.sharedStates } : {}),
    ...(input.settingsSchema?.hasSettings ? { settingsSchema: input.settingsSchema } : {}),
  };
  return result as PhotonClassExtended & {
    settingsSchema?: SettingsSchema;
    icon?: string;
    stateful?: boolean;
    auth?: string;
    authDirective?: PhotonAuthDirective;
    _httpRoutes?: HttpRouteDef[];
    _exposes?: ExposeDef[];
    _accessClasses?: Record<string, any>;
    sharedStates?: string[];
  };
}
