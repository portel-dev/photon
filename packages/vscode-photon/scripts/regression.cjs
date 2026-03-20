'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PACKAGE_DIR, 'package.json');
const EXTENSION_PATH = path.join(PACKAGE_DIR, 'extension.cjs');

const REQUIRED_COMMANDS = [
  'photon.openInBeam',
  'photon.regenerateEditorCache',
  'photon.createPhoton',
  'photon.goToSymbol',
];

const REQUIRED_RUNTIME_SNIPPETS = [
  'createPhotonCompletionProvider',
  'createPhotonHoverProvider',
  'createPhotonDefinitionProvider',
  'createPhotonReferenceProvider',
  'createPhotonRenameProvider',
  'createPhotonCodeActionProvider',
  'createPhotonSignatureHelpProvider',
  'createPhotonDocumentSymbolProvider',
];

async function main() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const extensionSource = await fs.readFile(EXTENSION_PATH, 'utf8');

  const declaredCommands = new Set(
    (manifest.contributes?.commands || []).map((command) => command.command)
  );
  const activationEvents = new Set(manifest.activationEvents || []);
  const files = new Set(manifest.files || []);
  const scripts = manifest.scripts || {};

  for (const command of REQUIRED_COMMANDS) {
    if (!declaredCommands.has(command)) {
      throw new Error(`Manifest is missing contributed command: ${command}`);
    }
    if (!activationEvents.has(`onCommand:${command}`) && command !== 'photon.openInBeam') {
      throw new Error(`Manifest is missing activation event for command: ${command}`);
    }
    if (!extensionSource.includes(`registerCommand('${command}'`)) {
      throw new Error(`Extension does not register command: ${command}`);
    }
  }

  if (!scripts.build || !scripts.smoke || !scripts.package) {
    throw new Error('Manifest scripts must include build, smoke, and package.');
  }

  if (!files.has('.generated/**')) {
    throw new Error('Manifest files must include .generated/** for vendored runtime packaging.');
  }

  for (const snippet of REQUIRED_RUNTIME_SNIPPETS) {
    if (!extensionSource.includes(snippet)) {
      throw new Error(`Extension is missing expected runtime integration: ${snippet}`);
    }
  }

  console.log('Photon VS Code regression checks passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
