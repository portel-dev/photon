import { printHeader, printInfo } from '../cli-formatter.js';

export function renderSection(title: string, lines: string[]) {
  if (!lines || lines.length === 0) {
    return;
  }
  printHeader(title);
  lines.forEach(line => printInfo(line));
  console.log('');
}

export function renderKeyValueSection(title: string, pairs: Array<{ label: string; value?: string | null }>) {
  const lines = pairs
    .filter(pair => pair.value !== undefined && pair.value !== null && pair.value !== '')
    .map(pair => `${pair.label}: ${pair.value}`);
  renderSection(title, lines);
}
