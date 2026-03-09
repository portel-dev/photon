/**
 * photon package <name> — Generate cross-platform PWA launchers
 *
 * Creates macOS .app, Linux .sh/.desktop, and Windows .bat launchers
 * that auto-start a beam server and open the PWA in the default browser.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { getDefaultContext } from '../../context.js';

function toClassName(name: string): string {
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function generateBashLauncherScript(
  name: string,
  version: string,
  startPort: number,
  openCmd: string
): string {
  const endPort = startPort + 9;
  return `#!/usr/bin/env bash
# Launcher for ${name} — auto-starts beam and opens as PWA
set -e

PHOTON="${name}"
VERSION="${version}"
START_PORT=${startPort}
END_PORT=${endPort}
OPEN_CMD="${openCmd}"

# Detect package runner: bunx > pnpx > npx
if command -v bunx &>/dev/null; then
  RUNNER="bunx @portel/photon@$VERSION"
elif command -v pnpx &>/dev/null; then
  RUNNER="pnpx @portel/photon@$VERSION"
elif command -v npx &>/dev/null; then
  RUNNER="npx -y @portel/photon@$VERSION"
else
  echo "Error: no package runner found (npx, pnpx, or bunx required)"
  exit 1
fi

# Scan ports for an existing beam already serving this photon
for port in $(seq $START_PORT $END_PORT); do
  RESP=$(curl -s --max-time 2 "http://localhost:\${port}/api/diagnostics" 2>/dev/null || true)
  if [ -n "$RESP" ]; then
    # Check if this beam has our photon loaded
    echo "$RESP" | grep -q "\\"name\\":\\"$PHOTON\\"" 2>/dev/null && {
      # Beam already running with this photon — skip browser open (client likely connected)
      exit 0
    }
  fi
done

# No existing beam found — start one (--no-open: we handle browser launch ourselves)
$RUNNER $PHOTON --no-open --port=$START_PORT &
BEAM_PID=$!

# Poll until beam is ready (up to 30s), then open browser
WAITED=0
while [ $WAITED -lt 30 ]; do
  for port in $(seq $START_PORT $END_PORT); do
    RESP=$(curl -s --max-time 1 "http://localhost:\${port}/api/diagnostics" 2>/dev/null || true)
    if [ -n "$RESP" ]; then
      echo "$RESP" | grep -q "\\"name\\":\\"$PHOTON\\"" 2>/dev/null && {
        $OPEN_CMD "http://localhost:\${port}/#$PHOTON?focus=1"
        exit 0
      }
    fi
  done
  sleep 1
  WAITED=$((WAITED + 1))
done

echo "Error: beam did not start within 30 seconds"
exit 1
`;
}

function generateInfoPlist(name: string, className: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${className}</string>
  <key>CFBundleDisplayName</key>
  <string>${className}</string>
  <key>CFBundleIdentifier</key>
  <string>com.photon.${name}</string>
  <key>CFBundleExecutable</key>
  <string>launch</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>`;
}

function generateWindowsBat(name: string, version: string, startPort: number): string {
  const endPort = startPort + 9;
  return `@echo off
REM Launcher for ${name} — auto-starts beam and opens as PWA
setlocal enabledelayedexpansion

set "PHOTON=${name}"
set "VERSION=${version}"
set START_PORT=${startPort}
set END_PORT=${endPort}

REM Detect package runner: bunx > pnpx > npx
where bunx >nul 2>&1 && set "RUNNER=bunx @portel/photon@%VERSION%" && goto :found_runner
where pnpx >nul 2>&1 && set "RUNNER=pnpx @portel/photon@%VERSION%" && goto :found_runner
where npx >nul 2>&1 && set "RUNNER=npx -y @portel/photon@%VERSION%" && goto :found_runner
echo Error: no package runner found (npx, pnpx, or bunx required)
exit /b 1
:found_runner

REM Scan ports for an existing beam serving this photon
for /L %%p in (%START_PORT%,1,%END_PORT%) do (
  for /f "delims=" %%r in ('curl -s --max-time 2 "http://localhost:%%p/api/diagnostics" 2^>nul') do (
    echo %%r | findstr /c:"%PHOTON%" >nul 2>&1
    if !errorlevel! equ 0 (
      REM Beam already running with this photon — skip browser open
      exit /b 0
    )
  )
)

REM No existing beam found — start one
start /b %RUNNER% %PHOTON% --no-open --port=%START_PORT%

REM Poll until beam is ready (up to 30s), then open browser
set WAITED=0
:poll
if %WAITED% geq 30 (
  echo Error: beam did not start within 30 seconds
  exit /b 1
)
for /L %%p in (%START_PORT%,1,%END_PORT%) do (
  for /f "delims=" %%r in ('curl -s --max-time 1 "http://localhost:%%p/api/diagnostics" 2^>nul') do (
    echo %%r | findstr /c:"%PHOTON%" >nul 2>&1
    if !errorlevel! equ 0 (
      start "" "http://localhost:%%p/#%PHOTON%?focus=1"
      exit /b 0
    )
  )
)
timeout /t 1 /nobreak >nul
set /a WAITED+=1
goto poll
`;
}

async function generateMacOSApp(
  name: string,
  className: string,
  version: string,
  startPort: number,
  outputDir: string
): Promise<string> {
  const appDir = path.join(outputDir, `${className}.app`);
  const contentsDir = path.join(appDir, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');

  await fs.mkdir(macosDir, { recursive: true });
  await fs.writeFile(path.join(contentsDir, 'Info.plist'), generateInfoPlist(name, className));
  const script = generateBashLauncherScript(name, version, startPort, 'open');
  await fs.writeFile(path.join(macosDir, 'launch'), script, { mode: 0o755 });

  return appDir;
}

async function generateLinuxLauncher(
  name: string,
  version: string,
  startPort: number,
  outputDir: string
): Promise<[string, string]> {
  const shPath = path.join(outputDir, `${name}.sh`);
  const desktopPath = path.join(outputDir, `${name}.desktop`);

  const script = generateBashLauncherScript(name, version, startPort, 'xdg-open');
  await fs.writeFile(shPath, script, { mode: 0o755 });

  const desktop = `[Desktop Entry]
Type=Application
Name=${toClassName(name)}
Exec=${shPath}
Terminal=false
Categories=Utility;
`;
  await fs.writeFile(desktopPath, desktop);

  return [shPath, desktopPath];
}

async function generateWindowsLauncher(
  name: string,
  version: string,
  startPort: number,
  outputDir: string
): Promise<string> {
  const batPath = path.join(outputDir, `${name}.bat`);
  await fs.writeFile(batPath, generateWindowsBat(name, version, startPort));
  return batPath;
}

/**
 * Check if a photon directory contains an app photon (main() + @ui).
 * Reads .ts/.js source files and looks for class-level @ui asset declaration
 * and a main() method linked to that UI.
 */
async function checkIsAppPhoton(photonDir: string): Promise<boolean> {
  const entries = await fs.readdir(photonDir);
  const sourceFiles = entries.filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'));

  for (const file of sourceFiles) {
    const content = await fs.readFile(path.join(photonDir, file), 'utf-8');
    // Check for class-level @ui asset declaration (e.g. @ui my-view ./ui/view.html)
    const hasClassUi = /@ui\s+\S+\s+\S+/.test(content);
    // Check for a main method
    const hasMain = /(?:async\s+)?main\s*\(/.test(content);
    if (hasClassUi && hasMain) return true;
  }
  return false;
}

export function registerPackageAppCommand(program: Command): void {
  program
    .command('package')
    .argument('<name>', 'Photon name to package')
    .option('--output <dir>', 'Output directory', process.cwd())
    .option('--port <number>', 'Preferred start port', '3000')
    .description('Generate cross-platform PWA launchers for a photon')
    .action(async (name: string, options: any, command: Command) => {
      const workingDir = getDefaultContext().baseDir;
      const outputDir = path.resolve(options.output);
      const startPort = parseInt(options.port, 10);

      // Resolve the photon directory
      const photonDir = path.resolve(workingDir, name);
      if (!existsSync(photonDir)) {
        console.error(`Error: photon directory not found: ${photonDir}`);
        process.exit(1);
      }

      // Validate that the photon is an app (has main() method + @ui)
      const isApp = await checkIsAppPhoton(photonDir);
      if (!isApp) {
        console.error(
          `Error: "${name}" is not an app photon.\n` +
            `Only photons with a main() method and a linked @ui can be packaged as PWA apps.`
        );
        process.exit(1);
      }

      // Get the current photon runtime version to pin in launchers
      const { PHOTON_VERSION } = await import('../../version.js');

      const className = toClassName(name);

      console.log(`\n📦 Packaging ${name} (runtime v${PHOTON_VERSION})...\n`);

      await fs.mkdir(outputDir, { recursive: true });

      // Generate all platform launchers
      const macAppPath = await generateMacOSApp(
        name,
        className,
        PHOTON_VERSION,
        startPort,
        outputDir
      );
      const [linuxShPath, linuxDesktopPath] = await generateLinuxLauncher(
        name,
        PHOTON_VERSION,
        startPort,
        outputDir
      );
      const winBatPath = await generateWindowsLauncher(name, PHOTON_VERSION, startPort, outputDir);

      console.log(`   ✓ macOS    ${macAppPath}`);
      console.log(`   ✓ Linux    ${linuxShPath}, ${path.basename(linuxDesktopPath)}`);
      console.log(`   ✓ Windows  ${winBatPath}`);

      // Write pwa.json to record this PWA instance configuration
      try {
        const pwaConfigPath = path.join(workingDir, 'pwa.json');
        let config: {
          instances: Array<{
            port: number;
            photon: string;
            version: string;
            createdAt: string;
          }>;
        } = { instances: [] };
        try {
          const raw = await fs.readFile(pwaConfigPath, 'utf-8');
          config = JSON.parse(raw);
          if (!Array.isArray(config.instances)) config.instances = [];
        } catch {
          // File doesn't exist yet — use default
        }

        // Deduplicate by port + photon name
        const exists = config.instances.some((i) => i.port === startPort && i.photon === name);
        if (!exists) {
          config.instances.push({
            port: startPort,
            photon: name,
            version: PHOTON_VERSION,
            createdAt: new Date().toISOString(),
          });
          await fs.writeFile(pwaConfigPath, JSON.stringify(config, null, 2));
          console.log(`   ✓ pwa.json  PWA configured (port ${startPort})`);
        } else {
          console.log(`   ✓ pwa.json  Already configured`);
        }
      } catch (err: any) {
        console.error(`   ⚠ pwa.json  ${err.message || 'Failed to write'}`);
      }

      console.log();
    });
}
