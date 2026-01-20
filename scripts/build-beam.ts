import * as esbuild from 'esbuild';
import * as path from 'path';

async function build() {
    await esbuild.build({
        entryPoints: ['src/auto-ui/frontend/main.ts'],
        bundle: true,
        outfile: 'dist/beam.bundle.js',
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
        sourcemap: true,
        minify: false, // Keep it readable for now
        tsconfig: 'src/auto-ui/frontend/tsconfig.json',
    });
    console.log('⚡️ Beam UI bundle built');
}

build().catch(() => process.exit(1));
