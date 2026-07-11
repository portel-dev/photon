/**
 * OpenAPI CLI Command
 *
 * Generate an OpenAPI 3.1 document for a photon's callable methods.
 */

import type { Command } from 'commander';
import { dirname, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { getDefaultContext } from '../../context.js';
import { resolvePhotonPath } from '../../path-resolver.js';
import { getErrorMessage } from '../../shared/error-handler.js';
import { logger } from '../../shared/logger.js';

type LoadedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  outputFormat?: string;
  layoutHints?: Record<string, string>;
  buttonLabel?: string;
  icon?: string;
  autorun?: boolean;
  linkedUi?: string;
  ['x-output-format']?: string;
  ['x-layout-hints']?: Record<string, string>;
  ['x-button-label']?: string;
};

function toOpenAPIMethod(tool: LoadedTool) {
  return {
    name: tool.name,
    description: tool.description || `Execute ${tool.name}`,
    icon: tool.icon,
    params: tool.inputSchema || { type: 'object', properties: {} },
    returns: tool.outputSchema || { type: 'object' },
    autorun: tool.autorun,
    outputFormat: tool.outputFormat || tool['x-output-format'],
    layoutHints: tool.layoutHints || tool['x-layout-hints'],
    buttonLabel: tool.buttonLabel || tool['x-button-label'],
    linkedUi: tool.linkedUi,
  };
}

export function registerOpenAPICommand(program: Command): void {
  program
    .command('openapi')
    .argument('<name>', 'Photon name (without .photon.ts extension)')
    .option('-o, --output <file>', 'Write JSON to a file instead of stdout')
    .option(
      '--server-url <url>',
      'Server URL for the OpenAPI servers section',
      'http://localhost:3000'
    )
    .option('--compact', 'Emit compact JSON instead of pretty-printed output')
    .description('Generate an OpenAPI 3.1 spec for a photon')
    .action(
      async (name: string, options: { output?: string; serverUrl: string; compact?: boolean }) => {
        try {
          const workingDir = getDefaultContext().baseDir;
          const photonPath = await resolvePhotonPath(name, workingDir);

          if (!photonPath) {
            logger.error(`Photon not found: ${name}`);
            console.error(`Searched in: ${workingDir}`);
            console.error(`Tip: Use 'photon info' to see available photons`);
            process.exit(1);
          }

          const [{ PhotonLoader }, { generateOpenAPISpec }] = await Promise.all([
            import('../../loader.js'),
            import('../../auto-ui/openapi-generator.js'),
          ]);
          const loader = new PhotonLoader(false, undefined, workingDir);
          const loaded = await loader.loadFile(photonPath);
          const tools = ((loaded as { tools?: LoadedTool[] }).tools || []).map(toOpenAPIMethod);
          const spec = generateOpenAPISpec(
            [
              {
                name: (loaded as { name?: string }).name || name,
                path: photonPath,
                configured: true,
                methods: tools,
                httpRoutes: (loaded as any)._httpRoutes,
              },
            ],
            options.serverUrl
          );
          const json = JSON.stringify(spec, null, options.compact ? 0 : 2) + '\n';

          if (options.output) {
            const outputPath = resolve(process.cwd(), options.output);
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, json, 'utf-8');
            logger.info(`OpenAPI spec written to ${outputPath}`);
            return;
          }

          process.stdout.write(json);
        } catch (error) {
          logger.error(`OpenAPI generation failed: ${getErrorMessage(error)}`);
          process.exit(1);
        }
      }
    );
}
