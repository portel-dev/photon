/**
 * Cloudflare Workers deployment for Photon
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { SchemaExtractor } from '@portel/photon-core';
import { PHOTON_VERSION } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Find package root (where templates folder is)
function getPackageRoot(): string {
  // When running from dist/, go up to package root
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(require('fs').readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        if (pkg.name === '@portel/photon') {
          return dir;
        }
      } catch {}
    }
    dir = path.dirname(dir);
  }
  // Fallback: assume we're in dist/deploy/
  return path.join(__dirname, '..', '..');
}

export interface CloudflareDeployOptions {
  photonPath: string;
  outputDir?: string;
  devMode?: boolean;
  dryRun?: boolean;
}

export async function deployToCloudflare(options: CloudflareDeployOptions): Promise<void> {
  const { photonPath, devMode = false, dryRun = false } = options;

  // Resolve photon file
  const absolutePath = path.resolve(photonPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Photon file not found: ${absolutePath}`);
  }

  // Extract photon name from filename
  const filename = path.basename(absolutePath);
  const photonName = filename.replace(/\.photon\.ts$/, '').replace(/[^a-z0-9-]/gi, '-');

  console.log(`\n📦 Preparing ${photonName} for Cloudflare Workers...\n`);

  // Create output directory
  const outputDir = options.outputDir || path.join(process.cwd(), `.cf-${photonName}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });

  // Extract tool definitions using SchemaExtractor
  console.log('  Extracting tool definitions...');
  const extractor = new SchemaExtractor();
  const sourceCode = await fs.readFile(absolutePath, 'utf-8');
  const extracted = extractor.extractFromSource(sourceCode);

  const toolDefs = extracted.map((tool: any) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  console.log(`  Found ${toolDefs.length} tools`);

  // Read worker template
  const packageRoot = getPackageRoot();
  const templatePath = path.join(packageRoot, 'templates', 'cloudflare', 'worker.ts.template');
  let workerCode = await fs.readFile(templatePath, 'utf-8');

  // Replace placeholders
  workerCode = workerCode
    .replace(/__TOOL_DEFINITIONS__/g, JSON.stringify(toolDefs, null, 2))
    .replace(/__PHOTON_NAME__/g, photonName)
    .replace(/__DEV_MODE__/g, String(devMode));

  // Copy photon file and rename import
  const photonCode = await fs.readFile(absolutePath, 'utf-8');

  // Transform photon code for Workers compatibility
  // 1. Remove @portel/photon-core import and PhotonMCP extension
  // 2. Remove Node.js-specific imports
  let transformedPhoton = photonCode
    // Remove photon-core import
    .replace(/import\s+{\s*PhotonMCP\s*}\s+from\s+['"]@portel\/photon-core['"];?\n?/g, '')
    // Remove extends PhotonMCP
    .replace(/extends\s+PhotonMCP\s*{/g, '{')
    // Remove Node.js imports
    .replace(/import\s+\*\s+as\s+fs\s+from\s+['"]fs['"]/g, '// fs not available in Workers')
    .replace(/import\s+\*\s+as\s+path\s+from\s+['"]path['"]/g, '// path not available in Workers')
    .replace(/import\s+{\s*[^}]+\s*}\s+from\s+['"]fs['"]/g, '// fs not available in Workers')
    .replace(/import\s+{\s*[^}]+\s*}\s+from\s+['"]fs\/promises['"]/g, '// fs not available in Workers')
    .replace(/import\s+{\s*[^}]+\s*}\s+from\s+['"]path['"]/g, '// path not available in Workers')
    // Remove @dependencies comment
    .replace(/\s*\*\s*@dependencies[^\n]*/g, '');

  // Write files
  await fs.writeFile(path.join(outputDir, 'src', 'worker.ts'), workerCode);
  await fs.writeFile(path.join(outputDir, 'src', 'photon.ts'), transformedPhoton);

  // Create wrangler.toml
  const wranglerTemplatePath = path.join(packageRoot, 'templates', 'cloudflare', 'wrangler.toml.template');
  let wranglerConfig = await fs.readFile(wranglerTemplatePath, 'utf-8');
  wranglerConfig = wranglerConfig.replace(/__PHOTON_NAME__/g, photonName);
  await fs.writeFile(path.join(outputDir, 'wrangler.toml'), wranglerConfig);

  // Create package.json
  const packageJson = {
    name: photonName,
    version: PHOTON_VERSION,
    private: true,
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
    },
    devDependencies: {
      '@cloudflare/workers-types': '^4.0.0',
      wrangler: '^3.0.0',
      typescript: '^5.0.0',
    },
  };
  await fs.writeFile(
    path.join(outputDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // Create tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ['@cloudflare/workers-types'],
    },
    include: ['src/**/*'],
  };
  await fs.writeFile(
    path.join(outputDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2)
  );

  console.log(`\n✅ Project generated at: ${outputDir}\n`);

  if (dryRun) {
    console.log('  Dry run - skipping deployment');
    console.log('\n  To deploy manually:');
    console.log(`    cd ${outputDir}`);
    console.log('    npm install');
    console.log('    npm run dev      # Local development');
    console.log('    npm run deploy   # Deploy to Cloudflare');
    return;
  }

  // Check if wrangler is available
  console.log('  Installing dependencies...');
  try {
    execSync('npm install', { cwd: outputDir, stdio: 'pipe' });
  } catch (error) {
    console.error('  ❌ Failed to install dependencies');
    console.error(`     Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error('     💡 Check your npm installation and network connection');
    throw new Error(`Dependency installation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Check for wrangler authentication
  console.log('  Checking Cloudflare authentication...');
  try {
    execSync('npx wrangler whoami', { cwd: outputDir, stdio: 'pipe' });
  } catch {
    console.log('\n  ⚠️  Not logged in to Cloudflare');
    console.log('  Running: wrangler login\n');

    // Run wrangler login interactively
    const login = spawn('npx', ['wrangler', 'login'], {
      cwd: outputDir,
      stdio: 'inherit',
    });

    await new Promise<void>((resolve, reject) => {
      login.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Login failed'));
      });
    });
  }

  // Deploy
  console.log('\n  Deploying to Cloudflare Workers...\n');

  const deploy = spawn('npx', ['wrangler', 'deploy'], {
    cwd: outputDir,
    stdio: 'inherit',
  });

  await new Promise<void>((resolve, reject) => {
    deploy.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Deployment complete!');
        console.log(`\n  Your MCP server is live at:`);
        console.log(`  https://${photonName}.<your-subdomain>.workers.dev`);
        if (devMode) {
          console.log(`\n  Playground: https://${photonName}.<your-subdomain>.workers.dev/playground`);
        }
        resolve();
      } else {
        reject(new Error('Deployment failed'));
      }
    });
  });
}

export async function devCloudflare(options: CloudflareDeployOptions): Promise<void> {
  // Generate with dev mode, then run wrangler dev
  await deployToCloudflare({ ...options, devMode: true, dryRun: true });

  const photonName = path.basename(options.photonPath).replace(/\.photon\.ts$/, '').replace(/[^a-z0-9-]/gi, '-');
  const outputDir = options.outputDir || path.join(process.cwd(), `.cf-${photonName}`);

  console.log('\n  Installing dependencies...');
  execSync('npm install', { cwd: outputDir, stdio: 'pipe' });

  console.log('\n  Starting local Cloudflare Workers dev server...\n');

  const dev = spawn('npx', ['wrangler', 'dev'], {
    cwd: outputDir,
    stdio: 'inherit',
  });

  await new Promise<void>((resolve) => {
    dev.on('close', () => resolve());
    process.on('SIGINT', () => {
      dev.kill();
      resolve();
    });
  });
}
