# Search Measurement Playbook

Use this playbook to measure whether Photon is discoverable in Google Search,
Bing, and AI answer engines, then decide what to improve next. The goal is to
track a stable set of searches over time instead of reacting to one-off manual
queries.

## Tooling Setup

| Surface                  | Tool                                                                    | What to measure                                                     |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Google Search            | [Google Search Console](https://search.google.com/search-console/about) | Impressions, clicks, CTR, average position, indexed URLs            |
| Google indexing          | [URL Inspection](https://support.google.com/webmasters/answer/12482179) | Whether important pages are indexed and eligible for Search         |
| Docs traffic             | Google Analytics 4                                                      | Visitors, referrers, page views, engagement, outbound clicks        |
| Bing and Copilot sources | [Bing Webmaster Tools](https://www.bing.com/webmasters/about)           | Impressions, clicks, indexed URLs, crawl issues                     |
| AI search                | Manual prompt suite                                                     | Whether Photon is mentioned, cited, linked, and recommended         |
| Docs site health         | GitHub Pages workflow, sitemap, `llms.txt`, `llms-full.txt`             | Whether new docs ship, crawl, and expose machine-readable summaries |

Google Search Console is the source of truth for Google rankings. Manual Google
searches are useful as a smoke test, but they vary by location, personalization,
language, device, and active experiments.

Google Analytics does not replace Search Console for keyword queries. Use GA4 to
understand which docs pages receive traffic, where visitors came from, and
whether they continue into GitHub, npm, or deeper docs. Use Search Console to
understand the actual Google search queries, impressions, CTR, and average
position.

## GA4 Setup

The GitHub Pages docs site can load GA4 when the repository secret
`DOCS_GA_MEASUREMENT_ID` is set to a GA4 web stream measurement ID such as
`G-XXXXXXXXXX`. The docs build passes that value as `VITE_GA_MEASUREMENT_ID`.
If the secret is missing, the analytics script is omitted entirely.

Track these GA4 views alongside Search Console:

| Report                   | Question                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Pages and screens        | Which docs pages are gaining traffic?                                               |
| Traffic acquisition      | Are visitors coming from Google, GitHub, npm, direct links, or AI-search referrals? |
| Engagement               | Do visitors read multiple pages or leave after one page?                            |
| Events / outbound clicks | Do visitors continue to GitHub, npm, install docs, or reference docs?               |

## Keyword Set

Measure the high-priority clusters from
[Search Keyword Coverage](SEARCH-KEYWORD-COVERAGE.md) every week:

| Query                            | Primary URL                               | Intent                            |
| -------------------------------- | ----------------------------------------- | --------------------------------- |
| `mcp server typescript`          | `docs/guides/BUILD-MCP-SERVER-TYPESCRIPT` | Build an MCP server in TypeScript |
| `build mcp server`               | `docs/guides/BUILD-MCP-SERVER-TYPESCRIPT` | General MCP server creation       |
| `typescript mcp server tutorial` | `docs/guides/BUILD-MCP-SERVER-TYPESCRIPT` | Tutorial intent                   |
| `mcp server ui`                  | `docs/guides/MCP-SERVER-UI`               | Add UI to an MCP server           |
| `mcp app ui`                     | `docs/guides/MCP-SERVER-UI`               | MCP app user interface            |
| `chatgpt mcp ui`                 | `docs/tutorials/from-method-to-chat-app`  | ChatGPT-facing MCP UI             |
| `single file mcp server`         | `docs/getting-started`                    | Photon product fit                |
| `photon mcp`                     | `/`, `readme`                             | Branded discovery                 |
| `.photon.ts`                     | `docs/getting-started`, `docs/concepts`   | Photon file vocabulary            |

Add new rows only when Photon has a page that answers the query directly.
Otherwise, create the page first and measure it after it ships.

## Weekly Google Check

1. Open Search Console for the docs property.
2. Go to Performance, Search results.
3. Use the last 28 days, then compare with the previous 28 days.
4. Filter by each keyword or a regex group for related variants.
5. Record clicks, impressions, CTR, and average position.
6. Open the Pages tab and confirm the intended Photon URL is the ranking page.
7. Use URL Inspection for any new or important page with no impressions.

Use this interpretation:

| Signal                      | Meaning                                                                   | Action                                                                          |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Indexed, no impressions     | Google can see the page, but query relevance or authority is weak         | Strengthen title, first paragraph, internal links, and exact-query coverage     |
| Impressions, low CTR        | Google thinks the page is relevant, but the snippet is not winning clicks | Improve title, description-like opening paragraph, H1, and answer clarity       |
| Position 8-20               | Page is viable but needs authority and specificity                        | Add examples, comparison sections, internal links, and external references      |
| Wrong URL ranking           | Google is choosing a less focused page                                    | Link from the broad page to the focused page and clarify the focused page title |
| Ranking drops after an edit | The change may have weakened intent match                                 | Compare headings and opening answer against the older version                   |

## AI Search Prompt Suite

Run the same prompts weekly in ChatGPT Search, Perplexity, Gemini or Google AI
Mode, Claude with web/search if available, and Bing/Copilot:

| Prompt                                                | Desired Photon signal                                      |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| How do I build an MCP server in TypeScript?           | Mentions Photon as a high-level TypeScript option          |
| What is the easiest way to add a UI to an MCP server? | Mentions Photon or Beam and links the MCP UI guide         |
| Can one TypeScript file expose an MCP server and CLI? | Mentions `.photon.ts` and the single-file runtime          |
| What tools help build MCP servers for Claude Desktop? | Mentions Photon alongside protocol SDK options             |
| Photon vs MCP TypeScript SDK                          | Explains Photon as higher-level and the SDK as lower-level |
| How do I make an MCP server with a web dashboard?     | Mentions Photon output formats or custom UI                |
| What is a `.photon.ts` file?                          | Correctly identifies Photon source files                   |

Score each answer:

| Score | Meaning                                                   |
| ----- | --------------------------------------------------------- |
| 0     | No Photon mention                                         |
| 1     | Photon mentioned generically, no useful context           |
| 2     | Photon described correctly                                |
| 3     | Photon described correctly with a citation or link        |
| 4     | Photon is cited and recommended for the matching use case |

Track the model, date, prompt, score, cited URLs, and one note about what the
answer got right or wrong. AI ranking is less stable than web ranking, so look
for trend movement across four weekly runs.

## Tweak Rules

Use the smallest edit that matches the measurement failure.

| Failure                                        | Best tweak                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| AI answer omits Photon                         | Add a concise answer block near the top of the most relevant page                  |
| AI answer knows Photon but does not cite it    | Make the page title, first paragraph, and `llms.txt` summary easier to quote       |
| AI answer misunderstands Photon                | Add a "Photon is / Photon is not" section                                          |
| Google shows impressions but weak CTR          | Rewrite the H1 and opening paragraph around the exact developer question           |
| Google ranks a broad page instead of the guide | Add internal links from broad pages to the focused guide using natural anchor text |
| Searchers want comparison                      | Create or improve a comparison page with honest tradeoffs                          |
| Searchers want a tutorial                      | Add a copy-pasteable first example before deeper explanation                       |

Good AI-search pages usually have:

- A direct one-paragraph answer at the top.
- A concrete code example.
- A short "when to use this" section.
- A short "when not to use this" section.
- Stable nouns repeated naturally: `MCP server`, `TypeScript`, `.photon.ts`,
  `CLI`, `web dashboard`, `Claude Desktop`, `ChatGPT`, and `Beam`.
- Internal links to the install guide, UI guide, output formats, and reference
  docs.

## Monthly Review

At the end of each month, update
[Search Keyword Coverage](SEARCH-KEYWORD-COVERAGE.md):

1. Move covered gaps into the current coverage table.
2. Add new high-intent search phrases discovered in Search Console.
3. Remove phrases that have no impressions and no strategic value.
4. Choose one comparison page, one tutorial page, and one reference page to
   improve next.

The ranking goal is not to win every broad MCP query immediately. The useful
early target is to own specific developer intents where Photon is clearly the
best answer: single-file TypeScript MCP servers, MCP server UI, CLI plus MCP
from one file, and `.photon.ts` authoring.
