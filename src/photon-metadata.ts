import type {
  ConstructorParam,
  PhotonClass,
  PhotonTool,
  SettingsSchema,
  TemplateInfo,
  StaticInfo,
} from '@portel/photon-core';
import type { PhotonAuthDirective } from './auth/directive.js';
import type { ExposeDef } from './shared/expose-route-extractor.js';

export interface PhotonMetadataExtractionPort {
  extractTools(
    photonClass: new (...args: unknown[]) => unknown,
    sourceFilePath: string,
    sourceContent?: string
  ): Promise<{
    tools: PhotonTool[];
    templates: TemplateInfo[];
    statics: StaticInfo[];
    settingsSchema?: SettingsSchema;
    auth?: string;
    authDirective?: PhotonAuthDirective;
    httpRoutes?: Array<{ method: string; path: string; handler: string }>;
    exposes?: ExposeDef[];
  }>;
  extractConstructorParams(filePath: string): Promise<ConstructorParam[]>;
}

/** Metadata extraction port used by loaders and composition roots. */
export interface PhotonMetadataSource {
  classConstructor: PhotonClass;
  sourceFilePath: string;
  sourceContent?: string;
}
