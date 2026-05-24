import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const distDir = join(root, 'docs-site/.vitepress/dist');
const hostname = process.env.DOCS_HOSTNAME ?? 'https://portel-dev.github.io/photon';

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.html') && entry.name !== '404.html') return [fullPath];
    return [];
  });
}

function routeFor(file) {
  const route = relative(distDir, file)
    .replace(/\\/g, '/')
    .replace(/(^|\/)index\.html$/, '$1')
    .replace(/\.html$/, '');

  return route === '' ? '/' : `/${route}`;
}

if (!statSync(distDir).isDirectory()) {
  throw new Error(`Docs dist directory not found: ${distDir}`);
}

const urls = htmlFiles(distDir)
  .map(routeFor)
  .sort((a, b) => a.localeCompare(b))
  .map((route) => `<url><loc>${hostname.replace(/\/$/, '')}${route}</loc></url>`)
  .join('');

writeFileSync(
  join(distDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
);

console.log('Normalized docs sitemap URLs.');
