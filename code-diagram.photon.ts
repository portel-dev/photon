/**
 * Code Diagram - Generate Mermaid diagrams from TypeScript/JavaScript code
 *
 * Visualize any code as flowcharts, API surfaces, dependency graphs, or call graphs.
 * Works on raw code strings or files - no AI required, pure static analysis.
 *
 * @name code-diagram
 * @version 1.0.0
 * @author Portel
 * @license MIT
 * @dependencies typescript@^5.0.0
 */

import * as fs from 'fs/promises';
import ts from 'typescript';

type DiagramType = 'auto' | 'workflow' | 'api' | 'deps' | 'calls';
type DiagramStyle = 'linear' | 'branching' | 'structure';

interface YieldStatement {
  type: 'ask' | 'emit';
  subtype: string;
  message?: string;
  variable?: string;
}

interface MethodInfo {
  name: string;
  isGenerator: boolean;
  isAsync: boolean;
  params: string[];
}

interface ImportInfo {
  source: string;
  imports: string[];
  isDefault: boolean;
}

interface CallInfo {
  caller: string;
  callee: string;
  method?: string;
}

export default class CodeDiagram {
  /**
   * Generate a Mermaid diagram from code string
   *
   * @param code The TypeScript/JavaScript code to analyze
   * @param type Diagram type: 'auto' | 'workflow' | 'api' | 'deps' | 'calls' (default: 'auto')
   * @param style Diagram style: 'linear' (happy path) | 'branching' (control flow) | 'structure' (async/generators/deps)
   * @param name Optional name for the diagram (default: 'Code')
   */
  async generate(params: {
    code: string;
    type?: DiagramType;
    style?: DiagramStyle;
    name?: string;
  }): Promise<{ diagram: string; detectedType: string; style: string; isPhoton: boolean }> {
    const { code, type = 'auto', style = 'linear', name = 'Code' } = params;

    const detectedType = type === 'auto' ? this.detectType(code) : type;
    const isPhoton = this.detectPhoton(code);

    let diagram: string;

    // Structure style works for any type - shows architecture
    if (style === 'structure') {
      diagram = this.generateStructureDiagram(code, name);
      return { diagram, detectedType, style, isPhoton };
    }

    switch (detectedType) {
      case 'workflow':
        diagram = style === 'branching'
          ? this.generateBranchingWorkflowDiagram(code, name)
          : this.generateWorkflowDiagram(code, name);
        break;
      case 'deps':
        diagram = this.generateDepsDiagram(code, name);
        break;
      case 'calls':
        diagram = this.generateCallsDiagram(code, name);
        break;
      case 'api':
      default:
        diagram = this.generateApiDiagram(code, name);
        break;
    }

    // If it's a Photon, augment with Photon-specific context
    if (isPhoton && style !== 'structure') {
      diagram = this.augmentWithPhotonContext(diagram, code, name);
    }

    return { diagram, detectedType, style, isPhoton };
  }

  /**
   * Generate a Mermaid diagram from a file
   *
   * @param path Path to the TypeScript/JavaScript file {@accept *.ts,*.js,*.tsx,*.jsx,*.photon.ts}
   * @param type Diagram type: 'auto' | 'workflow' | 'api' | 'deps' | 'calls' (default: 'auto')
   * @param style Diagram style: 'linear' | 'branching' (default: 'linear')
   */
  async fromFile(params: {
    path: string;
    type?: DiagramType;
    style?: DiagramStyle;
  }): Promise<{ diagram: string; detectedType: string; style: string; isPhoton: boolean; name: string }> {
    const { path, type = 'auto', style = 'linear' } = params;

    const code = await fs.readFile(path, 'utf-8');
    const name = this.extractName(path, code);

    const result = await this.generate({ code, type, style, name });
    return { ...result, name };
  }

  /**
   * List available diagram types and styles
   */
  async types(): Promise<{
    types: Array<{ name: string; description: string; bestFor: string }>;
    styles: Array<{ name: string; description: string; bestFor: string }>;
  }> {
    return {
      types: [
        {
          name: 'auto',
          description: 'Automatically detect the best diagram type',
          bestFor: 'When you\'re not sure which type to use',
        },
        {
          name: 'workflow',
          description: 'Flowchart showing execution flow with decision points',
          bestFor: 'Async generators, state machines, multi-step processes',
        },
        {
          name: 'api',
          description: 'API surface diagram showing available methods',
          bestFor: 'Classes, modules, service interfaces',
        },
        {
          name: 'deps',
          description: 'Dependency graph showing imports and modules',
          bestFor: 'Understanding module dependencies, refactoring',
        },
        {
          name: 'calls',
          description: 'Call graph showing function relationships',
          bestFor: 'Understanding code flow, finding dead code',
        },
      ],
      styles: [
        {
          name: 'linear',
          description: 'Sequential flow showing the happy path',
          bestFor: 'Quick overview, documentation, understanding main flow',
        },
        {
          name: 'branching',
          description: 'Full control flow with if/else/switch branches',
          bestFor: 'Debugging, understanding edge cases, finding all paths',
        },
        {
          name: 'structure',
          description: 'Architecture showing async/await, generators, dependencies, and injections',
          bestFor: 'Understanding Photon architecture, runtime dependencies, async patterns',
        },
      ],
    };
  }

  // ============================================
  // PHOTON & TYPE DETECTION
  // ============================================

  /**
   * Detect if code is a Photon based on characteristic patterns
   */
  private detectPhoton(code: string): boolean {
    // Check for Photon JSDoc markers
    if (/@name\s+\S+/.test(code)) return true;
    if (/@dependencies\s+\S+/.test(code)) return true;

    // Check for Photon runtime patterns
    if (/this\.mcp\s*\(/.test(code)) return true;
    if (/this\.photon\s*\(/.test(code)) return true;

    // Check for workflow yield patterns
    if (/yield\s*\{\s*(ask|emit)\s*:/.test(code)) return true;

    // Check for .photon.ts filename pattern in @name
    if (/@name\s+[\w-]+/.test(code)) return true;

    // Check for default export class pattern common in Photons
    if (/export\s+default\s+class\s+\w+/.test(code) && /async\s+\w+\s*\(/.test(code)) {
      // Has default export class with async methods - likely a Photon
      return true;
    }

    return false;
  }

  /**
   * Augment any diagram with Photon-specific context
   */
  private augmentWithPhotonContext(diagram: string, code: string, name: string): string {
    const dependencies = this.extractDependencies(code);
    const mcpCalls = this.extractMcpCalls(code);
    const photonCalls = this.extractPhotonCalls(code);
    const yields = this.extractYields(code);

    const contextLines: string[] = [];

    // Add dependencies
    if (dependencies.length > 0) {
      contextLines.push('');
      contextLines.push('    subgraph PHOTON_DEPS["📚 Dependencies"]');
      contextLines.push('        direction LR');
      dependencies.forEach((dep, i) => {
        contextLines.push(`        PDEP${i}[${dep.name}@${dep.version}]`);
      });
      contextLines.push('    end');
    }

    // Add MCP injections
    if (mcpCalls.length > 0) {
      const uniqueMcps = [...new Set(mcpCalls.map(c => c.name))];
      contextLines.push('');
      contextLines.push('    subgraph PHOTON_MCPS["🔌 MCP Injections"]');
      contextLines.push('        direction LR');
      uniqueMcps.forEach((mcp, i) => {
        contextLines.push(`        PMCP${i}[${mcp}]`);
      });
      contextLines.push('    end');
    }

    // Add Photon injections
    if (photonCalls.length > 0) {
      const uniquePhotons = [...new Set(photonCalls.map(c => c.name))];
      contextLines.push('');
      contextLines.push('    subgraph PHOTON_PHTS["📦 Photon Calls"]');
      contextLines.push('        direction LR');
      uniquePhotons.forEach((photon, i) => {
        contextLines.push(`        PPHT${i}[${photon}]`);
      });
      contextLines.push('    end');
    }

    // Add yield patterns for workflows
    if (yields.length > 0) {
      const askTypes = [...new Set(yields.filter(y => y.type === 'ask').map(y => y.subtype))];
      const emitTypes = [...new Set(yields.filter(y => y.type === 'emit').map(y => y.subtype))];

      if (askTypes.length > 0 || emitTypes.length > 0) {
        contextLines.push('');
        contextLines.push('    subgraph PHOTON_YIELDS["🔄 Yield Patterns"]');
        contextLines.push('        direction LR');
        if (askTypes.length > 0) {
          contextLines.push(`        PASK[❓ ask: ${askTypes.join(', ')}]`);
        }
        if (emitTypes.length > 0) {
          contextLines.push(`        PEMIT[📣 emit: ${emitTypes.join(', ')}]`);
        }
        contextLines.push('    end');
      }
    }

    if (contextLines.length === 0) {
      return diagram;
    }

    // Insert context before the last line or at the end
    const lines = diagram.split('\n');
    return [...lines, ...contextLines].join('\n');
  }

  private detectType(code: string): DiagramType {
    // Check for workflow patterns (ask/emit yields)
    if (/yield\s*\{\s*(ask|emit)\s*:/.test(code)) {
      return 'workflow';
    }

    // Check for async generators
    if (/async\s+\*\s*\w+/.test(code)) {
      return 'workflow';
    }

    // Check if it's mostly imports (dependency-focused)
    const importCount = (code.match(/^import\s+/gm) || []).length;
    const totalLines = code.split('\n').filter(l => l.trim()).length;
    if (importCount > totalLines * 0.3) {
      return 'deps';
    }

    // Check for class with methods (API surface)
    if (/class\s+\w+/.test(code) && /async\s+\w+\s*\(/.test(code)) {
      return 'api';
    }

    // Check for multiple function definitions (call graph)
    const functionCount = (code.match(/(?:async\s+)?function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/g) || []).length;
    if (functionCount >= 3) {
      return 'calls';
    }

    // Default to API
    return 'api';
  }

  // ============================================
  // DIAGRAM GENERATORS
  // ============================================

  private generateWorkflowDiagram(code: string, name: string): string {
    const yields = this.extractYields(code);
    const externalCalls = this.extractExternalCalls(code);
    const lines: string[] = ['flowchart TD'];

    lines.push(`    subgraph ${this.sanitizeId(name)}["📦 ${this.titleCase(name)}"]`);
    lines.push('        START([▶ Start])');

    let prevNode = 'START';
    let nodeCounter = 0;

    // Process yields
    for (const y of yields) {
      const nodeId = `N${nodeCounter++}`;

      if (y.type === 'emit') {
        const emoji = this.getEmitEmoji(y.subtype);
        const msg = y.message ? this.truncate(y.message, 30) : y.subtype;
        lines.push(`        ${nodeId}[${emoji} ${msg}]`);
        lines.push(`        ${prevNode} --> ${nodeId}`);
        prevNode = nodeId;
      } else if (y.type === 'ask') {
        const emoji = this.getAskEmoji(y.subtype);
        const msg = y.message ? this.truncate(y.message, 25) : y.subtype;
        lines.push(`        ${nodeId}{${emoji} ${msg}}`);
        lines.push(`        ${prevNode} --> ${nodeId}`);

        if (y.subtype === 'confirm') {
          const cancelId = `N${nodeCounter++}`;
          const continueId = `N${nodeCounter++}`;
          lines.push(`        ${cancelId}([❌ Cancelled])`);
          lines.push(`        ${nodeId} -->|No| ${cancelId}`);
          lines.push(`        ${nodeId} -->|Yes| ${continueId}`);
          lines.push(`        ${continueId}[Continue]`);
          prevNode = continueId;
        } else {
          prevNode = nodeId;
        }
      }
    }

    // Add external calls
    for (const call of externalCalls) {
      const nodeId = `N${nodeCounter++}`;
      const emoji = call.type === 'mcp' ? '🔌' : '📦';
      lines.push(`        ${nodeId}[${emoji} ${call.name}.${call.method}]`);
      lines.push(`        ${prevNode} --> ${nodeId}`);
      prevNode = nodeId;
    }

    // End node
    lines.push(`        SUCCESS([✅ Success])`);
    lines.push(`        ${prevNode} --> SUCCESS`);
    lines.push('    end');

    return lines.join('\n');
  }

  /**
   * Generate workflow diagram with full control flow analysis using TypeScript AST
   */
  private generateBranchingWorkflowDiagram(code: string, name: string): string {
    const sourceFile = ts.createSourceFile(
      'code.ts',
      code,
      ts.ScriptTarget.Latest,
      true
    );

    const lines: string[] = ['flowchart TD'];
    lines.push(`    subgraph ${this.sanitizeId(name)}["📦 ${this.titleCase(name)}"]`);
    lines.push('        START([▶ Start])');

    let nodeCounter = 0;
    const edges: string[] = [];

    const createNode = (label: string, shape: 'rect' | 'diamond' | 'stadium' = 'rect'): string => {
      const id = `N${nodeCounter++}`;
      switch (shape) {
        case 'diamond':
          lines.push(`        ${id}{${label}}`);
          break;
        case 'stadium':
          lines.push(`        ${id}([${label}])`);
          break;
        default:
          lines.push(`        ${id}[${label}]`);
      }
      return id;
    };

    const addEdge = (from: string, to: string, label?: string) => {
      if (label) {
        edges.push(`        ${from} -->|${label}| ${to}`);
      } else {
        edges.push(`        ${from} --> ${to}`);
      }
    };

    // Walk the AST to find the main generator/async function
    let prevNode = 'START';
    let successNode = '';

    const processNode = (node: ts.Node, currentPrev: string): string => {
      // Yield expression with ask/emit
      if (ts.isYieldExpression(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
        const props = node.expression.properties;
        let type = '';
        let subtype = '';
        let message = '';

        for (const prop of props) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            const propName = prop.name.text;
            if (propName === 'ask' || propName === 'emit') {
              type = propName;
              if (ts.isStringLiteral(prop.initializer)) {
                subtype = prop.initializer.text;
              }
            } else if (propName === 'message') {
              if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
                message = prop.initializer.text;
              } else if (ts.isTemplateExpression(prop.initializer)) {
                message = prop.initializer.head.text + '...';
              }
            }
          }
        }

        if (type === 'emit') {
          const emoji = this.getEmitEmoji(subtype);
          const label = message ? `${emoji} ${this.truncate(message, 25)}` : `${emoji} ${subtype}`;
          const nodeId = createNode(label);
          addEdge(currentPrev, nodeId);
          return nodeId;
        } else if (type === 'ask') {
          const emoji = this.getAskEmoji(subtype);
          const label = message ? `${emoji} ${this.truncate(message, 20)}` : `${emoji} ${subtype}`;
          const nodeId = createNode(label, 'diamond');
          addEdge(currentPrev, nodeId);
          return nodeId;
        }
      }

      // If statement
      if (ts.isIfStatement(node)) {
        // Create condition node
        let conditionText = node.expression.getText(sourceFile);
        conditionText = this.truncate(conditionText, 20);
        const condNode = createNode(`❓ ${conditionText}`, 'diamond');
        addEdge(currentPrev, condNode);

        // Process then branch
        let thenEnd = condNode;
        ts.forEachChild(node.thenStatement, (child) => {
          thenEnd = processNode(child, thenEnd);
        });

        // Process else branch
        let elseEnd = condNode;
        if (node.elseStatement) {
          ts.forEachChild(node.elseStatement, (child) => {
            elseEnd = processNode(child, elseEnd);
          });
          addEdge(condNode, elseEnd, 'No');
        }

        addEdge(condNode, thenEnd, 'Yes');

        // Create merge point if both branches exist
        if (node.elseStatement && thenEnd !== condNode && elseEnd !== condNode) {
          const mergeNode = createNode('🔄 Continue');
          addEdge(thenEnd, mergeNode);
          addEdge(elseEnd, mergeNode);
          return mergeNode;
        }

        return thenEnd;
      }

      // Return statement
      if (ts.isReturnStatement(node)) {
        const returnText = node.expression ? node.expression.getText(sourceFile) : '';
        const isSuccess = !returnText.includes('cancel') && !returnText.includes('error') && !returnText.includes('fail');
        const emoji = isSuccess ? '✅' : '❌';
        const label = isSuccess ? 'Success' : 'Exit';
        const nodeId = createNode(`${emoji} ${label}`, 'stadium');
        addEdge(currentPrev, nodeId);
        if (isSuccess) successNode = nodeId;
        return nodeId;
      }

      // Await expression (function calls)
      if (ts.isAwaitExpression(node)) {
        const callText = node.expression.getText(sourceFile);
        // Check for MCP or Photon calls
        const mcpMatch = callText.match(/this\.mcp\(['"](\w+)['"]\)\.(\w+)/);
        const photonMatch = callText.match(/this\.photon\(['"](\w+)['"]\)\.(\w+)/);

        if (mcpMatch) {
          const nodeId = createNode(`🔌 ${mcpMatch[1]}.${mcpMatch[2]}`);
          addEdge(currentPrev, nodeId);
          return nodeId;
        } else if (photonMatch) {
          const nodeId = createNode(`📦 ${photonMatch[1]}.${photonMatch[2]}`);
          addEdge(currentPrev, nodeId);
          return nodeId;
        }
      }

      // Try statement
      if (ts.isTryStatement(node)) {
        const tryNode = createNode('🔧 Try');
        addEdge(currentPrev, tryNode);

        let tryEnd = tryNode;
        ts.forEachChild(node.tryBlock, (child) => {
          tryEnd = processNode(child, tryEnd);
        });

        if (node.catchClause) {
          const catchNode = createNode('⚠️ Catch', 'diamond');
          addEdge(tryNode, catchNode, 'Error');

          let catchEnd = catchNode;
          ts.forEachChild(node.catchClause.block, (child) => {
            catchEnd = processNode(child, catchEnd);
          });
        }

        return tryEnd;
      }

      // Switch statement
      if (ts.isSwitchStatement(node)) {
        const switchText = this.truncate(node.expression.getText(sourceFile), 15);
        const switchNode = createNode(`📋 ${switchText}`, 'diamond');
        addEdge(currentPrev, switchNode);

        const caseEnds: string[] = [];
        for (const clause of node.caseBlock.clauses) {
          if (ts.isCaseClause(clause)) {
            const caseLabel = this.truncate(clause.expression.getText(sourceFile), 10);
            let caseEnd = switchNode;
            for (const stmt of clause.statements) {
              caseEnd = processNode(stmt, caseEnd);
            }
            if (caseEnd !== switchNode) {
              addEdge(switchNode, caseEnd, caseLabel);
              caseEnds.push(caseEnd);
            }
          }
        }

        if (caseEnds.length > 1) {
          const mergeNode = createNode('🔄 Continue');
          caseEnds.forEach(ce => addEdge(ce, mergeNode));
          return mergeNode;
        }

        return caseEnds[0] || switchNode;
      }

      // For of/in loops
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        const loopNode = createNode('🔁 Loop', 'diamond');
        addEdge(currentPrev, loopNode);

        let bodyEnd = loopNode;
        ts.forEachChild(node.statement, (child) => {
          bodyEnd = processNode(child, bodyEnd);
        });

        addEdge(bodyEnd, loopNode, 'Next');
        const exitNode = createNode('Done');
        addEdge(loopNode, exitNode, 'Done');
        return exitNode;
      }

      // Recursively process children
      let lastNode = currentPrev;
      ts.forEachChild(node, (child) => {
        lastNode = processNode(child, lastNode);
      });

      return lastNode;
    };

    // Find and process the main generator or async function
    const visit = (node: ts.Node) => {
      if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
        const name = node.name?.getText(sourceFile) || '';
        // Skip private methods and lifecycle
        if (!name.startsWith('_') && name !== 'constructor' && name !== 'onInitialize' && name !== 'onShutdown') {
          if (node.body) {
            prevNode = processNode(node.body, prevNode);
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Add success node if not already added
    if (!successNode) {
      successNode = createNode('✅ Success', 'stadium');
      addEdge(prevNode, successNode);
    }

    lines.push('    end');

    // Add all edges
    lines.push('');
    lines.push(...edges);

    return lines.join('\n');
  }

  private generateApiDiagram(code: string, name: string): string {
    const methods = this.extractMethods(code);
    const lines: string[] = ['flowchart LR'];

    lines.push(`    subgraph ${this.sanitizeId(name)}["📦 ${this.titleCase(name)}"]`);
    lines.push('        direction TB');
    lines.push('        CORE((🎯))');

    methods.forEach((method, i) => {
      const emoji = method.isGenerator ? '🌊' : this.inferEmoji(method.name);
      const suffix = method.isGenerator ? ' (stream)' : '';
      const id = `M${i}`;
      lines.push(`        ${id}[${emoji} ${method.name}${suffix}]`);
      lines.push(`        CORE --> ${id}`);
    });

    lines.push('    end');

    // Add imports as dependencies
    const imports = this.extractImports(code);
    const externalImports = imports.filter(i => !i.source.startsWith('.'));

    if (externalImports.length > 0) {
      lines.push('');
      lines.push('    subgraph deps["Dependencies"]');
      lines.push('        direction TB');
      externalImports.forEach((imp, i) => {
        const pkg = imp.source.replace(/^@/, '').split('/')[0];
        lines.push(`        DEP${i}[📚 ${pkg}]`);
      });
      lines.push('    end');
    }

    return lines.join('\n');
  }

  private generateDepsDiagram(code: string, name: string): string {
    const imports = this.extractImports(code);
    const lines: string[] = ['flowchart TD'];

    lines.push(`    MAIN[📦 ${this.titleCase(name)}]`);
    lines.push('');

    // Group imports by type
    const nodeModules = imports.filter(i => !i.source.startsWith('.'));
    const localModules = imports.filter(i => i.source.startsWith('.'));

    if (nodeModules.length > 0) {
      lines.push('    subgraph npm["📚 NPM Packages"]');
      nodeModules.forEach((imp, i) => {
        const pkg = imp.source.replace(/['"]/g, '');
        lines.push(`        NPM${i}[${pkg}]`);
      });
      lines.push('    end');
      lines.push('');
      nodeModules.forEach((_, i) => {
        lines.push(`    MAIN --> NPM${i}`);
      });
    }

    if (localModules.length > 0) {
      lines.push('');
      lines.push('    subgraph local["📁 Local Modules"]');
      localModules.forEach((imp, i) => {
        const modName = imp.source.replace(/^\.\//, '').replace(/\.[jt]sx?$/, '');
        lines.push(`        LOCAL${i}[${modName}]`);
      });
      lines.push('    end');
      lines.push('');
      localModules.forEach((_, i) => {
        lines.push(`    MAIN --> LOCAL${i}`);
      });
    }

    return lines.join('\n');
  }

  private generateCallsDiagram(code: string, name: string): string {
    const calls = this.extractCalls(code);
    const methods = this.extractMethods(code);
    const lines: string[] = ['flowchart TD'];

    lines.push(`    subgraph ${this.sanitizeId(name)}["📦 ${this.titleCase(name)}"]`);

    // Add all methods as nodes
    const methodSet = new Set<string>();
    methods.forEach(m => methodSet.add(m.name));

    methods.forEach((method) => {
      const emoji = this.inferEmoji(method.name);
      lines.push(`        ${this.sanitizeId(method.name)}[${emoji} ${method.name}]`);
    });

    lines.push('    end');

    // Add call relationships
    lines.push('');
    for (const call of calls) {
      if (methodSet.has(call.caller) && methodSet.has(call.callee)) {
        lines.push(`    ${this.sanitizeId(call.caller)} --> ${this.sanitizeId(call.callee)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate structure diagram showing async/await patterns, generators, dependencies, and injections
   */
  private generateStructureDiagram(code: string, name: string): string {
    const methods = this.extractMethods(code);
    const dependencies = this.extractDependencies(code);
    const mcpCalls = this.extractMcpCalls(code);
    const photonCalls = this.extractPhotonCalls(code);
    const yields = this.extractYields(code);
    const lines: string[] = ['flowchart TB'];

    // Central Photon node
    lines.push(`    PHOTON((📦 ${this.titleCase(name)}))`);
    lines.push('');

    // Dependencies from @dependencies header
    if (dependencies.length > 0) {
      lines.push('    subgraph DEPS["📚 Dependencies"]');
      lines.push('        direction LR');
      dependencies.forEach((dep, i) => {
        lines.push(`        DEP${i}[${dep.name}@${dep.version}]`);
      });
      lines.push('    end');
      lines.push('    DEPS --> PHOTON');
      lines.push('');
    }

    // Methods grouped by type
    const generators = methods.filter(m => m.isGenerator);
    const asyncMethods = methods.filter(m => m.isAsync && !m.isGenerator);
    const syncMethods = methods.filter(m => !m.isAsync && !m.isGenerator);

    if (generators.length > 0) {
      lines.push('    subgraph GENS["🌊 Generators"]');
      lines.push('        direction TB');
      generators.forEach((m, i) => {
        lines.push(`        GEN${i}[async * ${m.name}]`);
      });
      lines.push('    end');
      lines.push('    PHOTON --> GENS');
      lines.push('');
    }

    if (asyncMethods.length > 0) {
      lines.push('    subgraph ASYNC["⚡ Async Methods"]');
      lines.push('        direction TB');
      asyncMethods.forEach((m, i) => {
        lines.push(`        ASYNC${i}[async ${m.name}]`);
      });
      lines.push('    end');
      lines.push('    PHOTON --> ASYNC');
      lines.push('');
    }

    if (syncMethods.length > 0) {
      lines.push('    subgraph SYNC["📋 Sync Methods"]');
      lines.push('        direction TB');
      syncMethods.forEach((m, i) => {
        lines.push(`        SYNC${i}[${m.name}]`);
      });
      lines.push('    end');
      lines.push('    PHOTON --> SYNC');
      lines.push('');
    }

    // Runtime injections - MCPs
    if (mcpCalls.length > 0) {
      const uniqueMcps = [...new Set(mcpCalls.map(c => c.name))];
      lines.push('    subgraph MCPS["🔌 MCP Injections"]');
      lines.push('        direction LR');
      uniqueMcps.forEach((mcp, i) => {
        lines.push(`        MCP${i}[${mcp}]`);
      });
      lines.push('    end');
      lines.push('    PHOTON -.->|this.mcp| MCPS');
      lines.push('');
    }

    // Runtime injections - Photons
    if (photonCalls.length > 0) {
      const uniquePhotons = [...new Set(photonCalls.map(c => c.name))];
      lines.push('    subgraph PHOTONS["📦 Photon Injections"]');
      lines.push('        direction LR');
      uniquePhotons.forEach((photon, i) => {
        lines.push(`        PHT${i}[${photon}]`);
      });
      lines.push('    end');
      lines.push('    PHOTON -.->|this.photon| PHOTONS');
      lines.push('');
    }

    // Yield patterns (for generators)
    if (yields.length > 0) {
      const askTypes = [...new Set(yields.filter(y => y.type === 'ask').map(y => y.subtype))];
      const emitTypes = [...new Set(yields.filter(y => y.type === 'emit').map(y => y.subtype))];

      if (askTypes.length > 0 || emitTypes.length > 0) {
        lines.push('    subgraph YIELDS["🔄 Yield Patterns"]');
        lines.push('        direction LR');
        if (askTypes.length > 0) {
          lines.push(`        ASK[❓ ask: ${askTypes.join(', ')}]`);
        }
        if (emitTypes.length > 0) {
          lines.push(`        EMIT[📣 emit: ${emitTypes.join(', ')}]`);
        }
        lines.push('    end');
        if (generators.length > 0) {
          lines.push('    GENS -.->|yield| YIELDS');
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Extract @dependencies from JSDoc header
   */
  private extractDependencies(code: string): Array<{ name: string; version: string }> {
    const deps: Array<{ name: string; version: string }> = [];
    const match = code.match(/@dependencies\s+([^\n*]+)/);
    if (match) {
      const depList = match[1].split(/[,\s]+/).filter(Boolean);
      for (const dep of depList) {
        const [name, version = '*'] = dep.split('@');
        if (name) {
          deps.push({ name, version });
        }
      }
    }
    return deps;
  }

  /**
   * Extract this.mcp() calls
   */
  private extractMcpCalls(code: string): Array<{ name: string; method: string }> {
    const calls: Array<{ name: string; method: string }> = [];
    const regex = /this\.mcp\(['"](\w+)['"]\)\.(\w+)/g;
    let match;
    while ((match = regex.exec(code)) !== null) {
      calls.push({ name: match[1], method: match[2] });
    }
    return calls;
  }

  /**
   * Extract this.photon() calls
   */
  private extractPhotonCalls(code: string): Array<{ name: string; method: string }> {
    const calls: Array<{ name: string; method: string }> = [];
    const regex = /this\.photon\(['"](\w+)['"]\)\.(\w+)/g;
    let match;
    while ((match = regex.exec(code)) !== null) {
      calls.push({ name: match[1], method: match[2] });
    }
    return calls;
  }

  // ============================================
  // EXTRACTORS
  // ============================================

  private extractYields(code: string): YieldStatement[] {
    const yields: YieldStatement[] = [];
    const yieldRegex = /(?:const\s+(\w+)\s*(?::\s*\w+)?\s*=\s*)?yield\s*\{\s*(ask|emit)\s*:\s*['"](\w+)['"]\s*(?:,\s*message\s*:\s*[`'"]([^`'"]*)[`'"])?/g;

    let match;
    while ((match = yieldRegex.exec(code)) !== null) {
      yields.push({
        variable: match[1],
        type: match[2] as 'ask' | 'emit',
        subtype: match[3],
        message: match[4],
      });
    }

    return yields;
  }

  private extractExternalCalls(code: string): Array<{ type: 'mcp' | 'photon'; name: string; method: string }> {
    const calls: Array<{ type: 'mcp' | 'photon'; name: string; method: string }> = [];

    // MCP calls
    const mcpRegex = /this\.mcp\(['"](\w+)['"]\)\.(\w+)/g;
    let match;
    while ((match = mcpRegex.exec(code)) !== null) {
      calls.push({ type: 'mcp', name: match[1], method: match[2] });
    }

    // Photon calls
    const photonRegex = /this\.photon\(['"](\w+)['"]\)\.(\w+)/g;
    while ((match = photonRegex.exec(code)) !== null) {
      calls.push({ type: 'photon', name: match[1], method: match[2] });
    }

    return calls;
  }

  private extractMethods(code: string): MethodInfo[] {
    const methods: MethodInfo[] = [];

    // Reserved words that look like function calls but aren't methods
    const reserved = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch',
      'finally', 'throw', 'return', 'break', 'continue', 'new', 'typeof',
      'instanceof', 'in', 'of', 'with', 'function', 'class', 'extends',
      'import', 'export', 'default', 'await', 'yield', 'async', 'static',
      'get', 'set', 'let', 'const', 'var', 'this', 'super', 'delete', 'void',
    ]);

    // Match class methods: async methodName(...) or async *methodName(...)
    // Must be preceded by whitespace/newline (not part of another word)
    const methodRegex = /(?:^|[\s\n])(?:(async)\s+)?(\*?)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/gm;

    let match;
    while ((match = methodRegex.exec(code)) !== null) {
      const name = match[3];

      // Skip reserved words, constructors, private methods, and lifecycle methods
      if (reserved.has(name) ||
          name === 'constructor' ||
          name.startsWith('_') ||
          name === 'onInitialize' ||
          name === 'onShutdown') {
        continue;
      }

      methods.push({
        name,
        isAsync: !!match[1],
        isGenerator: match[2] === '*',
        params: match[4].split(',').map(p => p.trim()).filter(Boolean),
      });
    }

    // Deduplicate by name (keep first occurrence)
    const seen = new Set<string>();
    return methods.filter(m => {
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });
  }

  private extractImports(code: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    // ES6 imports
    const importRegex = /import\s+(?:(\w+)|(?:\{([^}]+)\})|(?:(\w+)\s*,\s*\{([^}]+)\}))\s+from\s+['"]([^'"]+)['"]/g;

    let match;
    while ((match = importRegex.exec(code)) !== null) {
      const source = match[5];
      const defaultImport = match[1] || match[3];
      const namedImports = (match[2] || match[4] || '').split(',').map(s => s.trim()).filter(Boolean);

      imports.push({
        source,
        imports: defaultImport ? [defaultImport, ...namedImports] : namedImports,
        isDefault: !!defaultImport,
      });
    }

    // require() calls
    const requireRegex = /(?:const|let|var)\s+(?:(\w+)|(?:\{([^}]+)\}))\s*=\s*require\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = requireRegex.exec(code)) !== null) {
      imports.push({
        source: match[3],
        imports: match[1] ? [match[1]] : match[2].split(',').map(s => s.trim()),
        isDefault: !!match[1],
      });
    }

    return imports;
  }

  private extractCalls(code: string): CallInfo[] {
    const calls: CallInfo[] = [];
    const methods = this.extractMethods(code);
    const methodNames = new Set(methods.map(m => m.name));

    // For each method, find calls to other methods
    for (const method of methods) {
      // Find the method body
      const methodPattern = new RegExp(
        `(?:async\\s+)?\\*?\\s*${method.name}\\s*\\([^)]*\\)[^{]*\\{`,
        'g'
      );

      const methodMatch = methodPattern.exec(code);
      if (!methodMatch) continue;

      const startIndex = methodMatch.index + methodMatch[0].length;
      let depth = 1;
      let endIndex = startIndex;

      // Find matching closing brace
      for (let i = startIndex; i < code.length && depth > 0; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
        endIndex = i;
      }

      const methodBody = code.slice(startIndex, endIndex);

      // Find calls to other methods
      for (const otherMethod of methodNames) {
        if (otherMethod !== method.name) {
          const callPattern = new RegExp(`\\b${otherMethod}\\s*\\(`, 'g');
          if (callPattern.test(methodBody)) {
            calls.push({
              caller: method.name,
              callee: otherMethod,
            });
          }
        }
      }
    }

    return calls;
  }

  // ============================================
  // HELPERS
  // ============================================

  private extractName(path: string, code: string): string {
    // Try to get name from @name tag
    const nameMatch = code.match(/@name\s+(\S+)/);
    if (nameMatch) return nameMatch[1];

    // Fall back to filename
    return path.split(/[\/\\]/).pop()?.replace(/\.(photon\.)?[jt]sx?$/, '') || 'Code';
  }

  private inferEmoji(name: string): string {
    const lower = name.toLowerCase();
    if (/^(read|get|fetch|load|find|query|search|list)/.test(lower)) return '📖';
    if (/^(write|create|save|put|add|insert|set)/.test(lower)) return '✏️';
    if (/^(delete|remove|drop|clear)/.test(lower)) return '🗑️';
    if (/^(send|post|push|publish|notify)/.test(lower)) return '📤';
    if (/^(update|modify|patch|edit)/.test(lower)) return '🔄';
    if (/^(validate|check|verify|test)/.test(lower)) return '✅';
    if (/^(config|setup|init)/.test(lower)) return '⚙️';
    if (/^(run|execute|start|begin)/.test(lower)) return '▶️';
    if (/^(stop|cancel|abort|end)/.test(lower)) return '⏹️';
    if (/^(connect|login|auth)/.test(lower)) return '🔌';
    if (/^(download|export)/.test(lower)) return '📥';
    if (/^(upload|import)/.test(lower)) return '📤';
    if (/^(generate|build|compile)/.test(lower)) return '🏗️';
    if (/^(parse|analyze|extract)/.test(lower)) return '🔍';
    if (/^(format|transform|convert)/.test(lower)) return '🔄';
    return '🔧';
  }

  private getAskEmoji(subtype: string): string {
    switch (subtype) {
      case 'confirm': return '🙋';
      case 'select': return '📋';
      case 'text': return '✏️';
      case 'number': return '🔢';
      case 'password': return '🔒';
      case 'date': return '📅';
      case 'file': return '📁';
      default: return '❓';
    }
  }

  private getEmitEmoji(subtype: string): string {
    switch (subtype) {
      case 'status': return '📢';
      case 'progress': return '⏳';
      case 'log': return '📝';
      case 'toast': return '🎉';
      case 'thinking': return '🧠';
      case 'artifact': return '📊';
      case 'stream': return '💬';
      default: return '📣';
    }
  }

  private sanitizeId(str: string): string {
    return str.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private titleCase(str: string): string {
    return str
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 3) + '...';
  }
}
