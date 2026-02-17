# Changelog

## [1.8.3](https://github.com/portel-dev/photon/compare/v1.8.2...v1.8.3) (2026-02-17)

### Bug Fixes

* auto-fetch marketplace manifest in fetchMCP when cache is empty ([d6b2d78](https://github.com/portel-dev/photon/commit/d6b2d789bdfeb28052ecee9b80f587087295fa7f))
* harden marketplace against corrupted config and missing cache ([04d11f1](https://github.com/portel-dev/photon/commit/04d11f18f051fb750ae2f7626dad0bf0dd3f8b01))

## [1.8.2](https://github.com/portel-dev/photon/compare/v1.8.1...v1.8.2) (2026-02-17)

### Bug Fixes

* add automated pre-release verification to prevent broken releases ([7dcbd79](https://github.com/portel-dev/photon/commit/7dcbd79e70576f30d761b4fe796c5c00b1ae19ba))
* convert step yields to emit pattern in internal photons ([73022fa](https://github.com/portel-dev/photon/commit/73022fa2a9c97d44b7533067529eed81612f97b9))
* handle multi-line and single-line yields in pre-release check ([df62376](https://github.com/portel-dev/photon/commit/df62376b435c6a3aa0084c4fef387314b2e5940f))
* improve fresh install robustness and error visibility ([a3a1cb7](https://github.com/portel-dev/photon/commit/a3a1cb7cbf69c7a1cada6ab12cec1e8a2dbf6c0b))

## [1.8.1](https://github.com/portel-dev/photon/compare/v1.8.0...v1.8.1) (2026-02-16)

### Bug Fixes

* Moved esbuild from dev dependencies to dependencies in package.json ([2b57589](https://github.com/portel-dev/photon/commit/2b57589755455c566ffa5b36c4ac9f9d00b7a997))

## [1.8.0](https://github.com/portel-dev/photon/compare/v1.7.0...v1.8.0) (2026-02-16)

### Features

* `photon shell init` for direct photon commands in terminal ([2fede55](https://github.com/portel-dev/photon/commit/2fede5519d96026864a3a6d901518c45d74909ac))
* add breadcrumb method dropdown for quick method switching ([4ed44a9](https://github.com/portel-dev/photon/commit/4ed44a9fe2f4fda1ece880478bfaebac6b525b02))
* add charts, metrics, gauges, timelines, and dashboards to auto-UI ([fe6d72f](https://github.com/portel-dev/photon/commit/fe6d72f7e294022203d2c7ef1bd265ada9424abc))
* add OKLCH theme customizer to Beam settings panel ([8efdf96](https://github.com/portel-dev/photon/commit/8efdf96dc78782959052a50aebbbde25270b4a3b))
* add purpose-driven UI type detection in result-viewer ([b4ab09f](https://github.com/portel-dev/photon/commit/b4ab09f2dec7cb2846d26869dfabda7b108432c6))
* add shared button, form, and badge stylesheets ([cf24ffd](https://github.com/portel-dev/photon/commit/cf24ffd20c90c75f2491143cb698efc0c75c5b71))
* add shopping cart layout and composable container formats to auto-UI ([3c00445](https://github.com/portel-dev/photon/commit/3c00445fe1abf5d9b7e39860b55dd391d810c719))
* add Space Grotesk display font and systematic type scale to Beam ([31906e7](https://github.com/portel-dev/photon/commit/31906e7161fbf7b0c6d485f50eba4d6e1a1ad3d7))
* add structuredContent to tool responses for MCP Apps compatibility ([7a841cd](https://github.com/portel-dev/photon/commit/7a841cdb29f7ed15116a8d7ea1d091100af745b8))
* add top-level mermaid layout detection and rendering ([abd7d6d](https://github.com/portel-dev/photon/commit/abd7d6dc310956b1677d9dc0e1ca1de637969093))
* add visual richness to method cards with design system colors ([773e893](https://github.com/portel-dev/photon/commit/773e8933d8566cd9906d16d2beef5f26f0d1040f))
* add warm data animations and recency heat to result-viewer ([10915a9](https://github.com/portel-dev/photon/commit/10915a94fc4bb15bfe10b43bc69cc3c2b3c8aff4))
* auto-detect and render mermaid diagrams in card cell values ([bdbc878](https://github.com/portel-dev/photon/commit/bdbc878adc28be529d4f8a2c90b69d51840a3a7f))
* auto-install shell integration with tab completion ([d5d5492](https://github.com/portel-dev/photon/commit/d5d5492d339fe9f4670a7c2c5b00e99e4dddaec2))
* auto-reload daemon when stateful photon files change ([5b9e722](https://github.com/portel-dev/photon/commit/5b9e7220c832c286725450e2ed2d0a1420ae7db6))
* auto-scaffold empty .photon.ts files when detected by Beam ([8ab430c](https://github.com/portel-dev/photon/commit/8ab430c064bff2187e54283544bbb9db7954bccd))
* auto-start daemon and reconnect subscriptions for stateful photons ([9f40f34](https://github.com/portel-dev/photon/commit/9f40f341d8257fda16423a7a19bc9ab0a723d48f))
* deletion exit animation and reorder detection in diff ([b381c01](https://github.com/portel-dev/photon/commit/b381c01e4f1eccb0104c37dc4ff56fb810fb5de1))
* enable live collection subscriptions for non-array results ([f4ce92e](https://github.com/portel-dev/photon/commit/f4ce92e7dfe810380894b927131c42fc273da79d))
* ephemeral CLI instances + Beam instance switcher ([be4ca7a](https://github.com/portel-dev/photon/commit/be4ca7a5b53900eb8bf1be62633d568a5cd0409b))
* fix [@inner](https://github.com/inner) hints, stack visuals, and add dynamic format animations ([5cefcfa](https://github.com/portel-dev/photon/commit/5cefcfae01d346330b8ba3b3fb425cc06d64a640))
* full tab completion for photon methods, params, and instances ([ce36d8b](https://github.com/portel-dev/photon/commit/ce36d8b9e78ea0b513f83a80efc79bd8eaf64572))
* handle 'state' injection type in loader and update test assertions ([057c51b](https://github.com/portel-dev/photon/commit/057c51b52582155a0e5764de598a697603c36c7e))
* implement `photon use` and `photon set` CLI commands ([effa1ed](https://github.com/portel-dev/photon/commit/effa1edbd9af918ce86cdd41094f15608e937ef7))
* launch Beam by default when running `photon` with no args ([058aa73](https://github.com/portel-dev/photon/commit/058aa7318f767834851a28468d37daf35997cccf))
* move file watcher to daemon for universal hot-reload ([ef7aad4](https://github.com/portel-dev/photon/commit/ef7aad4d63f72d96a759912d220af7b4b7006768))
* named instances for stateful photons via MCP tools ([ef466c6](https://github.com/portel-dev/photon/commit/ef466c6cfb62910055c191578e072c0ea1da1536))
* per-tab instance sessions and create-instance button in Beam ([0c6bcbd](https://github.com/portel-dev/photon/commit/0c6bcbd76154e0ea018cf8372798a7e83301bf33))
* persist instance selection across tab refresh via sessionStorage ([9c8cd65](https://github.com/portel-dev/photon/commit/9c8cd65991f0dc96e7793d31d86cfed033471922))
* PowerShell support and unsupported shell handling ([1147410](https://github.com/portel-dev/photon/commit/114741000b96dcc101438c00c87d9bb4bb7352ed))
* progressive enhancement — adapt MCP responses by client capability ([4bf499e](https://github.com/portel-dev/photon/commit/4bf499e15852565d312e13a2019a2692cfbdfa6c))
* pulsing LIVE indicator for results with active subscriptions ([3048978](https://github.com/portel-dev/photon/commit/30489783077e9641d2101da4e808bfe1d45ea378))
* real-time push updates for stateful photons across clients ([cb3a448](https://github.com/portel-dev/photon/commit/cb3a4480e2e8d3527ae9b6b148a7f6ee48ec11b8))
* render markdown in method descriptions with educational format-showcase content ([07db8b2](https://github.com/portel-dev/photon/commit/07db8b29bf2613c41b3c453f813b687329dd2d1a))
* replace custom instance bar with MCP elicitation-based instance selection ([7539ee4](https://github.com/portel-dev/photon/commit/7539ee4fec785c5ce03227711ee7419b17eb9625))
* route stateful photon calls through daemon for cross-client sync ([cdc1bd3](https://github.com/portel-dev/photon/commit/cdc1bd34371bbf53a1fbc7c985a423d381f02d50))
* session-scoped CLI instances via CLISessionStore ([da7e468](https://github.com/portel-dev/photon/commit/da7e46855fe1b89d8a74f0695a58eccc5149ce03))
* show fullscreen button for all photon views ([ebbb39b](https://github.com/portel-dev/photon/commit/ebbb39b22cf0b5b6a74e69066dc050447db88b85))
* smooth mermaid re-rendering for streaming diagram updates ([09aec4d](https://github.com/portel-dev/photon/commit/09aec4d15e8cd7d0dcb5faae66c08d7ab85f185c))
* strengthen real-time animations and add warmth to chips ([d043c05](https://github.com/portel-dev/photon/commit/d043c0587cdd6d895618d0b5bbf280b93faec8e8))
* support sync photons, fix param extraction, limit connection retries ([4cc348d](https://github.com/portel-dev/photon/commit/4cc348d3dfbea17cade214f21db51d5237a1ccbb))
* support YAML frontmatter in markdown rendering ([6037144](https://github.com/portel-dev/photon/commit/6037144a022295d6b561b2c8b2af8254fed5f6c5))
* update Beam light theme to warm cream/beige palette ([9fa2fbf](https://github.com/portel-dev/photon/commit/9fa2fbff912aae8092f247767dd891567fced5eb))

### Bug Fixes

* add animation support to chips/tags layout in result-viewer ([da17cb9](https://github.com/portel-dev/photon/commit/da17cb9aed3e1d45064a189489c6ef64ad2d073f))
* add comments to empty catch blocks in cache refresh calls ([c997081](https://github.com/portel-dev/photon/commit/c997081db256ce57b898b9b2f987cce29d7a9864))
* add fullscreen button to external MCP app view ([a7b7638](https://github.com/portel-dev/photon/commit/a7b7638fbc6bb2a6021821fb2b9e75b5e23f4392))
* add mermaid fallback detection in _renderText for timing resilience ([e904e2d](https://github.com/portel-dev/photon/commit/e904e2dac1e2076a7de64de1fa3970bd51bb7ccd))
* add missing 'grid' case in _renderContent() for [@inner](https://github.com/inner) grid hints ([0fda7ab](https://github.com/portel-dev/photon/commit/0fda7ab4db07db04c4fd9a3228dc49cd6baf3409))
* add scroll hint for external MCP app views ([92f4483](https://github.com/portel-dev/photon/commit/92f4483bc58210b1ddc439330b671645b92a351f))
* align arrow and text in metric delta pill ([31cbfef](https://github.com/portel-dev/photon/commit/31cbfefa876c2bea098494c4b1ab3bb0aa70f0a3))
* align MCP Apps bridge theme with platform-compat bridge ([a3a38a1](https://github.com/portel-dev/photon/commit/a3a38a1eb6328256e86b9de51ff4d97386501fc2)), closes [#f4f4f5](https://github.com/portel-dev/photon/issues/f4f4f5) [#ffffff](https://github.com/portel-dev/photon/issues/ffffff)
* align MCP Apps theme tokens with platform-compat bridge ([4d3143d](https://github.com/portel-dev/photon/commit/4d3143d93a42b4a44a02c8c6cbb38ab9dbf20c05))
* align STDIO and SSE transport responses for MCP parity ([3e5089a](https://github.com/portel-dev/photon/commit/3e5089ae1855f5b7db59ecc9ffd391d1d3253eb2))
* align table sort indicators inline with header text ([2af47ef](https://github.com/portel-dev/photon/commit/2af47efdf73d9a074e2e34f79b51ae399ee60faa))
* allow _use(name: "") to switch to default without elicitation ([4da7cfa](https://github.com/portel-dev/photon/commit/4da7cfa189a0a87c64eff89a95ce9134499dd48a))
* always reset CLI session to default to prevent instance leaking ([5b4596e](https://github.com/portel-dev/photon/commit/5b4596ee2a91fa720edd88de4933bb798219210f))
* animate toggle switches on click in overflow menu ([b04a4e4](https://github.com/portel-dev/photon/commit/b04a4e42308de3978845477bf9d28841028a78c2))
* animations and warmth broken by ID field mismatch + no persistence ([18f4828](https://github.com/portel-dev/photon/commit/18f4828a90b975b6b37f45e7dedcbf7ee18a67e0))
* auto-detect enum values from description and render as dropdown ([35153df](https://github.com/portel-dev/photon/commit/35153df7cf572c79749b25abf24f0f3cedb96769))
* break infinite state-changed refresh loop in beam-app ([e226fc7](https://github.com/portel-dev/photon/commit/e226fc7ab9419e89b173fe4d7a65165584bb76b4))
* broadcast state-changed after instance switch for UI refresh ([33110cf](https://github.com/portel-dev/photon/commit/33110cfc7fc1497738a3ff1e5563856b704718e5))
* browser back navigation and context-bar/method-detail card spacing ([1482908](https://github.com/portel-dev/photon/commit/1482908cb10ff97223ad82a43f3692c0bfe57d4e))
* clean external MCP error logs and harden SSE reconnection ([5d86f86](https://github.com/portel-dev/photon/commit/5d86f86ca15de985408439850bb62a232eb43d2f))
* clean up method card design - remove green border, ready badge, autorun tag, and run button ([e031c00](https://github.com/portel-dev/photon/commit/e031c00457b0d5873ef25669db9e3116242dcd68))
* consolidate table header template to single line, remove whitespace formatting ([0b3b857](https://github.com/portel-dev/photon/commit/0b3b857ea4ca12d445c19c21daadef453d5051aa))
* correct CLI list format test to match box-style rendering ([ed924e3](https://github.com/portel-dev/photon/commit/ed924e3121990b8d9d401e7d974280ab1b77c21c))
* correct SVG largeArcFlag calculation in gauge rendering ([a3f9a1b](https://github.com/portel-dev/photon/commit/a3f9a1bedb42c68e529ae43b986c70f5efa46b02))
* dev:beam now auto-rebuilds backend, frontend, and restarts Beam ([7368c4d](https://github.com/portel-dev/photon/commit/7368c4d30fcd11d798cf05347974d1fd6a43efbb))
* display human-readable labels for method names, parameters, and strip markdown from descriptions ([d59496e](https://github.com/portel-dev/photon/commit/d59496e4a3f0aa8d97b4ea3448858d6e831cc58e))
* don't pass axis labels as chart field-name hints ([2d6e761](https://github.com/portel-dev/photon/commit/2d6e7613ee756d856a89ffdf4b22774d289a3ab0))
* eliminate all as-any casts and dead parameters in server/loader ([2510545](https://github.com/portel-dev/photon/commit/2510545d09899cfd33cc16665fe50a9487a66b7c))
* ensure dev:beam kills all child processes on Ctrl+C ([64abcd5](https://github.com/portel-dev/photon/commit/64abcd5795eaecceeac3bb4923d59415725dafcb))
* ensure method dropdown renders above method card content ([973d40f](https://github.com/portel-dev/photon/commit/973d40f91b7b694826d43d497a0010d7450fda81))
* extract [@format](https://github.com/format) tags from method docblocks ([9915c7d](https://github.com/portel-dev/photon/commit/9915c7d76ae141a7f3d5ba0e389075c7c62fad47))
* flush fullscreen button to container corner ([5a53d3e](https://github.com/portel-dev/photon/commit/5a53d3ee88e3b4315d219ab4225113f4e9a203be))
* format security-hardened files with prettier ([58041ea](https://github.com/portel-dev/photon/commit/58041ea3fa16cbcaad70ee2d1f82f65644d4228a))
* fullscreen only for results, overflow menu theme and toggle styling ([399736f](https://github.com/portel-dev/photon/commit/399736fec1d4513c116391185ffba6a3147ba004))
* fully consolidate table header template to single line, eliminate all newlines ([75821d0](https://github.com/portel-dev/photon/commit/75821d0f246edfe5a4b5747568fdd5f99080d874))
* gauge arc not rendering due to HTML namespace issue ([ee8ec63](https://github.com/portel-dev/photon/commit/ee8ec6354586805a4e15751534dfb6251d24a1f6))
* handle union types in CLI arg parsing for relative adjustments ([8376a5d](https://github.com/portel-dev/photon/commit/8376a5d6d2901adf2bfcd564e35ecee55a995c47))
* hide internal methods, expand object params into sub-fields, filter placeholder descriptions ([3737d35](https://github.com/portel-dev/photon/commit/3737d352f1aaf1f98a08e3fe214134cfe495b6a1))
* improve Beam UI result viewer and form polish ([f93d594](https://github.com/portel-dev/photon/commit/f93d594a8254a9ef162dac0eb129964db779585b))
* improve Beam UI visibility for version badges, param tags, and LED indicator ([abb1f49](https://github.com/portel-dev/photon/commit/abb1f4916dbdc72cde8b84099c5199f3606ac22c))
* improve CLI help text, method listing, table rendering, and info command ([d69115a](https://github.com/portel-dev/photon/commit/d69115a8d14a06444d07f61966a5f656e19b007a))
* improve mobile layout for method detail view ([d582e34](https://github.com/portel-dev/photon/commit/d582e3462b0b7fe7e9e191a50f1d76e781d8dd99))
* improve mobile touch affordances, warning section differentiation, and remaining hardcoded colors ([bcd35fa](https://github.com/portel-dev/photon/commit/bcd35fabf7a20a4a09df60a13418aac6200d57a0))
* improve timeline visual with connecting line and dot alignment ([d55949a](https://github.com/portel-dev/photon/commit/d55949a695a1da7089c584d8abeb920667461bfe))
* label palette swatches in theme settings for clarity ([fc98643](https://github.com/portel-dev/photon/commit/fc98643a1f359843a13d6721f249c72f396f497c))
* move fullscreen button above app container to prevent overlap ([213c414](https://github.com/portel-dev/photon/commit/213c4145eb659bfc77f018cee31ee3e908bec02c))
* move fullscreen button to Beam chrome level ([84d2518](https://github.com/portel-dev/photon/commit/84d25180c5152b3c85142efb2e3317f0173f6b21))
* move LIVE indicator from result card to context bar breadcrumb ([04251c5](https://github.com/portel-dev/photon/commit/04251c50a709c0866a4ce694cf24c3f773a6baef))
* move UI type unwrapping from render() to updated() lifecycle ([2564629](https://github.com/portel-dev/photon/commit/25646293fd57919bd73f1e8ec7d221ee8dba0c5c))
* optimize card spacing to reduce excessive whitespace ([3378236](https://github.com/portel-dev/photon/commit/3378236f302c09b6795c9d161c5519207f8b5f67))
* optimize spacing and padding across auto-UI formats ([37637f6](https://github.com/portel-dev/photon/commit/37637f655ea9001b07c298aa3b8aed3724364dc7))
* parse [@format](https://github.com/format) chart:bar correctly instead of truncating at colon ([63ed978](https://github.com/portel-dev/photon/commit/63ed97869f1c448240e25c17115d6dbc413fc418))
* pass photonPath in daemon command requests from CLI runner ([02da02f](https://github.com/portel-dev/photon/commit/02da02f74a2dccffede8adf47e2150f5ac899bff))
* place instance dropdown in active list view, not dead code ([d1f5c09](https://github.com/portel-dev/photon/commit/d1f5c093c14a6ae894f118fd7a7f808a517d4216))
* pre-release audit fixes for security, dependencies, and test stability ([498887d](https://github.com/portel-dev/photon/commit/498887dd0bf071236ed319fa99f87b1f9e3fc83d))
* prevent Beam server disconnections with improved connection stability ([6cc7416](https://github.com/portel-dev/photon/commit/6cc7416a84c88d30c5e1df0a00e1d7ffdec03738))
* prevent instance drift when daemon sessions expire ([1c500bf](https://github.com/portel-dev/photon/commit/1c500bfe09fc9149deda23cc2b268b3e3158120f))
* prevent silent refresh cascade when viewing mutation methods ([9082b4d](https://github.com/portel-dev/photon/commit/9082b4d5a45120e985eab78306549ea2f4f905ce))
* prevent silent refresh from replaying mutation methods ([793b4a0](https://github.com/portel-dev/photon/commit/793b4a0ad4f461c63116107ac48b3ed874e89f09))
* prevent SSE server crash on client disconnect ([e555896](https://github.com/portel-dev/photon/commit/e55589669cdd6b5a3e111946b095e940e27ccc21))
* push fullscreen button to true top-right corner ([e8d6149](https://github.com/portel-dev/photon/commit/e8d614923d1bc8be375e6e581920f0ee9772c413))
* put Execute button above Cancel when stacked on narrow screens ([1f8886d](https://github.com/portel-dev/photon/commit/1f8886d17365ecc5bcfa8332ac3c3df99469df0f))
* redesign app layout divider and move fullscreen button ([5d0af21](https://github.com/portel-dev/photon/commit/5d0af21aaf0894a959efc0070576cac1ea284c63))
* reduce daemon reconnection log spam and prevent duplicate shutdown ([b6496c9](https://github.com/portel-dev/photon/commit/b6496c9175fe3dfda6a9a4547ff640a7327042e2))
* reduce excessive vertical spacing in container formats ([a15f47f](https://github.com/portel-dev/photon/commit/a15f47f10b30768c42a8b70787e68cb71a84a313))
* reduce excessive vertical spacing in format-showcase components ([872d82f](https://github.com/portel-dev/photon/commit/872d82f3d4cf3749e25118c69716d76641314211))
* reduce table cell padding for better space efficiency ([43144b4](https://github.com/portel-dev/photon/commit/43144b4ec73d6ebf8505cb14d90b85c0d74574f9))
* reduce vertical spacing in accordion and stack formats ([5fff2be](https://github.com/portel-dev/photon/commit/5fff2be83f9ded6a7d239967c5b22b2d722b7da4))
* remove 800px height cap on MCP app iframe renderer ([eb635ef](https://github.com/portel-dev/photon/commit/eb635ef897d816af1ff91ae1fc539d06dbc8a328))
* remove dead code, deprecated wrappers, and silent error swallowing ([c745748](https://github.com/portel-dev/photon/commit/c7457481977c4845a08a146ee7da4e61bcf983f2))
* remove duplicate fullscreen button from mcp-app-renderer ([a746db4](https://github.com/portel-dev/photon/commit/a746db4a06d0d31c450e8a7d95741fd78977a2ec))
* remove whitespace in accordion chevron span to prevent line breaks ([4bfb0e3](https://github.com/portel-dev/photon/commit/4bfb0e31c50eade35b4b093676835f498b5e83a5))
* remove whitespace in list badge and chips rendering templates ([6ef7bfc](https://github.com/portel-dev/photon/commit/6ef7bfcee4d055af148f218cbdefb3368663d150))
* remove whitespace in table header template that created line breaks ([d18b79a](https://github.com/portel-dev/photon/commit/d18b79a20543d38c7a7779831d2d0e083893595f))
* render structured table data as ASCII table in CLI output ([3186927](https://github.com/portel-dev/photon/commit/3186927ae35849c9aa6f603a1a0f03084bcc786d))
* replace ↕ (U+2195) with ⇅ (U+21C5) for better cross-browser font support ([b77eba3](https://github.com/portel-dev/photon/commit/b77eba3e01ad39dabe0f6edc9c93d7fca163f2f9))
* replace hardcoded border-radius values with CSS custom property tokens ([f60cf9b](https://github.com/portel-dev/photon/commit/f60cf9bcb2db08460af986b318b6c23d9097e592))
* replace tiny chevron character with crisp SVG icon ([b09068e](https://github.com/portel-dev/photon/commit/b09068e740139213c13fa2d5b5d078ff53da6766))
* reserve space for parameter tags in method cards for visual uniformity ([be0a511](https://github.com/portel-dev/photon/commit/be0a51182e956e66d2c641c54846bdab0d5d5db5))
* resolve scrollbar, chart, tab, and accordion issues across formats ([18eaa41](https://github.com/portel-dev/photon/commit/18eaa417cbcec463b62bcca18c3685cebbf881b0))
* resolve SSE keepalive bug causing constant reconnections ([d5d7032](https://github.com/portel-dev/photon/commit/d5d70324057e3c0fead6b8c3cdc6380227ca7d95))
* resolve visual issues across format-showcase components ([38bb8a5](https://github.com/portel-dev/photon/commit/38bb8a53b410bbe5c38e0e75ddde4ac9cc388c99))
* restore fullscreen button and fix theme propagation for external MCPs ([425dfec](https://github.com/portel-dev/photon/commit/425dfecbcc7623786cda33eb526cc83979210d8d))
* restore fullscreen button to absolute top-right inside container ([b9f47fe](https://github.com/portel-dev/photon/commit/b9f47fe05be960fc7655b74e88b4d2877489bd22))
* restore fullscreen button to beam-app and improve theme propagation for MCP apps ([09f12a7](https://github.com/portel-dev/photon/commit/09f12a729e73748fa1c660a3aab4daabfca7ba6c))
* return 'Done' acknowledgment for void method results and restore label tags ([8a956c9](https://github.com/portel-dev/photon/commit/8a956c90f3f21582036d9f7f3f2d9a577b1499ec))
* right-align LIVE indicator in context bar ([c691f7b](https://github.com/portel-dev/photon/commit/c691f7b2c310e0529df3e95b8f2d71f4e5389599))
* show (default) label and auto-execute on instance switch ([d6f9493](https://github.com/portel-dev/photon/commit/d6f9493daef276d1b2a36d96f9a24b8f136bd342))
* show instance dropdown in both list and form views ([d2da743](https://github.com/portel-dev/photon/commit/d2da7434a91b71a747fae412714309bca76e1315))
* split content CSS into text and structured layout modes ([3aec015](https://github.com/portel-dev/photon/commit/3aec0156dea9a31fccb7f8cdf1c7703b9c1f4157))
* standardize error handling across CLI, daemon, and context stores ([f1cfe6d](https://github.com/portel-dev/photon/commit/f1cfe6dc96c890d4e5701e07dbcbf4aa75fe97b8))
* state persistence accesses user class through PhotonMCPClass wrapper ([d59776c](https://github.com/portel-dev/photon/commit/d59776ca038f3a39afba768cd151718765f26110))
* strip markdown to plain text in method card descriptions ([10f9314](https://github.com/portel-dev/photon/commit/10f9314b015241ae5d3cae4252299a419cfc298b))
* subscribe to daemon state-changed lazily on first tool call ([6d59d34](https://github.com/portel-dev/photon/commit/6d59d34c77a64320f9ba02cc67f6bb88c9e4236b))
* subscription retry on initial failure and instance restore race ([3da85b6](https://github.com/portel-dev/photon/commit/3da85b6355221c3b30a5ad21add7e59189b2271b))
* sync Beam session to current instance for stateful photons ([acc3cc5](https://github.com/portel-dev/photon/commit/acc3cc5db5e3f51c43147c8c677135703dc301f2))
* table rendering, description truncation, and --no-flag parsing in CLI ([fcdaa57](https://github.com/portel-dev/photon/commit/fcdaa576af1fc3bdbd23f9297a85b0730400a852))
* test all known UI clients and align docs with code ([8130119](https://github.com/portel-dev/photon/commit/8130119196e006cc224941cfbc53ab37383a3508))
* tighten fullscreen button position to top-right corner ([a3e128a](https://github.com/portel-dev/photon/commit/a3e128ad624852becfec7a7e51e0d05d61db5055))
* timeline dot alignment and connecting line visibility ([01bf6ea](https://github.com/portel-dev/photon/commit/01bf6ea482a796ba1df55064c6588eddbe458651))
* update @portel/photon-core to 2.8.2 and @portel/cli to 1.0.2 ([b82963c](https://github.com/portel-dev/photon/commit/b82963cce6b29097844437ff83af64dc92c045c6))
* update @portel/photon-core to 2.8.3 ([fc240ea](https://github.com/portel-dev/photon/commit/fc240eaff02096440cae16ac2ee92e90a4c72b1c))
* update stale comments and docs for SEP-1865 default change ([42cc7af](https://github.com/portel-dev/photon/commit/42cc7af71ae7f8738f5140e62737cacd4a0f75fe))
* use colon separator for instance in breadcrumb (list:macha / get) ([31c384e](https://github.com/portel-dev/photon/commit/31c384e3ae11584ffb673625a905b0741ca0d350))
* use negative sticky top to push button flush with main-area edge ([d7ccd99](https://github.com/portel-dev/photon/commit/d7ccd99bfc894a9cc65b12b6a9f72d2f9e692d92))
* use stable Lit-managed container for streaming mermaid updates ([25720e4](https://github.com/portel-dev/photon/commit/25720e4ef40e96e899119b3045a92cda1669c03f))
* use stable session ID for stateful photons in CLI runner ([2e84017](https://github.com/portel-dev/photon/commit/2e8401719109f0d9e57d59a08bab6628e751b6cd))
* use TTY-based session key for CLI instance scoping ([02e5255](https://github.com/portel-dev/photon/commit/02e525571e0e80abca6387f1866101c4215606b5))
* validate number and enum parameters, show help on no-args ([ec869ed](https://github.com/portel-dev/photon/commit/ec869ed4faac9fdc5212a6e2e81b26491a939969))
* warmth highlighting persists after page refresh ([e015e02](https://github.com/portel-dev/photon/commit/e015e02bc8396dfa7aad196106721156a0b2383a))
* warmth survives refresh + animations trigger on diff ([70bfd69](https://github.com/portel-dev/photon/commit/70bfd699c5ebf0ef3fd90c548b98ef3aaa2ed09b))

## [1.7.0](https://github.com/portel-dev/photon/compare/v1.6.1...v1.7.0) (2026-02-08)

### Features

* upgrade photon-core to 2.6.1 and re-export elevationLight ([e47f777](https://github.com/portel-dev/photon/commit/e47f7779837a309db1af89fe0c0513c66db9a147))
* upgrade photon-core to 2.7.0 ([ce0a289](https://github.com/portel-dev/photon/commit/ce0a289dfa60eaa7ee0956b7684220fcf00cee0b))
* wire async execution and cross-photon calls in runtime ([7647f1e](https://github.com/portel-dev/photon/commit/7647f1e8ede2382ba7e135b8f92ba3bdf93dc062))
* wire execution audit trail into tool execution pipeline ([4090072](https://github.com/portel-dev/photon/commit/40900725011417c00ad13977fcb8c8e5bf178cdb))

### Bug Fixes

* add body size limits, enforce HTTPS marketplace, add security headers ([e149f44](https://github.com/portel-dev/photon/commit/e149f44bf6cfdc4862eb4e85c13149fe61277cb5))
* add mitigations for sandboxing, postMessage, and rate limiting ([648f120](https://github.com/portel-dev/photon/commit/648f1208cf64310a71056582950e415035747d86))
* add path validation and auth guards for HTTP endpoints ([81efc70](https://github.com/portel-dev/photon/commit/81efc701a5852194417ef82d1caa9be5ce923fd1))
* format code with prettier and fix IPv6 test failure in CI ([98a366d](https://github.com/portel-dev/photon/commit/98a366d4dd1a4c5abf50e3eda6ea31d87b16dc04))
* format loader.ts and server.ts with prettier ([4088f2d](https://github.com/portel-dev/photon/commit/4088f2daebde992b1d8b7ebeec0d66f2d8ba45e8))
* inline npm package validation in maker photon ([e6d1950](https://github.com/portel-dev/photon/commit/e6d1950be1de3a1259f95c9b5ba1c62deeb16b77))
* prevent command injection in npm view calls and URL handling ([fbcc443](https://github.com/portel-dev/photon/commit/fbcc443441f0456e3927fd436009cad50643c017))
* prevent path traversal in asset downloads and harden server binding ([6ff9557](https://github.com/portel-dev/photon/commit/6ff9557d2a81f1dda4ff860cbbd1e0e00d291aa8))
* prevent XSS, prototype pollution, and code injection ([f7c95cd](https://github.com/portel-dev/photon/commit/f7c95cddf97824f54be2e67776ffc3f0791b4634))
* remove duplicate marketplace content and stray photon files ([5bf7c25](https://github.com/portel-dev/photon/commit/5bf7c25948ada8a0d067b6ec3f0f6be55eae7bea))
* remove marketplace sync from runtime repo, clean up artifacts ([bf1dd4a](https://github.com/portel-dev/photon/commit/bf1dd4acc3bf5c6989f5eb5942ca3c0c85cfb18e))
* simplify release workflow to validation-only ([65cf9ed](https://github.com/portel-dev/photon/commit/65cf9ed435fd8de509e6270660cb8b8ce91cd904))

## [1.6.1](https://github.com/portel-dev/photon/compare/v1.6.0...v1.6.1) (2026-02-06)

### Bug Fixes

* move esbuild from devDependencies to dependencies ([0349502](https://github.com/portel-dev/photon/commit/034950272f78111974e32c26914f531883b7e556))

## [1.6.0](https://github.com/portel-dev/photon/compare/v1.5.1...v1.6.0) (2026-02-06)

### Features

* add [@label](https://github.com/label) tag for custom photon display names ([36c0cae](https://github.com/portel-dev/photon/commit/36c0cae68af523f5372d807b7f4df96f73d1d01f))
* add [@persist](https://github.com/persist) tag support for settings UI ([803bee6](https://github.com/portel-dev/photon/commit/803bee621252a4034de3e7c3f5b65bed6d98685d))
* add HTTP Streamable transport for external MCPs ([e5d60b8](https://github.com/portel-dev/photon/commit/e5d60b87d36dac78adb0da76a92ca08aac1af6b0))
* add MCP Apps Extension support for external MCPs ([cd106e4](https://github.com/portel-dev/photon/commit/cd106e4c5b3c2a29d0ca79f3a2d9abf622ae4279))
* add method type badges for autorun/webhook/cron/locked ([15ffd49](https://github.com/portel-dev/photon/commit/15ffd49a33d6c066f47329c8e2338825f21a7a47))
* add Photon Studio inline code editor for Beam ([d1a4807](https://github.com/portel-dev/photon/commit/d1a4807629c879fd874eb5dc8362d7fbbe8e7e32))
* add Swagger-style array forms with Form/JSON tabs ([eaccc44](https://github.com/portel-dev/photon/commit/eaccc4444a9b73bf35afd9181f3da0b1090de8bf))
* add tab bar for MCPs with multiple UIs and fix theme switching ([080a53f](https://github.com/portel-dev/photon/commit/080a53f38019100f0ab82b256ce377f68adf7348))
* add universal MCP support in Beam ([505057d](https://github.com/portel-dev/photon/commit/505057d40ae8c9b9b5db93c3668a0adbed2178d7))
* adopt official MCP Apps Extension SDK (AppBridge) ([a873131](https://github.com/portel-dev/photon/commit/a873131a2e85bcef5b2ed65c5982fe5c0037fc95))
* always-visible Run button on method cards ([5c41d94](https://github.com/portel-dev/photon/commit/5c41d94c3a76e0e4243100a5d282ed21adef8346))
* app-first layout with pop-out for App photons ([8d8df6f](https://github.com/portel-dev/photon/commit/8d8df6f4ebb5d19a3bd97b15bb59ae6f7cbe79d7))
* auto-invalidate dependency cache on photon-core version change and auto-restart daemon on connection failure ([d4ff898](https://github.com/portel-dev/photon/commit/d4ff898f2c3a561533a61f10cd4d99860b0e30dc))
* auto-subscribe to ReactiveCollection events in Auto UI ([e91813d](https://github.com/portel-dev/photon/commit/e91813d24cc5629f7c160a31fd10db8cf67d7e1d))
* auto-wire ReactiveArray/Map/Set properties for zero-effort reactivity ([f3631b5](https://github.com/portel-dev/photon/commit/f3631b5e5be6c25f8b45531f4fb7fb2836b4ec34))
* clean up sidebar — pure navigation focus ([99b12e8](https://github.com/portel-dev/photon/commit/99b12e86e0937b3be51a89003a98b8c3f11ab9e1))
* extract context-bar and overflow-menu components from beam-app ([b042dc5](https://github.com/portel-dev/photon/commit/b042dc5dd0a8c4cd2479056fdb21e5f0445eb080))
* implement unified UI bridge architecture using MCP Apps SDK ([3c95823](https://github.com/portel-dev/photon/commit/3c958235672479ac8d9850845c99cd62f67b416a))
* improve docs, add file paths and progressive onboarding to Beam ([b8fe0d6](https://github.com/portel-dev/photon/commit/b8fe0d64bb9b4aae42e34dbe95001469716fddab))
* improve light theme with soft shadows and cool blue-gray palette ([51dafc6](https://github.com/portel-dev/photon/commit/51dafc6d0b0e931ece35a7b32b65e7294e6df726)), closes [#F4F6F8](https://github.com/portel-dev/photon/issues/F4F6F8)
* methods-first bento layout with compact Context Bar ([36f9b48](https://github.com/portel-dev/photon/commit/36f9b48477c8083fcbe2cb49161438fbacd23651))
* rename sidebar sections and classify app-capable MCPs under APPS ([f70f24f](https://github.com/portel-dev/photon/commit/f70f24fdcadcaebc6090433f4e64c46ef069f331))
* render nested arrays/objects in card view as collapsible tables ([d1f8286](https://github.com/portel-dev/photon/commit/d1f828698201295420e16b223a2be3d79b7a2992))
* restyle CLI snippet as terminal with black background and monospace font ([d2be411](https://github.com/portel-dev/photon/commit/d2be4111623db93d9e857cfcea043c4e89b4e1a8))
* seamless class-based development with clean client API and animations ([06b655d](https://github.com/portel-dev/photon/commit/06b655d1eb292cc1658f7f3cd62d86be07f60b10))
* show CLI command preview in invoke form ([0012c55](https://github.com/portel-dev/photon/commit/0012c553d811834d7620d49a2c18319723fcbee2))
* show schema default values as input placeholders ([b3ae303](https://github.com/portel-dev/photon/commit/b3ae303e302d1db0a0d0dc3fadca8b66f97c3628))
* simplify app layout, remove method card initials, revert setup badge ([5c76055](https://github.com/portel-dev/photon/commit/5c760550e8fed49c50e7e0cdc220e95d5a254260))
* support client-side event subscriptions for injected photons ([3be68ef](https://github.com/portel-dev/photon/commit/3be68eff2ccbfbd4ac4928db70128fda8a006a35))
* support Collection<T> in loader wiring and auto-UI rendering hints ([3126f5d](https://github.com/portel-dev/photon/commit/3126f5d6e6ad5882890b9871c8c8266ec5f21ba4))
* unify source viewing with Open in Studio link ([a932eb9](https://github.com/portel-dev/photon/commit/a932eb9b82c80b578740f74259b0b25651d8bf0c))
* use standard MCP protocol for real-time cross-client sync ([ba87761](https://github.com/portel-dev/photon/commit/ba87761ea3d4a012927230e806c847dd45ecce88))
* watch config.json for external MCP changes + rename "Setup Pending" to "Needs Attention" ([28788a6](https://github.com/portel-dev/photon/commit/28788a6b568220cc694809e8eb460a6e030f25d8))

### Bug Fixes

* add fullscreen button to MCP apps, exclude UI from resource count ([5cfc606](https://github.com/portel-dev/photon/commit/5cfc606208270bbb233aa24657ce2a970e03765e))
* add grid layout to external MCP Available Tools section ([a5cfd11](https://github.com/portel-dev/photon/commit/a5cfd11339bb340673b47e81e94ced14f9dce719))
* add legacy SSE fallback for URL-based external MCPs ([f7191e7](https://github.com/portel-dev/photon/commit/f7191e7494b689ee0252f8b69d8824437e9c2168))
* add size notifications to MCP Apps bridge for proper iframe sizing ([2a24efd](https://github.com/portel-dev/photon/commit/2a24efde35d35a127d08c690e1b73bc26130a020))
* address release blockers and clean up for v1.6.0 ([ebaeb85](https://github.com/portel-dev/photon/commit/ebaeb85ac83dfaea8f148c16134114215524b616))
* autocomplete triggers inside JSDoc and route new photons to Studio ([cf676c6](https://github.com/portel-dev/photon/commit/cf676c65ab561721fa9878a78bd0e8670170e0e4))
* backfill env vars for constructor params with defaults after load ([80a25aa](https://github.com/portel-dev/photon/commit/80a25aa2d88430ddd423a427d0259e3f55b75d54))
* cap MCP Apps UI height to 800px for chat window fit ([28e6a69](https://github.com/portel-dev/photon/commit/28e6a6987fbbfb9a50d158ab89ed51edfae81966))
* capture generator return value when no yields occur ([73ec8fb](https://github.com/portel-dev/photon/commit/73ec8fb730fedc8c0299f8a81787afd59011b6dd))
* complete unified bridge migration for cross-client real-time sync ([5532dc8](https://github.com/portel-dev/photon/commit/5532dc8d5a9be24a2a59f2c1fbc2718c0cc6fcb9))
* constrain file picker to photon's workdir ([144f29a](https://github.com/portel-dev/photon/commit/144f29afa23d265a0b2d087cd318b2c637f264dd))
* contextual button labels and JSON serialization in array forms ([59d9aae](https://github.com/portel-dev/photon/commit/59d9aaed7795aef41053ef85f9c774d3c56275c0))
* correct [@internal](https://github.com/internal) detection and photon-core version resolution ([0d8397c](https://github.com/portel-dev/photon/commit/0d8397c0b63c76b40e25c58e363d3fa5f4b83ee8))
* correct README commands and render textarea for code fields in Beam ([3f341af](https://github.com/portel-dev/photon/commit/3f341af9738d832c5ea9f7770484deffea6ff7d5))
* detect port conflicts with localhost-only bindings ([59c7bd2](https://github.com/portel-dev/photon/commit/59c7bd2dc40f8b632d8b900241cb0bdd70727a5e))
* ensure appResourceUris defaults to empty array in tools response ([eb9d9eb](https://github.com/portel-dev/photon/commit/eb9d9eb39714f86abc2c1369b06b14c4a02ac530))
* external MCP App rendering and tool invocation in Beam ([d099324](https://github.com/portel-dev/photon/commit/d0993249aaed1d6949fd5a4b466260956a89bc75))
* external MCP tools not appearing in Beam ([f4eab95](https://github.com/portel-dev/photon/commit/f4eab95e01d4f0efe8bb8ac8388ae4fabe3a7dd4))
* extract and parse MCP result content in platform bridge ([7a406ba](https://github.com/portel-dev/photon/commit/7a406ba17842b49a7b6a693a518ac937234fe378))
* filter binary files and add directory mode to file picker ([71b3f41](https://github.com/portel-dev/photon/commit/71b3f41210b00b516dab2e4ec5d10b3400401cc2))
* filter theme tokens to spec-valid keys for AppBridge ([f5d6f6a](https://github.com/portel-dev/photon/commit/f5d6f6a2e8c1283362786ee1f0a06e676eed6926))
* force 620px minimum height for kanban boards ([227ba4e](https://github.com/portel-dev/photon/commit/227ba4e25ad3313a89cccc39969d5bcbcbf053d9))
* gracefully close external MCP clients on shutdown ([0ad4e1e](https://github.com/portel-dev/photon/commit/0ad4e1ee1f3f8868d4c7f1bcd3531bd468d1844b))
* handle isError flag in platform bridge tool results ([4630125](https://github.com/portel-dev/photon/commit/4630125252ae5376321f730b0c207e74623f6dca))
* hide photon-specific toolbar buttons for external MCPs ([f095859](https://github.com/portel-dev/photon/commit/f095859c993b4a5f451abff4b6bb95193ecfcfd2))
* implement correct MCP Apps ui/initialize handshake ([d11f422](https://github.com/portel-dev/photon/commit/d11f42238fdb72241689797c5e3548dfa33a6a32))
* improve Beam UI configuration, form handling, and diagnostics ([c409c0b](https://github.com/portel-dev/photon/commit/c409c0b39050cb3a3436d13f3eaad0e82d026810))
* improve MCP Apps size calculation for kanban boards ([941cbdf](https://github.com/portel-dev/photon/commit/941cbdf4b3e8bdb02079e707a90029b5af3a6600))
* improve param tag contrast in light theme method cards ([eaafca3](https://github.com/portel-dev/photon/commit/eaafca38d23408da5e74c156b102fd9b98543a53))
* increase light theme contrast — darker bg, stronger borders/shadows ([51ebeb5](https://github.com/portel-dev/photon/commit/51ebeb5eddf9f038bd30776aed2c81f65ea50c75)), closes [#F4F6F8](https://github.com/portel-dev/photon/issues/F4F6F8) [#E5E9EE](https://github.com/portel-dev/photon/issues/E5E9EE) [#FFFFFF](https://github.com/portel-dev/photon/issues/FFFFFF) [#F6F7F9](https://github.com/portel-dev/photon/issues/F6F7F9)
* inject MCP Apps bridge script into UI resources ([eb64cf4](https://github.com/portel-dev/photon/commit/eb64cf47a238ea3839af057a4f8ff66d80465bcd))
* JSDoc comment continuation and [@runtime](https://github.com/runtime) version in Studio autocomplete ([5998ac7](https://github.com/portel-dev/photon/commit/5998ac74235757b6faa266520c038a584e347b8e))
* MCP App hash navigation and auto-invoke linked tool ([ad53269](https://github.com/portel-dev/photon/commit/ad532692f5b0f62ededf67fa669d4ad1400c4805)), closes [#system-monitor](https://github.com/portel-dev/photon/issues/system-monitor)
* MCP Apps bridge sets __PHOTON_DATA__ and improved size calculation ([7617882](https://github.com/portel-dev/photon/commit/7617882c5698cb62ca15471cd24b02976210a0c7))
* move fullscreen button to toolbar above app viewport ([335548d](https://github.com/portel-dev/photon/commit/335548d45ff733152ad58f52e688e737621a4fda))
* move param tags to own row in method cards ([efd952e](https://github.com/portel-dev/photon/commit/efd952e1ee81fcd0b105d0238e901fb2e5e08100))
* no-op description saves, param tags on cards, hover pencil hints ([3fd5c53](https://github.com/portel-dev/photon/commit/3fd5c53819bf0e27aef703d62bc86e55f4461802))
* pencil-only edit triggers, name editing, and overflow menu portal ([e7fad58](https://github.com/portel-dev/photon/commit/e7fad5811f6b7f16fb8a01641dcd3edc97765aa2))
* preserve structuredContent in external MCP tool calls ([f3d3280](https://github.com/portel-dev/photon/commit/f3d328055799470a74a9f42e3c8b8bd2bbfda7e0))
* prevent file paths from rendering as broken image thumbnails ([ae9e250](https://github.com/portel-dev/photon/commit/ae9e250e3737af4c364abdfacca08a45b2fd57ee))
* prevent iframe from rendering before elicitation completes ([53090f7](https://github.com/portel-dev/photon/commit/53090f7955a9c8840e873b57514192d08f698ff7))
* pull nested arrays out of kv-table to eliminate excess whitespace ([6fbcca5](https://github.com/portel-dev/photon/commit/6fbcca5d829549fec41e58a17e8b42672b2de800))
* recognize 'modified', 'expires', 'since' as date fields ([19194c8](https://github.com/portel-dev/photon/commit/19194c845b83f901e48fdf2d02622f91d4e0ceed))
* render Mermaid diagrams and style tables in help modal ([9abd68a](https://github.com/portel-dev/photon/commit/9abd68a7127084e1bc8b35002342908f501d1746))
* replay saved configure() params on photon startup and hot-reload ([c66a638](https://github.com/portel-dev/photon/commit/c66a6383ff7211c5a9e57277ac5ea5abf14ff845))
* resolve config form cross-contamination and reconfigure failure ([6c9827d](https://github.com/portel-dev/photon/commit/6c9827d953e15ccae25e942a6ce763ae7fed03da))
* resolve file picker workdir from running photon instance ([d5d698c](https://github.com/portel-dev/photon/commit/d5d698cdc36d7f153ff9a61ca3235f1c551569e5))
* restore ecosystem infographic to README ([a326f92](https://github.com/portel-dev/photon/commit/a326f921a3ef62eb943c9f22b79d6b28d5bb9141))
* set MCP Apps context flag to prevent non-JSON-RPC messages ([5a7227c](https://github.com/portel-dev/photon/commit/5a7227cd0eba74d7d22f07ebd9d06235453f4afa))
* simplify help modal title to just "Help" ([b2540f9](https://github.com/portel-dev/photon/commit/b2540f982a3093279d62b6a77149c7fa17a50adf))
* stabilize docblock completion function reference for CM6 ([cdaae21](https://github.com/portel-dev/photon/commit/cdaae21f0223ccc543da05e9996d744bdd5772a1))
* suppress stderr from external MCP processes ([637c091](https://github.com/portel-dev/photon/commit/637c0915d857b7f152ce12b64ff688d35781c23e))
* use actual bound port for --open flag in beam command ([4e8a875](https://github.com/portel-dev/photon/commit/4e8a875a343f778215a4a43b50dec8290d7825bd))
* use correct mimeType for MCP Apps extension compatibility ([820ff8b](https://github.com/portel-dev/photon/commit/820ff8b79265bff06b7f5b4f68ae4a5963e8fa2b))
* use mcp-app-renderer for external MCPs in form view and fix matchMedia override ([7f9ee29](https://github.com/portel-dev/photon/commit/7f9ee29a8636bdd7ca5944688a681319246692fb))

## [1.5.1](https://github.com/portel-dev/photon/compare/v1.4.1...v1.5.1) (2026-02-02)

### Features

* actionable toasts, better error messages, connection recovery guidance ([55e73e9](https://github.com/portel-dev/photon/commit/55e73e90b33578437031c7b0e86591d68ed999f7))
* add _meta.outputTemplate to tools with linked UI ([8733425](https://github.com/portel-dev/photon/commit/8733425c373469b6d653a3ecf3b3b9baf8f49bce))
* Add [@accept](https://github.com/accept) filter to code-diagram file picker ([466fd52](https://github.com/portel-dev/photon/commit/466fd523419db1eafec080ceee169fb512a081c2))
* Add [@cli](https://github.com/cli) dependency checking in loader ([6ae91ae](https://github.com/portel-dev/photon/commit/6ae91ae7a741515add3dff25192e0938d8116b7f))
* Add [@runtime](https://github.com/runtime) tag for version compatibility checking ([e78fce9](https://github.com/portel-dev/photon/commit/e78fce990ed309f55a6a52266259e5dd16d39fdd))
* Add {[@label](https://github.com/label)} tag support and improved label formatting ([0e41373](https://github.com/portel-dev/photon/commit/0e413736dabc48a4779353051d9774b4ece0597f))
* Add {[@placeholder](https://github.com/placeholder)}, {[@hint](https://github.com/hint)}, and [@icon](https://github.com/icon) support in BEAM ([63c31d6](https://github.com/portel-dev/photon/commit/63c31d6c93b8af274e229ddd98fa547139c0d941))
* add /api/local-file endpoint for serving local files ([d5248b8](https://github.com/portel-dev/photon/commit/d5248b84b3df38e4544947cced5527a414f6157f))
* add `photon package` command for cross-platform PWA launchers ([bc10823](https://github.com/portel-dev/photon/commit/bc10823d6fd13345920246e226f38cda3a16639b))
* Add accessibility and animation performance improvements ([471d758](https://github.com/portel-dev/photon/commit/471d75837b47f2d7b3abf709a25a347f52445989))
* Add activity panel (audit trail) to Beam UI ([ba142b8](https://github.com/portel-dev/photon/commit/ba142b858436655c4f9ec7c9e4922da328089b80))
* Add advanced Beam UI features ([ecdf4b2](https://github.com/portel-dev/photon/commit/ecdf4b28c565d71a4daccafbab7cc1a3da0e9138))
* Add all 3 test modes to BEAM (direct, cli, mcp) ([7ad5066](https://github.com/portel-dev/photon/commit/7ad5066e526b0f4421f436dd6f60bd2baa70fb34))
* Add app state persistence API and improve settings menu ([9a3d496](https://github.com/portel-dev/photon/commit/9a3d4960ea0b59be75a814c43774cbf02e574517))
* add asset folder discovery in Loader ([06b448c](https://github.com/portel-dev/photon/commit/06b448c9c0b3a02ed7cd667b4cde2903fab4cc20))
* Add BEAM UI E2E test framework with Playwright ([d24931a](https://github.com/portel-dev/photon/commit/d24931aa129641596f31a9b21100b07d5b00a391))
* add bidirectional prompt protocol for daemon ↔ CLI ([e113f67](https://github.com/portel-dev/photon/commit/e113f6798c930578e0b9c3b899a298e7394f8ca9))
* Add bundled Maker photon for authoring ([4c0efff](https://github.com/portel-dev/photon/commit/4c0efff34056ba361754822673da7cfcb440e093))
* Add bundled photon support for maker ([ecea222](https://github.com/portel-dev/photon/commit/ecea22294655a77503f7810a6e214cbf47680c7d))
* Add bundled photon support to Beam UI ([134fbbe](https://github.com/portel-dev/photon/commit/134fbbeb9020fd8229fe1ea50267f4442a5a7acb))
* Add card, tabs, accordion to [@format](https://github.com/format) tag parser ([6835148](https://github.com/portel-dev/photon/commit/68351480ca328fa5bcc7c629483d6f165a54def9))
* Add channel-based pub/sub for cross-process emit notifications ([f133d8e](https://github.com/portel-dev/photon/commit/f133d8e7bcfae7c77bcdfc6b44ff3193451d58c3))
* add CLI handlers for form and URL elicitation ([73bbf1a](https://github.com/portel-dev/photon/commit/73bbf1a91d413b5547fbf11d4de150e26c5d30ad))
* Add Cloudflare D1 and KV store implementations ([f3affb1](https://github.com/portel-dev/photon/commit/f3affb1b8184697f0c9cd1a624cbe7754a2b5d91))
* add Cloudflare Workers deployment ([21332d7](https://github.com/portel-dev/photon/commit/21332d7182dff177b03c54c0d0b93fcf314eb2c0))
* Add comprehensive demo photon for testing ([05b6538](https://github.com/portel-dev/photon/commit/05b6538433eb4189abca4b3b735144bcb55437bc))
* Add configuration UI component and smart result rendering ([41509b2](https://github.com/portel-dev/photon/commit/41509b217fb72ecdbe9c213eb02376f9baaa2d58))
* Add cross-client notifications via daemon pub/sub ([39546c5](https://github.com/portel-dev/photon/commit/39546c57d0953e19b8b6c3f5f17f7d7caad261e9))
* Add custom UI rendering and auto-run for no-param methods in BEAM ([6ac4292](https://github.com/portel-dev/photon/commit/6ac4292fb4fb2212888f6237d3a83d1d0e55bd3f))
* Add daemon channel subscription to BEAM for cross-process updates ([2c945aa](https://github.com/portel-dev/photon/commit/2c945aaa9cfac664ba27273ed111d8c76c385ac6))
* Add daemon hot-reload for stateful photons ([6e3089d](https://github.com/portel-dev/photon/commit/6e3089d78d5a4681501f41c39bce37db33fee86e))
* Add dev:beam script with auto-restart on code changes ([1f08f24](https://github.com/portel-dev/photon/commit/1f08f243a78e908438cb195c0cc1eb168b093093))
* Add distributed locks, scheduled jobs, and webhooks to daemon ([3eff6e3](https://github.com/portel-dev/photon/commit/3eff6e304dd5ea7e906f6f51364d1e5c22867164))
* Add dual-mode testing to BEAM (direct + MCP) ([9ee8702](https://github.com/portel-dev/photon/commit/9ee8702467168ff42dea1d5129f28cdea805b6e8))
* Add E2E test suite for Beam UI flows ([9bf4537](https://github.com/portel-dev/photon/commit/9bf45374bdad03d98b67ac1414b2db0d3284c454))
* Add elicitation modal to Beam UI with interactive prompts ([03b5d42](https://github.com/portel-dev/photon/commit/03b5d426a84121c3153d0ac3bb75b3d2eb031075))
* Add enhanced markdown rendering with mermaid, callouts, and multi-column layouts ([2631a69](https://github.com/portel-dev/photon/commit/2631a692a0fb94c04db8807f2e5f5b9dd7c79f99))
* Add enum types and defaults to Serum parameters ([c8771f4](https://github.com/portel-dev/photon/commit/c8771f44fe28b6b0628c830541544755c0f5503d))
* add ephemeral progress indicators ([d7c2e4a](https://github.com/portel-dev/photon/commit/d7c2e4ab3d0706dd4eba044f5a68e8bb84cb644b))
* Add Escape key to cancel executions and close modals ([4a20bed](https://github.com/portel-dev/photon/commit/4a20bede4120739f083b75df72a20a3d001b3656))
* Add ESLint and Prettier configuration ([eb82f8c](https://github.com/portel-dev/photon/commit/eb82f8c59954cf9b3ef7487e264aca3cd2924e60))
* Add event replay support for reliable real-time sync ([bf4cab2](https://github.com/portel-dev/photon/commit/bf4cab23aae409e01bb648d56809a088f6344f7f))
* Add Execute/Data tabs to photon view method panel ([9fb564a](https://github.com/portel-dev/photon/commit/9fb564aedf899a980569f89e7aa96e39a5490e68))
* Add experimental MCP sampling capability ([a5cff16](https://github.com/portel-dev/photon/commit/a5cff1646721c56625867bd9ccd2c4c022e92304))
* Add file browser for path/file input fields in Beam UI ([c2d9706](https://github.com/portel-dev/photon/commit/c2d97063a2cf1a9692c7419fe41de037432e5c4c))
* Add file upload/download and [@ui](https://github.com/ui) template support ([73e6e46](https://github.com/portel-dev/photon/commit/73e6e4662a10afa4226490bbeb88746130d1b095))
* Add file watching for automatic hot reload in Beam ([412e51d](https://github.com/portel-dev/photon/commit/412e51da45e9675dff8211c4b3327c65af47de67))
* add first-run welcome wizard with install/create paths ([ab6edc5](https://github.com/portel-dev/photon/commit/ab6edc570a746b016d06ce64f78668273b2cf285))
* Add Form and JSON tabs to config view ([200e1d2](https://github.com/portel-dev/photon/commit/200e1d2b4d0ac8ad929e8ec50529947b9a5bd56a))
* Add form persistence, file picker improvements, and [@accept](https://github.com/accept) filtering ([8e1717b](https://github.com/portel-dev/photon/commit/8e1717b4d46bd87724e5c181c999afb9fd3dbea4))
* add generator support for interactive prompts in CLI ([f9f71f7](https://github.com/portel-dev/photon/commit/f9f71f7a347159e920f31cd40c718399d30b1d39))
* add generator support to PhotonAdapter ([4ecb35d](https://github.com/portel-dev/photon/commit/4ecb35d5a14214f477a50f27d9480e1510147613))
* Add goHome() function to return to home view ([985abc1](https://github.com/portel-dev/photon/commit/985abc1079430a57fc59532424e7e6d5724b60e1))
* Add hash-based routing to Beam UI ([74e8d6a](https://github.com/portel-dev/photon/commit/74e8d6a804059962b6a574347748264cb268b67a))
* Add hashed photon ID for unique identification ([19a4bd4](https://github.com/portel-dev/photon/commit/19a4bd4bf767e9bbec428d776d08bb84fc0f0c78))
* Add history and favorites to BEAM UI ([f01757d](https://github.com/portel-dev/photon/commit/f01757d18ccbd2a9d4bf493ea7e704868d18e29f))
* Add image zoom and fix mermaid inline buttons ([1b58f14](https://github.com/portel-dev/photon/commit/1b58f143d6b76d8916451be2b235c0a46bf03197))
* Add implicit CLI mode for sleeker interface ([3c3e4ca](https://github.com/portel-dev/photon/commit/3c3e4ca5b467e6123a5fd4d8b4a6f1dba21111cf))
* Add inline editing for method descriptions and icons ([6f7387f](https://github.com/portel-dev/photon/commit/6f7387f117b3d4a2f1527c770869a9251a75db87))
* Add inline editing for photon description and icon ([807f298](https://github.com/portel-dev/photon/commit/807f29815cb802f438aabf5ab8c3278a003e663b))
* add inline progress animation for CLI ([10b63e5](https://github.com/portel-dev/photon/commit/10b63e54633eb250c35f637c60c4d28042643937))
* add inline progress bar with spinner animation ([09540f7](https://github.com/portel-dev/photon/commit/09540f7c03cff302b41c7132cc774bbc70a72921))
* add input validation to critical paths ([18f0eb7](https://github.com/portel-dev/photon/commit/18f0eb73ac6257c6fc1afdd4b2c013e0115d9563))
* Add interactive UI pattern with Promise-based invokePhotonMethod ([1e3b996](https://github.com/portel-dev/photon/commit/1e3b9967034fa2277d3085bec916edd1826e95e8))
* Add interface testing modes (CLI, MCP) to test runner ([9d24e8e](https://github.com/portel-dev/photon/commit/9d24e8e77c4ba2e26241f689cc95624a6a6d881c))
* Add JSON input support for complex array/object parameters ([c7fcd81](https://github.com/portel-dev/photon/commit/c7fcd8112e010f419f8aa8431de745a08342936b))
* Add keyboard shortcuts to BEAM UI ([ab7156f](https://github.com/portel-dev/photon/commit/ab7156f288dd9c50156343272f427bd7db44f9fb))
* Add light/dark theme support and App vs Tool sidebar organization ([c232b51](https://github.com/portel-dev/photon/commit/c232b5172dde8c18146a843edc4c9d237e847a3c))
* Add LocalServ for zero-dependency local development ([bcc53e7](https://github.com/portel-dev/photon/commit/bcc53e7fec36be54d3ab4dd7488df4fa2d8ba39c))
* Add maker actions to Beam UI ([3c1b548](https://github.com/portel-dev/photon/commit/3c1b5483d2a5303684b7eb59df4f82bf6dbb52e1))
* Add marketplace filter pills to display and filter by source ([d1c80d2](https://github.com/portel-dev/photon/commit/d1c80d20bc8f71b261a2f7b3f7729875e61af933))
* Add marketplace integration and empty state UI in BEAM ([3cfe7c4](https://github.com/portel-dev/photon/commit/3cfe7c40b4e94df2b82cd15278a6975250c4e8d5))
* Add MCP Apps ui:// scheme support for UI resources ([3a295e2](https://github.com/portel-dev/photon/commit/3a295e2bd57b241b6ea0546f8449e1b385a6eafb))
* Add MCP client service for LitElement UI ([097e9ff](https://github.com/portel-dev/photon/commit/097e9ff2a6a1cc889cd7a3f82b5c9ba68c1c4847))
* Add MCP elicitation support for SDK 1.25 ([8de8a82](https://github.com/portel-dev/photon/commit/8de8a82069f5d27d3d97fe423f39914c6da55000))
* Add MCP prompts and resources viewer UI ([93be7b4](https://github.com/portel-dev/photon/commit/93be7b405022a225564ee5b31f5fc7dd74af58b0))
* add MCP protocol client for calling external MCPs from Photons ([cf66a0f](https://github.com/portel-dev/photon/commit/cf66a0fdd65cd4bff703d6749d254cf2a3d6356d))
* Add MCP protocol support over WebSocket for Beam UI ([3a02a69](https://github.com/portel-dev/photon/commit/3a02a6971e7da679fcf140257bd1cfd2100999a5))
* add MCP resource serving for Photon assets ([7b5de9a](https://github.com/portel-dev/photon/commit/7b5de9ae618440722098acc4f22a60ab16c12b5e))
* Add MCP Streamable HTTP transport for standard clients ([0b25c5a](https://github.com/portel-dev/photon/commit/0b25c5a87ee95574601851cf97732a3b690fab76))
* Add MCP-based configuration for unconfigured photons ([f2d53bc](https://github.com/portel-dev/photon/commit/f2d53bcc0d867dc99bd977295a007e939fddeec4))
* Add MCP-style postMessage bridge for portable HTML UIs ([0a2244a](https://github.com/portel-dev/photon/commit/0a2244a87450d398dd317bc168fdc38b8e6cac3a))
* add Mermaid diagram generation for Photons ([d63c158](https://github.com/portel-dev/photon/commit/d63c158fbb0dbe09a920305b6cb558d4756fae2b))
* Add Mermaid diagram rendering in Beam UI ([a33b91f](https://github.com/portel-dev/photon/commit/a33b91fa85aa656a00cc4e1a4c89f21dc786f7b6))
* add method-level [@ui](https://github.com/ui) linking after auto-discovery ([9993b8f](https://github.com/portel-dev/photon/commit/9993b8fe69cc5da6c7a1c57d15a2c6b0f4deddd8))
* Add notification/toast support to BEAM ([efcb8c2](https://github.com/portel-dev/photon/commit/efcb8c28dfd11ba177e6b4c372c15f4a1cb34d94))
* Add OAuth elicitation support to BEAM ([ed592d3](https://github.com/portel-dev/photon/commit/ed592d30cbd8cfa2274d5efa95ad1b8bf07535ad))
* Add OpenAPI 3.1 spec generation for Beam UI ([f25d1af](https://github.com/portel-dev/photon/commit/f25d1afcc86c5eaf6476cb85a3ad8eced6493d64))
* Add output filtering to BEAM UI ([a84cd3a](https://github.com/portel-dev/photon/commit/a84cd3a8530c21cbd5fa6c19fb5288899511966a))
* Add Photon Design System based on Material Design 3 + Apple HIG ([465e140](https://github.com/portel-dev/photon/commit/465e140b43115e4e50a6b9da4a544cc700c8cb2c))
* Add photon reload and remove functionality in Beam UI ([315748a](https://github.com/portel-dev/photon/commit/315748a6221560389b40ffb439987fb60be3710e))
* Add photon test runner for CLI and BEAM ([439e9c1](https://github.com/portel-dev/photon/commit/439e9c1bb278462f2c424e8be3a5d235af9cdbf9))
* Add PhotonBridge for unified custom UI communication ([fb99db6](https://github.com/portel-dev/photon/commit/fb99db60ee3624eabfcd3294179588f6fe9c165e))
* Add platform compatibility layer for MCP Apps, ChatGPT, and Claude ([a42e03b](https://github.com/portel-dev/photon/commit/a42e03bab45d8a634c04a92e2aeed5a772f6177b))
* add playground command for interactive multi-photon UI ([a8d217a](https://github.com/portel-dev/photon/commit/a8d217aea85352929023b39286dbd6cc1bed0a0d))
* add playground for interactive MCP Apps testing ([135ffce](https://github.com/portel-dev/photon/commit/135ffce363c3810fd1f138b9db88e8312474ccc2))
* Add real-time board updates via push notifications ([28aa07f](https://github.com/portel-dev/photon/commit/28aa07fe47dc51a23f8d330f05190b23edce1902))
* Add repository button and unified button styling in marketplace ([f8eb00c](https://github.com/portel-dev/photon/commit/f8eb00cf9e6517957b35ca7b03e92500cef1c0ec))
* Add responsive design for mobile devices ([c7e66a7](https://github.com/portel-dev/photon/commit/c7e66a7e5b7eed2495b1322c05bd4bfcec695eb7))
* Add result viewer modal and mermaid diagram controls ([01ed1ad](https://github.com/portel-dev/photon/commit/01ed1ad8eb6d602dde053767fafc5e96714c8dbd))
* Add rich select with filters, search, and quantity controls ([c025763](https://github.com/portel-dev/photon/commit/c02576315e4a026d4a578991a3ec222652cacf3c))
* Add SEP-1865 MCP Apps compatibility for UI templates ([0364897](https://github.com/portel-dev/photon/commit/03648971c1213d6916de8b3ebbfde6bf477e78b5))
* Add Serum - a collection of powerful prompt templates ([4913596](https://github.com/portel-dev/photon/commit/4913596da52996d79c2cb8bb69705cb15fadf5b9))
* Add SERV multi-tenant OAuth 2.1 authentication system ([17891a6](https://github.com/portel-dev/photon/commit/17891a65b8f16c8f585b24ecb07a1f89cc2baa3b))
* Add SERV OAuth runtime integration and serv command ([026b53c](https://github.com/portel-dev/photon/commit/026b53cd00045dab55fd7a02ff5c4162340a1306))
* add serve command with auto port detection ([7da3405](https://github.com/portel-dev/photon/commit/7da34053f96439e02b6305e454e11e14278ea2ad))
* Add share result link functionality ([02383bc](https://github.com/portel-dev/photon/commit/02383bc7080d3a585121172b7d9cfbb9116dcb45))
* Add smart form inputs based on schema ([156025c](https://github.com/portel-dev/photon/commit/156025c56b6ca3b2aba9f918e18c93c13b401892))
* Add Smart Rendering System for BEAM UI ([6087456](https://github.com/portel-dev/photon/commit/60874566c15d952eaf49b5c3f394b04601554f15))
* add SSE transport support for MCP server ([c1d2fbb](https://github.com/portel-dev/photon/commit/c1d2fbb2e30be9529136d45a7fb4bfc5e73000b6))
* add stateful workflow CLI commands ([3411d45](https://github.com/portel-dev/photon/commit/3411d4523d84562635252a0bff1a332abc4a0a3e))
* Add support for [@icon](https://github.com/icon) and [@internal](https://github.com/internal) docblock tags ([491e078](https://github.com/portel-dev/photon/commit/491e0782af9e9f957be6f49d5dbac916b994ca38))
* Add Swagger-style schema preview for complex JSON parameters ([ce811f8](https://github.com/portel-dev/photon/commit/ce811f85c4487d973b94a9db8ee075dc20433f69))
* Add test coverage reporting with c8 ([2039f9a](https://github.com/portel-dev/photon/commit/2039f9affe2e11cff505e7d4def1522cfb165e75))
* Add testing utilities with mocking and lifecycle hooks ([3e35750](https://github.com/portel-dev/photon/commit/3e3575082054610901ab5baf94c86dfa15cae0c2))
* Add tests and documentation for daemon docblock tags ([fdc816b](https://github.com/portel-dev/photon/commit/fdc816b659cedf2ac2a0021d0cb9b1a9b3a8e891))
* Add theme-aware syntax highlighting and mermaid diagrams ([11cf7c5](https://github.com/portel-dev/photon/commit/11cf7c5500628d0efcd77b602481e9addfa82546))
* Add tunnel photon for remote access ([94d8535](https://github.com/portel-dev/photon/commit/94d85355a0320639ec61f8730fb3e21ec6c30acb))
* Add tunnel to bundled photons in Beam UI ([24e04dd](https://github.com/portel-dev/photon/commit/24e04ddad43f933c8ee3a693997e6ffea96b1fb5))
* Add ui:// E2E tests for MCP Apps SEP-1865 support ([ef81b49](https://github.com/portel-dev/photon/commit/ef81b4905e250415e416f00dc7e5f94472da9514))
* Add unified MCP execution layer for Beam UI ([e557949](https://github.com/portel-dev/photon/commit/e557949b22b83bdb3623aae1725eee4ee8679b01))
* Add watch mode for Beam UI frontend auto-rebuild ([308cf9b](https://github.com/portel-dev/photon/commit/308cf9b469fa000f2dceb168762b082db97dadbc))
* Add web-based elicitation and html format support ([d335781](https://github.com/portel-dev/photon/commit/d335781df7d9a292c8ed82390471f03232916ce7))
* Add zoom, pan, and close controls to fullscreen viewers ([4866ede](https://github.com/portel-dev/photon/commit/4866eded2fcc93feb3c3cbdd7b0992d7c0cd1964))
* align custom UI output with MCP Apps ext-apps spec ([11e58da](https://github.com/portel-dev/photon/commit/11e58da2bea65cca518f51f57293528f39ab77ff))
* align playground streaming with MCP progress notifications ([d4ac1a6](https://github.com/portel-dev/photon/commit/d4ac1a6de318a106e210098b554e6a4103c8a97c))
* align theme communication with MCP Apps standard ([32679f6](https://github.com/portel-dev/photon/commit/32679f6eb292ae2b8343bd38e91b43cd1024c3e7))
* App-first navigation with main() convention ([10f0e14](https://github.com/portel-dev/photon/commit/10f0e14810a62241827dbabc9dccb540cad827cf))
* Apps use full panel without Execute/Data tabs ([dc9d594](https://github.com/portel-dev/photon/commit/dc9d59486dd79351c4da6a0b4796ad5c85793f91))
* auto-configure MCP dependencies during photon add ([f34ba02](https://github.com/portel-dev/photon/commit/f34ba02693c5386a1e80e4f6c96d6e4c42c218f1))
* Auto-detect @portel/photon-core import and include as dependency ([460ae69](https://github.com/portel-dev/photon/commit/460ae6990053769cd51ac311c5c92a4f2ed68040))
* auto-inject [@mcp](https://github.com/mcp) declared dependencies into Photon instances ([2f96412](https://github.com/portel-dev/photon/commit/2f96412eca83d2b9bbbc3b5e1ac596f4656ef0af))
* Auto-launch Custom UI for Apps with YouTube-style scroll layout ([fcfd762](https://github.com/portel-dev/photon/commit/fcfd76201376e01cb7bca61c2094ed23e294bd34))
* **beam:** Add auto-invoke for zero-param methods and HTML format rendering ([3d9f9a9](https://github.com/portel-dev/photon/commit/3d9f9a9023d80ed294f14be1a65c8d505446412f))
* **beam:** Add connection reliability with heartbeat and offline queue ([4c26343](https://github.com/portel-dev/photon/commit/4c26343ca250fc77d836eb2aaad9c946a2c07095))
* **beam:** Add minimal UI mode for HTML format methods ([0743d35](https://github.com/portel-dev/photon/commit/0743d35b1978097e373542744bcdd47c1e8246a5))
* **beam:** Add mobile responsiveness to remaining UI components ([bc8a3f0](https://github.com/portel-dev/photon/commit/bc8a3f04c8712ab5c5278beb1231dd5075f31e4e))
* **beam:** Add mobile responsiveness to UI components ([0524375](https://github.com/portel-dev/photon/commit/05243753176a199faa8b6d49fb9980ac44fb4394))
* **beam:** Add progress bar for async generator methods ([5ea0873](https://github.com/portel-dev/photon/commit/5ea08731111b15b3038a69b8b84647c557e5ce0f))
* **beam:** Add real-time emit types and elicitation support ([16e3ec5](https://github.com/portel-dev/photon/commit/16e3ec5a0a57625de8d079f27b191603c70deac4))
* **beam:** Add responsive action toolbar for desktop and mobile ([f83966c](https://github.com/portel-dev/photon/commit/f83966c5bcbac78a9e15aef9054be5d23f7401a7))
* **beam:** Add support for static methods in photons ([c693162](https://github.com/portel-dev/photon/commit/c69316290aa975bedd41d83caf992e9c92fe49d3))
* **beam:** Add syntax highlighting to View Source modal ([e0cf519](https://github.com/portel-dev/photon/commit/e0cf51971b955c11587d706767217b5cc8940a33))
* **beam:** Improve activity log UX with verbose mode and status indicator ([136adca](https://github.com/portel-dev/photon/commit/136adcaabe0d820d3203ffc1ffe6199020a0d153))
* Complete LitElement frontend with toast notifications, loading states, and error recovery ([41b6d48](https://github.com/portel-dev/photon/commit/41b6d48bd4057b882a2aefcd2f9efc3a7b84d645))
* Constrain file browser to photon's workdir ([51b4a16](https://github.com/portel-dev/photon/commit/51b4a16904936879057f92e566fbd77d02e50a7c))
* create marketplace photon + backend data enrichment ([c1242b8](https://github.com/portel-dev/photon/commit/c1242b89f7c9ac6df0ffada7727614cb687d9801))
* diagnostics view, test runner UI, and maker workflow feedback ([5a2f759](https://github.com/portel-dev/photon/commit/5a2f759c90a9d072cdb16480df2b578c5e697d90))
* Display supported marketplace formats as a neat table ([f69f5cd](https://github.com/portel-dev/photon/commit/f69f5cd0341fec00e857a8448108cac24fe1372e))
* distinguish installed vs available photons in marketplace ([39963a7](https://github.com/portel-dev/photon/commit/39963a7c34e87fd57e13fbcbefdc3f0599774b39))
* Enable [@mcp](https://github.com/mcp) dependency injection via protocol ([d5f075c](https://github.com/portel-dev/photon/commit/d5f075cac25ec5b8839ccf83ad1861367f076422))
* Enable static method execution in PhotonLoader ([9c1d3bb](https://github.com/portel-dev/photon/commit/9c1d3bbf34e7b2d9a1bb9b0e510bf10d12ebfaca))
* enhance maker wizard with description, icon, methods, and npm dependency validation ([e157f4d](https://github.com/portel-dev/photon/commit/e157f4d6684fae99004f3826d748732702219a07))
* enhance validation with type guards and assertions ([f86f8c9](https://github.com/portel-dev/photon/commit/f86f8c93d94cde36838ff01406adac23308b9260))
* Enhanced window.mcp API for ChatGPT Apps SDK parity ([1ebfc31](https://github.com/portel-dev/photon/commit/1ebfc314742b0d19a9be075f0d77f87291da53d9))
* **error-handling:** improve error handling across the codebase ([a4fdaaf](https://github.com/portel-dev/photon/commit/a4fdaaff53fd8d4c15aa7e0ec0ebc349ec72fe55))
* Expose daemon features as MCP tools ([b94255c](https://github.com/portel-dev/photon/commit/b94255c61888e3d3e57589732a6ec2a96bfc7302))
* Hide form when custom UI handles all interaction ([e088cf4](https://github.com/portel-dev/photon/commit/e088cf45096fe5b921e5306967c632d0d985c4ce))
* hide internal photons from sidebar, show welcome dashboard on first run ([6bbabc9](https://github.com/portel-dev/photon/commit/6bbabc9a92f330cad847359f6840b9df11d05b47))
* Implement Auto-UI system with progress indicators and component rendering ([901e0cd](https://github.com/portel-dev/photon/commit/901e0cdfa47a117cf6d2ca90abd2fe731087dae7))
* Implement ChatGPT SDK methods and add documentation ([bbc2f7d](https://github.com/portel-dev/photon/commit/bbc2f7df692bdeea1b0a2caf18cffb66b9d2f67d))
* Implement Custom UI rendering and asset distribution system ([453f81f](https://github.com/portel-dev/photon/commit/453f81fa9c86e04c733d92029b98e7b5d401ea49))
* implement MCP Apps standard compliance (7 features) ([faaba97](https://github.com/portel-dev/photon/commit/faaba971cc3b2072d3435f0809c4c177d94e488d))
* Implement missing Beam UI features from pre-Lit version ([8b8f12d](https://github.com/portel-dev/photon/commit/8b8f12daea7c8336e036ddb5715124d09c7bd4e6))
* Implement single global Photon daemon with event buffer ([2e12145](https://github.com/portel-dev/photon/commit/2e12145e556a04968b16e0f70060d9eaf1bc8c0f))
* implement streaming progress support in runtime and playground ([2b4aad8](https://github.com/portel-dev/photon/commit/2b4aad879d90b7d5a113afaf57a33cfdbb522b98))
* implement type-based constructor injection in PhotonLoader ([749f051](https://github.com/portel-dev/photon/commit/749f0510282b851c1ac1069d0ad02ac5412ecc27))
* Implement workspace-centric design for BEAM UI ([90315fe](https://github.com/portel-dev/photon/commit/90315fee43610ce3b9663207a0ffbb1ea7bd10c4))
* Improve "Ready to go" screen with stats and quick actions ([7546722](https://github.com/portel-dev/photon/commit/7546722ac45fcf89345b33cbe07b325c1f377680))
* Improve beam UI form field intelligence ([e1a1cd2](https://github.com/portel-dev/photon/commit/e1a1cd2e4b3f3babba6e08a9ce0faa323ad6b79c))
* Improve beam UI form field rendering ([55293d5](https://github.com/portel-dev/photon/commit/55293d5c17881f1fdc0c14420e61199613cbf802))
* Improve config form with defaults and boolean toggle ([43f34d3](https://github.com/portel-dev/photon/commit/43f34d3d4111fc412a0d73fba51e4fc0cb9cf263))
* Improve onboarding UX and make BEAM the default command ([893a891](https://github.com/portel-dev/photon/commit/893a891c608fb68dc195c60fccc84a39e4d02aab))
* Improve photon display with header and uniform method cards ([f4b5fe1](https://github.com/portel-dev/photon/commit/f4b5fe1a9c2f7aa8e42d8309aa9d1390372df488))
* Improve table rendering for [@format](https://github.com/format) table annotation ([af39a21](https://github.com/portel-dev/photon/commit/af39a2133fb056a22b2a43468620cb0f769097d4))
* improve workflow CLI messaging ([4aeab05](https://github.com/portel-dev/photon/commit/4aeab05d5feb7ac7a953cbb933ac00284527e253))
* Include MCP prompt templates in methods list ([2fb7dd5](https://github.com/portel-dev/photon/commit/2fb7dd5f47e96e15f772abb27a713ecb5be7a72a))
* Include public IP as password in tunnel result for localtunnel ([e21ab5e](https://github.com/portel-dev/photon/commit/e21ab5e5ad218530c50859d1a3ec694743339b0c))
* Include UI metadata in MCP tools/call response ([48a64bb](https://github.com/portel-dev/photon/commit/48a64bb01f7c095dc8382d96073f529ce793d58a))
* integrate implicit stateful execution into tool execution ([c7cd495](https://github.com/portel-dev/photon/commit/c7cd495eaeb353b2dfb0319adc69ff3883cc708f))
* integrate marked.js for markdown rendering and implement a glassmorphism-inspired UI refresh with new CSS variables and component styles. ([89b36ef](https://github.com/portel-dev/photon/commit/89b36efd7010b5d2f4913ee9ff7f7223c262db7a))
* integrate mcp-servers.json config with PhotonLoader ([bdac9ea](https://github.com/portel-dev/photon/commit/bdac9ea5ecd7726c81c06301dcc009418c4497e6))
* Introduce Beam UI frontend with LitElement components and a dedicated build system. ([94867c7](https://github.com/portel-dev/photon/commit/94867c7eb6244e6f83695da4a68f7b84ab5b300c))
* Introduce code diagram generation for TypeScript/JavaScript files and enhance UI styling for activity log and file picker components. ([3c06199](https://github.com/portel-dev/photon/commit/3c06199ea8dcabdfd1cf53f49a563de4694bb850))
* MCP server starts daemon for [@stateful](https://github.com/stateful) photons ([c2f7a60](https://github.com/portel-dev/photon/commit/c2f7a60c70c387f59c8cbf7752e230020311167d))
* Move search bar to home view ([d366759](https://github.com/portel-dev/photon/commit/d3667591364afe1019512f5b2c03e1cab5fa7551))
* move test runner to action toolbar and add cross-photon test runner in diagnostics ([fdbf9d6](https://github.com/portel-dev/photon/commit/fdbf9d62561a3a8c97373bc19328a17b9fbb9915))
* Organize sidebar into three sections with unconfigured indicator ([2517cd9](https://github.com/portel-dev/photon/commit/2517cd939fa75dd74dec1f650cef0149ccc5d786))
* photon detail header, enhanced welcome, MCP config export, per-field config editing ([5c1ed6f](https://github.com/portel-dev/photon/commit/5c1ed6f48d7b7449c7a39970e9b08b8123d9830f))
* **playground:** merge form and auto-UI in UI tab ([bb4695c](https://github.com/portel-dev/photon/commit/bb4695c54abb445fa9e72e4794ec07ae74211d21))
* Redesign marketplace with source management and keyboard shortcuts ([2e4a987](https://github.com/portel-dev/photon/commit/2e4a9872d268a33be08dcb2fb26ef58984650244))
* Redesign playground with professional mobile-friendly UI ([ff9be10](https://github.com/portel-dev/photon/commit/ff9be1089a5ec3568436c015fd802a668cec8295))
* redesign playground with tabs, auto-execute, and syntax highlighting ([00d8204](https://github.com/portel-dev/photon/commit/00d82048e9436afd410ad4841b373c04b17def99))
* Redesign Serum with cohesive injection metaphor ([ec8bea5](https://github.com/portel-dev/photon/commit/ec8bea5801d51f8c130b724b6d5404253ab386e2))
* Refactor CLI commands by renaming `serve` to `sse`, `serv` to `serve`, introducing a new `host` command for deployment and preview, and updating documentation. ([8912d84](https://github.com/portel-dev/photon/commit/8912d8458307b9f223d1e9f83cb7f0039bebd972))
* Rename playground to beam and add configuration UI ([b983c8f](https://github.com/portel-dev/photon/commit/b983c8f3ada33dec8c557f98d177680edd19378e))
* Render single objects as vertical key-value table ([df5711d](https://github.com/portel-dev/photon/commit/df5711d70260bd9646afce1a48d24c6b1f573329))
* Reorganize help system - shortcuts in sidebar, per-photon help in settings ([39d37e1](https://github.com/portel-dev/photon/commit/39d37e19916c13e21c98965a58977422fe6ca4b5))
* Replace boolean dropdown with toggle switch in BEAM forms ([17f3f90](https://github.com/portel-dev/photon/commit/17f3f903dbeadd9b89614daa2ba97905f5ea1b1d))
* Replace WebSocket with SSE via MCP Streamable HTTP ([f051047](https://github.com/portel-dev/photon/commit/f051047feea33bae90b7a2ff7354ba71b868934f))
* Replace WebSocket with Streamable HTTP for Beam UI MCP client ([95fd5c6](https://github.com/portel-dev/photon/commit/95fd5c6467285f1475a532348fad8a7d39545be6))
* separate static vs instance methods in UI ([b0aa4db](https://github.com/portel-dev/photon/commit/b0aa4db5929640cf5f204a0ea36262249e49299c))
* serve photon help from generated markdown docs ([09142fd](https://github.com/portel-dev/photon/commit/09142fda00a14457ca971f8bdc280432ee7d7576))
* Show icon and internal status in sidebar and help modal ([1209371](https://github.com/portel-dev/photon/commit/1209371b83308e00c8e3799a919d611c3919bddb))
* show method names in photon info output ([1a43404](https://github.com/portel-dev/photon/commit/1a434041be651b7480adb20c1fc755f90b184254))
* sidebar enrichment with version, counts, and update badges ([61b7606](https://github.com/portel-dev/photon/commit/61b760684d882e7e2926e8e8a4a349f30edc3f2e))
* Support {[@hidden](https://github.com/hidden)} tag to exclude fields from UI forms ([0fa5e84](https://github.com/portel-dev/photon/commit/0fa5e849848ec8b4a25acc33b3c854ff060fa5f1))
* Support methods, prompts, and resources in Maker ([968fe8b](https://github.com/portel-dev/photon/commit/968fe8bbc4d93fe5fe8704d4bc747e2f4e2cd0b3))
* surface workflow run ID to CLI and MCP users ([ec613dd](https://github.com/portel-dev/photon/commit/ec613dde8485973cc5ed5aeea47b9ec9f96ee2d5))
* throw MCPConfigurationError for missing MCP dependencies ([72ecced](https://github.com/portel-dev/photon/commit/72ecced9c0cd7b2d459f3bd92d88bc2f0365c3ac))
* Unify config to ~/.photon/config.json ([d34ade0](https://github.com/portel-dev/photon/commit/d34ade0aae396a5b54817f78a22da8e08281f630))
* Update demo photon to use io helper API ([647a0cd](https://github.com/portel-dev/photon/commit/647a0cda45e15047754a5254e1f6c4da731c970f))
* Update light theme to Saledash-inspired Slate palette ([b820af4](https://github.com/portel-dev/photon/commit/b820af4342365c0f751db93226cb11bb0bc67d56)), closes [#f1f5f9](https://github.com/portel-dev/photon/issues/f1f5f9) [#fafbfc](https://github.com/portel-dev/photon/issues/fafbfc)
* Update marketplace modal hints to show all supported source types ([23f0bc1](https://github.com/portel-dev/photon/commit/23f0bc1006b0f203e3fcd949b4e1a8add6494bfa))
* update to photon-core 1.2.0 with ask/emit pattern ([20716da](https://github.com/portel-dev/photon/commit/20716da3e4c1f09bee53a59d1bbc9fe0183cc0a4))
* upgrade doc generation with feature badges and architecture diagrams ([d70d157](https://github.com/portel-dev/photon/commit/d70d157b7fe75ba07cd081910a50e4a49a2c26e9))
* Use MCP resources/read for UI template fetching ([8cecff9](https://github.com/portel-dev/photon/commit/8cecff9aed7f5811946e3364eff944430cb5d5e6))
* use method names as button labels and filter lifecycle methods in playground ([dcf5a44](https://github.com/portel-dev/photon/commit/dcf5a44ff034b9368dd68faad2c16cd0d87dff0b))
* use official MCP SDK with multi-transport support ([573501d](https://github.com/portel-dev/photon/commit/573501dbca0cf442ff1b5caeb26d7cd30bd79d0f))
* Use web UI for elicitations instead of native dialogs ([1b1babd](https://github.com/portel-dev/photon/commit/1b1babdcc997b3e368a64bb85e263b289c527841))
* Watch asset folder for hot reload in dev mode ([33d7379](https://github.com/portel-dev/photon/commit/33d7379d132a87538e685e9a5263435b4cbc574a))
* Watch bundled photon asset folders for hot reload in Beam ([b066df4](https://github.com/portel-dev/photon/commit/b066df426190b10666c7b3c19c26d030e99802fe))
* Wire up on-demand channel subscriptions ([3051e7f](https://github.com/portel-dev/photon/commit/3051e7f48b5b31df08f5e263aa618b28e2dad8fa))
* zero-config MCP startup with auto-install and elicitation ([4c2d3b1](https://github.com/portel-dev/photon/commit/4c2d3b1432f02c5593ed5473721b540400916337))

### Bug Fixes

* Add .js extension to ES module import in platform-compat ([2ff175b](https://github.com/portel-dev/photon/commit/2ff175b9605064c8ea427e1cc96c4c25b9566217))
* Add allow-modals to iframe sandbox for confirm() dialogs ([774232d](https://github.com/portel-dev/photon/commit/774232dd95e19382c59664db6c2370613ed09dbb))
* Add app-mode detection to selectMethodByName for hash navigation ([7b59010](https://github.com/portel-dev/photon/commit/7b5901005423936341d96684c2ba28219886ebf0))
* Add common CSS variable aliases for iframe theme compatibility ([caba201](https://github.com/portel-dev/photon/commit/caba20159675be465c2674eba6e1269fb68c4eb0))
* add error logging, fetch timeouts, and named constants for pre-commit warnings ([0ce4107](https://github.com/portel-dev/photon/commit/0ce410769e6bc21e5245ad8e7f83aabad77d7956))
* Add ES module __dirname support to BEAM for CLI tests ([e1aedbd](https://github.com/portel-dev/photon/commit/e1aedbde850a26dc4b3d5ae5dde85d4bf565b068))
* Add ESM-compatible __dirname and fix startup detection in E2E tests ([a4c66a3](https://github.com/portel-dev/photon/commit/a4c66a3ca45f0402b8c16b8283f6c3ce6d36c04d))
* Add fetch timeouts and fix pre-commit hook detection ([0a97aed](https://github.com/portel-dev/photon/commit/0a97aed66c17b918e4519910c602b51ec85b6815))
* Add form rendering support in BEAM elicitation modal ([4388198](https://github.com/portel-dev/photon/commit/4388198c7e87cc4cbf0eb1e7b95f3c3030ed8fe4))
* Add JSON syntax highlighting to Execute tab smart rendering ([7e52e86](https://github.com/portel-dev/photon/commit/7e52e8640c2041e194b354d2d3a5638c011d4ba2))
* Add missing renderMethodView function and fix dashboard caching ([6a627d0](https://github.com/portel-dev/photon/commit/6a627d053a60e342525d4f3857320767ab5faa3d))
* Add missing TypeScript types for cancel and elicitation messages ([fd76a9d](https://github.com/portel-dev/photon/commit/fd76a9d1b308763106a1f51e4cecb6ab5be4569f))
* Add photon:call-tool handler for custom UI templates ([080a9b5](https://github.com/portel-dev/photon/commit/080a9b5f0228218c8e628235a9a0262a1f4515c4))
* Add port fallback retry in startBeam for race conditions ([bc931c6](https://github.com/portel-dev/photon/commit/bc931c64f6060a78e94a7abbdfac83d99be9dea4))
* Add prepublish safeguard for file: dependencies ([edd1ddf](https://github.com/portel-dev/photon/commit/edd1ddf5c0d0422140588b9a1171d6bf58a450b0))
* Add settings menu to methods list view and help button ([962a9a9](https://github.com/portel-dev/photon/commit/962a9a9ceaee0234587e9e8065fd593826db9c1b))
* Add theme sync to custom UI apps (dashboard, etc.) ([47dcc83](https://github.com/portel-dev/photon/commit/47dcc8359648624a0dfc771011d1dfdb2ae93f36))
* Add WebSocket dependencies and imports for playground ([71b34b4](https://github.com/portel-dev/photon/commit/71b34b46ba13c81deccd511a4b2d0170f40df577))
* Address architectural anti-patterns from pre-commit hook ([45b15eb](https://github.com/portel-dev/photon/commit/45b15eb10506c0822380dc88a495328e11c389e4))
* Align activity panel with 300px sidebar width ([445c5c1](https://github.com/portel-dev/photon/commit/445c5c1dfdc616eb0280778203f8c19ba244510d))
* Align dropdown indicator in select fields ([a07ebaa](https://github.com/portel-dev/photon/commit/a07ebaade3444c05bbe46edda6d6d43ad8aa10d5))
* App-mode invoke and selection state management ([147140c](https://github.com/portel-dev/photon/commit/147140c9d7e340bf8541b36a5b712f6b070a7c5c))
* App-mode now fills full viewport height by hiding method header ([0a295cd](https://github.com/portel-dev/photon/commit/0a295cda52ab6313af7852abf797c33ed770a94f))
* Back button from App method returns to App view with methods visible ([4421ee5](https://github.com/portel-dev/photon/commit/4421ee59654e3fa79a2121f1637f29669cbed749))
* Back button navigation for App methods with Custom UI ([8730a42](https://github.com/portel-dev/photon/commit/8730a42d3c8a406918cf6382b686a3effb6b7c46))
* **beam:** Add no-cache headers for UI templates ([60b1bbe](https://github.com/portel-dev/photon/commit/60b1bbe1c61f80a8df7e2ea6010d6257d6404c9f))
* **beam:** Fix View Source to show code modal and update Remember icon ([f77beb0](https://github.com/portel-dev/photon/commit/f77beb005f65a378181bb75ff720b065e5a90fee))
* **beam:** Handle photon file deletion in hot-reload watcher ([780f693](https://github.com/portel-dev/photon/commit/780f693073221dfb805006a0bc1d1956ba57948d))
* **beam:** Pass photon path to frontend for View Source ([89abc33](https://github.com/portel-dev/photon/commit/89abc333b013e5c75cb146586bb89dcd2ce52af5))
* **beam:** Restore unconfigured photons in sidebar SETUP section ([19c44b3](https://github.com/portel-dev/photon/commit/19c44b3f88b80ef223677e9e15e8e8b0db229380))
* Clean up Add Marketplace modal formatting ([69174b4](https://github.com/portel-dev/photon/commit/69174b41e8fdbedc3a9f9a0b731c067ba62ffa38))
* Clean up beam startup output and prevent error spam ([a86d2ce](https://github.com/portel-dev/photon/commit/a86d2ce72c6647a95316c975639d197245fe1c5c))
* clean up preprocessArgs flag-value skipping logic ([2f42a04](https://github.com/portel-dev/photon/commit/2f42a04b6a4b7430723808c92bdcdb840de43051))
* Clear stale results when switching between methods ([cf41210](https://github.com/portel-dev/photon/commit/cf41210da9834a1331e55ee4c53d208680a3e1dd))
* Collapse expanded photons when search is cleared ([7cce82e](https://github.com/portel-dev/photon/commit/7cce82e967fab73a262fc903120e1a752413c63f))
* Correct elicitation and progress bar handling in playground ([f463854](https://github.com/portel-dev/photon/commit/f4638542670beaa6dd9533686a6904a146fb7f12))
* correct tool count assertion in server comprehensive test ([840f96e](https://github.com/portel-dev/photon/commit/840f96e24b12a5725e4b417d1d24b3255bfe6d4e))
* correct UI data injection variable name in playground ([b55f569](https://github.com/portel-dev/photon/commit/b55f5697250b8231dac579b5544317b37493fb4d))
* deduplicate prompt templates from tool count in sidebar ([f72265e](https://github.com/portel-dev/photon/commit/f72265e25f49d71d0cd9792eb7af75adcb487c0d))
* default version to 1.0.0 when not detected ([65696d1](https://github.com/portel-dev/photon/commit/65696d1057bf9705209f28d918bd68e3d303e066))
* Don't shut down daemon when channel subscribers are active ([060b847](https://github.com/portel-dev/photon/commit/060b8472fe70a5967a97ff8dd4bd6821ebc4fa55))
* Enable cross-client pub/sub notifications via daemon ([ac781c5](https://github.com/portel-dev/photon/commit/ac781c58d7a7c5c90b7a9d8bb9b5cb7223c8b579))
* Enable dynamic theme switching for embedded iframes ([847bace](https://github.com/portel-dev/photon/commit/847bace8c9ec262a025b68cee093b48d99305049))
* Enable layout hints by rebuilding photon-core ([0ab6a1a](https://github.com/portel-dev/photon/commit/0ab6a1adb6cd69f56a52541977bf547011c552fa))
* Exit cleanly when no ports available instead of hanging ([0e2aee4](https://github.com/portel-dev/photon/commit/0e2aee49bb05fd6a6a5891a2591c2f012239cc7a))
* extract ProgressRenderer and use async file access ([1b30d77](https://github.com/portel-dev/photon/commit/1b30d774b01000077c28fac74a0146b65a8ae546))
* File browser now uses BEAM's working directory for filesystem photon ([fb84874](https://github.com/portel-dev/photon/commit/fb84874be8512b46a7160a64201e6a0518f22e00))
* Fix button label formatting in BEAM UI ([19220ea](https://github.com/portel-dev/photon/commit/19220ea45af1e43b6b05d18f44f5bd18ce8643c1))
* Fix playground form button label update ([0306fa3](https://github.com/portel-dev/photon/commit/0306fa33e1c2db3e3aeb4b6b1e500d5fff41cd1e))
* Forward board-update emits from MCP calls to WebSocket clients ([2ad09a2](https://github.com/portel-dev/photon/commit/2ad09a24a470242267884671b32760606e2eeb54))
* Forward board-update emits from Streamable HTTP MCP calls ([8a4b553](https://github.com/portel-dev/photon/commit/8a4b55302f97a865666546dc313d02b347de307a))
* Forward events to iframes in nested shadow DOMs ([8fa29d5](https://github.com/portel-dev/photon/commit/8fa29d5241a45f28575f6fc1ce9a0d32aeb0d643))
* Forward MCP tool channel events to global daemon for real-time sync ([3539147](https://github.com/portel-dev/photon/commit/353914768e0619c792fbac6a336207877025eddb))
* Give custom UI iframes more height using viewport calc ([8392815](https://github.com/portel-dev/photon/commit/8392815a8a30ee591b0fef918aff3c061aaa0aa2))
* Handle anyOf schemas in BEAM form rendering ([d11ea72](https://github.com/portel-dev/photon/commit/d11ea72d690fd99b7291551db701b63fd3a0fb27))
* Handle null data-content element in photon view result rendering ([fc22b5f](https://github.com/portel-dev/photon/commit/fc22b5f34f18b339140730fc7183bc0484820bd1))
* Handle property/method name collisions in tool execution ([09a2d06](https://github.com/portel-dev/photon/commit/09a2d065be3e759dacc1d21c95a55921ea4d8a38))
* Hide BEAM filter for custom UI, add priority filter to dashboard ([2f14648](https://github.com/portel-dev/photon/commit/2f1464887b4410423582d9e8556f350dfd88b7a3))
* hide iframe until loaded to prevent white flash ([387b7e5](https://github.com/portel-dev/photon/commit/387b7e558b34dc907946ad33a72bed4a2d606644))
* Hide progress dialog for interactive UI invocations ([53a90ce](https://github.com/portel-dev/photon/commit/53a90ce20a4a30de179aca7b7074d106bb702f72))
* Hide Run button for auto-executing methods ([b25cc0e](https://github.com/portel-dev/photon/commit/b25cc0e838fe47ad07324c97c293cd072e25f856))
* Ignore data files in hot reload watcher ([2ac8b63](https://github.com/portel-dev/photon/commit/2ac8b63ae7de1d12557e22061866b983ebf96308))
* Improve 'method not found' error to show available methods ([b30c16c](https://github.com/portel-dev/photon/commit/b30c16ce72406d28557f83c672e1b42bd1dfb33f))
* Improve BEAM test reliability with shared context ([b01a9ad](https://github.com/portel-dev/photon/commit/b01a9ad9e634107edb2fb9bc0788628221fdb58c))
* Improve BEAM UI rendering for lists and JSON display ([eade8cb](https://github.com/portel-dev/photon/commit/eade8cb639803b4489aef4534da2ba4236a3c052))
* Improve Data tab styling in photon view ([75c72bf](https://github.com/portel-dev/photon/commit/75c72bf41465306362a6a3ec7daf46157972ece1))
* Improve fullscreen viewer behavior ([fb25472](https://github.com/portel-dev/photon/commit/fb2547295335dc6ba25dccbbf614a927ee38309d))
* Improve markdown rendering with blockquotes, code, and line breaks ([cb86620](https://github.com/portel-dev/photon/commit/cb8662015795d027f41ef3ed3626531671913d91))
* Improve markdown rendering with YAML front matter and link styles ([0416e49](https://github.com/portel-dev/photon/commit/0416e49a29152299d04e4c30411af4615ab4bc1e)), closes [#64b5f6](https://github.com/portel-dev/photon/issues/64b5f6)
* Improve mermaid fullscreen and view switching ([b7b7f8c](https://github.com/portel-dev/photon/commit/b7b7f8c59592fd2bd595292e00aa690565566bb0))
* Improve public IP detection with multiple fallback services ([bdcdf70](https://github.com/portel-dev/photon/commit/bdcdf70eccb4f2364d35a11b056ea9f5b1ffa3f8))
* Improve tunnel photon and URL display in results ([ce50145](https://github.com/portel-dev/photon/commit/ce50145fde2d34715b3c1a14c8b2fa84bccfcb14))
* Improve unconfigured photon detection and display ([2f6db0b](https://github.com/portel-dev/photon/commit/2f6db0b0c3876572854034a8e9450bfff6755576))
* Include outputFormat and layoutHints in hot reload schema ([1fe6293](https://github.com/portel-dev/photon/commit/1fe629333314d963a8778b68232fbbcdd927604b))
* label wizard submit button as "Create" instead of "Execute" ([624bbdc](https://github.com/portel-dev/photon/commit/624bbdc67e03f6964715ae7dd5e00e48a0fef0ed))
* Lowercase first char of test names for camelCase display ([9aaad02](https://github.com/portel-dev/photon/commit/9aaad02e36babda100ff26d321a12ab92e68f778))
* make wizard name a direct parameter instead of elicitation step ([9b45d3e](https://github.com/portel-dev/photon/commit/9b45d3eff09b92d9530b86e9d20309cd197bdf1d))
* Mermaid fullscreen close button not working ([c1e2079](https://github.com/portel-dev/photon/commit/c1e2079abdf33108680f0cd5c7b1816e5fc8a9a0))
* Mermaid fullscreen now uses full viewport space ([8a0dec5](https://github.com/portel-dev/photon/commit/8a0dec5de6441746c20b0e24fe176215b5ca558a))
* Move config form from sidebar dropdown to main content area ([1d369df](https://github.com/portel-dev/photon/commit/1d369dfd0593a330caf7a72d5313f5eb8a26dc82))
* Only show filter input for array results ([2dbbd30](https://github.com/portel-dev/photon/commit/2dbbd307d1caa80dc098e87825ff5f808464cf06))
* parse MCP result envelope before forwarding to custom UI iframes ([53e0528](https://github.com/portel-dev/photon/commit/53e0528a2ffd86d34f9c98842336f1707ba50baf))
* Preserve existing owner field when syncing marketplace manifest ([dc0b614](https://github.com/portel-dev/photon/commit/dc0b614565a2000783135213871a83a01bd1cfb0))
* Prevent input overflow in marketplace Add Repository modal ([8d3514b](https://github.com/portel-dev/photon/commit/8d3514b4156c627049075fd24e21d874b065aba5))
* Prevent keyboard shortcuts from triggering while typing in inputs ([f6cca0c](https://github.com/portel-dev/photon/commit/f6cca0c9db66c4ca61c0fa0798091bde7735071e))
* Prevent method cards from stretching to equal row heights ([79746ca](https://github.com/portel-dev/photon/commit/79746ca5828f26d72d786fb8bbddbf2f589794fc))
* Progress shows as centered overlay and clears on result ([0f38b3c](https://github.com/portel-dev/photon/commit/0f38b3cc03410942d131f096f507b062424a4ec9))
* Properly render mermaid diagrams in markdown results ([e04e75c](https://github.com/portel-dev/photon/commit/e04e75c0c6e6ad3405aa97e147e7f9df76d61332))
* Redesign light theme with warm editorial palette and fix CSS variable inheritance ([d5c3f90](https://github.com/portel-dev/photon/commit/d5c3f908f1160f7e0de38e5b1424068534c83f76))
* Refresh button reloads current photon only ([3e3ee78](https://github.com/portel-dev/photon/commit/3e3ee781aa02a27e106aff09d2a06c088d542e6b))
* Refresh iframes on hot reload for asset changes ([85fa5ae](https://github.com/portel-dev/photon/commit/85fa5ae86489a113e9d63dd44587a47568adbb4e))
* regenerate photon help doc when source is newer than cached .md ([63a01bf](https://github.com/portel-dev/photon/commit/63a01bfe8661a118ca0b4c182f343585a222f0b2))
* Remove [@state](https://github.com/state) from mermaid blocks to prevent infinite update loop ([7b65d41](https://github.com/portel-dev/photon/commit/7b65d41a3dfa049abc655388dcfdaad8d84bc5e8))
* Remove comment containing </script> that broke HTML parsing ([f304ea4](https://github.com/portel-dev/photon/commit/f304ea4138b0dee455c39add232ce2503b6e6efc))
* remove hardcoded error messages, support custom errors ([fd605dc](https://github.com/portel-dev/photon/commit/fd605dc2da675f9affe29539076050807333a52c))
* Remove hardcoded paths and improve cross-platform compatibility ([286ed6b](https://github.com/portel-dev/photon/commit/286ed6bced965e96ff56b2227c50937f0d26898e))
* Remove inline script from toggle switch to prevent syntax errors ([3b2e366](https://github.com/portel-dev/photon/commit/3b2e366cd53c1be643a4d7661c974c3d6b7cfbcd))
* Remove noisy success toasts for tool executions ([879a8df](https://github.com/portel-dev/photon/commit/879a8df7c0c2b968a7f9bed200f24dfe939131d1))
* Rename 'Raw JSON' tab to 'Data' for format agnosticism ([15c3101](https://github.com/portel-dev/photon/commit/15c310172c2ab313004347ee0f4ca85c691c4a54))
* Rename "Add Repository" to "Add Source" in marketplace modal ([697466b](https://github.com/portel-dev/photon/commit/697466b24885ff6baa0984062c3d1f0f1e20517f))
* rename reserved method name in schema-extractor test ([e0658b9](https://github.com/portel-dev/photon/commit/e0658b982a5a1d4121f7e11ef5f85af914a5bb5b))
* Rename sidebar sections and fix method data for configured photons ([c20b651](https://github.com/portel-dev/photon/commit/c20b651074f4362e0ae4c88cf1d9d6e692612649))
* replace __PHOTON_DATA__ injection with MCP bridge in playground ([a087b0e](https://github.com/portel-dev/photon/commit/a087b0edeec6002f9ce4ce141ffafab1d1e2ebe8))
* Replace redundant APP badge with method count for all photons ([cedb1fa](https://github.com/portel-dev/photon/commit/cedb1fa0cd18103c8f0c74c8845dde7a91f227a8))
* replace template literal renderer with char-by-char walker ([853731c](https://github.com/portel-dev/photon/commit/853731cfca18c1b63e765f3f04f3b8809f4e5c8f))
* Replace unsafe Function type with typed callback in MCPClientService ([c2c30fa](https://github.com/portel-dev/photon/commit/c2c30fa669e4492f6522401ffc9d2823b61ddc9a))
* Resolve formatting issues and unused variable warnings ([48edb95](https://github.com/portel-dev/photon/commit/48edb957a30f61acd3274e53ccd6ded25c336705))
* resolve marketplace Photon dependencies from ~/.photon ([adfb10f](https://github.com/portel-dev/photon/commit/adfb10f4fb5cd48245de552abff4bf42f4861431))
* resolve photon name in deploy commands like other commands ([77ca2d1](https://github.com/portel-dev/photon/commit/77ca2d1e1a57a4762b0ce1529c9547bf38c1c488))
* resolve pre-commit hook warnings ([9805627](https://github.com/portel-dev/photon/commit/980562782b8af058efe76846ff30c189eac36115))
* Resolve TypeScript errors in photon-config and result-viewer ([aadb0d6](https://github.com/portel-dev/photon/commit/aadb0d673a0d00d9f688cec95d301823d64ceffe))
* resolve working dir to absolute path, load static-only photons ([0ad22d4](https://github.com/portel-dev/photon/commit/0ad22d42e8cc8bd64e2c16a3461251feaa36d49d))
* restore UI preview and show determinate progress ([d7a5606](https://github.com/portel-dev/photon/commit/d7a5606a962398013ecaffa0003d52b34ca28592))
* restrict playground to dev mode only ([c2a5e90](https://github.com/portel-dev/photon/commit/c2a5e90e0745e4f0efdef3ef4560ba355099584a))
* restrict playground to dev mode only ([7a4095e](https://github.com/portel-dev/photon/commit/7a4095ea59887745b873f5ffcfc93b41ce8b487a))
* Return final result from tunnel.start instead of yielding ([4ca2874](https://github.com/portel-dev/photon/commit/4ca2874b1fd59ccd9e092864d7bcc1255fa1e494))
* Set PHOTON_NAME in MCP command for daemon pub/sub to work ([f70eb28](https://github.com/portel-dev/photon/commit/f70eb28240bd32c26bdf96da10b1f209a1852561))
* Show friendly message in settings when no configuration needed ([9aa06ad](https://github.com/portel-dev/photon/commit/9aa06add5735185dbb1743aeddf240a855f9615b))
* Show progress bar instead of spinner for determinate progress ([e9faa44](https://github.com/portel-dev/photon/commit/e9faa443244b19d9de31ff0af88848a1fdd0d0fc))
* sidebar missing prompt and resource counts ([eb968a3](https://github.com/portel-dev/photon/commit/eb968a37959c9eb91a8f9fdfe9d6cc8103f25e69))
* Smart download button adapts to content format ([57fd86a](https://github.com/portel-dev/photon/commit/57fd86a7dc55f41b8b44f2174ad66a43a6813b8d))
* Source viewer scroll and README image paths ([1ebf541](https://github.com/portel-dev/photon/commit/1ebf541f0a82e600a893d2b423416c580a5bca71))
* Standardize CLI error handling and exit codes ([effaf50](https://github.com/portel-dev/photon/commit/effaf50f1b7a887349df3a91baf1a9c0aa25741e))
* Strip 'test' prefix from test names in CLI output ([c73005e](https://github.com/portel-dev/photon/commit/c73005ecae4639b78783bf83217d17b9a667fbb7))
* Subscribe to all kanban board channels for real-time updates ([042e414](https://github.com/portel-dev/photon/commit/042e4148bade298160c5925eed15a56f6483266b))
* Subscribe to correct channel based on actual board name ([3033afd](https://github.com/portel-dev/photon/commit/3033afd265fcce387f2976b3e541ecab70a554af))
* Sync app iframe theme with BEAM theme changes ([9d84ab6](https://github.com/portel-dev/photon/commit/9d84ab6e454156abbe611ae26779237e0d4b94d4))
* Sync rendering files with photon-core ([14a46d5](https://github.com/portel-dev/photon/commit/14a46d541c22e0cee443b2ae64364db7c01a1b9a))
* Target all iframe types in app-mode CSS for full height ([12598f0](https://github.com/portel-dev/photon/commit/12598f0f2b17b77cf945ac63e71761e9b2512f97))
* Test suite compatibility fixes ([7cd4c98](https://github.com/portel-dev/photon/commit/7cd4c98588b730803d3a6f6523bbcf66a6f31a1b))
* UI layout improvements for activity bar and search spacing ([d6bdbf0](https://github.com/portel-dev/photon/commit/d6bdbf07822bda6ee86f4d486840c6b5c998f1eb))
* Update BEAM UI tests for workspace-centric design ([33e29c8](https://github.com/portel-dev/photon/commit/33e29c8fa10fd8752edf10bad0243d2b0b6981a0)), closes [#help-modal](https://github.com/portel-dev/photon/issues/help-modal)
* Update E2E tests with correct selectors and skip problematic tests ([2b46d90](https://github.com/portel-dev/photon/commit/2b46d9055e4df7e218b732e53a2006f54aaf981c))
* update moduleResolution to bundler for subpath export support ([04dfb59](https://github.com/portel-dev/photon/commit/04dfb5919fb0edff65a25ee57e6b4e7504c33fdc))
* Update photon-core to 2.1.1 for tilde expansion support ([b9d8f71](https://github.com/portel-dev/photon/commit/b9d8f713c5af7a44e71a5a6780c32f57fbbc6a5c))
* Update photon-core to 2.1.2 for tilde expansion and npm deps ([1936a8c](https://github.com/portel-dev/photon/commit/1936a8c874489822fdffc0d3e3de48222d8448ec))
* Use --dir= syntax in readme validation tests ([71e9499](https://github.com/portel-dev/photon/commit/71e9499f0b32f283cf3fe92035e7e03d2ff9f60d))
* Use "Add Marketplace" wording throughout marketplace UI ([ee9fc7f](https://github.com/portel-dev/photon/commit/ee9fc7f8dd7d9aa678a14f1c349e75c3e33486ae))
* Use consistent daemon name for MCP auto-subscription ([0a0928f](https://github.com/portel-dev/photon/commit/0a0928f72b338a71acd40f37e20b4bd581fcf32b))
* Use event delegation for mermaid fullscreen controls ([8e71f07](https://github.com/portel-dev/photon/commit/8e71f0793186ab8f9eeb234022b1f92c959de3c6))
* Use loader.executeTool for proper this.emit() support in playground ([ed85ba8](https://github.com/portel-dev/photon/commit/ed85ba8873057717b3fa4e91ca6bea23bfec170a))
* use npm registry for @portel/photon-core dependency ([ac6ab1c](https://github.com/portel-dev/photon/commit/ac6ab1cd015fbd5aaddbba8e5950b746badd02a0))
* Use PhotonLoader in playground for proper dependency management ([6fcb37a](https://github.com/portel-dev/photon/commit/6fcb37ac7afd3fb7aafbb1ec4f2a6d414783828e))
* Use PhotonLoader in SSE playground for consistent dependency handling ([e02846d](https://github.com/portel-dev/photon/commit/e02846d984349bb86b26f2ce4cecb5c910b4fec4))
* Use reloadFile() for proper hot reload in Beam UI ([28b4e65](https://github.com/portel-dev/photon/commit/28b4e651f3c41d43b50487f13046b166d7c7f266))
* Use subtle setup indicator for unconfigured photons in Beam UI ([f51ed2f](https://github.com/portel-dev/photon/commit/f51ed2f6b9856d18182e3d57b024c03ecb3b9544))
* Watch symlinked photon asset folders for hot reload ([57201fd](https://github.com/portel-dev/photon/commit/57201fd8f9e3747605ce1713716d917fe6d01efe))
* wizard yields use standard ask/emit protocol, CLI defaults to beam with flags ([ced69fb](https://github.com/portel-dev/photon/commit/ced69fbd157fc2398b866221db765f3970819854))
* Wrap HTML fragments in proper document structure for script execution ([98a5936](https://github.com/portel-dev/photon/commit/98a5936937f32d16b589ecc9128a790013b9da3c))

### Performance

* optimize Beam startup by deferring photon loading and parallelizing ([d510f9a](https://github.com/portel-dev/photon/commit/d510f9a55b8c8d3cbfc85c4a381cc870aa9c8ef5))

## [1.4.0](https://github.com/portel-dev/photon/compare/v1.3.0...v1.4.0) (2025-11-24)

### Features

* add content format support for CLI and MCP output ([477aae3](https://github.com/portel-dev/photon/commit/477aae3bc6b495bb787ac66b04f3312570780aef))
* add hash-based dependency cache validation ([6706ea2](https://github.com/portel-dev/photon/commit/6706ea27d9cbfccaf87406521166799a77d70fc6))
* add maker command namespace for marketplace creators ([774f6e6](https://github.com/portel-dev/photon/commit/774f6e6385adb9cd6845a8e259c1feaee8305d9b))
* add missing CLI commands and improve command discoverability ([5f85a47](https://github.com/portel-dev/photon/commit/5f85a47644239bdac80462b7d9d0b6a96872d928))
* add shared CLI output formatter for consistent table/tree formatting ([c5f81ee](https://github.com/portel-dev/photon/commit/c5f81eefb1ab5d9d79ca76c4624a64f618b78a82))
* add syntax highlighting for --json flag output ([a1fcc92](https://github.com/portel-dev/photon/commit/a1fcc92955570bd08e4cd0e61fb0a49aab39c59b))
* add update command and typo suggestions ([c060591](https://github.com/portel-dev/photon/commit/c060591d8e04f01a1218e4cce5395a4a069f8864))
* migrate to @portel/photon-core for shared functionality ([91451b6](https://github.com/portel-dev/photon/commit/91451b68b220dbafdb6fd0e555349aa1318bfc04))

### Bug Fixes

* add type definitions and fix outputFormat access ([8c741e7](https://github.com/portel-dev/photon/commit/8c741e77cc9e24a11a1675671c001353aa789bd1))
* address PR review feedback ([d926095](https://github.com/portel-dev/photon/commit/d92609588f8ccccb08032b282ac5228e3e054f52))
* remove call to nonexistent removeInstallMetadata method ([9251121](https://github.com/portel-dev/photon/commit/9251121582bbedf30e49688e11e75f1b6a2371e4))
* update test imports to use @portel/photon-core ([4a2efd3](https://github.com/portel-dev/photon/commit/4a2efd39db061bc729319c33cba587ff7304fd2b))

## [1.3.0](https://github.com/portel-dev/photon/compare/v1.2.0...v1.3.0) (2025-11-19)

### Features

* add [@format](https://github.com/format) tag system for structured output rendering ([b824088](https://github.com/portel-dev/photon/commit/b8240888c53308c25dd45c491a4ca529480a7f78))
* add {[@unique](https://github.com/unique)} constraint for array uniqueItems ([d643ed6](https://github.com/portel-dev/photon/commit/d643ed6732c48e28ae987531e1d4204481deaeb9))
* add advanced JSDoc constraints - example, multipleOf, deprecated, readOnly/writeOnly ([7194f17](https://github.com/portel-dev/photon/commit/7194f172bc65e53a868327f41256330468bde751))
* add beautified table rendering with borders and clean output ([502e9bb](https://github.com/portel-dev/photon/commit/502e9bb0108891a960cd4ea6758bf758977bb7f8))
* add CLI aliases to run photons as standalone commands ([c5de92b](https://github.com/portel-dev/photon/commit/c5de92b0e521b748a3e2007f708b3a649ec83979))
* add comprehensive CLI documentation and tests ([2d5ba17](https://github.com/portel-dev/photon/commit/2d5ba17760babde8d1a72736c83ee0c5c181025c))
* add comprehensive JSDoc constraint support ([ddd537f](https://github.com/portel-dev/photon/commit/ddd537ff082065eb337290379cb5cd1d09866f4e))
* add direct CLI invocation for photon methods ([81e4be4](https://github.com/portel-dev/photon/commit/81e4be4d299fc25768c3c82640a4ff54e5122bad))
* add JSDoc constraint tags {[@min](https://github.com/min)} and {[@max](https://github.com/max)} ([d76092c](https://github.com/portel-dev/photon/commit/d76092c65fcaf2dc75791cf83c21f5bbf88b44fa))
* extract readonly from TypeScript with JSDoc precedence ([5a0f1a1](https://github.com/portel-dev/photon/commit/5a0f1a101998279d233b3025a03e5e3fbae16a18))
* format CLI output for better readability ([de70721](https://github.com/portel-dev/photon/commit/de707212dd33af96726fe4b1c8c5bbcca84bb721))
* generate proper JSON Schema enum arrays for literal unions ([1718188](https://github.com/portel-dev/photon/commit/171818820f8711a92add5f1409c8f6a3c648372b))
* implement session management for daemon isolation ([bae22d6](https://github.com/portel-dev/photon/commit/bae22d6125cfcd5af210123fa4118409b26811cb))
* implement stateful photon daemon architecture ([783e1cc](https://github.com/portel-dev/photon/commit/783e1cc511e2601bbb8f5b57e54310a5d6579a83))
* improve CLI error messages with hints ([837d47e](https://github.com/portel-dev/photon/commit/837d47e4594c4b5cd86c21fc3361bccf6b2b03a3))
* improve CLI help to follow standard conventions ([76ba48e](https://github.com/portel-dev/photon/commit/76ba48efcad43db17d161b7fbfdabae52b6325fa))
* optimize anyOf schemas for mixed type unions ([3281f2f](https://github.com/portel-dev/photon/commit/3281f2f301c7c973b6b4675e24bc4d777536919e))

### Bug Fixes

* add type coercion for CLI arguments based on method signatures ([a2125e0](https://github.com/portel-dev/photon/commit/a2125e02b0d120656070b703370f81e702520eef))
* critical CLI bugs - exit codes and --help ([6ee6da7](https://github.com/portel-dev/photon/commit/6ee6da782fa680f83bb866753ee2280e65d464cb))
* daemon CLI pairing flow and exit behavior ([83a3233](https://github.com/portel-dev/photon/commit/83a3233f6a9147e9a150cbe36af5b2c97b3cab36))
* detect optional parameters from TypeScript signatures ([8481df6](https://github.com/portel-dev/photon/commit/8481df6580e152133dd92acf39b8bf1803b9ef5c))
* make CLI aliases truly cross-platform ([1e541c2](https://github.com/portel-dev/photon/commit/1e541c2e571c711cb18aaa18c9dfcc1056a7316d))
* preserve +/- prefix for relative adjustments in CLI arguments ([38edba4](https://github.com/portel-dev/photon/commit/38edba474f29c54fbbc3fa8c18949e6c2a06ebe4))
* properly format JSDoc constraint tags in generated documentation ([d3f07f4](https://github.com/portel-dev/photon/commit/d3f07f4012753fb2b384fa575b7959b8e2fd79fa))
* remove 'path.' prefix from MCP config default values ([2ab0d30](https://github.com/portel-dev/photon/commit/2ab0d30fa1153513a50e038945dc7855cad23505))
* remove stack traces from CLI error output ([c3bf1e2](https://github.com/portel-dev/photon/commit/c3bf1e2e5ee4e73a0eec157e7a0c927ddd1de82a))
* update tests for CLI changes ([3557c10](https://github.com/portel-dev/photon/commit/3557c10569bbef94f523cfef69bacd4553a9cbef))
* use absolute path for lg-remote credentials file ([76e2357](https://github.com/portel-dev/photon/commit/76e2357341c7e044405b0c527318150968ef9963))
* use import.meta.url instead of __dirname for ES modules ([ccabd24](https://github.com/portel-dev/photon/commit/ccabd24e13322a5f3e39ce5f761ed954aa895386))
* use PhotonLoader for CLI to share dependency cache with MCP ([f8246e3](https://github.com/portel-dev/photon/commit/f8246e3b94dcfd3e1714052dc6b480200dcd78eb))

## [Unreleased]

### Features

* **CLI Interface** - Every photon automatically becomes a CLI tool with beautiful formatted output
  - `photon cli <name>` - List all methods for a photon
  - `photon cli <name> <method> [args...]` - Call methods directly from command line
  - `--help` flag for photon-level and method-level help
  - `--json` flag for raw JSON output
  - Natural syntax with positional arguments
  - Proper exit codes (0 for success, 1 for error)

* **Format System** - Smart output formatting with 5 standard types
  - `@format primitive` - String, number, boolean values
  - `@format table` - Bordered tables for flat objects
  - `@format tree` - Hierarchical data with indentation
  - `@format list` - Bullet-pointed arrays
  - `@format none` - Void operations
  - Auto-detection when no @format tag provided

* **Beautified Output** - Professional CLI presentation
  - Unicode box-drawing characters for tables (┌─┬─┐)
  - Bullet points for lists
  - Indented trees for nested data
  - Clean, minimal output (no progress logs unless errors)

* **Stateful Daemon Architecture** - Long-running photon processes with IPC
  - Daemons automatically start when needed
  - Unix domain sockets for fast IPC
  - Shared state across multiple CLI calls
  - Daemon management commands

* **CLI Aliases** - Run photons as standalone commands (cross-platform)
  - Automatic alias creation for each photon
  - Direct invocation: `lg-remote volume 50`
  - Works on Windows, macOS, and Linux

* **Type Coercion** - Automatic argument type conversion
  - Strings → numbers/booleans based on method signature
  - Preserves +/- prefixes for relative adjustments
  - JSON parsing for complex types

### Bug Fixes

* **Exit codes** - CLI now returns proper exit codes for automation/CI/CD
* **--help flag** - Fixed to work at photon level (`photon cli <name> --help`)
* **Relative adjustments** - Preserve +/- prefix in CLI arguments (e.g., `volume +5`)
* **Error messages** - Extract and display user-friendly error messages
* **Daemon pairing** - Fixed CLI pairing flow and exit behavior
* **ES modules** - Use import.meta.url instead of __dirname

### Documentation

* **Comprehensive CLI docs** - Added CLI Interface section to README
  - Quick examples with real output
  - Format system explanation
  - CLI command reference
  - "One Codebase, Multiple Interfaces" philosophy
  - Context-aware error messages
  - Exit codes for automation
* **Updated roadmap** - Highlight MCP + CLI availability
* **Examples** - Real-world CLI usage examples

### Tests

* **CLI test suite** - 17 comprehensive tests for CLI functionality
  - Method listing and invocation
  - Format detection and rendering
  - Relative adjustments
  - Error handling and exit codes
  - Help flags
  - Type coercion
* All 106 tests passing across all suites

## [1.2.0] - 2025-11-11

### Features

* **Unified info command** - `photon info` now shows both installed AND available photons from marketplaces
  - `photon info` - Lists all installed photons with marketplace availability in tree structure
  - `photon info <name>` - Shows details for photon (installed or available)
  - Tree format clearly shows which marketplace offers what photons
  - Install status marked with ✓ for easy identification

* **Smart global detection** - Automatically detects and uses global photon installation
  - Uses `photon` command if installed globally (cross-platform)
  - Falls back to `npx @portel/photon` if not installed globally
  - No manual configuration needed

* **Smart --dev guidance** - Contextual recommendations based on photon origin
  - Marketplace photons: Run without --dev, suggests copying to customize
  - Modified marketplace photons: Run with --dev, warns about upgrade conflicts
  - Local/custom photons: Run with --dev for hot reload

### Bug Fixes

* **Static analysis** - Use PhotonDocExtractor for `info` command to avoid instantiation errors
  - No longer requires constructor parameters to view photon details
  - Works for any photon regardless of configuration requirements

* **Cross-platform compatibility** - Use `photon` command instead of full path
  - Generated MCP configs now use `"command": "photon"` instead of platform-specific paths
  - Works consistently across macOS, Linux, and Windows

### Changed

* **Command renamed** - `photon get` → `photon info` for clarity
  - More intuitive naming (info shows information, add downloads)
  - Removed duplicate marketplace `info` command (now unified)
  - All documentation updated to reflect new command

### Tests

* Updated all test suites to use `info` command
* All tests passing (schema, marketplace, loader, server, integration, README validation)

## [1.1.0](https://github.com/portel-dev/photon/compare/v1.0.0...v1.1.0) (2025-11-09)

### Features

* add --claude-code flag to sync marketplace command ([1940535](https://github.com/portel-dev/photon/commit/1940535f5ed3c61378889280a8affe81b8fed7ac))
* add Claude Code integration section to README template ([eb0bd09](https://github.com/portel-dev/photon/commit/eb0bd093ccefdea63cc977d3c362c2aa6bd272a4))
* add photon marketplace init command with automatic git hooks ([0600756](https://github.com/portel-dev/photon/commit/06007567b72dab82e28b83f652bc1ecc73f22c45))
* generate individual plugin for each photon ([1d3c50c](https://github.com/portel-dev/photon/commit/1d3c50c5db048e892bb735bd5b1f3deff316acfb))

### Bug Fixes

* ensure owner field is always present in Claude Code plugin manifest ([2740c03](https://github.com/portel-dev/photon/commit/2740c036899acb3acf2b42fa492d679f2d2af7cf))
* switch npm badges from shields.io to badgen.net ([1f7e544](https://github.com/portel-dev/photon/commit/1f7e5440e6664d1d548ac08837f2d8e2381ae35c))
* update contact email from contact@portel.dev to arul@luracast.com ([96a195d](https://github.com/portel-dev/photon/commit/96a195dd21d57539d9a51116d2de93b9744c3518))
* use absolute path for CLI in tests to work after cd operations ([54ca674](https://github.com/portel-dev/photon/commit/54ca674c76a41bfe1a82f8e6ba453b9fc44d97a9))

## [Unreleased]

### Changed

**CLI Structure Overhaul:**
- `photon <name>` → `photon mcp <name>` - More explicit MCP server invocation
- `photon list` → `photon info` - Unified command for local and marketplace info
- `photon list --config` → `photon info <name> --mcp` - Generate MCP config
- `photon info` - List all Photons (local + marketplace availability)
- `photon info <name>` - Show Photon details with metadata
- `photon info --mcp` - MCP config for all Photons
- `photon info <name> --mcp` - MCP config for one Photon

**Marketplace System (replacing Registry):**
- `photon registry:*` → `photon marketplace *` - Simpler, clearer naming
- Marketplace structure: `.marketplace/photons.json` (was `.photon/marketplace.json`)
- Added `photon marketplace init` - Generate marketplace manifest from directory
- Marketplace manifest includes SHA-256 hashes for integrity verification
- Source paths relative to `.marketplace/` directory (use `../` prefix)

### Added

**Metadata Tracking:**
- Installation metadata stored in `~/.photon/.metadata.json`
- Track marketplace source, version, installation date for each Photon
- SHA-256 hash calculation for modification detection
- `photon info <name>` shows version, marketplace, and modification status
- ⚠️ Modified indicator when file hash doesn't match original

**Commands:**
- `photon marketplace init [path]` - Generate marketplace manifest
- `photon add <name>` - Install Photon from marketplace
- `photon search <query>` - Search across marketplaces

**Logging:**
- Conditional logging in PhotonLoader (verbose mode)
- Server mode shows compilation logs (verbose=true)
- CLI inspection commands are quiet (verbose=false)
- Errors always display regardless of verbose setting

### Removed

- `[Photon]` prefix from all log messages - cleaner output
- Old registry commands (`photon registry:add`, etc.)
- Old list command format

### Documentation

- Updated README.md with new CLI structure
- Updated GUIDE.md with new commands and marketplace system
- Updated COMPARISON.md with new command references
- Added marketplace structure and creation documentation
- Added metadata tracking documentation

## [1.0.0] - 2025-01-04

### Initial Release

**Photon MCP** - Zero-install CLI for running single-file TypeScript MCPs

#### Features

- ✅ Single-file `.photon.ts` MCP server format
- ✅ Convention over configuration (no base classes required)
- ✅ Auto schema extraction from TypeScript types and JSDoc
- ✅ Hot reload in development mode (`--dev`)
- ✅ Production mode for MCP clients
- ✅ Template generation (`photon init`)
- ✅ Validation command (`photon validate`)
- ✅ Claude Desktop config generation (`--config`)
- ✅ Global installation support (`npm install -g @portel/photon`)
- ✅ Zero-install support (`npx @portel/photon`)
- ✅ **Name-only references** - Run `photon calculator` (no paths, no extensions)
- ✅ **Working directory** - Default to `~/.photon/`, override with `--working-dir`
- ✅ **Simple mental model** - All MCPs in one directory, accessible from anywhere
- ✅ **List command** - `photon list` shows all MCPs in working directory
- ✅ **Zero configuration** - Just create, run, done!

#### Package

- **Name**: `@portel/photon` (scoped package)
- **Binary**: `photon`
- **Version**: 1.0.0
- **License**: MIT

#### Installation

```bash
# Global install
npm install -g @portel/photon

# Or use with npx (zero install)
npx @portel/photon --help
```

#### Usage

```bash
# Create new MCP (stored in ~/.photon/)
photon init my-tool

# Run from anywhere (just the name!)
photon my-tool --dev

# Generate Claude Desktop config
photon my-tool --config

# List all MCPs
photon list

# Custom directory
photon --working-dir ./mcps init project-tool
photon --working-dir ./mcps project-tool --dev
```

**Note:** Reference MCPs by name only—no paths, no extensions needed!

#### Examples

Three example Photon MCPs included:
- `calculator.photon.ts` - Arithmetic operations
- `string.photon.ts` - Text manipulation utilities
- `workflow.photon.ts` - Task management

#### Documentation

- `README.md` - Complete user guide
- `GUIDE.md` - Developer guide for creating Photon MCPs
- `LICENSE` - MIT license

#### Architecture

Built on:
- `@modelcontextprotocol/sdk` - Official MCP SDK
- `esbuild` - Fast TypeScript compilation
- `chokidar` - File watching for hot reload
- `commander` - CLI framework
