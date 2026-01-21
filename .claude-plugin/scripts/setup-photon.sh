#!/bin/bash
# Interactive setup script for Photon MCP credentials
# This script helps users configure photons without sharing secrets with AI

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           Photon MCP Configuration Setup${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "This will help you configure photons that require credentials."
echo -e "Your credentials will be stored in: ${YELLOW}${CONFIG_PATH}${NC}"
echo -e "${GREEN}(Credentials are NOT shared with Claude AI)${NC}"
echo ""

# Check if photon CLI is installed
if ! command -v photon &> /dev/null; then
  echo -e "${RED}❌ Photon CLI not found.${NC}"
  echo -e "Installing..."
  npm install -g @portel/photon

  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install Photon CLI${NC}"
    exit 1
  fi
fi

# Get list of all available photons
echo -e "${BLUE}Fetching available photons...${NC}"
PHOTONS=$(photon get 2>/dev/null | grep "📦" | awk '{print $2}' | sort)

if [ -z "$PHOTONS" ]; then
  echo -e "${YELLOW}No photons found in ~/.photon/${NC}"
  echo -e "Install photons from the marketplace first:"
  echo -e "  photon add <name>"
  exit 0
fi

# List photons that need configuration (have env vars)
echo ""
echo -e "${BLUE}Available photons:${NC}"
echo ""

NEEDS_CONFIG=()
index=1

for photon in $PHOTONS; do
  # Get config template and check if it has env vars
  CONFIG_OUTPUT=$(photon get "$photon" --mcp 2>/dev/null)

  if echo "$CONFIG_OUTPUT" | grep -q '"env"'; then
    echo -e "  ${GREEN}[$index]${NC} $photon ${YELLOW}(needs configuration)${NC}"
    NEEDS_CONFIG+=("$photon")
    ((index++))
  else
    echo -e "  ${GREEN}[ ]${NC} $photon (no configuration needed)"
  fi
done

if [ ${#NEEDS_CONFIG[@]} -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ All installed photons are ready to use!${NC}"
  exit 0
fi

echo ""
echo -e "Which photon would you like to configure? ${GREEN}[1-${#NEEDS_CONFIG[@]}]${NC} (or 'q' to quit)"
read -p "> " choice

if [ "$choice" = "q" ] || [ "$choice" = "Q" ]; then
  echo "Cancelled."
  exit 0
fi

if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt ${#NEEDS_CONFIG[@]} ]; then
  echo -e "${RED}Invalid choice${NC}"
  exit 1
fi

SELECTED_PHOTON="${NEEDS_CONFIG[$((choice-1))]}"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Configuring: ${SELECTED_PHOTON}${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Get config template
CONFIG_JSON=$(photon get "$SELECTED_PHOTON" --mcp 2>/dev/null | tail -n +3)

# Extract env vars with placeholders
ENV_VARS=$(echo "$CONFIG_JSON" | jq -r ".$SELECTED_PHOTON.env | to_entries[] | \"(.key)=(.value)\"" 2>/dev/null)

if [ -z "$ENV_VARS" ]; then
  echo -e "${GREEN}✅ This photon doesn't require configuration${NC}"
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
  if [[ "$DEFAULT_VALUE" == \<your-* ]]; then
    REQUIRED="${RED}[REQUIRED]${NC}"
    PROMPT="${YELLOW}${VAR_NAME}${NC} ${REQUIRED}"
  else
    REQUIRED="${GREEN}[OPTIONAL]${NC}"
    PROMPT="${YELLOW}${VAR_NAME}${NC} ${REQUIRED} (default: ${DEFAULT_VALUE})"
  fi

  echo -e "$PROMPT"
  read -p "> " user_value

  # Use default if empty and default exists
  if [ -z "$user_value" ] && [[ "$DEFAULT_VALUE" != \<your-* ]]; then
    ENV_VALUES["$VAR_NAME"]="$DEFAULT_VALUE"
  elif [ -n "$user_value" ]; then
    ENV_VALUES["$VAR_NAME"]="$user_value"
  fi

  echo ""
done <<< "$ENV_VARS"

# Build the complete MCP server config
echo -e "${BLUE}Building configuration...${NC}"

# Create config JSON
ENV_JSON="{"
first=true
for key in "${!ENV_VALUES[@]}"; do
  if [ "$first" = false ]; then
    ENV_JSON+=","
  fi
  first=false
  # Escape quotes in values
  value="${ENV_VALUES[$key]//\"/\\\"}"
  ENV_JSON+="\"$key\":\"$value\""
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
echo -e "${GREEN}✅ Configuration saved!${NC}"
echo ""
echo -e "The ${YELLOW}$SELECTED_PHOTON${NC} photon is now configured and ready to use."
echo -e "Configuration saved to: ${YELLOW}${CONFIG_PATH}${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "1. Restart Claude Code to load the new MCP server"
echo -e "2. The $SELECTED_PHOTON tools will be available to Claude"
echo ""
echo -e "To configure another photon, run this script again."
