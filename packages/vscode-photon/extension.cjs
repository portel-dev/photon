'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vscode = require('vscode');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'templates', 'photon.template.ts');
const IMPORT_RE = /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]/g;

let directSessionPromise;
let diagnosticsCollection;
const diagnosticTimers = new Map();

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

async function getDirectSession() {
  if (!directSessionPromise) {
    directSessionPromise = loadPhotonModule(
      path.join(DIST_DIR, 'editor-support', 'photon-ts-direct-session.js')
    ).then((mod) => mod.createDirectPhotonTsSession());
  }
  return directSessionPromise;
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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function resolveSupportPath(baseFilePath, specifier) {
  const basePath = path.resolve(path.dirname(baseFilePath), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.js`,
    `${basePath}.d.ts`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.d.ts'),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  return null;
}

async function collectSupportFiles(document) {
  const matches = Array.from(document.getText().matchAll(IMPORT_RE));
  const supportFiles = [];
  const seen = new Set();

  for (const match of matches) {
    const specifier = match[1] || match[2];
    if (!specifier) continue;
    const resolvedPath = await resolveSupportPath(document.fileName, specifier);
    if (!resolvedPath || seen.has(resolvedPath)) continue;
    seen.add(resolvedPath);
    supportFiles.push({
      path: resolvedPath,
      source: await fs.readFile(resolvedPath, 'utf8'),
    });
  }

  return supportFiles;
}

function severityFromPhoton(severity) {
  if (severity === 'warning') return vscode.DiagnosticSeverity.Warning;
  if (severity === 'info') return vscode.DiagnosticSeverity.Information;
  return vscode.DiagnosticSeverity.Error;
}

async function refreshDiagnostics(document) {
  if (!diagnosticsCollection) return;
  if (!isPhotonDocument(document) || document.isUntitled) {
    diagnosticsCollection.delete(document.uri);
    return;
  }

  const session = await getDirectSession();
  const supportFiles = await collectSupportFiles(document);
  const diagnostics = await session.diagnostics(document.fileName, document.getText(), supportFiles);
  const nextDiagnostics = diagnostics.map((entry) => {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(document.positionAt(entry.from), document.positionAt(entry.to)),
      entry.message,
      severityFromPhoton(entry.severity)
    );
    diagnostic.code = entry.code;
    diagnostic.source = 'photon';
    return diagnostic;
  });
  diagnosticsCollection.set(document.uri, nextDiagnostics);
}

function scheduleDiagnostics(document, delay = 150) {
  if (!isPhotonDocument(document)) return;
  const existing = diagnosticTimers.get(document.uri.toString());
  if (existing) clearTimeout(existing);
  const handle = setTimeout(() => {
    diagnosticTimers.delete(document.uri.toString());
    void refreshDiagnostics(document);
  }, delay);
  diagnosticTimers.set(document.uri.toString(), handle);
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

  if (await pathExists(targetPath)) {
    vscode.window.showErrorMessage(`Photon already exists: ${path.basename(targetPath)}`);
    return;
  }

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

function createPhotonHoverProvider() {
  return {
    async provideHover(document, position) {
      if (!isPhotonDocument(document)) return null;
      const session = await getDirectSession();
      const supportFiles = await collectSupportFiles(document);
      const hover = await session.hover(
        document.fileName,
        document.getText(),
        document.offsetAt(position),
        supportFiles
      );
      if (!hover) return null;

      const contents = [];
      if (hover.display) {
        contents.push(new vscode.MarkdownString().appendCodeblock(hover.display, 'ts'));
      }
      if (hover.documentation) {
        contents.push(new vscode.MarkdownString(hover.documentation));
      }
      for (const tag of hover.tags || []) {
        if (!tag.text) continue;
        contents.push(new vscode.MarkdownString(`**@${tag.name}** ${tag.text}`));
      }

      return new vscode.Hover(
        contents,
        new vscode.Range(document.positionAt(hover.from), document.positionAt(hover.to))
      );
    },
  };
}

function createPhotonDefinitionProvider() {
  return {
    async provideDefinition(document, position) {
      if (!isPhotonDocument(document)) return null;
      const session = await getDirectSession();
      const supportFiles = await collectSupportFiles(document);
      const definition = await session.definition(
        document.fileName,
        document.getText(),
        document.offsetAt(position),
        supportFiles
      );
      if (!definition || definition.kind === 'virtual') return null;

      const targetDocument =
        definition.filePath === document.fileName
          ? document
          : await vscode.workspace.openTextDocument(definition.filePath);

      return new vscode.Location(
        targetDocument.uri,
        new vscode.Range(
          targetDocument.positionAt(definition.targetFrom),
          targetDocument.positionAt(definition.targetTo)
        )
      );
    },
  };
}

function createPhotonReferenceProvider() {
  return {
    async provideReferences(document, position) {
      if (!isPhotonDocument(document)) return [];
      const session = await getDirectSession();
      const supportFiles = await collectSupportFiles(document);
      const references = await session.references(
        document.fileName,
        document.getText(),
        document.offsetAt(position),
        supportFiles
      );
      if (!references) return [];

      const locations = [];
      for (const item of references.items) {
        const targetDocument =
          item.filePath === document.fileName
            ? document
            : await vscode.workspace.openTextDocument(item.filePath);
        locations.push(
          new vscode.Location(
            targetDocument.uri,
            new vscode.Range(
              targetDocument.positionAt(item.from),
              targetDocument.positionAt(item.to)
            )
          )
        );
      }
      return locations;
    },
  };
}

async function buildWorkspaceEditFromUpdatedFiles(currentDocument, files) {
  const edit = new vscode.WorkspaceEdit();
  for (const file of files) {
    const targetDocument =
      file.filePath === currentDocument.fileName
        ? currentDocument
        : await vscode.workspace.openTextDocument(file.filePath);
    const fullRange = new vscode.Range(
      targetDocument.positionAt(0),
      targetDocument.positionAt(targetDocument.getText().length)
    );
    edit.replace(targetDocument.uri, fullRange, file.source);
  }
  return edit;
}

function createPhotonRenameProvider() {
  return {
    prepareRename(document, position) {
      return document.getWordRangeAtPosition(position);
    },
    async provideRenameEdits(document, position, newName) {
      if (!isPhotonDocument(document)) return null;
      const session = await getDirectSession();
      const supportFiles = await collectSupportFiles(document);
      const rename = await session.rename(
        document.fileName,
        document.getText(),
        document.offsetAt(position),
        newName,
        supportFiles
      );
      if (!rename) return null;
      return buildWorkspaceEditFromUpdatedFiles(document, rename.files);
    },
  };
}

function createPhotonCodeActionProvider() {
  return {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    async provideCodeActions(document, range, context) {
      if (!isPhotonDocument(document)) return [];

      const relevantDiagnostics = context.diagnostics.filter(
        (diagnostic) =>
          diagnostic.source === 'photon' &&
          typeof diagnostic.code === 'number' &&
          diagnostic.severity === vscode.DiagnosticSeverity.Error
      );
      if (relevantDiagnostics.length === 0) return [];

      const session = await getDirectSession();
      const supportFiles = await collectSupportFiles(document);
      const actions = [];
      const seen = new Set();

      for (const diagnostic of relevantDiagnostics) {
        if (!diagnostic.range.intersection(range)) continue;

        const fixes = await session.codeFixes(
          document.fileName,
          document.getText(),
          document.offsetAt(diagnostic.range.start),
          document.offsetAt(diagnostic.range.end),
          Number(diagnostic.code),
          supportFiles
        );

        for (const fix of fixes) {
          const key = `${diagnostic.code}:${fix.description}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const action = new vscode.CodeAction(
            fix.description,
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diagnostic];
          action.edit = await buildWorkspaceEditFromUpdatedFiles(document, fix.files);
          action.isPreferred = fix.files.length === 1;
          actions.push(action);
        }
      }

      return actions;
    },
  };
}

function createPhotonSignatureHelpProvider() {
  return {
    async provideSignatureHelp(document, position) {
      if (!isPhotonDocument(document)) return null;
      const session = await getDirectSession();
      const supportFiles = await collectSupportFiles(document);
      const signatureHelp = await session.signatureHelp(
        document.fileName,
        document.getText(),
        document.offsetAt(position),
        supportFiles
      );
      if (!signatureHelp || signatureHelp.items.length === 0) return null;

      const result = new vscode.SignatureHelp();
      result.activeSignature = signatureHelp.activeItem;
      result.activeParameter = signatureHelp.activeParameter;
      result.signatures = signatureHelp.items.map((item) => {
        const signature = new vscode.SignatureInformation(
          `${item.prefix}${item.parameters.map((param) => param.text).join(item.separator)}${item.suffix}`,
          item.documentation
        );
        signature.parameters = item.parameters.map(
          (param) => new vscode.ParameterInformation(param.text, param.documentation)
        );
        return signature;
      });
      return result;
    },
  };
}

function activate(context) {
  const selector = { language: 'typescript', scheme: 'file', pattern: '**/*.photon.ts' };
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('photon');

  context.subscriptions.push(
    diagnosticsCollection,
    vscode.workspace.onDidOpenTextDocument((document) => {
      void ensureDeclarationForDocument(document);
      scheduleDiagnostics(document, 0);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void ensureDeclarationForDocument(document);
      scheduleDiagnostics(document, 0);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduleDiagnostics(event.document);
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
    ),
    vscode.languages.registerHoverProvider(selector, createPhotonHoverProvider()),
    vscode.languages.registerDefinitionProvider(selector, createPhotonDefinitionProvider()),
    vscode.languages.registerReferenceProvider(selector, createPhotonReferenceProvider()),
    vscode.languages.registerRenameProvider(selector, createPhotonRenameProvider()),
    vscode.languages.registerCodeActionsProvider(selector, createPhotonCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.languages.registerSignatureHelpProvider(
      selector,
      createPhotonSignatureHelpProvider(),
      '(',
      ','
    )
  );

  for (const document of vscode.workspace.textDocuments) {
    void ensureDeclarationForDocument(document);
    scheduleDiagnostics(document, 0);
  }
}

async function deactivate() {
  for (const handle of diagnosticTimers.values()) {
    clearTimeout(handle);
  }
  diagnosticTimers.clear();
  diagnosticsCollection = null;
  if (directSessionPromise) {
    const session = await directSessionPromise;
    await session.destroy();
    directSessionPromise = null;
  }
}

module.exports = {
  activate,
  deactivate,
};
