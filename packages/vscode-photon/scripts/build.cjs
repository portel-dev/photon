'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const OUTPUT_ROOT = path.join(PACKAGE_DIR, '.generated', 'photon-dist');

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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(relativePath) {
  const sourcePath = path.join(DIST_ROOT, relativePath);
  const targetPath = path.join(OUTPUT_ROOT, relativePath);

  if (!(await pathExists(sourcePath))) {
    throw new Error(
      `Missing ${relativePath} in repo dist/. Run "npm run build" at the repo root before packaging the VS Code extension.`
    );
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function main() {
  await fs.rm(OUTPUT_ROOT, { recursive: true, force: true });
  for (const relativePath of REQUIRED_FILES) {
    await copyFile(relativePath);
  }
  console.log(`Prepared vendored Photon runtime in ${path.relative(PACKAGE_DIR, OUTPUT_ROOT)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
