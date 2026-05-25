import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

const root = process.cwd();
const siteDir = join(root, 'docs-site');
const siteDocsDir = join(siteDir, 'docs');
const publicDir = join(siteDir, 'public');

const readme = readFileSync(join(root, 'README.md'), 'utf8');

function resetDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function copyMarkdownTree(from, to) {
  resetDir(to);
  cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const extension = extname(source);
      return statSync(source).isDirectory() || ['.md', '.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(extension);
    },
  });
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function firstHeading(markdown) {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1];
  const frontmatterTitle = frontmatter?.match(/^title:\s*['"]?(.+?)['"]?$/m)?.[1]?.trim();
  if (frontmatterTitle) return frontmatterTitle.replace(/^['"]|['"]$/g, '');

  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

const htmlTags = new Set([
  'a',
  'article',
  'b',
  'body',
  'br',
  'button',
  'code',
  'details',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'head',
  'html',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'script',
  'section',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'table',
  'tbody',
  'td',
  'textarea',
  'th',
  'thead',
  'tr',
  'ul',
]);

function escapePlaceholders(markdown) {
  return markdown
    .replace(/^```tsx$/gm, '```txt')
    .split(/(```[\s\S]*?```)/g)
    .map((part) => {
      if (part.startsWith('```')) return part;

      return part
        .replaceAll('{{', '{ {')
        .replaceAll('}}', '} }')
        .replace(/<([A-Za-z][A-Za-z0-9_-]*)>/g, (match, tag) => {
          return htmlTags.has(tag.toLowerCase()) ? match : `&lt;${tag}&gt;`;
        });
    })
    .join('');
}

function excerpt(markdown) {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('<') && !line.startsWith('|') && !line.startsWith('![') && !line.startsWith('[![') && line !== '---')
    ?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.md')) return [fullPath];
    return [];
  });
}

copyMarkdownTree(join(root, 'docs'), siteDocsDir);

copyFileSync(join(root, 'WHY-PHOTON.md'), join(siteDir, 'why-photon.md'));
write(join(siteDir, 'readme.md'), `---\ntitle: README\n---\n\n${readme}`);

for (const file of [join(siteDir, 'why-photon.md'), join(siteDir, 'readme.md'), ...listMarkdownFiles(siteDocsDir)]) {
  writeFileSync(file, escapePlaceholders(readFileSync(file, 'utf8')));
}

resetDir(join(publicDir, 'assets'));
cpSync(join(root, 'assets'), join(publicDir, 'assets'), { recursive: true });
resetDir(join(siteDir, 'assets'));
cpSync(join(root, 'assets'), join(siteDir, 'assets'), { recursive: true });

const docs = [
  join(siteDir, 'index.md'),
  join(siteDir, 'why-photon.md'),
  join(siteDir, 'readme.md'),
  ...listMarkdownFiles(siteDocsDir),
]
  .filter((file) => existsSync(file))
  .map((file) => {
    const markdown = readFileSync(file, 'utf8');
    const route = `/${relative(siteDir, file).replace(/\\/g, '/').replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}`;
    return {
      route: route === '/' ? '/' : route,
      title: firstHeading(markdown) ?? relative(siteDir, file),
      excerpt: excerpt(markdown) ?? '',
    };
  });

const docsIndex = docs.map((doc) => ({
  title: doc.title,
  route: doc.route,
  excerpt: doc.excerpt,
  section: (() => {
    const parts = doc.route.split('/').filter(Boolean);
    if (parts[0] !== 'docs') return 'start';
    if (parts.length === 2) return 'docs';
    return parts[1];
  })(),
}));

const llmsSummary = `# Photon

> Photon is an open source TypeScript runtime that turns a single .photon.ts class into an MCP server for AI agents, a CLI tool, and a Beam web dashboard.

## Start Here

- [Getting Started](/docs/getting-started): Install Photon and build your first .photon.ts file.
- [Core Concepts](/docs/concepts): The mental model behind methods, comments, formats, state, settings, and surfaces.
- [From Method to Chat App](/docs/tutorials/from-method-to-chat-app): A weather example that runs as CLI, Beam, MCP, and embedded chat UI.
- [Output Formats](/docs/formats): Visual result formats for tables, charts, markdown, mermaid, cards, dashboards, and more.
- [Docblock Tags](/docs/reference/DOCBLOCK-TAGS): Public reference for every docblock tag Photon understands.
- [Complete Developer Guide](/docs/GUIDE): Comprehensive reference for authoring and operating photons.

## Core Claims

- One TypeScript class can expose the same capability through MCP, CLI, and web UI.
- JSDoc comments and TypeScript types become AI-readable tool descriptions, validation, CLI help, and form UI.
- Photon supports custom MCP app UIs, schedules, webhooks, state, settings, dependency metadata, and deployment paths.

## Package

- npm: @portel/photon
- GitHub: https://github.com/portel-dev/photon
- License: MIT
`;

const llmsFull = `${llmsSummary}

## Documentation Index

${docs.map((doc) => `- [${doc.title}](${doc.route})${doc.excerpt ? `: ${doc.excerpt}` : ''}`).join('\n')}
`;

write(join(publicDir, 'llms.txt'), llmsSummary);
write(join(publicDir, 'llms-full.txt'), llmsFull);
write(join(publicDir, 'photon-docs-index.json'), `${JSON.stringify(docsIndex, null, 2)}\n`);
write(join(siteDir, 'llms.md'), `# LLM Reference\n\n\`/llms.txt\` and \`/llms-full.txt\` are generated during the docs build.\n\n${llmsFull}`);

console.log(`Synced ${docs.length} documentation pages into docs-site.`);
