import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

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

    if (isWatch) {
        const ctx = await esbuild.context({
            ...buildOptions,
            plugins: [{
                name: 'rebuild-notify',
                setup(build) {
                    build.onEnd(result => {
                        if (result.errors.length === 0) {
                            console.log(`⚡️ Beam UI rebuilt at ${new Date().toLocaleTimeString()}`);
                        }
                    });
                }
            }]
        });
        await ctx.watch();
        console.log('👀 Watching for Beam UI changes...');
    } else {
        await esbuild.build(buildOptions);
        console.log('⚡️ Beam UI bundle built');
    }
}

build().catch(() => process.exit(1));
