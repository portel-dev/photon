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
- `docs/core/` — Internal architecture docs for contributors
- `templates/` — Project templates

## Architecture & Implementation Docs

Detailed documentation for contributors can be found in `docs/core/`:

- [Auto-UI Architecture](docs/core/AUTO-UI-ARCHITECTURE.md) — How the Auto-UI system generates interfaces
- [Auto-UI Implementation](docs/core/AUTO-UI-IMPLEMENTATION.md) — Deep dive into the Auto-UI code
- [Daemon PubSub Protocol](docs/core/DAEMON-PUBSUB.md) — Protocol for the Photon Daemon's pub/sub system
- [Elicitation Architecture](docs/core/ELICITATION-ARCHITECTURE.md) — Architecture of the elicitation system
- [MCP Elicitation Implementation](docs/core/MCP-ELICITATION-IMPLEMENTATION.md) — Implementation details for MCP elicitation
- [UX Guidelines](docs/core/UX-GUIDELINES.md) — Guidelines for consistent CLI and UI experience

For general usage and development of Photon MCPs:

- [GUIDE.md](GUIDE.md) — The main developer guide
- [ADVANCED.md](ADVANCED.md) — Advanced features and patterns
- [PHOTON_BEST_PRACTICES.md](PHOTON_BEST_PRACTICES.md) — Best practices for writing Photons

## Reporting Issues

Use [GitHub Issues](https://github.com/portel-dev/photon/issues) to report bugs or request features. Please include:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Node.js version and OS
