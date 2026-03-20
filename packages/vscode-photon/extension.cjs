'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vscode = require('vscode');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'templates', 'photon.template.ts');

function isPhotonDocument(document) {
  return Boolean(document && document.fileName && document.fileName.endsWith('.photon.ts'));
}

function photonNameFromPath(filePath) {
  return path.basename(filePath).replace(/\.photon\.ts$/i, '');
}

function toKebabCase(value) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function toPascalCase(value) {
  return value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function getBaseDir(document) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  return workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.fileName);
}

async function loadPhotonModule(modulePath) {
  return import(pathToFileURL(modulePath).href);
}

async function ensureDeclarationForDocument(document) {
  if (!isPhotonDocument(document) || document.isUntitled) return null;
  const { ensurePhotonEditorDeclaration } = await loadPhotonModule(
    path.join(DIST_DIR, 'photon-editor-declarations.js')
  );
  return ensurePhotonEditorDeclaration(document.fileName, document.getText(), getBaseDir(document));
}

async function regenerateWorkspaceDeclarations() {
  const results = [];
  const seen = new Set();

  for (const document of vscode.workspace.textDocuments) {
    if (!isPhotonDocument(document)) continue;
    seen.add(document.fileName);
    const declarationPath = await ensureDeclarationForDocument(document);
    if (declarationPath) results.push(declarationPath);
  }

  const files = await vscode.workspace.findFiles(
    '**/*.photon.ts',
    '**/{node_modules,dist,.cache}/**'
  );

  const { ensurePhotonEditorDeclaration } = await loadPhotonModule(
    path.join(DIST_DIR, 'photon-editor-declarations.js')
  );

  for (const uri of files) {
    if (seen.has(uri.fsPath)) continue;
    const source = await fs.readFile(uri.fsPath, 'utf8');
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const baseDir = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(uri.fsPath);
    const declarationPath = await ensurePhotonEditorDeclaration(uri.fsPath, source, baseDir);
    if (declarationPath) results.push(declarationPath);
  }

  return results;
}

async function createPhotonFromTemplate() {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  if (workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('Open a workspace folder before creating a Photon.');
    return;
  }

  const rawName = await vscode.window.showInputBox({
    prompt: 'Photon name',
    placeHolder: 'walkthrough',
    validateInput(value) {
      return value.trim() ? null : 'Photon name is required';
    },
  });
  if (!rawName) return;

  const folderPick =
    workspaceFolders.length === 1
      ? workspaceFolders[0]
      : await vscode.window.showQuickPick(
          workspaceFolders.map((folder) => ({
            label: folder.name,
            description: folder.uri.fsPath,
            folder,
          })),
          { placeHolder: 'Select the workspace folder for the new photon' }
        );
  if (!folderPick) return;

  const folder = folderPick.folder || folderPick;
  const kebabName = toKebabCase(rawName.replace(/\.photon\.ts$/i, ''));
  const className = toPascalCase(kebabName) || 'MyPhoton';
  const targetPath = path.join(folder.uri.fsPath, `${kebabName}.photon.ts`);

  try {
    await fs.access(targetPath);
    vscode.window.showErrorMessage(`Photon already exists: ${path.basename(targetPath)}`);
    return;
  } catch {}

  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const content = template
    .replaceAll('TemplateName', className)
    .replaceAll('template-name', kebabName);

  await fs.writeFile(targetPath, content, 'utf8');
  const document = await vscode.workspace.openTextDocument(targetPath);
  await vscode.window.showTextDocument(document);
  await ensureDeclarationForDocument(document);
}

async function openCurrentPhotonInBeam() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isPhotonDocument(editor.document)) {
    vscode.window.showErrorMessage('Open a .photon.ts file first.');
    return;
  }

  const beamUrl = vscode.workspace.getConfiguration('photon').get('beamUrl', 'http://localhost:3000');
  const photonName = encodeURIComponent(photonNameFromPath(editor.document.fileName));
  await vscode.env.openExternal(vscode.Uri.parse(`${beamUrl.replace(/\/$/, '')}/${photonName}`));
}

async function buildDocblockCompletions() {
  const { buildPhotonDocblockTagCatalog } = await loadPhotonModule(
    path.join(DIST_DIR, 'editor-support', 'docblock-tag-catalog.js')
  );
  return buildPhotonDocblockTagCatalog('1.0.0');
}

function insideDocblock(linePrefix) {
  return /\/\*\*|\*\s+|^\s*\*/.test(linePrefix);
}

function createDocblockCompletionItem(tag, range) {
  const item = new vscode.CompletionItem(tag.label, vscode.CompletionItemKind.Keyword);
  item.detail = tag.detail;
  if (tag.info) {
    item.documentation = new vscode.MarkdownString(tag.info);
  }
  if (tag.snippetTmpl || tag.apply) {
    item.insertText = new vscode.SnippetString(tag.snippetTmpl || tag.apply);
  }
  item.range = range;
  return item;
}

function createPhotonCompletionProvider() {
  const catalogPromise = buildDocblockCompletions();

  return {
    async provideCompletionItems(document, position) {
      if (!isPhotonDocument(document)) return [];

      const linePrefix = document.lineAt(position).text.slice(0, position.character);
      if (!insideDocblock(linePrefix)) return [];

      const inlineMatch = linePrefix.match(/\{@[A-Za-z]*$/);
      if (inlineMatch) {
        const catalog = await catalogPromise;
        const range = new vscode.Range(
          position.translate(0, -inlineMatch[0].length),
          position
        );
        const tagPool = linePrefix.includes('@param')
          ? catalog.inlineParamTags
          : catalog.inlineGeneralTags;
        return tagPool.map((tag) => createDocblockCompletionItem(tag, range));
      }

      const blockMatch = linePrefix.match(/@[A-Za-z]*$/);
      if (!blockMatch) return [];

      const catalog = await catalogPromise;
      const range = new vscode.Range(position.translate(0, -blockMatch[0].length), position);
      return catalog.allTags.map((tag) => createDocblockCompletionItem(tag, range));
    },
  };
}

function activate(context) {
  const selector = { language: 'typescript', scheme: 'file', pattern: '**/*.photon.ts' };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void ensureDeclarationForDocument(document);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void ensureDeclarationForDocument(document);
    }),
    vscode.commands.registerCommand('photon.openInBeam', () => void openCurrentPhotonInBeam()),
    vscode.commands.registerCommand('photon.regenerateEditorCache', async () => {
      const declarationPaths = await regenerateWorkspaceDeclarations();
      vscode.window.showInformationMessage(
        declarationPaths.length > 0
          ? `Regenerated ${declarationPaths.length} Photon editor declaration file(s).`
          : 'No Photon files found to regenerate.'
      );
    }),
    vscode.commands.registerCommand('photon.createPhoton', () => void createPhotonFromTemplate()),
    vscode.languages.registerCompletionItemProvider(
      selector,
      createPhotonCompletionProvider(),
      '@',
      '{'
    )
  );

  for (const document of vscode.workspace.textDocuments) {
    void ensureDeclarationForDocument(document);
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
