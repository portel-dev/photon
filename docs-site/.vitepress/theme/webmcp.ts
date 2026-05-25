type DocsEntry = {
  title: string;
  route: string;
  excerpt: string;
  section: string;
};

type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  annotations?: Record<string, unknown>;
};

type ModelContext = {
  registerTool?: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => unknown;
};

const docsIndexUrl = `${import.meta.env.BASE_URL}photon-docs-index.json`;
let docsIndexPromise: Promise<DocsEntry[]> | undefined;

function globalState() {
  return window as Window & {
    __photonDocsWebMcpRegistered?: boolean;
    __photonDocsWebMcpTools?: string[];
  };
}

function modelContext(): ModelContext | undefined {
  return (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
}

async function docsIndex() {
  docsIndexPromise ??= fetch(docsIndexUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`Could not load Photon docs index: ${response.status}`);
    }

    return response.json() as Promise<DocsEntry[]>;
  });

  return docsIndexPromise;
}

function baseUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin);
}

function absoluteUrl(route: string) {
  return new URL(route.replace(/^\//, ''), baseUrl()).toString();
}

function normalizeRoute(route: unknown) {
  if (typeof route !== 'string' || route.trim() === '') {
    return '/';
  }

  try {
    const url = new URL(route);
    route = url.pathname;
  } catch {
    // Plain docs route, not an absolute URL.
  }

  const basePath = baseUrl().pathname.replace(/\/$/, '');
  const normalized = route.startsWith(basePath) ? route.slice(basePath.length) || '/' : route;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function searchableText(entry: DocsEntry) {
  return `${entry.title} ${entry.route} ${entry.excerpt} ${entry.section}`.toLowerCase();
}

function searchScore(entry: DocsEntry, terms: string[]) {
  const haystack = searchableText(entry);
  return terms.reduce((score, term) => {
    if (entry.title.toLowerCase().includes(term)) return score + 8;
    if (entry.route.toLowerCase().includes(term)) return score + 5;
    if (haystack.includes(term)) return score + 2;
    return score;
  }, 0);
}

function currentPageTitle() {
  const heading =
    document.querySelector('h1')?.textContent || document.title.replace(/\s*\|\s*Photon\s*$/, '');
  return heading.replace(/\u200b/g, '').trim();
}

function currentPageSummary() {
  const heading = currentPageTitle();
  const paragraphs = Array.from(document.querySelectorAll('main p'))
    .map((paragraph) => paragraph.textContent?.trim())
    .filter((text): text is string => Boolean(text))
    .slice(0, 3);

  return {
    title: heading,
    route: normalizeRoute(window.location.pathname),
    url: window.location.href,
    summary: paragraphs.join('\n\n'),
  };
}

function registerTool(tool: WebMcpTool) {
  modelContext()?.registerTool?.(tool);
  const state = globalState();
  state.__photonDocsWebMcpTools = [...(state.__photonDocsWebMcpTools ?? []), tool.name];
}

export function registerPhotonDocsWebMcp() {
  const state = globalState();
  if (state.__photonDocsWebMcpRegistered || !modelContext()?.registerTool) {
    return;
  }

  state.__photonDocsWebMcpRegistered = true;
  state.__photonDocsWebMcpTools = [];

  registerTool({
    name: 'photon_search_docs',
    description:
      'Search the Photon documentation site for pages about MCP, CLI, Beam, WebMCP, deployment, docblock tags, output formats, and other Photon topics.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search words or phrase, such as "MCP server", "custom UI", "docblock tags", or "deployment".',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matching pages to return. Defaults to 5.',
        },
      },
      required: ['query'],
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: async ({ query, limit }) => {
      const terms = String(query ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const maxResults = Math.min(Math.max(Number(limit) || 5, 1), 10);

      if (terms.length === 0) {
        return [];
      }

      return (await docsIndex())
        .map((entry) => ({ entry, score: searchScore(entry, terms) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
        .slice(0, maxResults)
        .map(({ entry }) => ({ ...entry, url: absoluteUrl(entry.route) }));
    },
  });

  registerTool({
    name: 'photon_list_docs',
    description:
      'List Photon documentation pages, optionally filtered by section such as guides, reference, internals, tutorials, or start.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description:
            'Optional docs section to filter by: start, guides, reference, internals, tutorials, or docs.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of pages to return. Defaults to 20.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: async ({ section, limit }) => {
      const maxResults = Math.min(Math.max(Number(limit) || 20, 1), 50);
      const wantedSection = typeof section === 'string' ? section.toLowerCase() : '';

      return (await docsIndex())
        .filter((entry) => !wantedSection || entry.section.toLowerCase() === wantedSection)
        .slice(0, maxResults)
        .map((entry) => ({ ...entry, url: absoluteUrl(entry.route) }));
    },
  });

  registerTool({
    name: 'photon_open_docs_page',
    description: 'Navigate the current browser tab to a Photon documentation page by route or URL.',
    inputSchema: {
      type: 'object',
      properties: {
        route: {
          type: 'string',
          description:
            'Photon docs route or URL, such as /docs/getting-started or https://portel-dev.github.io/photon/docs/GUIDE.',
        },
      },
      required: ['route'],
    },
    annotations: {
      readOnlyHint: false,
    },
    execute: ({ route }) => {
      const normalizedRoute = normalizeRoute(route);
      const url = absoluteUrl(normalizedRoute);
      window.location.assign(url);
      return { navigatedTo: url };
    },
  });

  registerTool({
    name: 'photon_get_current_page_summary',
    description:
      'Return the title, route, URL, and first visible paragraphs from the current Photon documentation page.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: () => currentPageSummary(),
  });
}
