'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vscode = require('vscode');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BUNDLED_DIST_DIR = path.join(__dirname, '.generated', 'photon-dist');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'templates', 'photon.template.ts');
const IMPORT_RE = /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]/g;

let directSessionPromise;
let diagnosticsCollection;
const diagnosticTimers = new Map();
const resolvedImportCache = new Map();
const supportFileCache = new Map();
const supportGraphCache = new Map();

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

function getPhotonRuntimeDir() {
  return require('node:fs').existsSync(BUNDLED_DIST_DIR) ? BUNDLED_DIST_DIR : DIST_DIR;
}

async function getDirectSession() {
  if (!directSessionPromise) {
    directSessionPromise = loadPhotonModule(
      path.join(getPhotonRuntimeDir(), 'editor-support', 'photon-ts-direct-session.js')
    ).then((mod) => mod.createDirectPhotonTsSession());
  }
  return directSessionPromise;
}

async function ensureDeclarationForDocument(document) {
  if (!isPhotonDocument(document) || document.isUntitled) return null;
  const { ensurePhotonEditorDeclaration } = await loadPhotonModule(
    path.join(getPhotonRuntimeDir(), 'photon-editor-declarations.js')
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
    path.join(getPhotonRuntimeDir(), 'photon-editor-declarations.js')
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
  const cacheKey = `${baseFilePath}::${specifier}`;
  if (resolvedImportCache.has(cacheKey)) {
    return resolvedImportCache.get(cacheKey);
  }

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
    if (await pathExists(candidate)) {
      resolvedImportCache.set(cacheKey, candidate);
      return candidate;
    }
  }

  resolvedImportCache.set(cacheKey, null);
  return null;
}

function getImportsSignature(source) {
  return Array.from(source.matchAll(IMPORT_RE))
    .map((match) => match[1] || match[2] || '')
    .filter(Boolean)
    .join('|');
}

async function loadSupportFile(filePath) {
  const stat = await fs.stat(filePath);
  const cached = supportFileCache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return cached.source;
  }

  const source = await fs.readFile(filePath, 'utf8');
  supportFileCache.set(filePath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    source,
  });
  return source;
}

async function collectSupportFiles(document) {
  const documentSource = document.getText();
  const importsSignature = getImportsSignature(documentSource);
  const cachedGraph = supportGraphCache.get(document.fileName);
  if (
    cachedGraph &&
    cachedGraph.version === document.version &&
    cachedGraph.importsSignature === importsSignature
  ) {
    return cachedGraph.files;
  }

  const matches = Array.from(documentSource.matchAll(IMPORT_RE));
  const supportFiles = [];
  const seen = new Set();
  const dependencyPaths = [];

  for (const match of matches) {
    const specifier = match[1] || match[2];
    if (!specifier) continue;
    const resolvedPath = await resolveSupportPath(document.fileName, specifier);
    if (!resolvedPath || seen.has(resolvedPath)) continue;
    seen.add(resolvedPath);
    dependencyPaths.push(resolvedPath);
    supportFiles.push({
      path: resolvedPath,
      source: await loadSupportFile(resolvedPath),
    });
  }

  supportGraphCache.set(document.fileName, {
    version: document.version,
    importsSignature,
    dependencyPaths,
    files: supportFiles,
  });

  return supportFiles;
}

function invalidateSupportCaches(filePath) {
  resolvedImportCache.forEach((_value, key) => {
    if (key.startsWith(`${filePath}::`)) {
      resolvedImportCache.delete(key);
    }
  });

  supportFileCache.delete(filePath);
  supportGraphCache.delete(filePath);
  for (const [photonPath, entry] of supportGraphCache.entries()) {
    if (entry.dependencyPaths.includes(filePath)) {
      supportGraphCache.delete(photonPath);
    }
  }
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
    path.join(getPhotonRuntimeDir(), 'editor-support', 'docblock-tag-catalog.js')
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

function toCompletionKind(kind) {
  const map = {
    function: vscode.CompletionItemKind.Function,
    method: vscode.CompletionItemKind.Method,
    property: vscode.CompletionItemKind.Property,
    class: vscode.CompletionItemKind.Class,
    variable: vscode.CompletionItemKind.Variable,
    keyword: vscode.CompletionItemKind.Keyword,
    text: vscode.CompletionItemKind.Text,
  };
  return map[kind] || vscode.CompletionItemKind.Text;
}

function createRuntimeCompletionItem(entry, range) {
  const item = new vscode.CompletionItem(entry.label, toCompletionKind(entry.kind));
  item.detail = entry.detail;
  item.range = range;
  return item;
}

function createPhotonCompletionProvider() {
  const catalogPromise = buildDocblockCompletions();

  return {
    async provideCompletionItems(document, position, _token, context) {
      if (!isPhotonDocument(document)) return [];

      const linePrefix = document.lineAt(position).text.slice(0, position.character);
      if (insideDocblock(linePrefix)) {
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

        const catalog = await catalogPromise;
        const blockMatch = linePrefix.match(/@[A-Za-z]*$/);
        if (!blockMatch) return [];

        const range = new vscode.Range(position.translate(0, -blockMatch[0].length), position);
        return catalog.allTags.map((tag) => createDocblockCompletionItem(tag, range));
      }

      const session = await getDirectSession();
      const supportFiles = await collectSupportFiles(document);
      const completions = await session.completions(
        document.fileName,
        document.getText(),
        document.offsetAt(position),
        context.triggerKind === vscode.CompletionTriggerKind.Invoke,
        supportFiles
      );
      if (!completions.length) return [];

      const wordRange =
        document.getWordRangeAtPosition(position) || new vscode.Range(position, position);
      return completions.map((entry) => createRuntimeCompletionItem(entry, wordRange));
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

function buildChangeMetadata(file, annotation) {
  if (!annotation) return undefined;

  const relativePath =
    vscode.workspace.asRelativePath(file.filePath, false) || path.basename(file.filePath);
  const needsConfirmation =
    annotation.needsConfirmation === true ||
    (annotation.multiFile === true && file.filePath !== annotation.currentFilePath);

  return {
    label: annotation.label,
    description: `${relativePath} • ${file.changeCount} change${file.changeCount === 1 ? '' : 's'}`,
    needsConfirmation,
  };
}

async function buildWorkspaceEditFromUpdatedFiles(currentDocument, files, annotation) {
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
    edit.replace(targetDocument.uri, fullRange, file.source, buildChangeMetadata(file, annotation));
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
      return buildWorkspaceEditFromUpdatedFiles(document, rename.files, {
        label: `Rename Photon symbol to ${newName}`,
        currentFilePath: document.fileName,
        multiFile: rename.files.length > 1,
      });
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
          action.edit = await buildWorkspaceEditFromUpdatedFiles(document, fix.files, {
            label: fix.description,
            currentFilePath: document.fileName,
            multiFile: fix.files.length > 1,
          });
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

function toSymbolKind(kind) {
  const map = {
    class: vscode.SymbolKind.Class,
    method: vscode.SymbolKind.Method,
    function: vscode.SymbolKind.Function,
    property: vscode.SymbolKind.Property,
    variable: vscode.SymbolKind.Variable,
    interface: vscode.SymbolKind.Interface,
    enum: vscode.SymbolKind.Enum,
    namespace: vscode.SymbolKind.Namespace,
    module: vscode.SymbolKind.Module,
    constructor: vscode.SymbolKind.Constructor,
  };
  return map[kind] || vscode.SymbolKind.Object;
}

function buildDocumentSymbols(document, items) {
  const roots = [];
  const stack = [];

  for (const item of items) {
    const range = new vscode.Range(
      document.positionAt(item.from),
      document.positionAt(item.to)
    );
    const symbol = new vscode.DocumentSymbol(
      item.text,
      '',
      toSymbolKind(item.kind),
      range,
      range
    );

    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.symbol.children.push(symbol);
    } else {
      roots.push(symbol);
    }

    stack.push({ level: item.level, symbol });
  }

  return roots;
}

function createPhotonDocumentSymbolProvider() {
  return {
    async provideDocumentSymbols(document) {
      if (!isPhotonDocument(document)) return [];
      const session = await getDirectSession();
      const supportFiles = await collectSupportFiles(document);
      const outline = await session.outline(
        document.fileName,
        document.getText(),
        supportFiles
      );
      return buildDocumentSymbols(document, outline);
    },
  };
}

async function goToPhotonSymbol() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isPhotonDocument(editor.document)) {
    vscode.window.showErrorMessage('Open a .photon.ts file first.');
    return;
  }

  const session = await getDirectSession();
  const supportFiles = await collectSupportFiles(editor.document);
  const outline = await session.outline(
    editor.document.fileName,
    editor.document.getText(),
    supportFiles
  );

  const pick = await vscode.window.showQuickPick(
    outline.map((item) => ({
      label: item.text,
      description: item.kind,
      detail: `${'  '.repeat(item.level)}line ${editor.document.positionAt(item.from).line + 1}`,
      item,
    })),
    { placeHolder: 'Jump to a Photon symbol' }
  );
  if (!pick) return;

  const range = new vscode.Range(
    editor.document.positionAt(pick.item.from),
    editor.document.positionAt(pick.item.to)
  );
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

function activate(context) {
  const selector = { language: 'typescript', scheme: 'file', pattern: '**/*.photon.ts' };
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('photon');

  context.subscriptions.push(
    diagnosticsCollection,
    vscode.workspace.onDidOpenTextDocument((document) => {
      invalidateSupportCaches(document.fileName);
      void ensureDeclarationForDocument(document);
      scheduleDiagnostics(document, 0);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      invalidateSupportCaches(document.fileName);
      void ensureDeclarationForDocument(document);
      scheduleDiagnostics(document, 0);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      invalidateSupportCaches(event.document.fileName);
      scheduleDiagnostics(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      invalidateSupportCaches(document.fileName);
      if (isPhotonDocument(document) && diagnosticsCollection) {
        diagnosticsCollection.delete(document.uri);
      }
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
    vscode.commands.registerCommand('photon.goToSymbol', () => void goToPhotonSymbol()),
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
    ),
    vscode.languages.registerDocumentSymbolProvider(selector, createPhotonDocumentSymbolProvider())
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
