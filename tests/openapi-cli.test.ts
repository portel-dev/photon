import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { registerOpenAPICommand } from '../src/cli/commands/openapi.js';

const tmpDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('photon openapi command', () => {
  test('generates OpenAPI JSON for callable methods only', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'photon-openapi-test-'));
    tmpDirs.push(workspace);
    vi.stubEnv('PHOTON_DIR', workspace);

    writeFileSync(
      join(workspace, 'calculator.photon.ts'),
      `
export default class Calculator {
  /**
   * Add two numbers.
   * @param a First number
   * @param b Second number
   */
  add(a: number, b: number): number {
    return a + b;
  }

  /**
   * Health check.
   * @get /health
   */
  health(_request: Request): Response {
    return new Response('ok');
  }
}
`
    );

    const outputPath = join(workspace, 'openapi.json');
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    registerOpenAPICommand(program);

    await program.parseAsync([
      'node',
      'photon',
      'openapi',
      'calculator',
      '--server-url',
      'https://api.example.test',
      '--output',
      outputPath,
    ]);

    const spec = JSON.parse(readFileSync(outputPath, 'utf-8'));
    const paths = Object.keys(spec.paths);
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers[0].url).toBe('https://api.example.test');
    expect(paths).toContain('/photon/calculator/add');
    expect(paths).not.toContain('/photon/calculator/health');
    expect(
      spec.paths['/photon/calculator/add'].post.requestBody.content['application/json'].schema
        .properties.a.type
    ).toBe('number');
  });
});
