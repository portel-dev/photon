import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import ora from 'ora';
import chalk from 'chalk';
import { printError } from '../../cli-formatter.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function registerBuildCommand(program: Command) {
  program
    .command('build')
    .description('Compile a photon into a standalone executable binary')
    .argument('<file>', 'Path to the .photon.ts file')
    .option('-o, --outfile <name>', 'Name of the output binary')
    .option(
      '-t, --target <target>',
      'Bun compilation target (e.g. bun-linux-x64, bun-darwin-arm64, bun-windows-x64)'
    )
    .action(async (file: string, options: { outfile?: string; target?: string }) => {
      const spinner = ora(`Preparing standalone build for ${file}...`).start();
      const workingDir = process.cwd();
      const photonPath = path.resolve(workingDir, file);

      if (!fs.existsSync(photonPath)) {
        spinner.fail(`File not found: ${photonPath}`);
        process.exit(1);
      }

      // Check that bun is available
      try {
        const { execSync } = await import('child_process');
        execSync('bun --version', { stdio: 'ignore' });
      } catch {
        spinner.fail('Bun is required for compilation. Install it: https://bun.sh');
        process.exit(1);
      }

      // Read the source code to embed in the binary
      const sourceCode = fs.readFileSync(photonPath, 'utf-8');

      // Generate a unique temporary entrypoint file
      const tempEntrypointName = `.photon-build-${Date.now()}.ts`;
      const tempEntrypointPath = path.join(workingDir, tempEntrypointName);

      // Determine outfile name
      let outfile = options.outfile;
      if (!outfile) {
        const basename = path.basename(file, '.photon.ts');
        outfile = basename.endsWith('.photon.js') ? path.basename(file, '.photon.js') : basename;
      }

      try {
        // Relative import path for the photon module
        let relativePhotonPath = path.relative(workingDir, photonPath);
        if (!relativePhotonPath.startsWith('.')) {
          relativePhotonPath = `./${relativePhotonPath}`;
        }

        // Escape source for embedding as a template literal
        const escapedSource = sourceCode
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\$/g, '\\$');

        // Resolve the photon runtime package path for the entrypoint import.
        // At build time, we resolve the actual path so Bun can bundle it.
        // At runtime in the binary, everything is already bundled.
        const photonPkgDir = path.resolve(__dirname, '..', '..'); // dist/ -> package root
        let photonImportPath = path.relative(workingDir, path.join(photonPkgDir, 'index.js'));
        if (!photonImportPath.startsWith('.')) {
          photonImportPath = `./${photonImportPath}`;
        }

        // The entrypoint imports the photon class statically (bundled by Bun)
        // and passes it as preloadedModule with embedded source for metadata extraction.
        // This way the full loader pipeline runs (injection, middleware, capabilities)
        // without needing file I/O or compilation at runtime.
        const entrypointCode = `import { PhotonServer } from '${photonImportPath}';
import * as photonModule from '${relativePhotonPath}';

const EMBEDDED_SOURCE = \`${escapedSource}\`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'mcp';

  let port: number | undefined;
  if (command === 'sse') {
    port = args[1] ? parseInt(args[1], 10) : undefined;
  }

  const server = new PhotonServer({
    filePath: ${JSON.stringify(photonPath)},
    transport: command === 'sse' ? 'sse' : 'stdio',
    port,
    preloadedModule: photonModule,
    embeddedSource: EMBEDDED_SOURCE,
  });

  await server.start();
}

main().catch(err => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
`;

        fs.writeFileSync(tempEntrypointPath, entrypointCode, 'utf-8');
        spinner.text = 'Compiling executable with Bun...';

        // Prepare bun build arguments
        const buildArgs = ['build', tempEntrypointPath, '--compile', '--outfile', outfile];
        if (options.target) {
          buildArgs.push('--target', options.target);
        }

        const buildProcess = spawn('bun', buildArgs, {
          cwd: workingDir,
          stdio: 'pipe',
        });

        let stdoutData = '';
        let stderrData = '';

        buildProcess.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });

        buildProcess.stderr.on('data', (data) => {
          stderrData += data.toString();
        });

        await new Promise<void>((resolve, reject) => {
          buildProcess.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(
                  `Bun compilation failed with exit code ${code}\n\n${stderrData || stdoutData}`
                )
              );
            }
          });
          buildProcess.on('error', reject);
        });

        // Get file size for display
        const stat = fs.statSync(outfile);
        const sizeMB = (stat.size / 1024 / 1024).toFixed(1);

        spinner.succeed(`Compiled: ${chalk.green(chalk.bold(outfile))} (${sizeMB} MB)`);
        console.log(`\nUsage:`);
        console.log(`  ./${outfile}         MCP server (stdio)`);
        console.log(`  ./${outfile} sse     MCP server (HTTP/SSE)`);
      } catch (err) {
        spinner.fail('Build failed');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        // Clean up the temporary entrypoint file
        if (fs.existsSync(tempEntrypointPath)) {
          fs.unlinkSync(tempEntrypointPath);
        }
      }
    });
}
