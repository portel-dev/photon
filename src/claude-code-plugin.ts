/**
 * Claude Code Plugin Generator
 *
 * Generates Claude Code plugin files from a Photon marketplace
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

/**
 * Generate Claude Code plugin files
 */
export async function generateClaudeCodePlugin(
  dirPath: string,
  options: { name?: string; description?: string; owner?: string }
): Promise<void> {
  const resolvedPath = path.resolve(dirPath);

  console.error('\n🔌 Generating Claude Code plugin...');

  // Read the marketplace manifest
  const manifestPath = path.join(resolvedPath, '.marketplace', 'photons.json');
  if (!existsSync(manifestPath)) {
    console.error('❌ No marketplace manifest found. Run without --claude-code first.');
    return;
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

  // Create .claude-plugin directory
  const pluginDir = path.join(resolvedPath, '.claude-plugin');
  await fs.mkdir(pluginDir, { recursive: true });

  const scriptsDir = path.join(pluginDir, 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  // Generate marketplace.json for Claude Code
  await generateMarketplaceJson(pluginDir, manifest, options);

  // Generate hooks.json
  await generateHooksJson(pluginDir);

  // Generate shell scripts
  await generateCheckPhotonScript(scriptsDir);
  await generateSetupScript(scriptsDir);

  console.error('   ✓ .claude-plugin/marketplace.json');
  console.error('   ✓ .claude-plugin/hooks.json');
  console.error('   ✓ .claude-plugin/scripts/check-photon.sh');
  console.error('   ✓ .claude-plugin/scripts/setup-photon.sh');

  console.error('\n✅ Claude Code plugin generated successfully!');
  console.error('\nUsers can install with:');
  console.error('  /plugin marketplace add <your-repo>');
  console.error('  /plugin install photons@<your-marketplace>');
}

/**
 * Generate marketplace.json for Claude Code plugin
 */
async function generateMarketplaceJson(
  pluginDir: string,
  manifest: any,
  options: any
): Promise<void> {
  // Create one plugin per photon
  const plugins: any[] = [];

  for (const photon of manifest.photons || []) {
    const serverName = `photon-${photon.name}`;

    // Get constructor params to determine env vars
    const envVars = await extractEnvVars(photon);

    const mcpConfig: any = {
      command: 'photon',
      args: ['mcp', photon.name]
    };

    if (Object.keys(envVars).length > 0) {
      mcpConfig.env = envVars;
    }

    plugins.push({
      name: serverName,
      description: photon.description || `${photon.name} photon MCP server`,
      source: './',
      strict: false,
      hooks: [
        './.claude-plugin/hooks.json'
      ],
      mcpServers: {
        [serverName]: mcpConfig
      }
    });
  }

  const pluginManifest = {
    name: `${manifest.name}-marketplace`,
    owner: options.owner ? {
      name: options.owner,
      email: 'contact@portel.dev'
    } : (manifest.owner || {
      name: 'Portel',
      email: 'contact@portel.dev'
    }),
    metadata: {
      description: manifest.description || options.description || `Official ${manifest.name} MCP servers`,
      version: manifest.version || '1.0.0'
    },
    plugins
  };

  const outputPath = path.join(pluginDir, 'marketplace.json');
  await fs.writeFile(outputPath, JSON.stringify(pluginManifest, null, 2), 'utf-8');
}

/**
 * Extract environment variables from photon metadata
 */
async function extractEnvVars(photon: any): Promise<Record<string, string>> {
  // For now, return empty object
  // In the future, we could parse the source file to extract constructor params
  // But for simplicity, we'll use env var expansion with empty defaults

  // This would require reading and parsing the photon file
  // For now, we'll keep it simple and let users configure manually
  return {};
}

/**
 * Generate hooks.json for SessionStart
 */
async function generateHooksJson(pluginDir: string): Promise<void> {
  const hooks = {
    SessionStart: [
      {
        matcher: '.*',
        hooks: [
          {
            type: 'command',
            command: 'bash ${CLAUDE_PLUGIN_ROOT}/scripts/check-photon.sh',
            timeout: 120
          }
        ]
      }
    ]
  };

  const outputPath = path.join(pluginDir, 'hooks.json');
  await fs.writeFile(outputPath, JSON.stringify(hooks, null, 2), 'utf-8');
}

/**
 * Generate check-photon.sh script
 */
async function generateCheckPhotonScript(scriptsDir: string): Promise<void> {
  const script = `#!/bin/bash
# Check if Photon CLI is installed, install if missing

# Check if photon command exists and is from @portel/photon
if command -v photon &> /dev/null; then
  # Verify it's the right package by checking if it has the expected commands
  if photon --version &> /dev/null && photon get --help &> /dev/null 2>&1; then
    # Photon CLI is installed and working
    exit 0
  fi
fi

# Photon not found or not working, install it
echo "📦 Installing Photon CLI..." >&2
npm install -g @portel/photon &> /dev/null

if [ $? -eq 0 ]; then
  echo "✅ Photon CLI installed successfully" >&2
else
  echo "❌ Failed to install Photon CLI. Please run: npm install -g @portel/photon" >&2
  exit 1
fi
`;

  const outputPath = path.join(scriptsDir, 'check-photon.sh');
  await fs.writeFile(outputPath, script, { mode: 0o755 });
}

/**
 * Generate setup-photon.sh interactive configuration script
 */
async function generateSetupScript(scriptsDir: string): Promise<void> {
  const script = `#!/bin/bash
# Interactive setup script for Photon MCP credentials
# This script helps users configure photons without sharing secrets with AI

set -e

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

# Get OS-specific Claude Code config path
get_config_path() {
  case "$(uname -s)" in
    Darwin*)
      echo "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
      ;;
    Linux*)
      echo "$HOME/.config/Claude/claude_desktop_config.json"
      ;;
    CYGWIN*|MINGW*|MSYS*)
      echo "$APPDATA/Claude/claude_desktop_config.json"
      ;;
    *)
      echo "$HOME/.config/Claude/claude_desktop_config.json"
      ;;
  esac
}

CONFIG_PATH=$(get_config_path)

echo -e "\${BLUE}═══════════════════════════════════════════════════════════\${NC}"
echo -e "\${BLUE}           Photon MCP Configuration Setup\${NC}"
echo -e "\${BLUE}═══════════════════════════════════════════════════════════\${NC}"
echo ""
echo -e "This will help you configure photons that require credentials."
echo -e "Your credentials will be stored in: \${YELLOW}\${CONFIG_PATH}\${NC}"
echo -e "\${GREEN}(Credentials are NOT shared with Claude AI)\${NC}"
echo ""

# Check if photon CLI is installed
if ! command -v photon &> /dev/null; then
  echo -e "\${RED}❌ Photon CLI not found.\${NC}"
  echo -e "Installing..."
  npm install -g @portel/photon

  if [ $? -ne 0 ]; then
    echo -e "\${RED}Failed to install Photon CLI\${NC}"
    exit 1
  fi
fi

# Get list of all available photons
echo -e "\${BLUE}Fetching available photons...\${NC}"
PHOTONS=$(photon get 2>/dev/null | grep "📦" | awk '{print $2}' | sort)

if [ -z "$PHOTONS" ]; then
  echo -e "\${YELLOW}No photons found in ~/.photon/\${NC}"
  echo -e "Install photons from the marketplace first:"
  echo -e "  photon add <name>"
  exit 0
fi

# List photons that need configuration (have env vars)
echo ""
echo -e "\${BLUE}Available photons:\${NC}"
echo ""

NEEDS_CONFIG=()
index=1

for photon in $PHOTONS; do
  # Get config template and check if it has env vars
  CONFIG_OUTPUT=$(photon get "$photon" --mcp 2>/dev/null)

  if echo "$CONFIG_OUTPUT" | grep -q '"env"'; then
    echo -e "  \${GREEN}[$index]\${NC} $photon \${YELLOW}(needs configuration)\${NC}"
    NEEDS_CONFIG+=("$photon")
    ((index++))
  else
    echo -e "  \${GREEN}[ ]\${NC} $photon (no configuration needed)"
  fi
done

if [ \${#NEEDS_CONFIG[@]} -eq 0 ]; then
  echo ""
  echo -e "\${GREEN}✅ All installed photons are ready to use!\${NC}"
  exit 0
fi

echo ""
echo -e "Which photon would you like to configure? \${GREEN}[1-\${#NEEDS_CONFIG[@]}]\${NC} (or 'q' to quit)"
read -p "> " choice

if [ "$choice" = "q" ] || [ "$choice" = "Q" ]; then
  echo "Cancelled."
  exit 0
fi

if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt \${#NEEDS_CONFIG[@]} ]; then
  echo -e "\${RED}Invalid choice\${NC}"
  exit 1
fi

SELECTED_PHOTON="\${NEEDS_CONFIG[$((choice-1))]}"

echo ""
echo -e "\${BLUE}═══════════════════════════════════════════════════════════\${NC}"
echo -e "\${BLUE}  Configuring: \${SELECTED_PHOTON}\${NC}"
echo -e "\${BLUE}═══════════════════════════════════════════════════════════\${NC}"
echo ""

# Get config template
CONFIG_JSON=$(photon get "$SELECTED_PHOTON" --mcp 2>/dev/null | tail -n +3)

# Extract env vars with placeholders
ENV_VARS=$(echo "$CONFIG_JSON" | jq -r ".$SELECTED_PHOTON.env | to_entries[] | \\"\(.key)=\(.value)\\"" 2>/dev/null)

if [ -z "$ENV_VARS" ]; then
  echo -e "\${GREEN}✅ This photon doesn't require configuration\${NC}"
  exit 0
fi

# Collect values for each env var
declare -A ENV_VALUES

echo "Please enter values for the following configuration:"
echo ""

while IFS= read -r line; do
  VAR_NAME=$(echo "$line" | cut -d'=' -f1)
  DEFAULT_VALUE=$(echo "$line" | cut -d'=' -f2-)

  # Check if it's a required field (has <your-...>)
  if [[ "$DEFAULT_VALUE" == \\<your-* ]]; then
    REQUIRED="\${RED}[REQUIRED]\${NC}"
    PROMPT="\${YELLOW}\${VAR_NAME}\${NC} \${REQUIRED}"
  else
    REQUIRED="\${GREEN}[OPTIONAL]\${NC}"
    PROMPT="\${YELLOW}\${VAR_NAME}\${NC} \${REQUIRED} (default: \${DEFAULT_VALUE})"
  fi

  echo -e "$PROMPT"
  read -p "> " user_value

  # Use default if empty and default exists
  if [ -z "$user_value" ] && [[ "$DEFAULT_VALUE" != \\<your-* ]]; then
    ENV_VALUES["$VAR_NAME"]="$DEFAULT_VALUE"
  elif [ -n "$user_value" ]; then
    ENV_VALUES["$VAR_NAME"]="$user_value"
  fi

  echo ""
done <<< "$ENV_VARS"

# Build the complete MCP server config
echo -e "\${BLUE}Building configuration...\${NC}"

# Create config JSON
ENV_JSON="{"
first=true
for key in "\${!ENV_VALUES[@]}"; do
  if [ "$first" = false ]; then
    ENV_JSON+=","
  fi
  first=false
  # Escape quotes in values
  value="\${ENV_VALUES[$key]//\\"/\\\\\\"}"
  ENV_JSON+="\\"$key\\":\\"\$value\\""
done
ENV_JSON+="}"

MCP_CONFIG=$(cat <<EOF
{
  "$SELECTED_PHOTON": {
    "command": "photon",
    "args": ["mcp", "$SELECTED_PHOTON"],
    "env": $ENV_JSON
  }
}
EOF
)

# Ensure config directory exists
mkdir -p "$(dirname "$CONFIG_PATH")"

# Read existing config or create new one
if [ -f "$CONFIG_PATH" ]; then
  EXISTING_CONFIG=$(cat "$CONFIG_PATH")
else
  EXISTING_CONFIG='{}'
fi

# Merge configs using jq
MERGED_CONFIG=$(echo "$EXISTING_CONFIG" | jq ".mcpServers += $MCP_CONFIG")

# Write back to file
echo "$MERGED_CONFIG" > "$CONFIG_PATH"

echo ""
echo -e "\${GREEN}✅ Configuration saved!\${NC}"
echo ""
echo -e "The \${YELLOW}$SELECTED_PHOTON\${NC} photon is now configured and ready to use."
echo -e "Configuration saved to: \${YELLOW}\${CONFIG_PATH}\${NC}"
echo ""
echo -e "\${BLUE}Next steps:\${NC}"
echo -e "1. Restart Claude Code to load the new MCP server"
echo -e "2. The $SELECTED_PHOTON tools will be available to Claude"
echo ""
echo -e "To configure another photon, run this script again."
`;

  const outputPath = path.join(scriptsDir, 'setup-photon.sh');
  await fs.writeFile(outputPath, script, { mode: 0o755 });
}
