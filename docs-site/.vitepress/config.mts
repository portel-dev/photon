import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { defineConfig } from 'vitepress';

const root = join(__dirname, '..');
const gaMeasurementId = process.env.VITE_GA_MEASUREMENT_ID?.trim();
const docsHostname = (process.env.DOCS_HOSTNAME ?? 'https://portel-dev.github.io/photon').replace(
  /\/$/,
  '',
);

function titleFor(file: string) {
  const markdown = readFileSync(file, 'utf8');
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(file, '.md');
}

function pageLink(file: string) {
  return `/${relative(root, file).replace(/\\/g, '/').replace(/\.md$/, '')}`;
}

function markdownPages(dir: string) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return markdownPages(fullPath);
      if (entry.isFile() && entry.name.endsWith('.md')) return [fullPath];
      return [];
    })
    .sort((a, b) => a.localeCompare(b));
}

function itemsFor(dir: string) {
  return markdownPages(join(root, dir)).map((file) => ({
    text: titleFor(file),
    link: pageLink(file),
  }));
}

export default defineConfig({
  title: 'Photon',
  description: 'Build MCP servers, CLI tools, and web dashboards from one TypeScript file.',
  base: process.env.DOCS_BASE ?? '/photon/',
  cleanUrls: true,
  ignoreDeadLinks: true,
  lastUpdated: true,
  sitemap: {
    hostname: docsHostname,
  },
  head: [
    ['meta', { name: 'theme-color', content: '#0f172a' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Photon Documentation' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Single-file TypeScript runtime for MCP, CLI, and web UI.',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content: 'https://raw.githubusercontent.com/portel-dev/photon/main/assets/photon-logo.png',
      },
    ],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Photon',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Linux, Windows',
        programmingLanguage: 'TypeScript',
        license: 'https://github.com/portel-dev/photon/blob/main/LICENSE',
        codeRepository: 'https://github.com/portel-dev/photon',
        description:
          'Photon turns a single .photon.ts TypeScript class into an MCP server, CLI tool, and Beam web dashboard.',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      }),
    ],
    ...(gaMeasurementId
      ? [
          [
            'script',
            { async: '', src: `https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}` },
          ],
          [
            'script',
            {},
            `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${gaMeasurementId}',{send_page_view:false});`,
          ],
        ]
      : []),
  ],
  transformHead({ page }) {
    const path = page
      .replace(/(^|\/)index\.md$/, '$1')
      .replace(/\.md$/, '')
      .replace(/\/$/, '');
    const canonicalUrl = `${docsHostname}${path ? `/${path}` : '/'}`;

    return [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
    ];
  },
  vite: {
    define: {
      __PHOTON_GA_MEASUREMENT_ID__: JSON.stringify(gaMeasurementId ?? ''),
    },
  },
  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const rendered = fence
          ? fence(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
        return rendered.replace('<div class="language-', '<div v-pre class="language-');
      };
    },
  },
  themeConfig: {
    logo: '/assets/photon-logo.png',
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Getting Started', link: '/docs/getting-started' },
      { text: 'Concepts', link: '/docs/concepts' },
      { text: 'Reference', link: '/docs/reference/DOCBLOCK-TAGS' },
      { text: 'GitHub', link: 'https://github.com/portel-dev/photon' },
      { text: 'NCP', link: 'https://portel-dev.github.io/ncp/' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@portel/photon' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Home', link: '/' },
          { text: 'Why Photon', link: '/why-photon' },
          { text: 'README', link: '/readme' },
          { text: 'LLM Reference', link: '/llms' },
        ],
      },
      {
        text: 'Core Docs',
        items: [
          { text: 'Getting Started', link: '/docs/getting-started' },
          { text: 'Core Concepts', link: '/docs/concepts' },
          { text: 'Complete Developer Guide', link: '/docs/GUIDE' },
          { text: 'Output Formats', link: '/docs/formats' },
          { text: 'TSX Rendering', link: '/docs/tsx-rendering' },
          { text: 'Troubleshooting', link: '/docs/TROUBLESHOOTING' },
        ],
      },
      {
        text: 'Tutorials',
        collapsed: false,
        items: itemsFor('docs/tutorials'),
      },
      {
        text: 'Guides',
        collapsed: true,
        items: itemsFor('docs/guides'),
      },
      {
        text: 'Reference',
        collapsed: true,
        items: itemsFor('docs/reference'),
      },
      {
        text: 'Internals',
        collapsed: true,
        items: itemsFor('docs/internals'),
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/portel-dev/photon' }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright Portel Dev',
    },
  },
});
