import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');

// Copy HTML templates to dist
function copyHtmlTemplates() {
  const frontendDir = path.join(__dirname, '../src/auto-ui/frontend');
  const destDir = path.join(__dirname, '../dist/auto-ui/frontend');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(frontendDir, 'index.html'), path.join(destDir, 'index.html'));
  fs.copyFileSync(path.join(frontendDir, 'pure-view.html'), path.join(destDir, 'pure-view.html'));
}

// Keep the old Beam filename as a compatibility alias. MCP App resources use
// the canonical photon-form bundle and inline it instead of fetching either
// filename from a host origin.
function copyFormBundleCompatibility() {
  const canonicalPath = path.join(__dirname, '../dist/photon-form.bundle.js');
  const compatibilityPath = path.join(__dirname, '../dist/beam-form.bundle.js');
  fs.copyFileSync(canonicalPath, compatibilityPath);
}

async function build() {
  /** @type {esbuild.BuildOptions} */
  const buildOptions = {
    entryPoints: ['src/auto-ui/frontend/main.ts'],
    bundle: true,
    outfile: 'dist/beam.bundle.js',
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    sourcemap: true,
    minify: false,
    tsconfig: 'src/auto-ui/frontend/tsconfig.json',
  };

  /** @type {esbuild.BuildOptions} */
  const workerBuildOptions = {
    entryPoints: ['src/auto-ui/frontend/workers/photon-ts-worker.ts'],
    bundle: true,
    outfile: 'dist/beam-ts-worker.js',
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    sourcemap: true,
    minify: false,
    tsconfig: 'src/auto-ui/frontend/tsconfig.json',
  };

  // Canonical host-neutral form runtime — invoke-form + custom inputs for
  // pure-view and embedded MCP App contexts. The Beam filename is copied as a
  // compatibility alias after the build.
  /** @type {esbuild.Plugin} */
  const mcpClientShimPlugin = {
    name: 'mcp-client-shim',
    setup(build) {
      // Redirect mcp-client imports to the lightweight postMessage shim
      build.onResolve({ filter: /mcp-client\.js$/ }, (args) => {
        if (args.importer.includes('invoke-form') || args.importer.includes('form-bundle')) {
          return {
            path: path.resolve(__dirname, '../src/auto-ui/frontend/services/mcp-client-shim.ts'),
          };
        }
        return undefined;
      });
    },
  };

  /** @type {esbuild.BuildOptions} */
  const formBundleOptions = {
    entryPoints: ['src/auto-ui/frontend/form-bundle.ts'],
    bundle: true,
    outfile: 'dist/photon-form.bundle.js',
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    sourcemap: true,
    minify: false,
    tsconfig: 'src/auto-ui/frontend/tsconfig.json',
    plugins: [mcpClientShimPlugin],
  };

  if (isWatch) {
    copyHtmlTemplates();
    const ctx = await esbuild.context({
      ...buildOptions,
      plugins: [
        {
          name: 'rebuild-notify',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length === 0) {
                console.log(`⚡️ Beam UI rebuilt at ${new Date().toLocaleTimeString()}`);
              }
            });
          },
        },
      ],
    });
    const workerCtx = await esbuild.context({
      ...workerBuildOptions,
      plugins: [
        {
          name: 'rebuild-notify-worker',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length === 0) {
                console.log(`⚡️ Beam TS worker rebuilt at ${new Date().toLocaleTimeString()}`);
              }
            });
          },
        },
      ],
    });
    const formCtx = await esbuild.context({
      ...formBundleOptions,
      plugins: [
        {
          name: 'rebuild-notify-form',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length === 0) {
                copyFormBundleCompatibility();
                console.log(`⚡️ Beam form bundle rebuilt at ${new Date().toLocaleTimeString()}`);
              }
            });
          },
        },
      ],
    });
    await ctx.watch();
    await workerCtx.watch();
    await formCtx.watch();
    console.log('👀 Watching for Beam UI changes...');
  } else {
    await esbuild.build(buildOptions);
    await esbuild.build(workerBuildOptions);
    await esbuild.build(formBundleOptions);
    copyFormBundleCompatibility();
    copyHtmlTemplates();
    console.log('⚡️ Beam UI bundle built');
  }
}

build().catch((err) => { console.error('Build failed:', err); process.exit(1); });
