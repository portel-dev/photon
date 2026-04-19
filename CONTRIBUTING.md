# Contributing to Photon

Thank you for your interest in contributing to Photon!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/photon.git`
3. Install dependencies: `npm install`
4. Build: `npm run build`
5. Run tests: `npm test`

## Development Workflow

1. Create a feature branch from `main`: `git checkout -b feat/my-feature`
2. Make your changes
3. Ensure code passes lint and format checks:
   ```bash
   npm run lint
   npm run format:check
   ```
4. Run the full test suite: `npm test`
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   - `fix:` for bug fixes (patch release)
   - `feat:` for new features (minor release)
   - `feat:` with `BREAKING CHANGE:` in body for breaking changes (major release)
6. Push your branch and open a Pull Request

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Add tests for new functionality
- Ensure all CI checks pass before requesting review
- Update documentation if your change affects public APIs

## Code Style

- TypeScript with strict mode
- Formatting enforced by [Prettier](https://prettier.io/) (config in `.prettierrc`)
- Linting via [ESLint](https://eslint.org/) (config in `eslint.config.mjs`)
- Run `npm run format` to auto-fix formatting
- Run `npm run lint:fix` to auto-fix lint issues

## Project Structure

- `src/` — Main source code
- `tests/` — Test files
- `docs/` — User-facing documentation
- `docs/internals/` — Internal architecture docs for contributors
- `templates/` — Project templates

## Architecture & Implementation Docs

Detailed documentation for contributors can be found in `docs/internals/`:

- [Auto-UI Architecture](docs/internals/AUTO-UI-ARCHITECTURE.md) — How the Auto-UI system generates interfaces
- [Daemon PubSub Protocol](docs/internals/DAEMON-PUBSUB.md) — Protocol for the Photon Daemon's pub/sub system
- [Elicitation Architecture](docs/internals/ELICITATION-ARCHITECTURE.md) — Architecture of the elicitation system
- [MCP Elicitation Implementation](docs/internals/MCP-ELICITATION-IMPLEMENTATION.md) — Implementation details for MCP elicitation
- [Constructor Context](docs/internals/CONSTRUCTOR-CONTEXT.md) — Per-call context plumbed through the constructor
- [Constructor Injection](docs/internals/CONSTRUCTOR-INJECTION.md) — How env vars, MCPs, and photons get injected
- [Middleware](docs/internals/MIDDLEWARE.md) — The 12-phase method-call pipeline
- [Rendering Engine](docs/internals/RENDERING-ENGINE.md) — How `@format` results render across CLI, Beam, MCP
- [Stateful State Sync](docs/internals/STATEFUL-STATE-SYNC.md) — Event emission and patch streaming for `@stateful` photons
- [Lifecycle & Ingress](docs/internals/LIFECYCLE-AND-INGRESS.md) — Lifecycle hooks and the ingress/visibility model
- [OAuth Authorization Server](docs/internals/OAUTH-AUTHORIZATION-SERVER.md) — OAuth 2.1 AS, CIMD, DCR, OIDC id_token, RFC 8693 token exchange
- [PHOTON_DIR & Namespace](docs/internals/PHOTON-DIR-AND-NAMESPACE.md) — How a photon's source location determines where its data lives
- [UX Guidelines](docs/internals/UX-GUIDELINES.md) — Guidelines for consistent CLI and UI experience

For general usage and development of Photon MCPs:

- [GUIDE.md](docs/GUIDE.md) — The main developer guide
- [ADVANCED.md](docs/guides/ADVANCED.md) — Advanced features and patterns
- [BEST-PRACTICES.md](docs/guides/BEST-PRACTICES.md) — Best practices for writing Photons

## Reporting Issues

Use [GitHub Issues](https://github.com/portel-dev/photon/issues) to report bugs or request features. Please include:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Node.js version and OS
