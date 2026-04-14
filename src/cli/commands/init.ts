/**
 * Init & Uninit CLI Command Groups
 *
 * init:   Setup and shell integration (cli, daemon, all, completions)
 * uninit: Remove integrations (cli, daemon)
 */

import type { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { getErrorMessage } from '../../shared/error-handler.js';
import { getDefaultContext } from '../../context.js';

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register the init command group
 *
 * Subcommands: cli, daemon, all, completions
 */
export function registerInitCommands(program: Command): void {
  const initCmd = program.command('init').description('Setup and shell integration');

  // ── init cli ────────────────────────────────────────────────────────────────

  initCmd
    .command('cli')
    .option('--hook', 'Output the shell hook script (used internally by eval/Invoke-Expression)')
    .description('Set up shell integration for direct photon commands and tab completion')
    .action(async (options: { hook?: boolean }) => {
      const { printInfo, printSuccess, printError } = await import('../../cli-formatter.js');

      // Detect shell type
      const userShell = process.env.SHELL || '';
      const isPowerShell = !!process.env.PSModulePath;
      const isZsh = !isPowerShell && userShell.includes('zsh');
      const isBash = !isPowerShell && userShell.includes('bash');

      type ShellType = 'zsh' | 'bash' | 'powershell' | 'unsupported';
      let shellType: ShellType = 'unsupported';
      if (isZsh) shellType = 'zsh';
      else if (isBash) shellType = 'bash';
      else if (isPowerShell || process.platform === 'win32') shellType = 'powershell';

      // Unsupported shell — show supported list and exit
      if (shellType === 'unsupported') {
        const detected = userShell ? path.basename(userShell) : 'unknown';
        printError(`Unsupported shell: ${detected}`);
        console.log('');
        console.log('  Supported shells:');
        console.log('    zsh         ~/.zshrc           (macOS default)');
        console.log('    bash        ~/.bashrc          (Linux default)');
        console.log('    PowerShell  $PROFILE           (Windows default, cross-platform)');
        console.log('');
        console.log('  To use a specific shell, set $SHELL and retry:');
        console.log('    SHELL=/bin/zsh photon init cli');
        process.exit(1);
      }

      // RC file and eval/invoke line per shell
      let rcFile: string;
      let evalLine: string;
      const marker = '# photon shell integration';

      if (shellType === 'powershell') {
        // PowerShell profile path: cross-platform
        rcFile =
          process.platform === 'win32'
            ? path.join(os.homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')
            : path.join(os.homedir(), '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1');
        evalLine = 'Invoke-Expression (& photon init cli --hook)';
      } else {
        rcFile = isZsh ? path.join(os.homedir(), '.zshrc') : path.join(os.homedir(), '.bashrc');
        evalLine = 'eval "$(photon init cli --hook)"';
      }

      // Build the shell hook script. Extracted so the install path can also
      // emit it on stdout when invoked via `eval "$(photon init cli)"`.
      const buildHookScript = async (): Promise<string> => {
        const photonDir = getDefaultContext().baseDir;
        let photonNames: string[] = [];
        try {
          const entries = await fs.readdir(photonDir);
          photonNames = entries
            .filter((e) => /\.photon\.(ts|js)$/.test(e))
            .map((e) => e.replace(/\.photon\.(ts|js)$/, ''));
        } catch {
          // ~/.photon/ doesn't exist yet
        }

        if (shellType === 'zsh') {
          const functions = photonNames
            .map((name) => `${name}() { photon cli ${name} "$@"; }`)
            .join('\n');

          return `${marker}

# Shell functions for installed photons (direct invocation)
${functions}

# Fallback for newly installed photons (before shell restart)
command_not_found_handler() {
  if [ -f "$HOME/.photon/\$1.photon.ts" ] || [ -f "$HOME/.photon/\$1.photon.js" ]; then
    photon cli "$@"
    return $?
  fi
  echo "zsh: command not found: \$1" >&2
  return 127
}

# Tab completion for photon methods, params, and instances
_photon_cache="$HOME/.photon/cache/completions.cache"

_photon_complete_direct() {
  local cmd="\$words[1]"
  local curcontext="\$curcontext" state line
  _arguments -C "1: :->method" "*::arg:->params"
  case "\$state" in
    method)
      if [[ -f "\$_photon_cache" ]]; then
        local -a methods
        methods=("\${(@f)$(grep "^method:\${cmd}:" "\$_photon_cache" | while IFS=: read -r _ _ name desc; do echo "\${name}:\${desc}"; done)}")
        _describe 'method' methods
      fi
      ;;
    params)
      if [[ -f "\$_photon_cache" ]]; then
        local method="\$line[1]"
        local -a params
        params=("\${(@f)$(grep "^param:\${cmd}:\${method}:" "\$_photon_cache" | while IFS=: read -r _ _ _ name type req; do echo "--\${name}[\${type}]"; done)}")
        _describe 'parameter' params
      fi
      ;;
  esac
}

# Register completion for each photon function (guard for non-interactive shells)
if (( $+functions[compdef] )); then
${photonNames.map((name) => `  compdef _photon_complete_direct ${name}`).join('\n')}
fi

# Completion for the photon command itself
_photon() {
  local curcontext="\$curcontext" state line
  _arguments -C \\
    "1: :->cmds" \\
    "*::arg:->args"
  case "\$state" in
    cmds)
      local -a builtins
      builtins=(
        'cli:Run a photon method'
        'use:Switch to a named instance'
        'instances:List instances of a photon'
        'set:Configure environment for a photon'
        'beam:Start the interactive UI'
        'serve:Start MCP stdio server'
        'list:List installed photons'
        'add:Install a photon'
        'remove:Uninstall a photon'
        'search:Search for photons'
        'info:Show photon details'
        'init:Setup and shell integration'
        'uninit:Remove integrations'
        'test:Run photon tests'
        'doctor:Check system health'
      )
      _describe 'command' builtins
      ;;
    args)
      case \$line[1] in
        cli)
          local curcontext="\$curcontext" state line
          _arguments -C "1: :->photon_name" "*::arg:->method_args"
          case "\$state" in
            photon_name)
              if [[ -f "\$_photon_cache" ]]; then
                local -a photons
                photons=("\${(@f)$(grep "^photon:" "\$_photon_cache" | while IFS=: read -r _ name desc; do echo "\${name}:\${desc}"; done)}")
                _describe 'photon' photons
              fi
              ;;
            method_args)
              words[1]="\$line[1]"
              _photon_complete_direct
              ;;
          esac
          ;;
        use|instances|set|info|serve)
          if [[ -f "\$_photon_cache" ]]; then
            local curcontext="\$curcontext" state line
            _arguments -C "1: :->photon_name" "*::arg:->instance"
            case "\$state" in
              photon_name)
                local -a photons
                photons=("\${(@f)$(grep "^photon:" "\$_photon_cache" | while IFS=: read -r _ name desc; do echo "\${name}:\${desc}"; done)}")
                _describe 'photon' photons
                ;;
              instance)
                if [[ "\$line[-2]" == "use" ]]; then
                  local -a instances
                  instances=("\${(@f)$(grep "^instance:\${line[1]}:" "\$_photon_cache" | cut -d: -f3)}")
                  [[ \${#instances} -gt 0 ]] && _describe 'instance' instances
                fi
                ;;
            esac
          fi
          ;;
        init)
          local -a subcmds
          subcmds=('cli:Set up shell integration' 'completions:Manage completion cache')
          _describe 'subcommand' subcmds
          ;;
        uninit)
          local -a subcmds
          subcmds=('cli:Remove shell integration')
          _describe 'subcommand' subcmds
          ;;
      esac
      ;;
  esac
}

if (( $+functions[compdef] )); then
  compdef _photon photon
fi`;
        } else if (shellType === 'bash') {
          const functions = photonNames
            .map((name) => `${name}() { photon cli ${name} "$@"; }`)
            .join('\n');

          return `${marker}

# Shell functions for installed photons (direct invocation)
${functions}

# Fallback for newly installed photons (before shell restart)
command_not_found_handle() {
  if [ -f "$HOME/.photon/\$1.photon.ts" ] || [ -f "$HOME/.photon/\$1.photon.js" ]; then
    photon cli "$@"
    return $?
  fi
  echo "bash: \$1: command not found" >&2
  return 127
}

# Tab completion for photon methods, params, and instances
_photon_cache="$HOME/.photon/cache/completions.cache"

_photon_complete_direct() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local cmd="\${COMP_WORDS[0]}"
  COMPREPLY=()

  if [[ ! -f "\$_photon_cache" ]]; then return; fi

  if [[ \$COMP_CWORD -eq 1 ]]; then
    local methods
    methods="$(grep "^method:\${cmd}:" "\$_photon_cache" | cut -d: -f3)"
    COMPREPLY=($(compgen -W "\$methods" -- "\$cur"))
  elif [[ \$COMP_CWORD -eq 2 ]]; then
    local method="\${COMP_WORDS[1]}"
    local params
    params="$(grep "^param:\${cmd}:\${method}:" "\$_photon_cache" | cut -d: -f4 | sed 's/^/--/')"
    COMPREPLY=($(compgen -W "\$params" -- "\$cur"))
  fi
}

_photon_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  COMPREPLY=()

  if [[ ! -f "\$_photon_cache" ]]; then return; fi

  if [[ \$COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -W "cli use instances set beam serve list add remove search info init uninit test doctor" -- "\$cur"))
  elif [[ \$COMP_CWORD -eq 2 ]]; then
    case "\${COMP_WORDS[1]}" in
      cli|use|instances|set|info|serve)
        local photons
        photons="$(grep "^photon:" "\$_photon_cache" | cut -d: -f2)"
        COMPREPLY=($(compgen -W "\$photons" -- "\$cur"))
        ;;
      init)
        COMPREPLY=($(compgen -W "cli completions" -- "\$cur"))
        ;;
      uninit)
        COMPREPLY=($(compgen -W "cli" -- "\$cur"))
        ;;
    esac
  elif [[ \$COMP_CWORD -eq 3 ]]; then
    case "\${COMP_WORDS[1]}" in
      cli)
        local methods
        methods="$(grep "^method:\${COMP_WORDS[2]}:" "\$_photon_cache" | cut -d: -f3)"
        COMPREPLY=($(compgen -W "\$methods" -- "\$cur"))
        ;;
      use)
        local instances
        instances="$(grep "^instance:\${COMP_WORDS[2]}:" "\$_photon_cache" | cut -d: -f3)"
        COMPREPLY=($(compgen -W "\$instances" -- "\$cur"))
        ;;
    esac
  elif [[ \$COMP_CWORD -ge 4 && "\${COMP_WORDS[1]}" == "cli" ]]; then
    local params
    params="$(grep "^param:\${COMP_WORDS[2]}:\${COMP_WORDS[3]}:" "\$_photon_cache" | cut -d: -f4 | sed 's/^/--/')"
    COMPREPLY=($(compgen -W "\$params" -- "\$cur"))
  fi
}

# Register completions
${photonNames.map((name) => `complete -F _photon_complete_direct ${name}`).join('\n')}
complete -F _photon_complete photon`;
        } else if (shellType === 'powershell') {
          // PowerShell functions and completion
          const functions = photonNames
            .map((name) => `function ${name} { photon cli ${name} @Args }`)
            .join('\n');

          return `${marker}

# Functions for installed photons (direct invocation)
${functions}

# Fallback for newly installed photons (CommandNotFoundAction, PowerShell 7.4+)
if ($PSVersionTable.PSVersion.Major -ge 7 -and $PSVersionTable.PSVersion.Minor -ge 4) {
  $ExecutionContext.InvokeCommand.CommandNotFoundAction = {
    param($Name, $EventArgs)
    $photonFile = Join-Path $HOME ".photon" "$Name.photon.ts"
    $photonFileJs = Join-Path $HOME ".photon" "$Name.photon.js"
    if ((Test-Path $photonFile) -or (Test-Path $photonFileJs)) {
      $EventArgs.CommandScriptBlock = { photon cli $Name @Args }.GetNewClosure()
      $EventArgs.StopSearch = $true
    }
  }
}

# Tab completion for photon methods, params, and instances
$_photonCache = Join-Path $HOME ".photon" "cache" "completions.cache"

# Completion for direct photon commands
${photonNames
  .map(
    (name) => `Register-ArgumentCompleter -CommandName ${name} -ScriptBlock {
  param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
  if (-not (Test-Path $_photonCache)) { return }
  $pos = $commandAst.CommandElements.Count
  if ($pos -le 1) {
    # Complete method names
    Get-Content $_photonCache | Where-Object { $_ -match "^method:\${commandName}:" } | ForEach-Object {
      $parts = $_ -split ':', 4
      [System.Management.Automation.CompletionResult]::new($parts[2], $parts[2], 'ParameterValue', ($parts[3] ?? $parts[2]))
    } | Where-Object { $_.CompletionText -like "$wordToComplete*" }
  } elseif ($pos -le 2) {
    # Complete parameter names
    $method = $commandAst.CommandElements[1].Value
    Get-Content $_photonCache | Where-Object { $_ -match "^param:\${commandName}:\${method}:" } | ForEach-Object {
      $parts = $_ -split ':', 6
      $paramName = "--$($parts[3])"
      [System.Management.Automation.CompletionResult]::new($paramName, $paramName, 'ParameterName', "$($parts[4]) parameter")
    } | Where-Object { $_.CompletionText -like "$wordToComplete*" }
  }
}`
  )
  .join('\n')}

# Completion for the photon command itself
Register-ArgumentCompleter -CommandName photon -ScriptBlock {
  param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
  $pos = $commandAst.CommandElements.Count
  if ($pos -le 1) {
    @('cli','use','instances','set','beam','serve','list','add','remove','search','info','init','uninit','test','doctor') |
      Where-Object { $_ -like "$wordToComplete*" } |
      ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
  } elseif ($pos -le 2) {
    $sub = $commandAst.CommandElements[1].Value
    switch ($sub) {
      { $_ -in 'cli','use','instances','set','info','serve' } {
        if (Test-Path $_photonCache) {
          Get-Content $_photonCache | Where-Object { $_ -match "^photon:" } | ForEach-Object {
            $parts = $_ -split ':', 3
            [System.Management.Automation.CompletionResult]::new($parts[1], $parts[1], 'ParameterValue', ($parts[2] ?? $parts[1]))
          } | Where-Object { $_.CompletionText -like "$wordToComplete*" }
        }
      }
      'init' {
        @('cli','completions') | Where-Object { $_ -like "$wordToComplete*" } |
          ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
      }
      'uninit' {
        @('cli') | Where-Object { $_ -like "$wordToComplete*" } |
          ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
      }
    }
  } elseif ($pos -le 3) {
    $sub = $commandAst.CommandElements[1].Value
    $photonName = $commandAst.CommandElements[2].Value
    if ($sub -eq 'cli' -and (Test-Path $_photonCache)) {
      Get-Content $_photonCache | Where-Object { $_ -match "^method:\${photonName}:" } | ForEach-Object {
        $parts = $_ -split ':', 4
        [System.Management.Automation.CompletionResult]::new($parts[2], $parts[2], 'ParameterValue', ($parts[3] ?? $parts[2]))
      } | Where-Object { $_.CompletionText -like "$wordToComplete*" }
    } elseif ($sub -eq 'use' -and (Test-Path $_photonCache)) {
      Get-Content $_photonCache | Where-Object { $_ -match "^instance:\${photonName}:" } | ForEach-Object {
        $parts = $_ -split ':', 3
        [System.Management.Automation.CompletionResult]::new($parts[2], $parts[2], 'ParameterValue', $parts[2])
      } | Where-Object { $_.CompletionText -like "$wordToComplete*" }
    }
  }
}`;
        }
        return '';
      };

      // Ensure the completions cache exists before emitting any hook script.
      const ensureCompletionsCache = async () => {
        const { CACHE_FILE, generateCompletionCache } = await import('../../shell-completions.js');
        try {
          await fs.access(CACHE_FILE);
        } catch {
          await generateCompletionCache();
        }
      };

      // --hook flag: output the hook script only.
      if (options.hook) {
        await ensureCompletionsCache();
        console.log(await buildHookScript());
        return;
      }

      // When stdout is captured (e.g. `eval "$(photon init cli)"`), emit the
      // hook script directly so the current shell activates immediately.
      // All status messages go to stderr so they don't pollute the eval stream.
      const stdoutIsTTY = process.stdout.isTTY;
      const say = (msg: string) => {
        if (stdoutIsTTY) console.log(msg);
        else console.error(msg);
      };
      const sayOk = (msg: string) => {
        if (stdoutIsTTY) printSuccess(msg);
        else console.error(`✓ ${msg}`);
      };
      const sayInfo = (msg: string) => {
        if (stdoutIsTTY) printInfo(msg);
        else console.error(`ℹ ${msg}`);
      };

      // Interactive mode → install into rc file
      try {
        // Ensure profile directory exists (PowerShell profile dir may not)
        const rcDir = path.dirname(rcFile);
        await fs.mkdir(rcDir, { recursive: true });

        let rcContent = '';
        try {
          rcContent = await fs.readFile(rcFile, 'utf-8');
        } catch {
          // rc file doesn't exist, we'll create it
        }

        const alreadyInstalled = rcContent.includes(marker) || rcContent.includes(evalLine);

        if (alreadyInstalled) {
          sayInfo(`Shell integration already installed in ${rcFile}`);
        } else {
          // Remove old eval line if migrating from `photon shell init`
          const oldEvalLines = [
            'eval "$(photon shell init --hook)"',
            'Invoke-Expression (& photon shell init --hook)',
          ];
          let cleaned = rcContent;
          for (const old of oldEvalLines) {
            cleaned = cleaned
              .split('\n')
              .filter((l) => !l.includes(old))
              .join('\n');
          }
          if (cleaned !== rcContent) {
            await fs.writeFile(rcFile, cleaned, 'utf-8');
          }

          const block = `\n${marker}\n${evalLine}\n`;
          await fs.appendFile(rcFile, block);
        }

        await ensureCompletionsCache();

        // When stdout is captured (eval "$(photon init cli)"), emit the hook
        // script to stdout so the current shell activates immediately.
        if (!stdoutIsTTY) {
          process.stdout.write(await buildHookScript());
          process.stdout.write('\n');
        }

        if (!alreadyInstalled) sayOk(`Installed shell integration into ${rcFile}`);
        say('');
        if (stdoutIsTTY) {
          // Not captured — user needs to take one more step to activate.
          say(`  Activate in this shell:`);
          if (shellType === 'powershell') {
            say(`    Invoke-Expression (& photon init cli --hook)`);
          } else {
            say(`    eval "$(photon init cli --hook)"`);
          }
          say('');
          say(`  Or run with eval to install + activate in one step:`);
          if (shellType === 'powershell') {
            say(`    Invoke-Expression (& photon init cli)`);
          } else {
            say(`    eval "$(photon init cli)"`);
          }
          say('');
          say(`  New shells will pick it up automatically.`);
        } else {
          sayOk('Activated in current shell.');
        }
      } catch (error) {
        printError(`Failed to update ${rcFile}: ${getErrorMessage(error)}`);
        console.log(`  Add this line manually to your shell profile:`);
        console.log(`    ${evalLine}`);
        process.exit(1);
      }
    });

  // ── init daemon ─────────────────────────────────────────────────────────────

  initCmd
    .command('daemon')
    .description('Set up daemon auto-start on login (launchd / systemd)')
    .action(async () => {
      const { printSuccess, printError } = await import('../../cli-formatter.js');

      const platform = process.platform;
      const photonBin = process.execPath.replace(/node$/, 'photon');
      // Resolve the actual photon binary path from PATH
      let photonExe: string;
      try {
        const { execSync } = await import('child_process');
        photonExe =
          platform === 'win32'
            ? execSync('where photon', { encoding: 'utf-8' }).trim().split('\n')[0].trim()
            : execSync('which photon', { encoding: 'utf-8' }).trim();
      } catch {
        photonExe = photonBin;
      }

      if (platform === 'darwin') {
        // macOS: launchd plist in ~/Library/LaunchAgents/
        const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
        const plistPath = path.join(plistDir, 'dev.photon.daemon.plist');
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.photon.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${photonExe}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${os.homedir()}/.photon/daemon-init.log</string>
  <key>StandardErrorPath</key>
  <string>${os.homedir()}/.photon/daemon-init.log</string>
</dict>
</plist>
`;
        await fs.mkdir(plistDir, { recursive: true });
        await fs.writeFile(plistPath, plistContent, 'utf-8');
        printSuccess(`Daemon auto-start registered: ${plistPath}`);
        console.log('');
        console.log('  The daemon will start automatically at next login.');
        console.log('  To start it now without logging out:');
        console.log(`    launchctl load ${plistPath}`);
        console.log('');
        console.log('  To remove: photon uninit daemon');
      } else if (platform === 'linux') {
        // Linux: systemd user service
        const systemdDir = path.join(os.homedir(), '.config', 'systemd', 'user');
        const servicePath = path.join(systemdDir, 'photon-daemon.service');
        const serviceContent = `[Unit]
Description=Photon background daemon
After=default.target

[Service]
ExecStart=${photonExe} daemon start
Type=oneshot
RemainAfterExit=no

[Install]
WantedBy=default.target
`;
        await fs.mkdir(systemdDir, { recursive: true });
        await fs.writeFile(servicePath, serviceContent, 'utf-8');
        printSuccess(`Daemon service written: ${servicePath}`);
        console.log('');
        console.log('  Enable auto-start:');
        console.log('    systemctl --user enable photon-daemon');
        console.log('    systemctl --user start photon-daemon');
        console.log('');
        console.log('  (Requires systemd with lingering: loginctl enable-linger)');
        console.log('');
        console.log('  To remove: photon uninit daemon');
      } else if (platform === 'win32') {
        // Windows: Task Scheduler via schtasks
        const taskName = 'PhotonDaemon';
        try {
          const { execSync } = await import('child_process');
          execSync(
            `schtasks /create /tn "${taskName}" /tr "${photonExe} daemon start" /sc onlogon /f`,
            { stdio: 'ignore' }
          );
          printSuccess(`Task Scheduler entry created: ${taskName}`);
          console.log('');
          console.log('  The daemon will start at next login.');
          console.log('  To remove: photon uninit daemon');
        } catch {
          printError('Failed to create Task Scheduler entry. Try running as Administrator.');
          console.log('');
          console.log('  Manual alternative: add to startup folder:');
          console.log(`    ${photonExe} daemon start`);
        }
      } else {
        printError(`Unsupported platform: ${platform}`);
        console.log('  Supported: macOS (launchd), Linux (systemd), Windows (Task Scheduler)');
        process.exit(1);
      }
    });

  // ── init all ────────────────────────────────────────────────────────────────

  initCmd
    .command('all')
    .description('Run all setup steps: shell integration + daemon auto-start')
    .action(async () => {
      const { printSuccess } = await import('../../cli-formatter.js');
      const { execFileSync } = await import('child_process');
      const cli = process.argv[1]; // path to this CLI script

      console.log('Setting up Photon...\n');

      console.log('Step 1/2: Shell integration');
      try {
        execFileSync(process.execPath, [cli, 'init', 'cli'], { stdio: 'inherit' });
      } catch {
        // error already printed by the subcommand
      }

      console.log('');

      console.log('Step 2/2: Daemon auto-start');
      try {
        execFileSync(process.execPath, [cli, 'init', 'daemon'], { stdio: 'inherit' });
      } catch {
        // error already printed by the subcommand
      }

      console.log('');
      printSuccess('Photon setup complete.');
    });

  // ── init completions ─────────────────────────────────────────────────────────

  initCmd
    .command('completions')
    .option('--generate', 'Regenerate the completions cache')
    .description('Manage shell completion cache')
    .action(async (options: { generate?: boolean }) => {
      const { printInfo, printSuccess } = await import('../../cli-formatter.js');
      const { generateCompletionCache, CACHE_FILE } = await import('../../shell-completions.js');

      if (options.generate) {
        await generateCompletionCache();
        printSuccess(`Completions cache updated: ${CACHE_FILE}`);
        return;
      }

      // Default: show cache status
      try {
        const stat = await fs.stat(CACHE_FILE);
        const age = Date.now() - stat.mtimeMs;
        const ageStr =
          age < 60_000
            ? 'just now'
            : age < 3_600_000
              ? `${Math.floor(age / 60_000)}m ago`
              : `${Math.floor(age / 3_600_000)}h ago`;
        printInfo(`Cache: ${CACHE_FILE}`);
        console.log(`  Last updated: ${ageStr}`);
        console.log(`  Run \`photon init completions --generate\` to refresh`);
      } catch {
        printInfo('No completions cache found.');
        console.log('  Run `photon init completions --generate` to create one.');
      }
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// UNINIT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register the uninit command group
 *
 * Subcommands: cli, daemon
 */
export function registerUninitCommands(program: Command): void {
  const uninitCmd = program.command('uninit').description('Remove integrations');

  // ── uninit cli ───────────────────────────────────────────────────────────────

  uninitCmd
    .command('cli')
    .description('Remove shell integration')
    .action(async () => {
      const { printInfo, printSuccess, printError } = await import('../../cli-formatter.js');

      // Detect shell type
      const userShell = process.env.SHELL || '';
      const isPowerShell = !!process.env.PSModulePath;
      const isZsh = !isPowerShell && userShell.includes('zsh');
      const isBash = !isPowerShell && userShell.includes('bash');

      let rcFile: string;
      if (isPowerShell || process.platform === 'win32') {
        rcFile =
          process.platform === 'win32'
            ? path.join(os.homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')
            : path.join(os.homedir(), '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1');
      } else if (isZsh) {
        rcFile = path.join(os.homedir(), '.zshrc');
      } else if (isBash) {
        rcFile = path.join(os.homedir(), '.bashrc');
      } else {
        const detected = userShell ? path.basename(userShell) : 'unknown';
        printError(`Unsupported shell: ${detected}`);
        process.exit(1);
        return; // unreachable but satisfies TS
      }

      let rcContent: string;
      try {
        rcContent = await fs.readFile(rcFile, 'utf-8');
      } catch {
        printInfo(`No rc file found at ${rcFile}`);
        return;
      }

      const marker = '# photon shell integration';
      const removePats = [marker, 'photon shell init --hook', 'photon init cli --hook'];

      const lines = rcContent.split('\n');
      const filtered = lines.filter((line) => !removePats.some((pat) => line.includes(pat)));

      if (filtered.length === lines.length) {
        printInfo('No shell integration found to remove.');
        return;
      }

      // Clean up trailing blank lines left by removal
      let result = filtered.join('\n');
      result = result.replace(/\n{3,}/g, '\n\n');

      await fs.writeFile(rcFile, result, 'utf-8');
      printSuccess(`Removed shell integration from ${rcFile}`);
      if (isPowerShell || process.platform === 'win32') {
        console.log('  Run: . $PROFILE  (or restart PowerShell)');
      } else {
        console.log(`  Run: exec $SHELL  (or restart your terminal)`);
      }
    });

  // ── uninit daemon ────────────────────────────────────────────────────────────

  uninitCmd
    .command('daemon')
    .description('Remove daemon auto-start')
    .action(async () => {
      const { printInfo, printSuccess, printError } = await import('../../cli-formatter.js');

      const platform = process.platform;

      if (platform === 'darwin') {
        const plistPath = path.join(
          os.homedir(),
          'Library',
          'LaunchAgents',
          'dev.photon.daemon.plist'
        );
        try {
          const { execSync } = await import('child_process');
          try {
            execSync(`launchctl unload ${plistPath}`, { stdio: 'ignore' });
          } catch {
            // already unloaded — fine
          }
          await fs.unlink(plistPath);
          printSuccess('Daemon auto-start removed.');
        } catch {
          printInfo('No daemon auto-start found (plist not present).');
        }
      } else if (platform === 'linux') {
        const servicePath = path.join(
          os.homedir(),
          '.config',
          'systemd',
          'user',
          'photon-daemon.service'
        );
        try {
          const { execSync } = await import('child_process');
          try {
            execSync('systemctl --user disable photon-daemon', { stdio: 'ignore' });
          } catch {
            // may already be disabled
          }
          await fs.unlink(servicePath);
          printSuccess('Daemon service removed.');
        } catch {
          printInfo('No systemd daemon service found.');
        }
      } else if (platform === 'win32') {
        try {
          const { execSync } = await import('child_process');
          execSync('schtasks /delete /tn "PhotonDaemon" /f', { stdio: 'ignore' });
          printSuccess('Task Scheduler entry removed.');
        } catch {
          printInfo('No Task Scheduler entry found.');
        }
      } else {
        printError(`Unsupported platform: ${platform}`);
        process.exit(1);
      }
    });
}
