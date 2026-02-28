import { printHeader, printInfo } from '../cli-formatter.js';

export function renderSection(title: string, lines: string[]) {
  if (!lines || lines.length === 0) {
    return;
  }
  printHeader(title);
  lines.forEach((line) => printInfo(line));
  console.log('');
}
