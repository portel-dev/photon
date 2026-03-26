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

async function build() {
  const buildOptions: esbuild.BuildOptions = {
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

  const workerBuildOptions: esbuild.BuildOptions = {
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

  // Form components bundle — invoke-form + custom inputs for pure-view context.
  // Uses mcp-client-shim (postMessage-based) instead of the full Beam SSE client.
  const mcpClientShimPlugin: esbuild.Plugin = {
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

  const formBundleOptions: esbuild.BuildOptions = {
    entryPoints: ['src/auto-ui/frontend/form-bundle.ts'],
    bundle: true,
    outfile: 'dist/beam-form.bundle.js',
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
    copyHtmlTemplates();
    console.log('⚡️ Beam UI bundle built');
  }
}

build().catch(() => process.exit(1));
