import chalk from 'chalk';
import { highlight } from 'cli-highlight';

export type OutputFormat =
  | 'primitive'
  | 'table'
  | 'tree'
  | 'list'
  | 'none'
  | 'json'
  | 'markdown'
  | 'yaml'
  | 'xml'
  | 'html'
  | 'code'
  | `code:${string}`;

export const STATUS = {
  OK: chalk.green('OK'),
  ERROR: chalk.red('ERROR'),
  WARN: chalk.yellow('WARN'),
  UNKNOWN: chalk.gray('UNKNOWN'),
  UPDATE: chalk.blue('UPDATE'),
  OFF: chalk.gray('OFF'),
};

export function formatOutput(data: any, hint?: OutputFormat): void {
  const format = hint || detectFormat(data);

  if (typeof data === 'string' && isContentFormat(format)) {
    renderContent(data, format);
    return;
  }

  formatDataWithHint(data, format as 'primitive' | 'table' | 'tree' | 'list' | 'none');
}

function isContentFormat(format: OutputFormat): boolean {
  return (
    format === 'json' ||
    format === 'markdown' ||
    format === 'yaml' ||
    format === 'xml' ||
    format === 'html' ||
    format === 'code' ||
    format.startsWith('code:')
  );
}

function renderContent(content: string, format: OutputFormat): void {
  switch (format) {
    case 'json':
      renderJson(content);
      break;
    case 'markdown':
      renderMarkdown(content);
      break;
    case 'yaml':
      renderYaml(content);
      break;
    case 'xml':
    case 'html':
      renderXml(content);
      break;
    default:
      if (format === 'code' || format.startsWith('code:')) {
        const lang = format === 'code' ? undefined : format.slice(5);
        renderCode(content, lang);
      } else {
        console.log(content);
      }
  }
}

function renderJson(content: string): void {
  try {
    const parsed = JSON.parse(content);
    console.log(highlight(JSON.stringify(parsed, null, 2), { language: 'json', ignoreIllegals: true }));
  } catch {
    console.log(content);
  }
}

function renderMarkdown(content: string): void {
  let rendered = content;

  rendered = rendered.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const trimmedCode = code.trim();
    if (lang && lang !== '') {
      try {
        return '\n' + highlight(trimmedCode, { language: lang, ignoreIllegals: true }) + '\n';
      } catch {
        return '\n' + chalk.gray(trimmedCode) + '\n';
      }
    }
    return '\n' + chalk.gray(trimmedCode) + '\n';
  });

  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
    chalk.blue.underline(text) + chalk.dim(` (${url})`)
  );

  rendered = rendered
    .replace(/^### (.+)$/gm, (_m, h) => `\n${chalk.cyan('   ' + h)}\n   ${chalk.dim('-'.repeat(20))}`)
    .replace(/^## (.+)$/gm, (_m, h) => `\n${chalk.yellow.bold('  ' + h)}\n  ${chalk.dim('='.repeat(30))}`)
    .replace(/^# (.+)$/gm, (_m, h) => `\n${chalk.magenta.bold(h)}\n${chalk.dim('='.repeat(40))}`);

  rendered = rendered.replace(/^> (.+)$/gm, (_m, quote) => chalk.dim('│ ') + chalk.italic(quote));
  rendered = rendered.replace(/^---+$/gm, chalk.dim('─'.repeat(40)));
  rendered = rendered.replace(/^- /gm, chalk.dim('  • '));
  rendered = rendered.replace(/^(\d+)\. /gm, (_m, num) => chalk.dim(`  ${num}. `));
  rendered = rendered.replace(/\*\*(.+?)\*\*/g, (_m, text) => chalk.bold(text));
  rendered = rendered.replace(/\*(.+?)\*/g, (_m, text) => chalk.italic(text));
  rendered = rendered.replace(/_(.+?)_/g, (_m, text) => chalk.italic(text));
  rendered = rendered.replace(/`([^`]+)`/g, (_m, code) => chalk.cyan(code));

  console.log(rendered.trimEnd());
}

function renderYaml(content: string): void {
  try {
    console.log(highlight(content, { language: 'yaml', ignoreIllegals: true }));
  } catch {
    console.log(content);
  }
}

function renderXml(content: string): void {
  try {
    console.log(highlight(content, { language: 'xml', ignoreIllegals: true }));
  } catch {
    console.log(content);
  }
}

function renderCode(content: string, lang?: string): void {
  try {
    console.log(highlight(content, { language: lang, ignoreIllegals: true }));
  } catch {
    console.log(content);
  }
}

function formatDataWithHint(data: any, format: 'primitive' | 'table' | 'tree' | 'list' | 'none'): void {
  switch (format) {
    case 'primitive':
      renderPrimitive(data);
      break;
    case 'list':
      renderList(Array.isArray(data) ? data : [data]);
      break;
    case 'table':
      renderTable(data);
      break;
    case 'tree':
      renderTree(data);
      break;
    case 'none':
      renderNone();
      break;
  }
}

export function detectFormat(data: any): OutputFormat {
  if (data === null || data === undefined) {
    return 'none';
  }
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return 'primitive';
  }
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return 'list';
    }
    const firstItem = data[0];
    if (typeof firstItem !== 'object' || firstItem === null) {
      return 'list';
    }
    if (isFlatObject(firstItem)) {
      return 'table';
    }
    return 'tree';
  }
  if (typeof data === 'object') {
    if (isFlatObject(data)) {
      return 'table';
    }
    return 'tree';
  }
  return 'none';
}

function isFlatObject(obj: any): boolean {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  return !Object.values(obj).some(value => typeof value === 'object' && value !== null);
}

export function renderPrimitive(value: any): void {
  if (typeof value === 'boolean') {
    console.log(value ? 'yes' : 'no');
  } else {
    console.log(value);
  }
}

export function renderList(data: any[]): void {
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }
  data.forEach(item => console.log(`  * ${item}`));
}

export function renderTable(data: any): void {
  if (!Array.isArray(data)) {
    const entries = Object.entries(data).filter(([key]) => key !== 'returnValue');
    if (entries.length === 0) {
      console.log('(empty)');
      return;
    }

    const keyCells = entries.map(([key]) => formatKey(key));
    const valueCells = entries.map(([, value]) => String(formatValue(value)));
    const keyCol = Math.max(...keyCells.map(cell => visibleLength(cell)));
    const valueCol = Math.max(...valueCells.map(cell => visibleLength(cell)));

    const horizontal = (width: number) => '─'.repeat(width + 2);
    console.log(`┌${horizontal(keyCol)}┬${horizontal(valueCol)}┐`);
    entries.forEach((_entry, index) => {
      const keyCell = padAnsi(keyCells[index], keyCol);
      const valueCell = padAnsi(valueCells[index], valueCol);
      console.log(`│ ${keyCell} │ ${valueCell} │`);
      console.log(index < entries.length - 1 ? `├${horizontal(keyCol)}┼${horizontal(valueCol)}┤` : `└${horizontal(keyCol)}┴${horizontal(valueCol)}┘`);
    });
    return;
  }
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }
  const keys = Array.from(new Set(data.flatMap(obj => Object.keys(obj)))).filter(
    key => key !== 'returnValue'
  );
  if (keys.length === 0) {
    console.log('(no data)');
    return;
  }
  const columnWidths = new Map<string, number>();
  const headerCells = new Map<string, string>();
  keys.forEach(key => {
    const header = formatKey(key);
    headerCells.set(key, header);
    const maxWidth = Math.max(
      visibleLength(header),
      ...data.map(obj => visibleLength(String(formatValue(obj[key] ?? ''))))
    );
    columnWidths.set(key, maxWidth);
  });

  const horizontal = (key: string) => '─'.repeat(columnWidths.get(key)! + 2);
  console.log('┌' + keys.map(horizontal).join('┬') + '┐');
  console.log(
    '│' +
      keys
        .map(key => ` ${padAnsi(headerCells.get(key)!, columnWidths.get(key)!)} `)
        .join('│') +
      '│'
  );
  console.log('├' + keys.map(horizontal).join('┼') + '┤');
  data.forEach((obj, rowIndex) => {
    console.log(
      '│' +
        keys
          .map(key => {
            const value = String(formatValue(obj[key] ?? ''));
            return ` ${padAnsi(value, columnWidths.get(key)!)} `;
          })
          .join('│') +
        '│'
    );
    if (rowIndex === data.length - 1) {
      console.log('└' + keys.map(horizontal).join('┴') + '┘');
    }
  });
}

export function renderTree(data: any, indent = 0): void {
  const spacing = '  '.repeat(indent);
  if (Array.isArray(data)) {
    data.forEach(item => renderTree(item, indent));
    return;
  }
  if (typeof data === 'object' && data !== null) {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        console.log(`${spacing}${chalk.bold(formatKey(key))}:`);
        renderTree(value, indent + 1);
      } else {
        console.log(`${spacing}${chalk.bold(formatKey(key))}: ${formatValue(value)}`);
      }
    }
    return;
  }
  console.log(`${spacing}${data}`);
}

export function renderNone(): void {
  console.log('(empty)');
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

export function formatKey(key: string): string {
  return chalk.yellow(humanizeKey(key));
}

export function formatValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? chalk.green('yes') : chalk.red('no');
  }
  if (value === null || value === undefined) {
    return chalk.dim('nil');
  }
  return chalk.white(String(value));
}

function visibleLength(text: string): number {
  return text.replace(/\[[0-9;]*m/g, '').length;
}

function padAnsi(text: string, width: number): string {
  const len = visibleLength(text);
  if (len >= width) {
    return text;
  }
  return text + ' '.repeat(width - len);
}

export function formatToMimeType(format: OutputFormat): string | undefined {
  switch (format) {
    case 'json':
      return 'application/json';
    case 'markdown':
      return 'text/markdown';
    case 'yaml':
      return 'text/yaml';
    case 'xml':
    case 'html':
      return 'text/html';
    case 'code':
    default:
      return 'text/plain';
  }
}

export function printSuccess(message: string): void {
  console.log(chalk.green('✅'), message);
}

export function printError(message: string): void {
  console.log(chalk.red('❌'), message);
}

export function printInfo(message: string): void {
  console.log(chalk.cyan('ℹ️'), message);
}

export function printWarning(message: string): void {
  console.log(chalk.yellow('⚠️'), message);
}

export function printHeader(message: string): void {
  console.log(chalk.bold(message));
}
