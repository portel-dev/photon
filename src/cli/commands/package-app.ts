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

function toClassName(name: string): string {
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function generateBashLauncherScript(
  name: string,
  photonDir: string,
  startPort: number,
  openCmd: string
): string {
  const endPort = startPort + 9;
  return `#!/usr/bin/env bash
# Launcher for ${name} — auto-starts beam and opens PWA
set -e

PHOTON_DIR="${photonDir}"
START_PORT=${startPort}
END_PORT=${endPort}
OPEN_CMD="${openCmd}"

# Scan ports for an existing beam serving this directory
for port in $(seq $START_PORT $END_PORT); do
  RESP=$(curl -s --max-time 2 "http://localhost:\${port}/api/diagnostics" 2>/dev/null || true)
  if [ -n "$RESP" ]; then
    DIR=$(echo "$RESP" | grep -o '"workingDir":"[^"]*"' | cut -d'"' -f4)
    if [ "$DIR" = "$PHOTON_DIR" ]; then
      $OPEN_CMD "http://localhost:\${port}"
      exit 0
    fi
  fi
done

# No existing beam found — start one
npx @portel/photon beam --dir="$PHOTON_DIR" --port=$START_PORT &
BEAM_PID=$!

# Poll until beam is ready (up to 30s)
WAITED=0
while [ $WAITED -lt 30 ]; do
  for port in $(seq $START_PORT $END_PORT); do
    RESP=$(curl -s --max-time 1 "http://localhost:\${port}/api/diagnostics" 2>/dev/null || true)
    if [ -n "$RESP" ]; then
      DIR=$(echo "$RESP" | grep -o '"workingDir":"[^"]*"' | cut -d'"' -f4)
      if [ "$DIR" = "$PHOTON_DIR" ]; then
        $OPEN_CMD "http://localhost:\${port}"
        exit 0
      fi
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

function generateWindowsBat(name: string, photonDir: string, startPort: number): string {
  const endPort = startPort + 9;
  return `@echo off
REM Launcher for ${name} — auto-starts beam and opens PWA
setlocal enabledelayedexpansion

set "PHOTON_DIR=${photonDir}"
set START_PORT=${startPort}
set END_PORT=${endPort}

REM Scan ports for an existing beam serving this directory
for /L %%p in (%START_PORT%,1,%END_PORT%) do (
  for /f "delims=" %%r in ('curl -s --max-time 2 "http://localhost:%%p/api/diagnostics" 2^>nul') do (
    echo %%r | findstr /c:"%PHOTON_DIR%" >nul 2>&1
    if !errorlevel! equ 0 (
      start "" "http://localhost:%%p"
      exit /b 0
    )
  )
)

REM No existing beam found — start one
start /b npx @portel/photon beam --dir="%PHOTON_DIR%" --port=%START_PORT%

REM Poll until beam is ready (up to 30s)
set WAITED=0
:poll
if %WAITED% geq 30 (
  echo Error: beam did not start within 30 seconds
  exit /b 1
)
for /L %%p in (%START_PORT%,1,%END_PORT%) do (
  for /f "delims=" %%r in ('curl -s --max-time 1 "http://localhost:%%p/api/diagnostics" 2^>nul') do (
    echo %%r | findstr /c:"%PHOTON_DIR%" >nul 2>&1
    if !errorlevel! equ 0 (
      start "" "http://localhost:%%p"
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
  photonDir: string,
  startPort: number,
  outputDir: string
): Promise<string> {
  const appDir = path.join(outputDir, `${className}.app`);
  const contentsDir = path.join(appDir, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');

  await fs.mkdir(macosDir, { recursive: true });
  await fs.writeFile(path.join(contentsDir, 'Info.plist'), generateInfoPlist(name, className));
  const script = generateBashLauncherScript(name, photonDir, startPort, 'open');
  await fs.writeFile(path.join(macosDir, 'launch'), script, { mode: 0o755 });

  return appDir;
}

async function generateLinuxLauncher(
  name: string,
  photonDir: string,
  startPort: number,
  outputDir: string
): Promise<[string, string]> {
  const shPath = path.join(outputDir, `${name}.sh`);
  const desktopPath = path.join(outputDir, `${name}.desktop`);

  const script = generateBashLauncherScript(name, photonDir, startPort, 'xdg-open');
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
  photonDir: string,
  startPort: number,
  outputDir: string
): Promise<string> {
  const batPath = path.join(outputDir, `${name}.bat`);
  await fs.writeFile(batPath, generateWindowsBat(name, photonDir, startPort));
  return batPath;
}

export function registerPackageAppCommand(program: Command, defaultWorkingDir: string): void {
  program
    .command('package')
    .argument('<name>', 'Photon name to package')
    .option('--output <dir>', 'Output directory', process.cwd())
    .option('--port <number>', 'Preferred start port', '3000')
    .description('Generate cross-platform PWA launchers for a photon')
    .action(async (name: string, options: any, command: Command) => {
      const workingDir = command.parent?.opts().dir || defaultWorkingDir;
      const outputDir = path.resolve(options.output);
      const startPort = parseInt(options.port, 10);

      // Resolve the photon directory
      const photonDir = path.resolve(workingDir, name);
      if (!existsSync(photonDir)) {
        console.error(`Error: photon directory not found: ${photonDir}`);
        process.exit(1);
      }

      const className = toClassName(name);

      console.log(`\n📦 Packaging ${name}...\n`);

      await fs.mkdir(outputDir, { recursive: true });

      // Generate all platform launchers
      const macAppPath = await generateMacOSApp(name, className, photonDir, startPort, outputDir);
      const [linuxShPath, linuxDesktopPath] = await generateLinuxLauncher(
        name,
        photonDir,
        startPort,
        outputDir
      );
      const winBatPath = await generateWindowsLauncher(name, photonDir, startPort, outputDir);

      console.log(`   ✓ macOS    ${macAppPath}`);
      console.log(`   ✓ Linux    ${linuxShPath}, ${path.basename(linuxDesktopPath)}`);
      console.log(`   ✓ Windows  ${winBatPath}`);
      console.log();
    });
}
