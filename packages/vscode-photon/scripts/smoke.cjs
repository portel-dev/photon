'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(PACKAGE_DIR, '.generated', 'photon-dist');
const REQUIRED_FILES = [
  'context.js',
  'photon-editor-declarations.js',
  'editor-support/docblock-tag-catalog.js',
  'editor-support/photon-ts-direct-session.js',
  'editor-support/photon-ts-service.js',
  'editor-support/photon-ts-session.js',
  'editor-support/photon-ts-protocol.js',
  'editor-support/photon-ts-types.js',
];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const manifestPath = path.join(PACKAGE_DIR, 'package.json');
  const readmePath = path.join(PACKAGE_DIR, 'README.md');
  const extensionPath = path.join(PACKAGE_DIR, 'extension.cjs');

  for (const filePath of [manifestPath, readmePath, extensionPath]) {
    if (!(await exists(filePath))) {
      throw new Error(`Missing required extension file: ${path.relative(PACKAGE_DIR, filePath)}`);
    }
  }

  const missingRuntimeFiles = [];
  for (const relativePath of REQUIRED_FILES) {
    const filePath = path.join(GENERATED_DIR, relativePath);
    if (!(await exists(filePath))) {
      missingRuntimeFiles.push(relativePath);
    }
  }

  if (missingRuntimeFiles.length > 0) {
    throw new Error(
      `Missing vendored Photon runtime files:\n${missingRuntimeFiles.map((file) => `- ${file}`).join('\n')}\nRun "npm run build" inside packages/vscode-photon first.`
    );
  }

  console.log('Photon VS Code package smoke check passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
