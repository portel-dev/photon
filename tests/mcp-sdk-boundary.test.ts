import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const src = join(root, 'src');
const boundary = 'src/mcp/sdk-v1-2025/';
const directSdkImport = /(?:from\s+|import\s*\()\s*['"]@modelcontextprotocol\/sdk(?:\/[^'"]*)?['"]/;
const boundaryImport = /(?:from\s+|import\s*\()\s*['"][^'"]*sdk-v1-2025(?:\/[^'"]*)?['"]/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const violations = sourceFiles(src)
  .filter((path) => directSdkImport.test(readFileSync(path, 'utf8')))
  .map((path) => relative(root, path))
  .filter((path) => !path.startsWith(boundary));

assert.deepEqual(
  violations,
  [],
  `MCP SDK v1 imports must stay inside ${boundary}:\n${violations.join('\n')}`
);

for (const path of sourceFiles(join(src, 'mcp', 'protocol'))) {
  const source = readFileSync(path, 'utf8');
  assert.equal(
    boundaryImport.test(source),
    false,
    `Canonical protocol module depends on the v1 SDK boundary: ${relative(root, path)}`
  );
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pins = JSON.parse(readFileSync(join(root, 'tests', 'conformance', 'pins.json'), 'utf8'));
assert.equal(packageJson.dependencies['@modelcontextprotocol/sdk'], pins.typescriptSdkV1.version);
assert.equal(
  packageJson.dependencies[pins.typescriptSdkV2.package],
  pins.typescriptSdkV2.version,
  'Beam must pin the official MCP v2 client package used by its adapter'
);
assert.equal(
  packageJson.devDependencies['@modelcontextprotocol/conformance'],
  pins.officialConformance.version
);
assert.equal(
  packageJson.dependencies['@modelcontextprotocol/ext-apps'],
  pins.appsExtension.version
);

const beamClient = readFileSync(
  join(root, 'src', 'auto-ui', 'frontend', 'services', 'mcp-client-sdk.ts'),
  'utf8'
);
assert.match(beamClient, /@modelcontextprotocol\/client/);
assert.doesNotMatch(beamClient, /pending\s*=\s*new Map/);
assert.doesNotMatch(beamClient, /JSON\.stringify\(message\)/);
assert.doesNotMatch(beamClient, /readResponse\(/);

console.log('MCP SDK boundaries and official Beam client dependency pins are valid.');
