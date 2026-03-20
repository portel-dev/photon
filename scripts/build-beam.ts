import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');

// Copy index.html to dist
function copyIndexHtml() {
  const src = path.join(__dirname, '../src/auto-ui/frontend/index.html');
  const dest = path.join(__dirname, '../dist/auto-ui/frontend/index.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
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

  if (isWatch) {
    copyIndexHtml();
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
    await ctx.watch();
    await workerCtx.watch();
    console.log('👀 Watching for Beam UI changes...');
  } else {
    await esbuild.build(buildOptions);
    await esbuild.build(workerBuildOptions);
    copyIndexHtml();
    console.log('⚡️ Beam UI bundle built');
  }
}

build().catch(() => process.exit(1));
